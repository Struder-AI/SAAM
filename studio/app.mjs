import { advancePlayback, frameAtTime, displayPoint, exportMovie } from './playback.mjs';
import { createProjection } from './camera.mjs';
import { buildToolpathView, toolpathFrame, toolpathStyle, createLayerFade, layerKey, remainingLayerMs, layerIndexAt, layerEndSeconds, stepLayerIndex, TOOLPATH_COLORS } from './toolpath-view.mjs';
import {buildGeometryView,createGeometryRenderer,pickGeometry} from './mesh-view.mjs';
import {buildMaterialScene,createMaterialRenderer} from './material-view.mjs';
import {hasSkill,regionRows,recipeRows,robotRows,materialGrams} from './settings.mjs';
import {moveStore} from './studio/move-store.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
const exportedThisSession=new Set();
const exportKey=()=>state?.printId+':'+state?.exportHash;
let state,tab='geometry',selected=null,yaw=-0.78,tilt=0.62,zoom=1,playing=false,frame=0,busy=false,fitBounds=null,seconds=0,lastFrame=0,polling=false,reconnecting=false;
const canvas=$('#canvas');
let polygons=[],drag=null,moved=false;
let redrawFrame=0;
let pathView,meshView;
let geometryScene,geometryRenderer,geometryProject,geometryError='';
let materialScene,materialRenderer,materialError='';
const layerFade=createLayerFade();
let movieController=null,movieUrl=null;
const viewStorageKey=()=> 'saam-view:'+state?.printId;
function saveView(){
  if(!state||movieController)return;
  try{sessionStorage.setItem(viewStorageKey(),JSON.stringify({exportHash:state.exportHash,yaw,tilt,zoom,fitBounds,seconds,tab,
    speed:Number($('#playback-speed').value),travel:$('#travel').checked,followPlate:$('#follow-plate').checked}));}catch{}
}
function restoreView(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(viewStorageKey()));if(!saved)return;
    if([saved.yaw,saved.tilt,saved.zoom].every(Number.isFinite)){yaw=saved.yaw;tilt=saved.tilt;zoom=saved.zoom;}
    if(Number.isFinite(saved.speed))$('#playback-speed').value=saved.speed;
    $('#speed-label').value=$('#playback-speed').value+'×';
    $('#travel').checked=saved.travel===true;$('#follow-plate').checked=saved.followPlate===true;
    if(saved.exportHash===state.exportHash){
      if(Number.isFinite(saved.seconds))seconds=Math.max(0,Math.min(duration(),saved.seconds));
      if(saved.fitBounds?.min?.length===3&&saved.fitBounds?.max?.length===3&&[...saved.fitBounds.min,...saved.fitBounds.max].every(Number.isFinite))fitBounds=saved.fitBounds;
      if(['geometry','plan','toolpath'].includes(saved.tab)&&(saved.tab!=='plan'||state.geometryApproved||state.inspection)&&(saved.tab!=='toolpath'||state.program))tab=saved.tab;
    }
    $('#fit-program').textContent=fitBounds?'Fit part':'Fit all moves';
  }catch{}
}
window.addEventListener('pagehide',saveView);
function requestDraw(){
  if(!redrawFrame)redrawFrame=requestAnimationFrame(()=>{redrawFrame=0;draw();});
}
const message=(text,error=false)=>{$('#message').textContent=text;$('#message').classList.toggle('error',error);};
const duration=()=>state?.program?.summary.motionSeconds??0;
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const round2=v=>Number(v).toFixed(2);
const materialFact=program=>program.summary.materialModel==='relay-estimate'
  ? ['Material estimate',round2(materialGrams(program.summary.estimatedRelayVolumeMm3))+' g from relay timing; unverified']
  : [program.envelope?'Part material estimate':'Material estimate',round2(materialGrams(program.summary.volumeMm3??program.volumeMm3))+' g'];
const materialSetup=state=>state.plan.setup.dobot||state.plan.setup.denso
  ? ['Extrusion','External relay control · '+state.plan.setup.material]
  : ['Material',state.plan.setup.material+' · '+state.plan.setup.nozzleC+'°C'];
const vaseSettings=state=>{
  if(state.plan.composition?.regions?.length)return [];
  const vase=state.plan.skills?.['vase-wall'];
  return vase?.enabled?[
    ['Vase wall','One continuous spiral; '+(vase.endTransition==='level'?'level rim':'spiral rim')],
    ['Vase component',vase.part??'Part'],
    ['Vase height range',vase.zStartMm+'–'+(vase.zEndMm??'geometry top')+' mm above component base'],
    ['Spiral sampling',vase.sampleStepMm+' mm maximum step · '+vase.toleranceMm+' mm tolerance']
  ]:[];
};
function machineSettings(state,rows){
  const d=state.plan.setup.dobot??state.plan.setup.denso;
  if(!d)return rows;
  const omitted=new Set(['Bed temperature','Build volume temperature','Retraction','Cooling fan','Filament diameter','Material flow limit']);
  return [...rows.filter(([name])=>!omitted.has(name)),...robotRows(state.plan)];
}
function stop(){playing=false;lastFrame=0;cancelAnimationFrame(frame);$('#play').textContent='Play';}
function activity(text=''){
  $('#activity').hidden=!text;$('#activity-label').textContent=text;
  $('main').setAttribute('aria-busy',String(!!text));
}
async function working(text,task){
  if(busy)return;busy=true;stop();activity(text);if(state)render();$('#open-print').disabled=true;
  // Paint the indicator before local parsing/drawing can occupy the UI thread.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{return await task();}
  finally{busy=false;activity();$('#open-print').disabled=false;if(state)render();}
}

// Studio reviews more than one kind of print. Everything that depends on which
// package produced the bundle lives here; the viewer, approvals and playback
// below are shared. A print names its kind in its own state.
const views={
  wedge:{
    eyebrow:'WEDGE DEMO',skinPhase:'inclined',skinLabel:'Sloped layers',exportName:'wedge.gcode',
    names:{'sloping-face':'Roof',base:'Bottom','front-side':'Front','back-side':'Back','right-side':'Right','left-side':'Left','high-end':'Tall end','low-end':'Low end'},
    facts(state,tab) {
      const {geometry:g,setup:s,process:p}=state.plan,roof=state.geometry.roof;
      const high=roof?.maxHeightMm??g.baseMm+g.runMm*Math.tan(g.angleDeg*Math.PI/180);
      if(tab==='geometry') {
        if(!roof)return [['Size',g.runMm+' × '+g.widthMm+' mm'],['Height',g.baseMm+'–'+high.toFixed(2)+' mm'],['Slope',g.angleDeg+'°']];
        const bounds=state.geometry.boundsMm,directions=[];
        if(Math.abs(roof.a)>1e-10)directions.push(roof.a>0?'right':'left');
        if(Math.abs(roof.b)>1e-10)directions.push(roof.b>0?'back':'front');
        return [['Size',round2(bounds.max[0])+' × '+round2(bounds.max[1])+' mm'],['Height',round2(roof.minHeightMm)+'–'+round2(high)+' mm'],
          ['Roof slope',round2(roof.angleDeg)+'°'],['Rises toward',directions.join(' + ')||'Level']];
      }
      if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
        ['Sloped layers',p.skinLayers+' × '+p.skinNormalMm+' mm'],['Travel height',high.toFixed(2)+' + '+p.liftMm+' mm']];
      return state.program?[['Layers',state.pathSummary.planarLayers+' flat + '+p.skinLayers+' sloped'],
        [state.program.envelope?'Printing motion':'Estimated motion',Math.round(duration()/60)+' min'],materialFact(state.program)]:[];
    },
    settings(state) {
      const {setup:s,process:p}=state.plan;
      return [['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC+'°C'],['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
        ['Flat / sloped speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
        ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
        ['Cooling fan',p.fanPercent+'%'],['Minimum layer time',p.minimumLayerSeconds+' s'],['Material flow limit',p.maxFlowMm3S+' mm³/s'],
        ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
        ['Fill','Solid; direction reverses each layer'],['Sloped passes','Back and forth'],['Startup',state.setupBasis]];
    }
  },
  shell:{
    eyebrow:'DEVELOPMENT PREVIEW',skinPhase:'draped-skin',skinLabel:'Draped skin',exportName:'part.gcode',
    // Faces are named by the shape that built them, so the label is the name.
    names:{},
    facts(state,tab) {
      const {geometry:g,setup:s,process:p}=state.plan,fill=state.plan.skills['full-fill'],skin=state.plan.skills['draped-skin'],normal=state.plan.skills['planar-infill'];
      const shape={assembly:'Assembly',box:'Box',wedge:'Wedge','spline-tube':'Bumpy spline tube',"spline-top":'Spline top surface',"spline-shell":'Tapered spline shell',"vertical-spline-shell":'Vertical spline shell'}[g.shape]??g.shape;
      if(tab==='geometry') {
        const bounds=state.geometry.boundsMm;
        const rows=[['Shape',shape],['Footprint',round2(bounds.max[0]-bounds.min[0])+' × '+round2(bounds.max[1]-bounds.min[1])+' mm'],['Height',round2(bounds.max[2]-bounds.min[2])+' mm']];
        if(g.shape==='pipe')rows.push(['Bore / outside diameter',2*g.innerRadiusMm+' / '+2*g.outerRadiusMm+' mm'],['Wall thickness',round2(g.outerRadiusMm-g.innerRadiusMm)+' mm']);
        if(g.shape==='spline-top'||g.shape==='spline-shell')rows.push(['Surface',g.cpU+' × '+g.cpV+' control points']);
        if(g.shape==='spline-shell')rows.push(['Side taper','Long sides in '+g.longSideInsetMm+' mm · short sides out '+g.shortSideOutsetMm+' mm']);
        if(g.shape==='vertical-spline-shell'){
          rows.push(['Surface',g.cpU+' × '+g.cpV+' control points']);
          rows.push(['Vertical wall outline','X out '+g.xBulgeMm+' mm · Y in '+g.yInsetMm+' mm']);
        }
        if(g.shape==='assembly')for(const part of g.parts)rows.push([part.id,part.geometry.shape+' at '+[part.xMm,part.yMm,part.zMm].join(', ')+' mm']);
        if(g.shape==='spline-tube')rows.push(['Circular bore',2*g.innerRadiusMm+' mm'],['Substrate height',g.heightMm+' mm'],['Outer spline',g.controlPoints.length+' × '+g.controlPoints[0].length+' control points'],['Surface meaning','Full-fill boundary; cladding builds outward']);
        return rows;
      }
      if(tab==='plan'&&state.plan.composition?.regions?.length)return [materialSetup(state),
        ['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],...regionRows(state.plan)];
      if(tab==='plan'&&hasSkill(state.plan,'pipe-cladding')){
        const clad=state.plan.skills['pipe-cladding'],surface=Boolean(clad.surface);
        return [materialSetup(state),['Body',surface?fill.perimeters+' perimeters + solid fill':'Concentric horizontal loops'],
          ['Exterior',clad.shells+' alternating axial / circumferential shells'],[surface?'Normal thickness per shell':'Radial thickness per shell',clad.normalMm+' mm'],
          ['Nozzle tilt',clad.tiltDeg+(surface?'° from the downward surface tangent toward the surface':'° inward from downward')],
          ['Axial passes',surface?'Local surface spacing with partial passes':'Full height'],['Between passes','Extrusion off'],...robotRows(state.plan)];
      }
      if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
        ['Body',normal?.enabled?normal.perimeters+' walls + '+Math.round(normal.density*100)+'% '+(normal.pattern??'rectilinear')+' infill':fill.enabled?fill.perimeters+' perimeters + solid fill':'Not printed'],...vaseSettings(state),
        ['Solid surfaces',normal?.enabled&&fill.enabled?fill.bottomLayers+' bottom / '+fill.topLayers+' top layers':'—'],
        ['Draped skin',skin.enabled?skin.layers+' × '+skin.normalMm+' mm along the surface':'None'],['Fill sequencing',(state.plan.composition?.batchLayers??1)+' layer(s) per component'],['Filled components',fill.parts?.join(', ')||'All'],['Roof component',skin.part??'Part roof']];
      if(!state.program)return [];
      const limit=state.pathSummary?.nonplanarLimit;
      const rows=[['Layers',(state.pathSummary?.fullFill?.layers??0)+' flat + '+(state.pathSummary?.drapedSkin?.skinLayers??0)+' draped'],
        [state.program.envelope?'Printing motion':'Estimated motion',Math.round(duration()/60)+' min'],materialFact(state.program)];
      if(state.program.summary?.materialModel==='relay-estimate')rows.push(['Material intent',round2(materialGrams(state.program.volumeMm3))+' g; not metered']);
      if(hasSkill(state.plan,'vase-wall'))rows.push(['Vase wall','Continuous spiral within its assigned region']);
      if(hasSkill(state.plan,'pipe-cladding'))rows.push(['Exterior shells',state.plan.skills['pipe-cladding'].shells+' · alternating axial / circumferential'],['Motion model','Nominal Cartesian + rotary; robot feasibility deferred']);
      if(state.pathSummary?.pipeCladding?.partialAxialPasses!==undefined)rows.push(['Partial vertical passes',String(state.pathSummary.pipeCladding.partialAxialPasses)],['Full vertical passes',String(state.pathSummary.pipeCladding.fullAxialPasses)]);
      if(state.plan.composition?.regions?.length)rows.push(...regionRows(state.plan));
      if(limit) {
        rows.push(['Surface not skinned',limit.excludedAreaPercent+'% steeper than '+limit.effectiveMaxAngleDeg+'°']);
        if(limit.experimentalOverride)rows.push(['Experimental override',limit.effectiveMaxAngleDeg+'° versus the profile’s '+limit.machineMaxAngleDeg+'°']);
      }
      return rows;
    },
    settings(state) {
      const {setup:s,process:p}=state.plan,fill=state.plan.skills['full-fill'],skin=state.plan.skills['draped-skin'];
      const contract=state.machine.outputs.find(o=>o.id===state.plan.output)?.constraints;
      const declaredLimit=state.machine.nonplanar?.maxAngleDeg,effectiveLimit=skin.maxAngleDegOverride??declaredLimit;
      return [['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC===0?'Heating off':s.buildVolumeC+'°C'],
        ...(contract?.bedType?[['Build surface',contract.bedType==='textured_plate'?'Textured PEI':contract.bedType],['Startup purge',contract.startupPurgeC+'°C · up to '+contract.startupPurgeFlowMm3S+' mm³/s']]:[]),
        ['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
        ['Flat / skin speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
        ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
        ['Cooling fan',p.fanPercent+'%'],['Minimum layer time',p.minimumLayerSeconds+' s'],['Material flow limit',p.maxFlowMm3S+' mm³/s'],
        ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
        ['Machine non-planar limit',(declaredLimit??'—')+'° (profile declaration)'],
        ['Travel','Comb up to '+p.maxCombMm+' mm; otherwise clear the whole plan by '+p.liftMm+' mm'],
        ['Startup',state.setupBasis]];
    }
  }
};
const view=()=>views[state?.kind==='shell'?'shell':'wedge'];
const label=id=>view().names[id]??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());

// Part bounds come from the display proxy both packages write, so the camera
// and the bed grid do not need to know which shape produced them.
function partBounds() {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of state.geometry.vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  return {min,max};
}

async function api(route,data) {
  const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({...data,printId:state?.printId})});
  if(!response.ok)throw new Error((await response.json()).error);
  return response;
}
async function refresh(follow=false,reopen=false) {
  const response=await fetch('/api/state');if(!response.ok)throw new Error((await response.json()).error);
  const next=await response.json(),previous=!reopen&&state?.printId===next.printId?state:null;
  if(next.program){
    if(previous?.program&&previous.exportHash===next.exportHash&&previous.planHash===next.planHash)next.program=previous.program;
    else try{
      const decoded=await decodeInWorker(next);
      next.program={...next.program,...decoded,summary:{...decoded.summary,...next.program.summary}};
    }catch(error){next.programError=error.message;delete next.program;next.toolpathApproved=false;}
  }
  state=next;
  if(!geometryScene||previous?.geometry.geometryVersion!==state.geometry.geometryVersion){
    geometryScene=buildGeometryView(state.geometry);meshView=geometryScene.topology;
    try{geometryRenderer??=createGeometryRenderer();geometryError=geometryRenderer?'':'Shading needs WebGL2; showing flat surfaces.';}
    catch(error){geometryError='Shading unavailable: '+error.message;}
  }
  pathView=state.program?buildToolpathView(state.program.moves):null;
  if(state.program&&materialScene?.moves!==state.program.moves){
    materialError='';
    try{
      materialRenderer??=createMaterialRenderer();
      if(materialRenderer)materialScene=await buildMaterialScene(state.program.moves,state.plan,state.geometry,
        {onProgress:progress=>activity('Preparing material view… '+Math.round(progress*100)+'%')});
      else materialError='3D material rendering needs WebGL2. Showing toolpath lines.';
    }catch(error){materialScene=null;materialError='Material view unavailable: '+error.message+' Showing toolpath lines.';}
  }
  layerFade.reset();
  if(previous?.exportHash!==next.exportHash){stop();seconds=duration();fitBounds=null;}
  if(!previous) {
    stop();selected=null;fitBounds=null;zoom=1;seconds=duration();
    tab=state.program?'toolpath':state.geometryApproved?'plan':'geometry';
    $('#kind-label').textContent=view().eyebrow+' · '+state.machine.name;
    $('#skin-label').textContent=view().skinLabel;
    document.title='SAAM Studio · '+state.printName;
    $('#open-print').title='Open print: '+state.printName;
    restoreView();
  }
  else if(follow&&previous.planHash!==state.planHash){tab=state.geometryApproved?'plan':'geometry';message('Updated from chat.');}
  else if(follow&&state.planApproved&&!previous.program&&state.program)tab='toolpath';
  if(!selected||!state.geometry.labels.includes(selected))selectFeature(null);
  render();
}
function decodeInWorker(snapshot){
  return new Promise((resolve,reject)=>{
    const worker=new Worker('/studio/source-worker.mjs',{type:'module'});
    worker.onmessage=({data})=>{
      worker.terminate();
      if(data.error)reject(new Error(data.error));
      else resolve({...data.program,moves:moveStore(data.program.moves)});
    };
    worker.onerror=event=>{worker.terminate();reject(new Error(event.message||'Unable to load the machine-code player.'));};
    worker.postMessage({printId:snapshot.printId,revision:snapshot.revision,exportHash:snapshot.exportHash,
      plan:snapshot.plan,machine:snapshot.machine,program:{sources:snapshot.program.sources}});
  });
}
function table(entries) {
  const dl=document.createElement('dl');
  for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  return dl;
}
function render() {
  $('.machine').textContent=state.machine.name;
  const stage={geometry:1,plan:2,toolpath:3}[tab];
  $('#stage-label').textContent='STEP '+stage+' OF 3';
  $('#view-title').textContent={geometry:'Your geometry',plan:'Your geometry',toolpath:'Your toolpath'}[tab];
  $('#prompt').textContent={geometry:'Look at the geometry.',plan:'Look at the settings.',toolpath:'Review the toolpath.'}[tab];
  $('#guidance').textContent={geometry:'Check the shape and size before continuing.',plan:'Confirm how this part will be printed.',toolpath:'Play it through, then confirm and export.'}[tab];
  $('#facts').replaceChildren(table(view().facts(state,tab)));
  $('#more-settings').hidden=tab!=='plan';
  $('#settings-detail').replaceChildren(table([...machineSettings(state,view().settings(state)),...recipeRows(state.plan)]));
  $('#planar-label').textContent=hasSkill(state.plan,'pipe-cladding')?'Body':'Flat layers';
  $('.dot.planar').style.background=TOOLPATH_COLORS.skyBlue;
  const samples=$('#axial-colors');samples.replaceChildren();samples.hidden=!hasSkill(state.plan,'pipe-cladding')||!pathView;
  const sampledPhases=new Set();
  if(!samples.hidden)for(const [index,group] of pathView.groups.entries()){
    const move=pathView.moves[group.first];
    const swatch={planar:{name:'Body · Sky blue',color:TOOLPATH_COLORS.skyBlue},'cladding-axial':{name:'Axial · Teal',color:TOOLPATH_COLORS.teal},'cladding-hoop':{name:'Circumferential · Orange',color:TOOLPATH_COLORS.orange}}[move.phase];
    if(!swatch||sampledPhases.has(move.phase))continue;
    sampledPhases.add(move.phase);
    const button=document.createElement('button'),dot=document.createElement('span');
    dot.className='dot';dot.style.background=swatch.color;
    button.append(dot,swatch.name);
    button.title='Inspect '+swatch.name;
    button.onclick=()=>{
      if(busy)return;
      stop();layerFade.reset();
      const end=pathView.groups[index+1];
      seconds=move.startSeconds+((end?pathView.moves[end.first].startSeconds:duration())-move.startSeconds)*(move.phase==='planar'?.98:.6);
      $('#scrub').value=seconds;requestDraw();
    };
    samples.append(button);
  }
  $('#skin-label').textContent=hasSkill(state.plan,'pipe-cladding')?'Circumferential':hasSkill(state.plan,'vase-wall')?'Skin / spiral':view().skinLabel;
  const ready=tab==='geometry'||(tab==='plan'&&state.geometryApproved)||(tab==='toolpath'&&state.planApproved&&state.program&&state.review.generation?.mode==='production');
  $('#confirm').disabled=!ready||busy;
  $('#confirm').textContent=tab==='geometry'?(state.geometryApproved?'Continue to settings':'Confirm geometry'):tab==='plan'?(state.planApproved?'View toolpath':'Confirm settings'):state.toolpathApproved?(exportedThisSession.has(exportKey())?'Export again':'Export print file'):'Confirm & export';
  $('#review-note').textContent=state.outputAvailability??(tab==='toolpath'?(state.programError??(!state.program?'The toolpath will appear after you confirm the settings.':!state.planApproved?'Preview only. Confirm geometry and settings before export.':state.program.notice??state.program.envelope?.notice??'Clearance is your check for this demo.')):'');
  $('#playback').hidden=tab!=='toolpath'||!state.program;
  $('#selection').hidden=tab==='toolpath';
  canvas.setAttribute('aria-label',tab==='toolpath'?'Toolpath viewer. Current layer is dark; earlier layers are faded. Drag or use arrow keys to rotate; scroll to zoom.':'Part viewer. Drag or use arrow keys to rotate; scroll to zoom; click a face to select it.');
  $('#scrub').max=duration();$('#scrub').value=seconds;
  $('#rotary-view').hidden=!state.plan.setup.denso;
  $$('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.classList.toggle('done',!!state[{geometry:'geometryApproved',plan:'planApproved',toolpath:'toolpathApproved'}[b.dataset.tab]]);b.disabled=busy||!state.inspection&&b.dataset.tab==='plan'&&!state.geometryApproved||b.dataset.tab==='toolpath'&&!state.program;});
  // Explicit local scratch adapters can describe historical paths without
  // assigning them a current skill or presenting manufacturing approval controls.
  $('#confirm').hidden=Boolean(state.inspection);
  if(state.inspection){
    const inspection=state.inspection;
    $('#stage-label').textContent='DEVELOPMENT INSPECTION';
    $('#view-title').textContent=inspection.title;
    $('#prompt').textContent=tab==='toolpath'?'Explore the historical toolpath.':tab==='plan'?'Original generator settings.':'Reference geometry.';
    $('#guidance').textContent=inspection.description;
    $('#facts').replaceChildren(table(tab==='plan'?inspection.settings:inspection.facts));
    $('#more-settings').hidden=true;
    $('#review-note').textContent=inspection.note;
  }
  requestDraw();
}
function selectFeature(id){selected=id;$('#selection').textContent=id?label(id):'Click a surface to select';requestDraw();}
function setTab(next){if(!state)return;tab=next;stop();layerFade.reset();render();}

function draw({target=canvas,width=canvas.clientWidth,height=canvas.clientHeight,ratio=devicePixelRatio||1,
  position=seconds,now=performance.now(),fadeState=layerFade,updateUI=true,
  playbackSpeed=playing?Number($('#playback-speed').value):0}={}) {
  const ctx=target.getContext('2d'),seconds=position;
  function segment(a,b,color,width=1){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  if(updateUI&&redrawFrame){cancelAnimationFrame(redrawFrame);redrawFrame=0;}
  if(!state)return;
  if(target.width!==Math.round(width*ratio)||target.height!==Math.round(height*ratio)){target.width=Math.round(width*ratio);target.height=Math.round(height*ratio);}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.globalAlpha=1;
  // Paint the CSS ellipse into the pixels too: movies have no CSS background.
  ctx.save();ctx.translate(width/2,height/2);ctx.scale(width/Math.SQRT2,height/Math.SQRT2);
  const background=ctx.createRadialGradient(0,0,0,0,0,1);background.addColorStop(0,'#f8faf1');background.addColorStop(1,'#eaf0e0');
  ctx.fillStyle=background;ctx.fillRect(-1,-1,2,2);ctx.restore();
  const bounds=partBounds(),skinPhase=view().skinPhase;
  const project=createProjection(tab==='toolpath'&&fitBounds?fitBounds:bounds,width,height,yaw,tilt,zoom);
  const strokeScale={lineWidthMm:state.plan.process.lineWidthMm,pixelsPerMm:project.pixelsPerMm};
  ctx.globalAlpha=1;
  for(let x=bounds.min[0]-10;x<=bounds.max[0]+10;x+=5)segment(project([x,bounds.min[1]-10,0]),project([x,bounds.max[1]+10,0]),'#dbe1d4',.6);
  for(let y=bounds.min[1]-10;y<=bounds.max[1]+10;y+=5)segment(project([bounds.min[0]-10,y,0]),project([bounds.max[0]+10,y,0]),'#dbe1d4',.6);
  ctx.globalAlpha=1;
  if(updateUI)polygons=[];
  if(tab!=='toolpath') {
    geometryProject=project;
    if(geometryRenderer){
      try{
        const options={project,width,height,ratio,color:TOOLPATH_COLORS.skyBlue,selected};
        // Project the actual silhouette onto the bed, retaining openings.
        geometryRenderer.draw(geometryScene,{...options,shadow:true});
        ctx.save();ctx.globalAlpha=.16;ctx.filter='blur(6px)';ctx.drawImage(geometryRenderer.canvas,0,0,width,height);ctx.restore();
        geometryRenderer.draw(geometryScene,options);ctx.drawImage(geometryRenderer.canvas,0,0,width,height);
      }catch(error){geometryError=error.message;geometryRenderer.dispose();geometryRenderer=null;}
    }
    if(!geometryRenderer){
      const pts=state.geometry.vertices.map(project);
      polygons=state.geometry.faces.map((face,i)=>({id:state.geometry.labels[i],edges:meshView.edgeMasks[i],points:face.map(j=>pts[j]),depth:face.reduce((sum,j)=>sum+pts[j][2],0)/face.length})).sort((a,b)=>a.depth-b.depth);
      for(const polygon of polygons){
        ctx.beginPath();polygon.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
        ctx.fillStyle=polygon.id===selected?'#83b5d6':TOOLPATH_COLORS.skyBlue;ctx.fill();
        for(let i=0;i<polygon.points.length;i++)if(polygon.edges[i])segment(polygon.points[i],polygon.points[(i+1)%polygon.points.length],'#5c879e',.6);
      }
    }
    if(updateUI)$('#selection').textContent=geometryError||(selected?label(selected):'Click a surface to select');
  }
  if(tab==='toolpath'&&state.program) {
    const moves=state.program.moves,at=frameAtTime(moves,seconds),count=at.completed,placement=state.plan.placement,showTravel=$('#travel').checked;
    if(updateUI)$('#layer-label').textContent='Layer '+(layerIndexAt(pathView,seconds)+1)+'/'+pathView.groups.length;
    const center=state.plan.setup.denso?.rotaryCenterMm??[0,0,0],angle=at.rotaryDeg??0;
    const local=p=>{const q=displayPoint(p,angle,center,!state.plan.setup.denso||$('#follow-plate').checked);return [q[0]-placement.xMm,q[1]-placement.yMm,q[2]];};
    if(state.plan.setup.denso){
      const radius=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1])*.65;
      let prior=null;
      for(let i=0;i<=80;i++){const a=i*Math.PI/40,q=project(local([center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a),center[2]]));if(prior)segment(prior,q,'#718d91',1);prior=q;}
      segment(project(local(center)),project(local([center[0]+radius,center[1],center[2]])),'#507b89',2);
    }
    const solidView=!!materialScene&&!!materialRenderer;
    const detail=!solidView||showTravel||materialScene.unsupported.length?toolpathFrame(pathView,count,showTravel):{segments:[]};
    if(updateUI)$('#viewer-detail').textContent=solidView
      ?'Shaded oval beads · solid completed layers.'+(materialScene.unsupported.length?' Line view for '+materialScene.unsupported.join(', ')+': surface frames unavailable.':'')
      :materialError||(detail.overview?'Layer overview · detail follows playback. Export keeps every point.':detail.reduced?'Curves simplified for display (0.02 mm). Export keeps every point.':'');
    const displayed=detail.partial?[...detail.segments,{...detail.partial,to:moves[count].from}]:detail.segments;
    const current=moves[at.active];
    const currentLayer=current?.phase==='finish'?moves.findLast(m=>m.extruding):current;
    const fade=fadeState.frame(currentLayer,now,remainingLayerMs(pathView,at.active,seconds,playbackSpeed)),styles=new Map();
    if(solidView){
      const materialProject=p=>project(local(p));materialProject.pixelsPerMm=project.pixelsPerMm;
      try{
        materialRenderer.draw(materialScene,{at,current:currentLayer,fade,project:materialProject,width,height,ratio,skinPhase});
        ctx.drawImage(materialRenderer.canvas,0,0,width,height);
      }catch(error){materialError=error.message;materialRenderer.dispose();materialRenderer=null;materialScene=null;if(!updateUI)throw error;requestDraw();}
    }
    // Draw the active layer last so older geometry cannot obscure it.
    for(const active of [false,true])for(const edge of displayed) {
      if(solidView&&edge.move.extruding&&materialScene?.supported[edge.first])continue;
      const key=layerKey(edge.move),styleKey=key+':'+!!edge.move.extruding;
      let style=styles.get(styleKey);
      if(!style){style=toolpathStyle(edge.move,currentLayer,skinPhase,fade.weights.get(key)??0,strokeScale);styles.set(styleKey,style);}
      if(style.active!==active)continue;
      ctx.globalAlpha=style.opacity;segment(project(local(edge.from)),project(local(edge.to)),style.color,style.width);
    }
    ctx.globalAlpha=1;
    // Finish an outgoing fade even when playback is paused at the boundary.
    if(updateUI&&fade.fading&&!playing)requestDraw();
    if(current&&at.fraction<1&&(current.extruding||showTravel)&&!(solidView&&materialScene?.supported[at.active])){
      const style=toolpathStyle(current,current,skinPhase,undefined,strokeScale);segment(project(local(current.from)),project(local(at.point)),style.color,style.width);
    }
    if(at.point){const axis=at.toolAxis??[0,0,-1],p=project(local(at.point)),q=project(local(at.point.map((v,i)=>v-axis[i]*6)));segment(p,q,'#273e36',3);ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fillStyle='#273e36';ctx.fill();
      if(updateUI)$('#time-label').textContent=clock(seconds)+' / '+clock(duration());
    }
  }
  const projectedOrigin=project([0,0,0]),origin=tab==='toolpath'?projectedOrigin:[width-48,height-42];
  ctx.globalAlpha=tab==='toolpath'?1:.65;
  ctx.font='10px Segoe UI';
  for(const [point,name,color] of [[[5,0,0],'X','#b26751'],[[0,5,0],'Y','#659a7a'],[[0,0,5],'Z','#638599']]){
    const p=project(point),end=tab==='toolpath'?p:[origin[0]+(p[0]-projectedOrigin[0])*5/project.pixelsPerMm,origin[1]+(p[1]-projectedOrigin[1])*5/project.pixelsPerMm];segment(origin,end,color,tab==='toolpath'?1.5:1);
    if(Math.hypot(end[0]-origin[0],end[1]-origin[1])>1){ctx.fillStyle=color;ctx.fillText(name,end[0]+4,end[1]-4);}
  }
  ctx.globalAlpha=1;
  ctx.font='10px Segoe UI';ctx.fillStyle='#71836b';ctx.fillText('5 mm grid',18,height-18);
}

canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];moved=false;};
canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag[0],dy=e.clientY-drag[1];if(Math.abs(dx)+Math.abs(dy)>2)moved=true;yaw+=dx*.008;tilt=Math.max(-1.5,Math.min(1.5,tilt+dy*.008));drag=[e.clientX,e.clientY];requestDraw();};
canvas.onpointerup=e=>{drag=null;if(!moved&&tab!=='toolpath'&&geometryProject){const rect=canvas.getBoundingClientRect();selectFeature(pickGeometry(geometryScene,geometryProject,e.clientX-rect.left,e.clientY-rect.top));}};
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.08,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));requestDraw();},{passive:false});
canvas.onkeydown=e=>{if(e.key==='ArrowLeft')yaw-=.1;else if(e.key==='ArrowRight')yaw+=.1;else if(e.key==='ArrowUp')tilt-=.1;else if(e.key==='ArrowDown')tilt+=.1;else return;e.preventDefault();requestDraw();};
new ResizeObserver(requestDraw).observe(canvas);
$$('[data-view]').forEach(b=>b.onclick=()=>{const mode=b.dataset.view;if(mode==='iso'){yaw=-.78;tilt=.62;}if(mode==='side'){yaw=0;tilt=0;}if(mode==='top'){yaw=0;tilt=Math.PI/2;}requestDraw();});
$('#reset-view').onclick=()=>{zoom=1;yaw=-.78;tilt=.62;fitBounds=null;$('#fit-program').textContent='Fit all moves';requestDraw();};
$('#fit-program').onclick=()=>{
  if(fitBounds){fitBounds=null;$('#fit-program').textContent='Fit all moves';}
  else {
    const part=partBounds();
    fitBounds={min:[part.min[0],part.min[1],0],max:[part.max[0],part.max[1],0]};
    for(const move of state.program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){
      const v=p[i]-(i===0?state.plan.placement.xMm:i===1?state.plan.placement.yMm:0);
      fitBounds.min[i]=Math.min(fitBounds.min[i],v);fitBounds.max[i]=Math.max(fitBounds.max[i],v);
    }
    $('#travel').checked=true;$('#fit-program').textContent='Fit part';
  }
  zoom=1;requestDraw();
};
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
async function approval(stage){await api('approve',{stage,actor:'Local user',revision:state.revision});await refresh();}
async function download(){
  const response=await api('deliver',{});
  if(!response.ok){const error=await response.json();throw new Error(error.error??'Export failed.');}
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');
  a.href=url;a.download=state.exportName??view().exportName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  exportedThisSession.add(exportKey());
}
$('#confirm').onclick=async()=>{
  if(busy||!state)return;message('');
  try{
    await working(tab==='toolpath'?'Checking and exporting your print…':tab==='plan'?'Saving settings and preparing your toolpath…':'Saving geometry confirmation…',async()=>{
    if(tab==='geometry'){if(!state.geometryApproved)await approval('geometry');tab='plan';}
    else if(tab==='plan'){if(!state.planApproved)await approval('plan');if(!state.program||state.review.generation?.mode!=='production'){activity('Generating and checking your toolpath…');await api('generate',{development:false});activity('Loading the checked toolpath…');await refresh();}tab='toolpath';}
    else {if(!state.toolpathApproved)await approval('toolpath');await download();}
    message('');
    });
  }catch(e){message(e.message,true);}
};
async function openPrint(path){
  if(busy)return;
  saveView();
  $('#picker-message').textContent='';$('#print-picker').close();
  try{await working('Opening and checking your saved print…',async()=>{await api('open',{path});await refresh(false,true);message('');});}
  catch(error){message(error.message,true);$('#picker-message').textContent=error.message;$('#print-picker').showModal();}
}
$('#open-print').onclick=async()=>{
  if(busy)return;$('#print-picker').showModal();$('#picker-message').textContent='Loading saved prints…';$('#print-list').replaceChildren();
  try{
    const response=await fetch('/api/prints');if(!response.ok)throw new Error('Could not list local prints.');
    const {prints}=await response.json();
    for(const print of prints){const button=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('span');
      name.textContent=print.name;detail.textContent=print.machine;button.append(name,detail);button.title=print.path;button.onclick=()=>openPrint(print.path);$('#print-list').append(button);}
    $('#picker-message').textContent=prints.length?'':'No saved prints found here. Enter a local print folder below.';
  }catch(error){$('#picker-message').textContent=error.message;}
};
$('#close-picker').onclick=()=>$('#print-picker').close();
$('#open-path').onsubmit=event=>{event.preventDefault();openPrint($('#print-path').value.trim());};
$('#travel').onchange=requestDraw;
$('#follow-plate').onchange=requestDraw;
$('#playback-speed').oninput=()=>{$('#speed-label').value=$('#playback-speed').value+'×';};
$('#scrub').oninput=()=>{stop();layerFade.reset();seconds=Number($('#scrub').value);requestDraw();};
function stepLayer(direction){
  if(busy||!pathView||!pathView.groups.length)return;
  stop();layerFade.reset();
  seconds=layerEndSeconds(pathView,stepLayerIndex(pathView,seconds,direction));
  $('#scrub').value=seconds;requestDraw();
}
$('#prev-layer').onclick=()=>stepLayer(-1);
$('#next-layer').onclick=()=>stepLayer(1);
$('#cancel-movie').onclick=()=>movieController?.abort();
$('#export-movie').onclick=async()=>{
  if(busy||!state?.program)return;
  saveView();stop();requestDraw();busy=true;
  const controller=new AbortController();movieController=controller;
  const controls=$$('button,input').filter(element=>element.id!=='cancel-movie');
  const disabled=controls.map(element=>element.disabled);
  controls.forEach(element=>element.disabled=true);canvas.inert=true;
  $('#cancel-movie').hidden=false;$('#movie-progress').hidden=false;$('#movie-progress').value=0;
  $('#movie-download').hidden=true;
  const speed=Number($('#playback-speed').value),width=canvas.clientWidth,height=canvas.clientHeight,ratio=devicePixelRatio||1;
  const target=document.createElement('canvas');target.width=Math.round(width*ratio);target.height=Math.round(height*ratio);
  const fadeState=createLayerFade();
  $('#movie-status').textContent='Rendering movie at '+speed+'× · '+clock(duration()/speed+2)+' · 30 fps. Your viewer stays paused.';
  try{
    const blob=await exportMovie({canvas:target,duration:duration(),speed,signal:controller.signal,
      draw:frame=>draw({target,width,height,ratio,position:frame.seconds,now:frame.now,fadeState,updateUI:false,playbackSpeed:speed}),
      onProgress:value=>{$('#movie-progress').value=value;}});
    if(movieUrl)URL.revokeObjectURL(movieUrl);movieUrl=URL.createObjectURL(blob);
    const link=$('#movie-download');link.href=movieUrl;
    link.download=(state.printName??'saam').replace(/[^a-zA-Z0-9_-]/g,'-')+'-toolpath-'+speed+'x.webm';
    link.hidden=false;link.click();
    $('#movie-status').textContent='Movie ready · '+clock(duration()/speed+2)+' · '+(blob.size/1024/1024).toFixed(1)+' MB WebM. Includes the final fade.';
  }catch(error){$('#movie-status').textContent=controller.signal.aborted?'Movie export cancelled.':error.message;}
  finally{
    movieController=null;busy=false;controls.forEach((element,index)=>element.disabled=disabled[index]);canvas.inert=false;
    $('#cancel-movie').hidden=true;$('#movie-progress').hidden=true;render();
  }
};
$('#play').onclick=()=>{if(playing){stop();requestDraw();return;}if(seconds>=duration()){seconds=0;layerFade.reset();}playing=true;lastFrame=0;$('#play').textContent='Pause';frame=requestAnimationFrame(animate);};
function animate(now){
  if(!playing)return;
  if(lastFrame)seconds=advancePlayback(seconds,now-lastFrame,Number($('#playback-speed').value),duration());
  lastFrame=now;$('#scrub').value=seconds;draw();
  if(seconds>=duration()){stop();requestDraw();return;}frame=requestAnimationFrame(animate);
}
async function poll(){
  if(polling||busy)return;polling=true;
  try{
    const response=await fetch('/api/revision');if(!response.ok)throw new Error('Reconnecting to your print…');
    const next=await response.json();if(movieController)return;
    if(reconnecting)message('');
    if(!state||reconnecting||next.fingerprint!==state.fingerprint)await working('Loading and checking the updated print…',()=>refresh(true));
    reconnecting=false;
  }catch(e){reconnecting=true;$('#confirm').disabled=true;message('Your print is updating. Reconnecting…');}
  finally{polling=false;}
}
working('Loading and checking your print…',()=>refresh()).catch(e=>message(e.message,true));
setInterval(poll,1000);
