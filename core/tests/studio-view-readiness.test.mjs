import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {agentIndicator,requestReceiptState,activeEditStage} from '../../studio/work-state.mjs';
import {needsTourToolpath} from '../../studio/tour-ui.mjs';
import {TOUR_LESSONS as L} from '../../studio/tour-catalog.mjs';
import {createProjection} from '../../studio/camera.mjs';
import {buildGeometryView,visibleGeometryEdgeSegments} from '../../studio/mesh-view.mjs';
import {TOOLPATH_COLORS} from '../../studio/toolpath-view.mjs';

const app=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
const agentSource=(await readFile(new URL('../../studio/agent-ui.mjs',import.meta.url),'utf8'))
  // `.` excludes \r, so the line matches must tolerate a CRLF checkout.
  .replace(/^import [^\n]*\n/gm,'').replace(/^export \{[^\n]*\n/gm,'').replace('export function createAgentUI','function createAgentUI');
function section(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from);
  if(from<0||to<0)throw Error('Browser test extraction boundary changed: '+start);
  return app.slice(from,to);
}

test('compact review updates retain playback and avoid loading the scene again',async()=>{
  let reloads=0,renders=0;
  const state={fingerprint:'old-review',presentationFingerprint:'same-source',instanceId:'studio',seconds:12,tour:{active:false}};
  const context=vm.createContext({state,polling:false,busy:false,reconnecting:false,movieController:null,URLSearchParams,
    fetch:async()=>({ok:true,json:async()=>({instanceId:'studio',fingerprint:'new-review',presentationFingerprint:'same-source',
      reviewUpdate:{revision:'approved',toolpathApproved:true},tour:{active:false}})}),
    needsTourToolpath:()=>false,render:()=>renders++,working:async(_text,action)=>action(),refresh:()=>reloads++,
    message(){},agentUI:{settled(){}},$:()=>({}),window:{location:{reload(){throw Error('Unexpected reload');}}}});
  vm.runInContext(section('async function poll(){','\nfunction seekTourLayer('),context);
  await context.poll();
  assert.equal(reloads,0);assert.equal(renders,1);assert.equal(state.seconds,12);
  assert.equal(state.toolpathApproved,true);assert.equal(state.revision,'approved');assert.equal(state.fingerprint,'new-review');
});

test('one pure classifier defines geometry and toolpath presentation readiness',()=>{
  const work={snapshot:{inputKey:'current',generationKey:'generated'}};
  assert.deepEqual(requestReceiptState(null,{state:{work,geometry:{}},stage:'geometry'}),
    {activity:'idle',receipt:true,awaitingConfirmation:false});
  assert.equal(requestReceiptState(null,{state:{work,program:{}},stage:'toolpath'}).receipt,true);
  assert.equal(requestReceiptState(null,{state:{work,program:{},generationError:'failed'},stage:'toolpath'}).receipt,false);
  assert.equal(requestReceiptState(null,{state:{work,program:{}},stage:'toolpath',requiresToolpath:true}).receipt,false);
  assert.equal(requestReceiptState(null,{state:{work},stage:'geometry'}).receipt,false);
});
const browserCode=[
  section('async function working(text,task,','\n// Studio reviews'),
  section('async function acknowledgeDisplayedView(){','\nasync function decodeInWorker'),
  section('function setTab(next){','\n'),
  section('async function approval(){','\nasync function download'),
  section("$('#confirm').onclick=async()=>{",'\nasync function openPrint')
].join('\n');

function element(){
  const classes=new Set();
  return {hidden:false,disabled:false,textContent:'',setAttribute(){},
    classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)}};
}

// Exercise the real click handler, readiness acknowledgement, busy lifecycle and
// agent indicator together. Network generation and drawing are controlled seams;
// the refresh seam presents its loaded snapshot through the real readiness code.
async function confirmationHarness({stored=false,generationError,tour=false,pending=false,painting=true}={}){
  const nodes=new Map(),events=[],calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  get('agent-status').querySelector=()=>get('typing-dots');
  const request={id:'edit',printId:'part',status:'working',updatedAt:1,expiresAt:Date.now()+60000,
    baseline:{inputKey:'before',generationKey:null},target:{inputKey:'current',stage:'toolpath'}};
  const snapshot={inputKey:'current',generationKey:stored?'generated':null};
  const state={printId:'part',revision:'review-1',planHash:'plan',
    ...(tour?{localPrintDirectory:'part',tour:{active:true,step:5,directory:'part'}}:{}),
    work:{printId:'part',snapshot,requests:[request]},review:{generation:stored?{mode:'production'}:null},
    ...(stored?{program:{},exportHash:'export'}:{})};
  let context;
  context=vm.createContext({state,busy:false,generating:false,acknowledging:false,tab:'geometry',L,needsTourToolpath,agentIndicator,requestReceiptState,activeEditStage,
    generationPending:()=>pending,stalePresentation:pending?{program:{}}:null,
    document:{getElementById:get,addEventListener(){}},$:selector=>get(selector.slice(1)),addEventListener(){},setInterval(){},
    fetch:async()=>({ok:true,json:async()=>({requests:[request]})}),
    requestAnimationFrame:callback=>{if(painting)queueMicrotask(()=>{events.push('paint:'+context.tab);callback();});},
    setTimeout:(callback,ms)=>setTimeout(callback,painting?ms:0),clearTimeout,
    stop(){},clearManual(){},clearProgramView(){},cameras:{mode:'ghost'},layerFade:{reset(){}},
    activity(){},message(text,error){if(error)events.push('error:'+text);},
    render(){events.push('render:'+context.tab);},
    tourUI:{active:()=>tour,async acknowledgeView(current,stage){
      events.push('ack:'+stage);
      assert.equal(context.busy,true,'the loading lifecycle remains active until acknowledgement finishes');
      assert.equal(get('typing-dots').hidden,false);
      assert.equal(current.program!==undefined,true);
    }},
    async api(route){
      calls.push(route);
      if(route==='approve')return {json:async()=>({approval:{programAvailable:stored}})};
      if(route==='generate'){
        if(generationError)throw Error(generationError);
        return {};
      }
      throw Error('Unexpected mutation: '+route);
    },
    async refresh(){
      events.push('refresh:'+context.tab);
      context.state={...context.state,program:{},exportHash:'export',review:{generation:{mode:'production'}},
        work:{...context.state.work,snapshot:{inputKey:'current',generationKey:'generated'}}};
      context.agentUI.received(context.state.work);
      context.render();
      await vm.runInContext('acknowledgeDisplayedView()',context);
    }
  });
  vm.runInContext(agentSource+'\nagentUI=createAgentUI();\n'+browserCode,context);
  await context.agentUI.refresh();
  context.agentUI.received(state.work);
  await get('confirm').onclick();
  return {context,nodes,events,calls};
}

for(const stored of [false,true])test('geometry action acknowledges rendered '+(stored?'stored':'newly generated')+' toolpath',async()=>{
  const {context,nodes,events,calls}=await confirmationHarness({stored});
  assert.deepEqual(calls,stored?[]:['generate']);
  assert.equal(context.tab,'toolpath');
  const displayed=events.indexOf('render:toolpath'),ack=events.indexOf('ack:toolpath');
  assert.ok(displayed>=0&&ack>displayed,'toolpath renders before its acknowledgement');
  assert.ok(events.slice(displayed+1,ack).filter(event=>event==='paint:toolpath').length>=2,
    'acknowledgement waits for the rendered view to paint');
  assert.equal(events.filter(event=>event.startsWith('ack:')).length,1);
  assert.equal(context.busy,false);
  assert.equal(nodes.get('open-print').disabled,false);
  assert.equal(nodes.get('typing-dots').hidden,true,'the still-working request is satisfied by its displayed result');
  assert.equal(nodes.get('canvas').classList.contains('work-faded'),false);
});

test('tour geometry action generates without changing the lesson',async()=>{
  const {context,nodes,calls}=await confirmationHarness({tour:true});
  assert.deepEqual(calls,['generate']);
  assert.equal(context.state.tour.step,5);assert.equal(context.tab,'toolpath');
  assert.equal(nodes.get('typing-dots').hidden,true);
});

test('new geometry remains active until it satisfies the pending toolpath target',()=>{
  const request={status:'working',updatedAt:1,expiresAt:Date.now()+60000,
    baseline:{inputKey:'before'},target:{inputKey:'after',stage:'toolpath'}};
  const view={ready:true,awaitingConfirmation:false,snapshot:{inputKey:'after',stage:'geometry'}};
  assert.equal(agentIndicator([request],{view}).active,true);
  assert.equal(agentIndicator([request],{view:{...view,loading:true}}).active,true);
  assert.equal(agentIndicator([{...request,baseline:{inputKey:'after'},target:undefined}],{view}).active,true,'unprepared work on this reviewed shape remains visible');
});

test('a pending toolpath generation lets Next return to its faded pane without regenerating',async()=>{
  const {context,calls,events}=await confirmationHarness({pending:true});
  assert.deepEqual(calls,[],'no calculation is launched while one is already pending');
  assert.equal(context.tab,'toolpath','Next moves to the faded toolpath pane');
  assert.equal(context.busy,false,'navigation does not enter the blocking work lifecycle');
  assert.ok(events.includes('render:toolpath'));
});

test('a toolpath-only generation dims that pane but leaves the geometry pane crisp',()=>{
  const request={id:'edit',printId:'part',status:'working',updatedAt:1,expiresAt:Date.now()+60000,
    baseline:{inputKey:'before',generationKey:null},target:{inputKey:'current',stage:'toolpath'}};
  const view={printId:'part',ready:false,snapshot:{inputKey:'current',stage:'toolpath'}};
  assert.equal(activeEditStage([request],{view}),'toolpath');
  assert.equal(activeEditStage([request],{view:{...view,loading:true,loadingStage:'toolpath'}}),'toolpath');
  // A concurrent geometry-scoped edit widens the scope so both panes dim.
  assert.equal(activeEditStage([request,{...request,id:'geo',target:{inputKey:'current',stage:'geometry'}}],{view}),'all');
  assert.equal(activeEditStage([],{view:{...view,loading:true}}),'all','an unscoped full load dims everything');
  assert.equal(activeEditStage([],{view}),null,'idle work dims nothing');
});

test('failed generation settles loading without acknowledging an absent toolpath',async()=>{
  const {context,nodes,events,calls}=await confirmationHarness({generationError:'Synthetic generation failure'});
  assert.deepEqual(calls,['generate']);
  assert.equal(events.some(event=>event.startsWith('ack:')),false);
  assert.ok(events.includes('error:Synthetic generation failure'));
  assert.equal(context.busy,false);
  assert.equal(nodes.get('open-print').disabled,false);
  assert.equal(nodes.get('typing-dots').hidden,true);
  assert.equal(nodes.get('canvas').classList.contains('work-faded'),false);
});

// The toolpath viewport must never be empty: without a current program it draws
// the previous toolpath when one is retained, otherwise the part being sliced.
const placeholderGeometry={
  vertices:[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]],
  faces:[[0,1,2,3],[7,6,5,4],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]],
  labels:['bottom','top','front','right','back','left'],boundsMm:{min:[0,0,0],max:[10,10,10]},geometryVersion:1};
function placeholderContext({program=null,stale=null,tab='toolpath'}={}){
  const scene=buildGeometryView(placeholderGeometry,35,[]);
  const ctx={strokeStyle:'',fillStyle:'',lineWidth:1,font:'',filter:'',globalAlpha:1,fills:0,strokes:0,
    save(){},restore(){},translate(){},scale(){},setTransform(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},arc(){},
    fillRect(){},fillText(){},drawImage(){},createRadialGradient:()=>({addColorStop(){}}),
    fill(){this.fills++;},stroke(){this.strokes++;}};
  const inputs={'#travel':{checked:false},'#follow-plate':{checked:true},'#previous-layer-opacity':{value:'50'},'#playback-speed':{value:'10'}};
  const canvas={clientWidth:800,clientHeight:600,width:0,height:0,getContext:()=>ctx,
    classList:{names:new Set(),toggle(name,on){if(on)this.names.add(name);else this.names.delete(name);}}};
  const state={printId:'part',geometry:placeholderGeometry,plan:{placement:{xMm:0,yMm:0},process:{lineWidthMm:.42},setup:{}},
    ...(program?{program}:{})};
  const context=vm.createContext({state,tab,stalePresentation:stale,generating:false,agentUI:{generating:()=>false},
    canvas,ctx,seconds:0,playing:false,movieController:null,layerFade:{frame:()=>({weights:new Map(),fading:false}),reset(){}},
    devicePixelRatio:1,performance,redrawFrame:0,cancelAnimationFrame(){},requestAnimationFrame:()=>1,
    motionQuality:null,lastMotion:0,lastMovingFrame:0,redrawRequested:0,settleTimer:0,playing:false,drag:null,lastWheel:0,viewPerformance:{frame(){},flush(){}},
    createProjection,visibleGeometryEdgeSegments,TOOLPATH_COLORS,
    geometryScene:scene,meshView:scene.topology,geometryRenderer:null,geometryProject:null,geometryError:'',polygons:[],selected:null,
    fitBounds:null,yaw:-.78,tilt:.62,zoom:1,pan:[0,0],cameras:{mode:'ghost'},
    partBounds:()=>({min:[0,0,0],max:[10,10,10]}),view:()=>({skinPhase:'draped-skin',names:{}}),label:id=>id,
    machineDisplay:()=>null,requestMachinePose(){},updateMachineStatus(){},requestDraw(){},transform:p=>p,
    $:selector=>inputs[selector]??{value:'',checked:false,textContent:'',hidden:false}});
  vm.runInContext(section('const presentedState=','const clock=')+'\n'+section('function draw({target=canvas','\nfunction planCanvasDrag('),context);
  return context;
}

test('the toolpath viewport falls back to the sliced geometry whenever no program can be drawn',()=>{
  const context=placeholderContext();
  assert.equal(vm.runInContext('toolpathPlaceholder()',context),true,'the pane is faded rather than empty');
  assert.equal(vm.runInContext('showingGeometry()',context),true);
  vm.runInContext('draw()',context);
  assert.equal(context.polygons.length,placeholderGeometry.faces.length,'the part being sliced is drawn');
  assert.ok(context.ctx.fills>=placeholderGeometry.faces.length);
});

test('a retained previous toolpath still replaces the geometry while its replacement is prepared',()=>{
  const context=placeholderContext({stale:{program:{moves:[]},plan:{placement:{xMm:0,yMm:0}}}});
  assert.equal(vm.runInContext('toolpathPlaceholder()',context),true,'the pane is still a faded placeholder');
  assert.equal(vm.runInContext('showingGeometry()',context),false,'the previous toolpath is preferred over the geometry');
});

test('a tab that never paints still finishes opening and loading',async()=>{
  const {context,nodes,calls}=await confirmationHarness({painting:false});
  assert.deepEqual(calls,['generate'],'the work ran without waiting for a frame callback');
  assert.equal(context.tab,'toolpath');
  assert.equal(context.busy,false,'the loading overlay is dismissed');
  assert.equal(nodes.get('open-print').disabled,false);
});

test('a current program leaves the toolpath pane unfaded and geometry-free',()=>{
  const context=placeholderContext({program:{moves:[]}});
  assert.equal(vm.runInContext('toolpathPlaceholder()',context),false);
  assert.equal(vm.runInContext('showingGeometry()',context),false);
  assert.equal(vm.runInContext('showingGeometry()',placeholderContext({tab:'geometry'})),true,'the geometry pane always draws the part');
});
