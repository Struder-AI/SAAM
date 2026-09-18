import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {agentIndicator,requestReceiptState,activeEditStage} from '../../studio/work-state.mjs';
import {needsTourToolpath} from '../../studio/tour-ui.mjs';
import {TOUR_LESSONS as L} from '../../studio/tour-catalog.mjs';

const app=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
const agentSource=(await readFile(new URL('../../studio/agent-ui.mjs',import.meta.url),'utf8'))
  .replace(/^import .*\n/gm,'').replace(/^export \{.*\n/gm,'').replace('export function createAgentUI','function createAgentUI');
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
  vm.runInContext(section('async function poll(){','\ntourUI=createTourUI'),context);
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
async function confirmationHarness({stored=false,generationError,tour=false,pending=false}={}){
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
    document:{getElementById:get},$:selector=>get(selector.slice(1)),addEventListener(){},setInterval(){},
    fetch:async()=>({ok:true,json:async()=>({requests:[request]})}),
    requestAnimationFrame:callback=>queueMicrotask(()=>{events.push('paint:'+context.tab);callback();}),
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
