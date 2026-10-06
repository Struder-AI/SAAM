import {initializeChatUI} from './chat-ui.mjs';
import {invert,point} from '../core/geom/frame.mjs';
import {createTourUI,needsTourToolpath} from './tour-ui.mjs';
import { advancePlayback, exportMovie } from './playback.mjs';
import { createLayerFade, layerEndSeconds, layerIndexAt, representativeLayer, stepLayerIndex } from './toolpath-view.mjs';
import {DEFAULT_PHASE_COLOURS} from '../core/print/phase-colours.mjs';
import {hasConstruction,sliceSummary,recipeRows,materialGrams,nextExportName,depositionFamilyRows} from './settings.mjs';
import {sourceSession,machineCameras} from './studio/machine-session.mjs';
import {machineFitBounds,boundsCorners,machinePalette} from './machine-view.mjs';
import {createViewerRenderer} from './viewer-renderer.mjs';
import {planRefreshNavigation,outputView} from './refresh-plan.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';
import {prepareStudioState,withoutPreviewMaterial} from './studio-state.mjs';
import {studioControls} from './studio-controls.mjs';
import {loadSavedPath} from './path-preview.mjs';
import {viewerConnected} from './viewer-session.mjs';
import {createServicePanel} from './service-panel.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
createServicePanel({token,available:$('meta[name="saam-service"]').content==='on'});
const NO_PRINT='Open a print, import STL or ask your agent to make a part.';
// Title: the server's runtime name ("SAAM Studio 0.3.6" or "SAAM Studio source"), the print, then the port,
// which alone tells every window apart and by which opening SAAM again finds it (studio/raise-window.ps1).
const studioName=document.title,studioTitle=printName=>[studioName,printName,location.port].filter(Boolean).join(' · ');
document.title=studioTitle();
const exportedThisSession=new Set();
const exportKey=()=>printSync.state?.printId+':'+printSync.state?.outputId;
// Page state, one record per owner: the print and its server sync, Studio-run
// work, what the view shows, the orbit camera, playback, and the machine pose.
const printSync={state:undefined,stateTag:null,stateUpdate:0,loadedUpdate:0,polling:false,reconnecting:false,changeTimer:undefined,stateFallbackTimer:undefined,progressFallbackTimer:undefined,progressPolling:false};
const studioWork={busy:false,generating:false,generationTarget:null,acknowledging:false,importElapsedTimer:null,episodeWorking:false,tourUI:undefined};
const viewState={tab:'geometry',selected:null,activePresentation:null,exportNameState:null,machineColors:machinePalette,waveBoundsMoves:null,waveDisplayBounds:null};
const orbitView={yaw:-0.78,tilt:0.62,zoom:1,pan:[0,0],fitBounds:null,drag:null,moved:false};
const playState={playing:false,frame:0,seconds:0,lastFrame:0,playbackEpoch:0,movieController:null,movieUrl:null};
const machinePose={machineSession:null,requestingPose:null,manualValues:null,manualJog:null,manualDescriptor:null};
import {TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createAgentUI} from './agent-ui.mjs';
const agentUI=initializeAgentInterface();
function initializeAgentInterface(){return createAgentUI({onActivity:active=>studioWork.tourUI?.activity(active),onWork:active=>{studioWork.episodeWorking=active;if(printSync.state)render();},onRequests:requests=>{
  if(!printSync.state?.work)return;
  printSync.state.work.requests=requests;
  if(needsTourToolpath(printSync.state))scheduleChange();
},onPresentation:failure=>{if(!studioWork.busy)void acknowledgeDisplayedView(failure).catch(error=>message(error.message,true));},getStage:()=>viewState.tab});}
const canvas=$('#canvas');
// View bursts go to the server for agents; failures never reach the person.
// Material detail drops while the view moves and the measured frame cost is
// high; one full-detail frame follows when motion stops.
// ?motion-quality=N pins a level, still frames included, to inspect or time it.
const pinnedQuality=/^[0-2]$/.test(new URLSearchParams(location.search).get('motion-quality')??'')?Number(new URLSearchParams(location.search).get('motion-quality')):null;
const layerFade=createLayerFade();
const cameras=machineCameras();
const viewer=createViewerRenderer({canvas,pinnedQuality,reportPerformance:burst=>void fetch('/api/view-performance',{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify(burst)}).catch(()=>{})});
const phasePalette=()=>printSync.state?.phasePalette??DEFAULT_PHASE_COLOURS;
const sampleNames={planar:'Body',curves:'Cladding','vase-wall':'Vase substrate'};
const cameraState=()=>({yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:[...orbitView.pan],fitBounds:orbitView.fitBounds});
function useCamera(c){if(c)({yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:orbitView.pan,fitBounds:orbitView.fitBounds}=c);}
function machineSample(t=playState.seconds){return machinePose.machineSession?.current(t,{manual:machinePose.manualValues,jog:machinePose.manualJog})??null;}
function machineDisplay(t=playState.seconds){const sample=machineSample(t);return machinePose.manualValues&&sample?.snapshot?.status!=='ready'?(machinePose.machineSession?.held(t)??sample):sample;}
function clearManual(){machinePose.manualValues=null;machinePose.manualJog=null;machinePose.requestingPose=null;}
function updateManualControls(sample){
  const descriptor=machinePose.machineSession?.scene?.descriptor,controls=descriptor?.controls??[];
  $('#manual-position').hidden=viewState.tab!=='toolpath'||cameras.mode!=='machine'||!controls.length;
  if(descriptor!==machinePose.manualDescriptor){
    machinePose.manualDescriptor=descriptor;$('#manual-sliders').replaceChildren();
    controls.forEach((c,i)=>{
      const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),output=document.createElement('output');
      row.className='manual-axis';input.id='manual-axis-'+i;input.type='range';input.step=c.step;input.min=c.min;input.max=c.max;
      label.htmlFor=input.id;label.textContent=c.label;output.htmlFor=input.id;
      input.oninput=()=>{
        const values=machinePose.machineSession?.held(playState.seconds)?.snapshot?.controlValues;if(!values?.length)return;
        stop();machinePose.manualValues=[...values];machinePose.manualValues[i]=Number(input.value);machinePose.manualJog={axis:i,from:[...values]};machinePose.requestingPose=null;requestDraw();
      };
      row.append(label,output,input);$('#manual-sliders').append(row);
    });
  }
  const values=sample?.snapshot?.controlValues??machinePose.manualValues;
  $$('#manual-sliders input').forEach((input,i)=>{
    input.disabled=studioWork.busy||!values?.length||!machinePose.machineSession?.held(playState.seconds);
    if(!values?.length)return;
    input.min=Math.min(controls[i].min,values[i]);input.max=Math.max(controls[i].max,values[i]);input.value=values[i];
    input.previousElementSibling.value=(Math.abs(values[i])<.05?0:values[i]).toFixed(1)+' '+controls[i].unit;
  });
  $('#manual-reset').disabled=studioWork.busy||!machinePose.manualValues;
  $('#manual-status').textContent=machinePose.manualValues?(machinePose.machineSession?.error||sample?.snapshot?.diagnostics.map(d=>d.message).join(' · ')||(sample?'Manual pose · playback paused':'Solving pose…')):'';
}
function machineTheme(){const style=getComputedStyle(canvas);return Object.fromEntries(Object.keys(machinePalette).map(role=>[role,style.getPropertyValue('--machine-'+role).trim()||machinePalette[role]]));}
function updateMachineStatus(sample=machineSample()){
  const scene=machinePose.machineSession?.scene,pose=sample?.pose;
  $('#machine-control').hidden=viewState.tab!=='toolpath'||!printSync.state?.program;
  $('#machine-view').checked=cameras.mode==='machine';$('#machine-view').disabled=studioWork.busy||(!pose&&cameras.mode!=='machine');
  $('#machine-info').hidden=viewState.tab!=='toolpath'||(!scene&&!machinePose.machineSession?.error);
  const diagnostic=sample?.snapshot?.diagnostics.map(d=>d.message).join(' · ');
  $('#machine-diagnostics').textContent=machinePose.machineSession?.error||diagnostic||'';
  $('#machine-diagnostics').hidden=!$('#machine-diagnostics').textContent;
  $('#machine-status').textContent=machinePose.machineSession?.error?'Machine model unavailable · see Machine model':'';
  if(!$('#machine-status').textContent)$('#machine-status').textContent=!scene?'Machine model unavailable':!sample?'Loading machine pose…':!pose?'Machine pose unavailable · see Machine model':
    (cameras.mode==='ghost'?'Ghost':'Machine')+(machinePose.manualValues?' · manual pose':' · simulated motion')+(sample.snapshot.status==='partial'||sample.snapshot.diagnostics.some(d=>d.code!=='jog-boundary')?' · limited model':'');
  updateManualControls(sample);
}
function requestMachinePose(){
  const key=JSON.stringify([playState.seconds,machinePose.manualValues,machinePose.manualJog]);
  if(viewState.tab!=='toolpath'||!machinePose.machineSession?.scene||machineSample()||machinePose.requestingPose?.key===key)return;
  const session=machinePose.machineSession,t=playState.seconds;
  const promise=session.sample(t,{manual:machinePose.manualValues,jog:machinePose.manualJog}).then(()=>{if(machinePose.machineSession===session&&playState.seconds===t)requestDraw();}).catch(error=>{if(error.name!=='AbortError')message(error.message,true);})
    .finally(()=>{if(machinePose.requestingPose?.promise===promise)machinePose.requestingPose=null;});
  machinePose.requestingPose={key,promise};
}
const viewStorageKey=()=> 'saam-view:'+printSync.state?.printId;
function saveView(){
  if(!printSync.state||playState.movieController)return;
  try{sessionStorage.setItem(viewStorageKey(),JSON.stringify({outputId:printSync.state.outputId,yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:orbitView.pan,fitBounds:orbitView.fitBounds,seconds:playState.seconds,tab:viewState.tab,
    speed:Number($('#playback-speed').value),previousLayerOpacity:Number($('#previous-layer-opacity').value),travel:$('#travel').checked,followPlate:$('#follow-plate').checked,machineCameras:cameras.snapshot(cameraState())}));}catch{}
}
function restoreView(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(viewStorageKey()));if(!saved)return;
    if([saved.yaw,saved.tilt,saved.zoom].every(Number.isFinite)){orbitView.yaw=saved.yaw;orbitView.tilt=saved.tilt;orbitView.zoom=saved.zoom;}
    if(Array.isArray(saved.pan)&&saved.pan.length===2&&saved.pan.every(Number.isFinite))orbitView.pan=saved.pan;
    if(Number.isFinite(saved.speed))$('#playback-speed').value=saved.speed;
    $('#speed-label').value=$('#playback-speed').value+'×';
    if(Number.isFinite(saved.previousLayerOpacity))$('#previous-layer-opacity').value=saved.previousLayerOpacity;
    $('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';
    $('#travel').checked=saved.travel===true;$('#follow-plate').checked=saved.followPlate!==false;
    if(saved.outputId===printSync.state.outputId){
      if(Number.isFinite(saved.seconds))playState.seconds=Math.max(0,Math.min(duration(),saved.seconds));
      if(saved.fitBounds?.min?.length===3&&saved.fitBounds?.max?.length===3&&[...saved.fitBounds.min,...saved.fitBounds.max].every(Number.isFinite))orbitView.fitBounds=saved.fitBounds;
      if(['geometry','toolpath'].includes(saved.tab)&&(saved.tab!=='toolpath'||printSync.state.program||printSync.state.neutralProgram))viewState.tab=saved.tab;
      if(machinePose.machineSession?.scene)useCamera(cameras.restore(saved.machineCameras));
    }
    $('#fit-program').textContent=orbitView.fitBounds?.allMoves?'Fit part':'Fit all moves';
  }catch{}
}
function connectViewPersistence(){window.addEventListener('pagehide',saveView);}
connectViewPersistence();
function requestDraw(){
  viewer.requestDraw(readViewerSnapshot,applyViewerAnnotations);
}
function clearProgramView(){
  clearManual();
  if(cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));
  cameras.reset();
  viewer.clearProgram();
  machinePose.machineSession?.dispose();machinePose.machineSession=null;
}
const message=(text,error=false)=>{$('#message').textContent=text;$('#message').classList.toggle('error',error);};
const presentedState=()=>viewState.activePresentation?.presentedState??printSync.state;
// A toolpath is being (re)generated and a faded preview is on offer, so the
// geometry action should return to it rather than start a fresh calculation.
const generationPending=()=>studioWork.generating||printSync.state?.outputGenerating===true;
// The toolpath pane never goes empty. Without a current program it shows a faded
// placeholder — the previous toolpath when one is retained, otherwise the part
// being sliced — through first generation, regeneration, reload and failure.
const showingGeometry=()=>viewState.tab!=='toolpath'||!presentedState()?.program;
const duration=()=>presentedState()?.program?.summary.motionSeconds??0;
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const round2=v=>Number(v).toFixed(2);
const materialFact=program=>program.materialModel==='relay-estimate'
  ? ['Material estimate',round2(materialGrams(program.estimatedRelayVolumeMm3))+' g from relay timing; unverified']
  : [program.envelope?'Part material estimate':'Material estimate',round2(materialGrams(program.volumeMm3))+' g'];
// A relay-extrusion machine feeds material by external control; it has no filament, bed or fan settings.
const relay=state=>state.machine?.capabilities?.includes('relay-extrusion');
const materialSetup=state=>relay(state)
  ? ['Extrusion','External relay control · '+state.plan.setup.material]
  : ['Material',state.plan.setup.material+' · '+state.plan.setup.nozzleC+'°C'+(state.plan.setup.filamentColor?' · '+state.plan.setup.filamentColor:'')+(state.plan.setup.ams?' · intended AMS '+state.plan.setup.ams.unit+' slot '+state.plan.setup.ams.slot:'')];
const vaseSettings=state=>{
  return (state.plan.slices?.assignments??[]).filter(a=>a.construction==='sleeve').flatMap(vase=>[
    [vase.pathMode==='segmented'?'Segmented paths':'Vase wall',vase.pattern?(vase.pathMode==='segmented'?'Repeated sleeve pattern with travel between gaps':'Continuous pattern wrapped around the sleeve'):'One continuous spiral; '+(vase.endTransition==='level'?'level rim':'spiral rim')],
    ['Path component',vase.part??'Part'],
    ['Path height range',vase.zStartMm+'–'+(vase.zEndMm??'geometry top')+' mm above component base'],
    ['Path sampling',vase.sampleStepMm+' mm maximum step'+(vase.pattern?'':' · '+vase.toleranceMm+' mm tolerance')]
  ]);
};
// The adapter's rows (computed by the server) follow the common settings.
function machineSettings(state,rows){
  const omitted=new Set(relay(state)?['Bed temperature','Build volume temperature','Retraction','Cooling fan','Filament diameter']:[]);
  return [...rows.filter(([name])=>!omitted.has(name)),...state.settingsRows??[]];
}
function stop(){if(playState.playing)void studioWork.tourUI?.playback('pause');playState.playing=false;playState.playbackEpoch++;playState.lastFrame=0;cancelAnimationFrame(playState.frame);$('#play').textContent='Play';}
function activity(text='',fraction=null){
  $('#activity').hidden=!text;$('#activity-label').textContent=text;
  const measured=Number.isFinite(fraction);
  $('#activity-percent').hidden=!measured;$('#activity-progress').hidden=!measured;
  if(measured){const value=Math.min(1,Math.max(0,fraction));$('#activity-percent').textContent=Math.floor(value*100)+'%';$('#activity-progress').value=value;}
  $('#activity-detail').textContent=measured?'Progress for this stage.':'Please wait. Studio is working.';
  $('main').setAttribute('aria-busy',String(!!text));
}
async function working(text,task,{preview=true,stage=null}={}){
  if(studioWork.busy)return;studioWork.busy=true;stop();if(preview)agentUI.loading(stage);activity(text);if(printSync.state)render();$('#open-print').disabled=true;
  // Paint the indicator before local parsing/drawing can occupy the UI thread.
  if(preview)await painted();
  let failure;
  try{return await task();}catch(error){failure=error;throw error;}
  finally{studioWork.busy=false;if(preview)agentUI.settled(failure||(viewState.tab==='toolpath'&&(printSync.state?.generationError||printSync.state?.programError||printSync.state?.programViewError)));activity();$('#open-print').disabled=false;if(printSync.state)render();}
}
// Give the compositor two frames to show what was just rendered, then continue
// regardless: a hidden or unpainted tab runs no frame callback at all, and
// opening, loading and acknowledging a drawn view must not wait on one.
function painted(){
  return new Promise(resolve=>{
    const timer=setTimeout(resolve,150),done=()=>{clearTimeout(timer);resolve();};
    requestAnimationFrame(()=>requestAnimationFrame(done));
  });
}

// Studio reviews more than one kind of print. Everything that depends on which
// package produced the bundle lives here; the viewer, approvals and playback
// below are shared. A print names its kind in its own state.
const views={
  shell:{
    eyebrow:'DEVELOPMENT PREVIEW',skinLabel:'Surface paths',exportName:'part.gcode',
    // Faces are named by the shape that built them, so the label is the name.
    names:{},
    facts(state,tab) {
      const {geometry:g,setup:s,process:p}=state.plan;
      const slices=state.plan.slices?.assignments??[],owners=slices.filter(a=>!a.construction),body=owners.find(a=>a.preset===null&&!a.within.length);
      const solid=g?.shape==='spatial'?g.solid:g,spatial=g?.shape==='spatial'||!g&&Boolean(state.geometry?.curves||state.geometry?.points);
      const shape=solid?({'blob-field':'Blob field',assembly:'Assembly',spline:'Spline surfaces',mesh:'Mesh'}[solid.shape]??solid.shape):'Curves and points';
      if(tab==='geometry') {
        if(!g&&!spatial)return [['Source',shape]];
        const bounds=state.geometry.boundsMm;
        const rows=[['Shape',spatial?(solid?'Solid, curves and points':'Curves and points'):shape],['Footprint',round2(bounds.max[0]-bounds.min[0])+' × '+round2(bounds.max[1]-bounds.min[1])+' mm'],['Height',round2(bounds.max[2]-bounds.min[2])+' mm']];
        if(spatial){
          const curves=g?.curves??state.geometry.curves??[],points=g?.points??state.geometry.points??[];
          if(solid)rows.push(['Solid',shape]);
          for(const [name,entries]of [['Curves',curves],['Points',points]])rows.push([name,entries.length+' authored · '+entries.filter(entry=>entry.visible!==false).length+' visible']);
        }
        if(solid?.shape==='mesh'&&solid.source?.format==='stl')rows.push(['STL units',solid.source.units+(solid.source.unitsInferred?' · assumed':'')+' · ask your agent to change']);
        if(solid?.shape==='spline')rows.push(['Patches',solid.patches.map(p=>p.name+' '+p.controlPoints.length+' × '+p.controlPoints[0].length).join(' · ')]);
        const textRows=(geometry,prefix='')=>{if(geometry?.shape==='text')for(const feature of geometry.features)rows.push([prefix+feature.id,(feature.mode==='raised'?'Raised':'Recessed')+' “'+feature.text+'” · '+feature.depthMm+' mm']);};
        const blobFieldRows=(geometry,prefix='')=>{if(geometry?.shape==='blob-field')rows.push([prefix+'Points',String(geometry.field.points.length)],[prefix+'Surface sampling',geometry.extraction.edgeMm+' mm · finer features may be missed'],[prefix+'Material threshold',String(geometry.field.threshold)]);};
        textRows(solid);
        blobFieldRows(solid);
        if(solid?.shape==='assembly')for(const part of solid.parts){rows.push([part.id,part.geometry.shape+' at '+[part.xMm,part.yMm,part.zMm].join(', ')+' mm']);textRows(part.geometry,part.id+' · ');blobFieldRows(part.geometry,part.id+' · ');}
        return rows;
      }
      if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
        ['Body',body?sliceSummary(body):owners.length?'Assigned volumes only':'Not printed'],...vaseSettings(state),
        ...(slices.length>(body?1:0)?[['Other deposition assignments',slices.filter(a=>a!==body).map(a=>a.id+' · '+sliceSummary(a)).join('; ')]]:[]),
        ...(solid?.shape==='assembly'?[['Sliced components',owners.some(a=>a.part===null)?'All':[...new Set(owners.map(a=>a.part))].join(', ')||'None']]:[])];
      if(!state.program)return [];
      const limit=state.pathSummary?.surfaceDomain;
      const rows=[...depositionFamilyRows(state.pathSummary?.inspection),
        [state.program.envelope?'Printing motion':'Estimated motion',Math.round((state.program.seconds??duration())/60)+' min'],materialFact(state.program)];
      for(const c of state.pathSummary?.curves??[])rows.push([c.id,c.strokes+' strokes · '+c.courses+' courses']);
      if(state.program.materialModel==='relay-estimate')rows.push(['Material intent',round2(materialGrams(state.program.volumeMm3))+' g; not metered']);
      if(hasConstruction(state.plan,'sleeve')){
        const selections=state.plan.slices.assignments.filter(a=>a.construction==='sleeve');
        rows.push(['Wall paths',selections.some(s=>s.pathMode==='segmented')?'Includes segmented paths with travel':selections.some(s=>s.pattern)?'Continuous pattern wrapped around the sleeve':'Continuous spiral within its assigned region']);
      }
      for(const family of state.pathSummary?.referenceFamilies?.normal??[])rows.push([family.owner+' · Normal surface courses',String(family.normalOwnership?.courseCount??family.courses??'')]);
      for(const instance of state.pathSummary?.slices?.instances??[])if(instance.fillOrder){const f=instance.fillOrder;rows.push(['Surface fronts · '+instance.id,(f.waves??0)+' fronts · '+(f.continuity?.passes??'unverified')+' pass(es) · '+(f.residualsUv?.length??0)+' residual region(s)']);}
      if(limit) {
        rows.push(['Surface not skinned',limit.excludedAreaPercent+'% steeper than '+limit.maxSlopeDeg+'°']);
      }
      return rows;
    },
    settings(state) {
      const {setup:s,process:p}=state.plan;
      const contract=state.machine.outputs.find(o=>o.id===state.plan.output)?.constraints;
      const declaredLimit=state.machine.nonplanar?.maxAngleDeg;
      return [['Bed temperature',s.bedC+'°C'],['Build volume temperature',s.buildVolumeC===0?'Heating off':s.buildVolumeC+'°C'],
        ...(contract?.bedType?[['Build surface',contract.bedType==='textured_plate'?'Textured PEI':contract.bedType],['Startup purge',contract.startupPurgeC+'°C · up to '+contract.startupPurgeFlowMm3S+' mm³/s']]:[]),
        ['First layer',p.firstLayerMm+' mm'],['Line width',p.lineWidthMm+' mm'],
        ['Flat / skin speed',p.planarSpeedMmS+' / '+p.skinSpeedMmS+' mm/s'],['First-layer speed',p.firstLayerSpeedMmS+' mm/s'],
        ['Travel / lift speed',p.travelSpeedMmS+' / '+p.zSpeedMmS+' mm/s'],['Retraction',p.retractMm+' mm at '+p.retractSpeedMmS+' mm/s'],
        ['Cooling fan',p.fanPercent+'%'],['Minimum layer time',p.minimumLayerSeconds+' s'],
        ['Filament diameter',s.filamentMm+' mm'],['Placement','X '+state.plan.placement.xMm+' / Y '+state.plan.placement.yMm+' mm'],
        ['Machine non-planar limit',(declaredLimit??'—')+'° (profile declaration)'],
        ['Travel','Comb up to '+p.maxCombMm+' mm; otherwise clear the whole plan by '+p.liftMm+' mm'],
        ['Startup',state.setupBasis]];
    }
  }
};
const view=()=>views.shell;
const label=id=>{const edge=viewer.sceneState().edge(id);return edge?edge.names.map(label).join(' / ')+' · edge '+edge.number:view().names[id]??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());};

// Part bounds come from the display proxy both packages write, so the camera
// and the bed grid do not need to know which shape produced them.
function partBounds() {
  const shown=viewState.tab==='toolpath'?(presentedState()??printSync.state):printSync.state;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of [...(shown.geometry?.vertices??[]),...(shown.geometry?.curves??[]).filter(c=>c.visible!==false).flatMap(c=>c.points??[]),...(shown.geometry?.points??[]).filter(p=>p.visible!==false).map(p=>p.point),...(shown.geometry?.boundsMm?[shown.geometry.boundsMm.min,shown.geometry.boundsMm.max]:[])])for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  if(viewState.tab==='toolpath'&&shown.program){
    if(viewState.waveBoundsMoves!==shown.program.moves){
      viewState.waveBoundsMoves=shown.program.moves;viewState.waveDisplayBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
      for(const move of viewState.waveBoundsMoves)if(move.extruding&&move.phase!=='prime')for(const p of [move.from,move.to])for(let i=0;i<3;i++){
        const v=p[i]-(i===0?shown.plan.placement?.xMm??0:i===1?shown.plan.placement?.yMm??0:0);
        viewState.waveDisplayBounds.min[i]=Math.min(viewState.waveDisplayBounds.min[i],v);viewState.waveDisplayBounds.max[i]=Math.max(viewState.waveDisplayBounds.max[i],v);
      }
    }
    for(let i=0;i<3;i++){min[i]=Math.min(min[i],viewState.waveDisplayBounds.min[i]);max[i]=Math.max(max[i],viewState.waveDisplayBounds.max[i]);}
  }
  return {min,max};
}

async function api(route,data) {
  const target=(route==='generate'||route==='tour'&&!['finish','finish-view'].includes(data?.action)&&(data?.step??printSync.state?.tour?.step)>=L.playback)
    ?{printId:printSync.state?.printId,editRevision:route==='generate'?data?.editRevision:null}:null;
  if(target)studioWork.generationTarget=target;
  try{
    const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({...data,printId:printSync.state?.printId})});
    if(!response.ok){const result=await response.json();throw Object.assign(new Error(result.error),{code:result.code});}
    return response;
  }finally{if(target===studioWork.generationTarget){studioWork.generationTarget=null;$('#cancel-generation').hidden=true;}}
}
async function pollPreparation(){
  const target=studioWork.generationTarget;if(!target||printSync.progressPolling)return;
  printSync.progressPolling=true;
  try{
    const response=await fetch('/api/preparation');if(!response.ok)return;
    const job=await response.json();
    applyProgress(job,target);
  }catch{/* The owning generation call reports failures. */}finally{printSync.progressPolling=false;}
}
function applyProgress(job,target=studioWork.generationTarget){
  if(printSync.state&&job?.printId===printSync.state.printId){printSync.state.outputGenerating=['preparing','generating'].includes(job.status);render();}
  if(!target||studioWork.generationTarget!==target||!job||job.studioInstanceId&&printSync.state&&job.studioInstanceId!==printSync.state.instanceId
    ||job.printId!==target.printId||target.editRevision&&job.editRevision!==target.editRevision)return;
  target.editRevision??=job.editRevision;
  target.jobId??=job.jobId;
  $('#cancel-generation').hidden=!job.cancellable;
  clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;
  if(job.progress&&['preparing','generating','importing'].includes(job.status)){
    const showProgress=()=>{
      if(studioWork.generationTarget!==target){clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;return;}
      const elapsed=job.startedAt?Date.now()-job.startedAt:job.elapsedMs;
      activity(job.progress.stage+(job.status==='importing'&&elapsed>=1000?` · ${Math.floor(elapsed/1000)}s elapsed`:''),job.progress.total>0?job.progress.completed/job.progress.total:null);
    };
    showProgress();if(job.status==='importing')studioWork.importElapsedTimer=setInterval(showProgress,1000);
  }
}
$('#cancel-generation').onclick=async()=>{
  const target=studioWork.generationTarget;if(!target)return;
  $('#cancel-generation').disabled=true;
  try{const result=await(await api('cancel-calculation',{jobId:target.jobId,editRevision:target.editRevision})).json();
    if(result.cancelled){if(printSync.state&&result.kind==='generation')printSync.state.generationCancelled=true;message(result.kind==='import'?'Cancelling import…':'Toolpath calculation cancelled.');}
    else if(result.committing)message('The calculation finished; saving its checked file.');
  }catch(error){message(error.message,true);}finally{$('#cancel-generation').disabled=false;}
};
async function loadAndAdoptStudioState(follow=false,reopen=false,fetchedState=null,fetchedTag=null) {
  let fetched=fetchedState;
  if(!fetched){
    const response=await fetch('/api/state');
    if(response.status===204)throw Object.assign(new Error(NO_PRINT),{code:'NO_PRINT'});
    if(!response.ok)throw new Error((await response.json()).error);
    fetchedTag=response.headers?.get?.('etag')??null;fetched=await response.json();
  }
  const loaded=printSync.state?.printId===fetched.printId?printSync.state:null,previous=!reopen?loaded:null;
  agentUI.received(fetched.work);
  const presentationChanged=!previous||previous.editRevision!==fetched.editRevision||previous.outputId!==fetched.outputId
    ||previous.geometryId!==fetched.geometryId;
  if(presentationChanged)clearManual();
  const scenes=viewer.sceneState();
  const adopted=await prepareStudioState(fetched,{previous,follow,presentation:viewState.activePresentation,
    pathMoves:scenes.pathMoves,materialMoves:scenes.materialMoves,decode:decodeInWorker,decodeNeutral:loadSavedPath,
    // Serializable metadata is bound before the proxy-backed cached move store is adopted.
    bind:bindCachedProgram});
  printSync.state=adopted.state;printSync.stateTag=fetchedTag;chatUI.reflect();
  return {adopted,loaded,previous,presentationChanged,follow};
}
async function presentStudioState({adopted,loaded,previous,presentationChanged,follow}) {
  // Metadata can change while the exact same source/move buffers are reused.
  const outputState=outputView(printSync.state);
  $('#kind-label').textContent=printSync.state.neutralProgram?'Saved SAAMpath · '+(printSync.state.machine?.name??'No printer selected')
    :(completedOutputState(printSync.state).previous?'Previous toolpath · ':outputState.review.generation?.mode==='development'?'Development preview · ':'')+(outputState.machine?.name??'No printer selected');
  document.title=studioTitle(printSync.state.printName);
  $('#open-print').title='Open print: '+printSync.state.printName;
  // Geometry keys off the previously loaded state's geometry id (none on a
  // print switch), so a different print always rebuilds.
  if(!viewer.sceneState().hasGeometry||!loaded||loaded.geometryId!==printSync.state.geometryId)
    viewer.publishGeometry({geometry:printSync.state.geometry});
  const presentation=await applyProgramPresentation(adopted.presentation,printSync.state);printSync.state=presentation.state;
  if(presentationChanged)layerFade.reset();
  const navigation=planRefreshNavigation(previous,printSync.state,{follow,tab:viewState.tab,seconds:playState.seconds,duration:presentation.duration,selected:viewState.selected,
    hasSelectedEdge:viewer.sceneState().hasSelectedEdge(viewState.selected),tourInitialTab:!previous&&printSync.state.tourExample?studioWork.tourUI?.initialTab():undefined});
  applyRefreshNavigation(navigation);
  viewState.machineColors=machineTheme();
  if(machinePose.machineSession?.scene){
    const d=machinePose.machineSession.scene.descriptor;$('#machine-basis').textContent=d.basis;
    $('#machine-limitations').replaceChildren(...d.limitations.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    await machinePose.machineSession.sample(playState.seconds,{manual:machinePose.manualValues,jog:machinePose.manualJog});
  }else{$('#machine-basis').textContent='';$('#machine-limitations').replaceChildren();}
  render();
  await acknowledgeDisplayedView();
}
async function ensureTourGeneration(follow=false){
  if(needsTourToolpath(printSync.state)){
    activity('Preparing your toolpath…');
    try{
      await api('generate',{development:false,editRevision:printSync.state.editRevision});
      await presentStudioState(await loadAndAdoptStudioState(follow));
    }
    catch(error){printSync.state.generationError=error.message;message(error.message,true);render();}
  }
}
async function refresh(follow=false,reopen=false,fetchedState=null,fetchedTag=null) {
  await presentStudioState(await loadAndAdoptStudioState(follow,reopen,fetchedState,fetchedTag));
  await ensureTourGeneration(follow);
}
async function applyProgramPresentation(decision,next){
  if(decision.effects.program==='clear')clearProgramView();
  let publication=null;
  if(decision.effects.buildPath||decision.effects.buildMaterial){
    const shown=outputView(next),visible=shown.program??next.neutralProgram;
    if(visible.neutral)viewer.clearProgram();
    publication=await viewer.publishProgram({moves:visible.moves,plan:shown.plan,geometry:shown.geometry,previewMaterial:visible.previewMaterial,
      buildPath:decision.effects.buildPath,buildMaterial:decision.effects.buildMaterial,onProgress:progress=>activity('Preparing material view…',progress)});}
  const state=publication?.previewMaterialConsumed?withoutPreviewMaterial(next):next;
  viewState.activePresentation={...decision.model,
    presentedState:decision.effects.program==='clear'?outputView({...state,program:null}):state.program?outputView(state):decision.model.presentedState,
    program:state.program??decision.model.program};
  return {duration:duration(),state};
}
function applyRefreshNavigation(decision){
  if(decision.resetExport){stop();playState.seconds=decision.seconds;if(cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));cameras.reset();orbitView.fitBounds=null;}
  if(decision.resetView) {
    stop();viewState.selected=null;orbitView.fitBounds=null;orbitView.zoom=1;orbitView.pan=[0,0];playState.seconds=decision.seconds;
    cameras.reset();$('#follow-plate').checked=true;
  }
  viewState.tab=decision.tab;
  if(decision.notice)message(decision.notice);
  if(decision.restoreSavedView)restoreView();
  if(decision.resetSelection)selectFeature(null);
}
async function acknowledgeDisplayedView(failure){
  if(studioWork.acknowledging)return;
  studioWork.acknowledging=true;
  try{
  await painted();
  if(failure||agentUI.presentState(printSync.state,viewState.tab,{requiresToolpath:needsTourToolpath(printSync.state)})){
    const presented=await studioWork.tourUI?.acknowledgeView(printSync.state,viewState.tab,failure);
    if(presented)agentUI.updated(presented);
  }
  }finally{studioWork.acknowledging=false;}
}
async function decodeInWorker(snapshot){
  activity('Loading your toolpath…');
  machinePose.machineSession?.dispose();machinePose.requestingPose=null;
  machinePose.machineSession=sourceSession(new Worker('/studio/source-worker.mjs',{type:'module'}));
  return machinePose.machineSession.load({printId:snapshot.printId,revision:snapshot.revision,outputId:snapshot.outputId,
    plan:snapshot.plan,machine:snapshot.machine,inspection:snapshot.pathSummary?.inspection});
}
function bindCachedProgram(snapshot){return machinePose.machineSession?.bind(snapshot);}
function table(entries) {
  const dl=document.createElement('dl');
  for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  return dl;
}
function selectStudioPresentation(state,tab,{facts,settings}){
  if(tab==='toolpath'&&state.neutralProgram)return {stage:'SAVED SAAMPATH',title:'Your toolpath',
    guidance:'Inspect the saved, machine-independent path.',facts:[['Moves',String(state.neutralProgram.summary.moves)],
      ['Deposited volume',round2(state.neutralProgram.summary.volumeMm3)+' mm³']],settings:[],
    reviewNote:[state.programError,state.neutralProgram.notice].filter(Boolean).join(' ')};
  if(!state.machine||!state.plan.slices||!state.plan.process)return {stage:null,title:'Your geometry',guidance:'Ask the agent to add printing settings and a toolpath recipe.',facts:views.shell.facts(state,'geometry'),settings:[],reviewNote:state.neutralPathError??state.outputAvailability??''};
  const inspection=state.inspection;
  if(inspection)return {stage:'DEVELOPMENT INSPECTION',title:inspection.title,guidance:inspection.description,
    facts:inspection.facts,settings:inspection.settings,reviewNote:inspection.note};
  const title=state.tourExample?state.printName+(tab==='toolpath'?' · toolpath':''):{geometry:'Your geometry',toolpath:'Your toolpath'}[tab];
  const guidance={geometry:'Check the shape and dimensions.',toolpath:'Review the path and printing settings.'}[tab];
  const reviewNote=state.programViewError??state.outputAvailability??(tab==='toolpath'?(state.generationError??state.programError??state.neutralPathError??(!state.program
    ?'Generate the toolpath to review it with all printing settings.'
    :state.program.notice??state.program.envelope?.notice??'')):'');
  return {stage:null,title,guidance,facts:facts(),settings:settings(),reviewNote};
}
function render() {
  const shown=viewState.tab==='toolpath'?outputView(printSync.state):printSync.state,output=completedOutputState(printSync.state,{generating:generationPending()});
  const presentation=selectStudioPresentation(shown,viewState.tab,{facts:()=>view().facts(shown,viewState.tab),
    settings:()=>[...view().facts(shown,'plan'),...machineSettings(shown,view().settings(shown)),...recipeRows(shown.plan)]});
  if(viewState.tab==='toolpath'&&output.previous)presentation.reviewNote='Previous toolpath — recent edits are not included. '+(presentation.reviewNote??'');
  if(output.phase==='generating')presentation.guidance='Preparing your toolpath…';
  if(!studioWork.busy)activity(output.phase==='generating'?'Preparing your toolpath…':'');
  $('#repair-review').hidden=viewState.tab!=='geometry'||!printSync.state.importRepair;
  $('#repair-summary').textContent=printSync.state.importRepair??'';
  $('#stage-label').textContent=presentation.stage??'';$('#stage-label').hidden=!presentation.stage;
  $('#view-title').textContent=presentation.title;
  $('#guidance').textContent=presentation.guidance;$('#guidance').hidden=!presentation.guidance;
  $('#facts').replaceChildren(table(presentation.facts));
  $('#more-settings').hidden=viewState.tab!=='toolpath';
  $('#print-setup').hidden=viewState.tab!=='toolpath';
  $('#print-setup-values').textContent=shown.machine?[shown.machine.name,shown.plan.setup?.material].filter(Boolean).join(' · '):'No printer selected';
  const suggestedName=printSync.state.printName??'';
  if(!viewState.exportNameState||viewState.exportNameState.printId!==printSync.state.printId)viewState.exportNameState={printId:printSync.state.printId,suggested:suggestedName,value:suggestedName,dirty:false};
  else if(!viewState.exportNameState.dirty&&viewState.exportNameState.suggested!==suggestedName)Object.assign(viewState.exportNameState,{suggested:suggestedName,value:suggestedName});
  const exportNameInput=$('#export-name');
  if(document.activeElement!==exportNameInput)exportNameInput.value=viewState.exportNameState.value;
  $('#settings-detail').replaceChildren(table(presentation.settings));
  $('#planar-label').textContent=hasConstruction(printSync.state.plan,'cladding')?'Body':'Deposition';
  const palette=phasePalette();
  for(const [dot,phase] of [['planar','planar'],['inclined','curves'],['modulated','modulated']])$('.dot.'+dot).style.background=palette[phase];
  const pathView=viewer.sceneState().pathView;
  const samples=$('#axial-colors');samples.replaceChildren();samples.hidden=!hasConstruction(printSync.state.plan,'cladding')||!pathView;
  const sampledPhases=new Set();
  if(!samples.hidden)for(const [index,group] of pathView.groups.entries()){
    const move=pathView.moves.at(group.first);
    const swatch=sampleNames[move.phase]&&{name:sampleNames[move.phase],color:palette[move.phase]};
    if(!swatch||sampledPhases.has(move.phase))continue;
    sampledPhases.add(move.phase);
    const button=document.createElement('button'),dot=document.createElement('span');
    dot.className='dot';dot.style.background=swatch.color;
    button.append(dot,swatch.name);
    button.title='Inspect '+swatch.name;
    button.onclick=()=>{
      if(studioWork.busy)return;
      stop();layerFade.reset();
      const end=pathView.groups[index+1];
      playState.seconds=move.startSeconds+((end?pathView.moves.at(end.first).startSeconds:duration())-move.startSeconds)*(move.phase==='planar'?.98:.6);
      $('#scrub').value=playState.seconds;requestDraw();
    };
    samples.append(button);
  }
  $('#skin-label').textContent=hasConstruction(printSync.state.plan,'cladding')?'Surface cladding':hasConstruction(printSync.state.plan,'fronts')?'Wave fronts':view().skinLabel;
  const reviewed=$('#reviewed-download'),controls=studioControls(printSync.state,{tab:viewState.tab,busy:studioWork.busy,generating:studioWork.generating,pending:generationPending(),staleProgram:Boolean(viewState.activePresentation?.retained&&viewState.activePresentation.program),
    exported:exportedThisSession.has(exportKey()),currentExportKey:exportKey(),inspection:printSync.state.inspection,
    machineView:cameras.mode==='machine',reviewedExportKey:reviewed?.dataset.exportKey});
  exportNameInput.disabled=controls.exportName.disabled;$('#export-name-row').hidden=controls.exportName.hidden;
  $('#next').disabled=controls.next.disabled;$('#next').hidden=controls.next.hidden;$('#next').textContent=controls.next.label;
  $('#confirm').disabled=controls.confirm.disabled;$('#confirm').textContent=controls.confirm.label;$('#confirm').hidden=controls.confirm.hidden;
  $('#confirm').setAttribute('aria-disabled',controls.confirm['aria-disabled']);
  if(reviewed)reviewed.hidden=controls.reviewedDownload.hidden;
  $('#review-note').textContent=presentation.reviewNote;
  $('#playback').hidden=controls.playback.hidden;$('#play').disabled=controls.playback.playDisabled;
  $('#selection').hidden=controls.selection.hidden;
  canvas.setAttribute('aria-label',controls.canvas.label);canvas.classList.toggle('stale-toolpath',controls.canvas.stale);
  $('#scrub').max=duration();$('#scrub').value=playState.seconds;
  $('#rotary-view').hidden=!machinePose.machineSession?.scene&&!printSync.state.machine?.capabilities?.includes('coordinated-rotary');
  $('#fit-program').hidden=controls.fitProgram.hidden;
  updateMachineStatus();
  // Keep the tabs live during a toolpath generation: the geometry pane stays
  // reachable (and crisp), and the toolpath pane stays reachable whenever its
  // faded preview is available, so navigating between them never cancels work.
  $$('[data-tab]').forEach(b=>{const policy=controls.tabs[b.dataset.tab];b.classList.toggle('active',b.dataset.tab===viewState.tab);b.classList.toggle('done',Boolean(policy.done));b.disabled=policy.disabled;});
  studioWork.tourUI?.render(printSync.state);
  // A work episode spans intermediate saves and both inspection panes.
  canvas.classList.toggle('work-faded',studioWork.episodeWorking||viewState.tab==='toolpath'&&output.phase==='generating');
  requestDraw();
}
function selectFeature(id){viewState.selected=id;$('#selection').textContent=id?label(id):'Click a surface or edge to see its name';requestDraw();}
function setTab(next){if(!printSync.state)return;clearManual();if(next!=='toolpath'&&cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));viewState.tab=next;stop();layerFade.reset();render();}

function readViewerSnapshot(options={}) {
  if(!printSync.state)return {state:null,target:options.target??canvas,updateUI:options.updateUI??true};
  const position=options.position??playState.seconds,updateUI=options.updateUI??true,shown=viewState.tab==='toolpath'?(presentedState()??printSync.state):printSync.state;
  return {target:options.target??canvas,width:options.width??canvas.clientWidth,height:options.height??canvas.clientHeight,
    ratio:options.ratio??(devicePixelRatio||1),position,frameNow:options.now??performance.now(),fadeState:options.fadeState??layerFade,updateUI,
    playbackSpeed:options.playbackSpeed??(playState.playing?Number($('#playback-speed').value):0),machineState:options.machineState??machineDisplay(position),
    state:printSync.state,shown,tab:viewState.tab,selected:viewState.selected,selectionLabel:viewState.selected?label(viewState.selected):'',showGeometry:showingGeometry(),
    camera:{yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:[...orbitView.pan],fitBounds:orbitView.fitBounds},bounds:partBounds(),phaseColours:phasePalette(),cameraMode:cameras.mode,machineColors:viewState.machineColors,
    settings:{showTravel:$('#travel').checked,followPlate:$('#follow-plate').checked,previousLayerOpacity:Number($('#previous-layer-opacity').value)/100},
    playing:playState.playing,manualPose:Boolean(machinePose.manualValues),duration:duration(),interaction:orbitView.drag?(orbitView.drag.pan?'pan':'orbit'):null,
    performanceContext:{tab:viewState.tab,view:cameras.mode,solid:viewState.tab==='toolpath'&&viewer.sceneState().solid,moves:printSync.state?.program?.moves.length??0,canvasCss:[canvas.clientWidth,canvas.clientHeight],
      devicePixelRatio:+(devicePixelRatio||1).toFixed(3),userAgent:navigator.userAgent}};
}
function applyViewerAnnotations(annotations) {
  if(!printSync.state)return;
  if(!playState.playing&&!playState.movieController)requestMachinePose();
  updateMachineStatus();
  if(annotations.selectionText!==null)$('#selection').textContent=annotations.selectionText;
  if(annotations.layerText!==null)$('#layer-label').textContent=annotations.layerText;
  if(annotations.detailText!==null)$('#viewer-detail').textContent=annotations.detailText;
  if(annotations.timeText!==null)$('#time-label').textContent=annotations.timeText;
  if(annotations.fadeContinuation||annotations.redraw)requestDraw();
}
function draw(options={}) {
  const snapshot=readViewerSnapshot(options),annotations=viewer.draw(snapshot);
  if(snapshot.updateUI)applyViewerAnnotations(annotations);
  return annotations;
}
function planCanvasDrag(current,point){
  const dx=point.x-current.drag.x,dy=point.y-current.drag.y;
  return {drag:{...current.drag,x:point.x,y:point.y},
    moved:current.moved||Math.hypot(point.x-current.drag.startX,point.y-current.drag.startY)>2,
    pan:current.drag.pan?[current.pan[0]+dx,current.pan[1]+dy]:[...current.pan],
    yaw:current.drag.pan?current.yaw:current.yaw+dx*.008,
    tilt:current.drag.pan?current.tilt:Math.max(-1.5,Math.min(1.5,current.tilt+dy*.008))};
}
function readCanvasDrag(){
  return {drag:{...orbitView.drag},moved:orbitView.moved,yaw:orbitView.yaw,tilt:orbitView.tilt,pan:[...orbitView.pan]};
}
function applyCanvasDrag(next){
  orbitView.drag.x=next.drag.x;orbitView.drag.y=next.drag.y;orbitView.moved=next.moved;
  orbitView.pan[0]=next.pan[0];orbitView.pan[1]=next.pan[1];orbitView.yaw=next.yaw;orbitView.tilt=next.tilt;
  viewer.noteMotion(orbitView.drag.pan?'pan':'orbit');requestDraw();
}
function beginCanvasDrag(e){
  if(e.button>2)return;
  e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
  orbitView.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,pan:e.shiftKey||e.button===1||e.button===2};orbitView.moved=false;
}
function moveCanvasDrag(e){
  if(!orbitView.drag)return;
  const current=readCanvasDrag();
  const next=planCanvasDrag(current,{x:e.clientX,y:e.clientY});
  applyCanvasDrag(next);
}
function endCanvasDrag(e){
  const select=orbitView.drag&&!orbitView.drag.pan&&!orbitView.moved;orbitView.drag=null;viewer.flushPerformance();
  if(select&&viewState.tab!=='toolpath'){const rect=canvas.getBoundingClientRect();selectFeature(viewer.pick({x:e.clientX-rect.left,y:e.clientY-rect.top}));}
}
function cancelCanvasDrag(){orbitView.drag=null;}
function suppressCanvasContextMenu(e){e.preventDefault();}
function connectCanvasPointerEvents(){
  canvas.onpointerdown=beginCanvasDrag;canvas.onpointermove=moveCanvasDrag;canvas.onpointerup=endCanvasDrag;
  canvas.onpointercancel=canvas.onlostpointercapture=cancelCanvasDrag;
  canvas.oncontextmenu=suppressCanvasContextMenu;
}
connectCanvasPointerEvents();
canvas.addEventListener('wheel',e=>{e.preventDefault();viewer.noteMotion('zoom');orbitView.zoom=Math.max(.08,Math.min(4,orbitView.zoom*Math.exp(-e.deltaY*.001)));requestDraw();},{passive:false});
canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;if(e.shiftKey){orbitView.pan[0]+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;orbitView.pan[1]+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}else{if(e.key==='ArrowLeft')orbitView.yaw-=.1;else if(e.key==='ArrowRight')orbitView.yaw+=.1;else if(e.key==='ArrowUp')orbitView.tilt-=.1;else orbitView.tilt+=.1;}e.preventDefault();viewer.noteMotion(e.shiftKey?'pan':'orbit');requestDraw();};
new ResizeObserver(requestDraw).observe(canvas);
$$('[data-view]').forEach(b=>b.onclick=()=>{const mode=b.dataset.view;if(mode==='iso'){orbitView.yaw=-.78;orbitView.tilt=.62;}if(mode==='side'){orbitView.yaw=0;orbitView.tilt=0;}if(mode==='top'){orbitView.yaw=0;orbitView.tilt=Math.PI/2;}requestDraw();});
function worldToDisplay(p,pose=machineSample()?.pose){const plan=(presentedState()??printSync.state).plan,q=$('#follow-plate').checked&&pose?point(invert(pose.part),p):p;return [q[0]-(plan.placement?.xMm??0),q[1]-(plan.placement?.yMm??0),q[2]];}
function fitMachine(){return machinePose.machineSession?.scene?machineFitBounds(machinePose.machineSession.scene,machineSample()?.pose,p=>worldToDisplay(p)):null;}
function fitDisplayedPart(bounds=partBounds()){
  const pose=machineSample()?.pose;if(!pose||$('#follow-plate').checked)return null;
  const {xMm,yMm}=(presentedState()??printSync.state).plan.placement??{xMm:0,yMm:0},points=boundsCorners(bounds).map(p=>worldToDisplay(point(pose.part,[p[0]+xMm,p[1]+yMm,p[2]]),pose));
  return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
$('#machine-view').onchange=()=>{
  clearManual();
  const next=$('#machine-view').checked?'machine':'ghost';
  useCamera(cameras.switch(next,cameraState(),{yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:1,pan:[0,0],fitBounds:fitMachine()}));
  $('#fit-program').hidden=next==='machine';$('#fit-program').textContent=orbitView.fitBounds?.allMoves?'Fit part':'Fit all moves';updateMachineStatus();saveView();requestDraw();
};
$('#reset-view').onclick=()=>{orbitView.zoom=1;orbitView.pan=[0,0];orbitView.yaw=-.78;orbitView.tilt=.62;orbitView.fitBounds=cameras.mode==='machine'?fitMachine():fitDisplayedPart();$('#fit-program').textContent='Fit all moves';requestDraw();};
$('#fit-program').onclick=()=>{
  if(orbitView.fitBounds?.allMoves){orbitView.fitBounds=fitDisplayedPart();$('#fit-program').textContent='Fit all moves';}
  else {
    const part=partBounds();
    orbitView.fitBounds={min:[part.min[0],part.min[1],0],max:[part.max[0],part.max[1],0]};
    const shown=presentedState()??printSync.state;
    for(const move of shown.program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){
      const v=p[i]-(i===0?shown.plan.placement?.xMm??0:i===1?shown.plan.placement?.yMm??0:0);
      orbitView.fitBounds.min[i]=Math.min(orbitView.fitBounds.min[i],v);orbitView.fitBounds.max[i]=Math.max(orbitView.fitBounds.max[i],v);
    }
    orbitView.fitBounds=fitDisplayedPart(orbitView.fitBounds)??orbitView.fitBounds;orbitView.fitBounds.allMoves=true;
    $('#travel').checked=true;$('#fit-program').textContent='Fit part';
  }
  orbitView.zoom=1;orbitView.pan=[0,0];requestDraw();
};
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
async function download(){
  const name=$('#export-name').value.trim();if(!name)throw Error('Enter a print name before exporting.');
  const key=exportKey(),response=await api('export',{exportSnapshot:printSync.state.exportSnapshot,name,downloadLink:true});
  if(!response.ok){const error=await response.json();throw new Error(error.error??'Export failed.');}
  const attachment=await response.json();
  let a=$('#reviewed-download');
  if(!a){a=document.createElement('a');a.id='reviewed-download';$('#confirm').insertAdjacentElement('afterend',a);}
  a.href=attachment.url;a.download=attachment.name;a.dataset.exportKey=key;a.hidden=false;
  a.textContent='Download reviewed file';a.title='If the download did not start, use this link. Available for ten minutes.';
  // This requests a native browser download. Browser/host save completion is
  // not observable here; leave a real link for a direct user-initiated retry.
  a.click();exportedThisSession.add(key);
  const nextName=nextExportName(name);
  if(nextName!==name){
    $('#export-name').value=nextName;
    Object.assign(viewState.exportNameState,{value:nextName,dirty:true});
  }
}
$('#export-name').oninput=event=>{if(!viewState.exportNameState)return;viewState.exportNameState.value=event.target.value;viewState.exportNameState.dirty=event.target.value!==viewState.exportNameState.suggested;};
$('#next').onclick=async()=>{
  if(!printSync.state||$('#next').disabled)return;message('');
  if(printSync.state.programViewError){
    try{await working('Loading your saved toolpath…',async()=>{await refresh();if(printSync.state.program)setTab('toolpath');});}
    catch(e){message(e.message,true);}
    return;
  }
  if(completedOutputState(printSync.state).current||generationPending()){setTab('toolpath');return;}
  try{
    await working('Preparing your toolpath…',async()=>{
      studioWork.generating=true;render();
      try{await api('generate',{development:false});viewState.tab='toolpath';}
      finally{studioWork.generating=false;await refresh();}
    },{stage:'toolpath'});
  }catch(e){message(e.message,true);}
};
$('#confirm').onclick=async()=>{
  if(!printSync.state||$('#confirm').disabled)return;message('');
  try{
    await working('Downloading your reviewed file…',async()=>{
      await download();
      if(studioWork.tourUI?.active()){await api('tour',{action:'finish'});await studioWork.tourUI.load();render();}
    },{preview:false});
  }catch(e){message(e.message,true);}
};

async function openPrint(path){
  if(studioWork.busy)return;
  saveView();
  $('#picker-message').textContent='';$('#print-picker').close();
  const loadSavedPrint=async()=>{await api('open',{path});await studioWork.tourUI?.load();await refresh(false,true);message('');};
  try{await working('Opening and checking your saved print…',loadSavedPrint);}
  catch(error){message(error.message,true);$('#picker-message').textContent=error.message;$('#print-picker').showModal();}
}
$('#open-print').onclick=async()=>{
  if(studioWork.busy)return;$('#print-picker').showModal();$('#picker-message').textContent='Loading saved prints…';$('#print-list').replaceChildren();
  try{
    const response=await fetch('/api/prints');if(!response.ok)throw new Error('Could not list local prints.');
    const {prints}=await response.json();
    for(const print of prints){const button=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('span');
      name.textContent=print.name;detail.textContent=print.machine;button.append(name,detail);button.title=print.path;button.onclick=()=>openPrint(print.path);$('#print-list').append(button);}
    $('#picker-message').textContent=prints.length?'':'No saved prints found here. Enter a local print folder below.';
  }catch(error){$('#picker-message').textContent=error.message;}
};
$('#close-picker').onclick=()=>$('#print-picker').close();
function chooseSTL(){$('#stl-file').value='';$('#stl-file').click();}
$('#import-stl').onclick=()=>{if(!studioWork.busy)chooseSTL();};
$('#stl-file').onchange=async()=>{
  const file=$('#stl-file').files[0];if(!file||studioWork.busy)return;
  if(file.size>64*1024*1024){message('Choose an STL file up to 64 MiB.',true);return;}
  try{await working('Importing your STL…',async()=>{
    const query=new URLSearchParams({name:file.name,...(printSync.state?{printId:printSync.state.printId}:{})});
    const target={printId:printSync.state?.printId??null,editRevision:null};studioWork.generationTarget=target;
    let response;
    try{response=await fetch('/api/import-stl?'+query,{method:'POST',headers:{'X-SAAM-Token':token,'Content-Type':'application/octet-stream'},body:file});}
    finally{if(studioWork.generationTarget===target){studioWork.generationTarget=null;$('#cancel-generation').hidden=true;}}
    if(!response.ok){const result=await response.json();throw Object.assign(Error(result.error),{code:result.code});}
    await studioWork.tourUI.load();await refresh(false,true);message('');
  });}catch(error){message(error.message,error.code!=='IMPORT_CANCELLED');await studioWork.tourUI.load();if(printSync.state)await refresh(false,true);}
};
$('#open-path').onsubmit=event=>{event.preventDefault();openPrint($('#print-path').value.trim());};
$('#travel').onchange=requestDraw;
$('#follow-plate').onchange=()=>{const fit=mode=>mode==='machine'?fitMachine():fitDisplayedPart();cameras.refit(fit);orbitView.fitBounds=fit(cameras.mode);$('#fit-program').textContent='Fit all moves';saveView();requestDraw();};
$('#playback-speed').oninput=()=>{$('#speed-label').value=$('#playback-speed').value+'×';};
$('#previous-layer-opacity').oninput=()=>{$('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';saveView();requestDraw();};
$('#manual-reset').onclick=()=>{clearManual();requestDraw();};
$('#scrub').oninput=()=>{clearManual();stop();layerFade.reset();playState.seconds=Number($('#scrub').value);requestDraw();};
function stepLayer(direction){
  const pathView=viewer.sceneState().pathView;
  if(studioWork.busy||!pathView||!pathView.groups.length)return;
  clearManual();stop();layerFade.reset();
  playState.seconds=layerEndSeconds(pathView,stepLayerIndex(pathView,playState.seconds,direction));
  $('#scrub').value=playState.seconds;requestDraw();
}
$('#prev-layer').onclick=()=>stepLayer(-1);
$('#next-layer').onclick=()=>stepLayer(1);
$('#cancel-movie').onclick=()=>playState.movieController?.abort();
$('#export-movie').onclick=async()=>{
  if(studioWork.busy||!printSync.state?.program)return;
  clearManual();
  saveView();stop();requestDraw();studioWork.busy=true;
  const controller=new AbortController();playState.movieController=controller;
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
      draw:async frame=>{const machineState=await machinePose.machineSession?.sample(frame.seconds,{signal:controller.signal});controller.signal.throwIfAborted();draw({target,width,height,ratio,position:frame.seconds,now:frame.now,fadeState,updateUI:false,playbackSpeed:speed,machineState});},
      onProgress:value=>{$('#movie-progress').value=value;}});
    if(playState.movieUrl)URL.revokeObjectURL(playState.movieUrl);playState.movieUrl=URL.createObjectURL(blob);
    const link=$('#movie-download');link.href=playState.movieUrl;
    link.download=(printSync.state.printName??'saam').replace(/[^a-zA-Z0-9_-]/g,'-')+'-toolpath-'+speed+'x.webm';
    link.hidden=false;link.click();
    $('#movie-status').textContent='Movie ready · '+clock(duration()/speed+2)+' · '+(blob.size/1024/1024).toFixed(1)+' MB WebM. Includes the final fade.';
  }catch(error){$('#movie-status').textContent=controller.signal.aborted?'Movie export cancelled.':error.message;}
  finally{
    playState.movieController=null;studioWork.busy=false;controls.forEach((element,index)=>element.disabled=disabled[index]);canvas.inert=false;
    $('#cancel-movie').hidden=true;$('#movie-progress').hidden=true;render();
  }
};
$('#play').onclick=()=>{if(studioWork.busy||!(printSync.state?.program&&!printSync.state.programError||printSync.state?.neutralProgram))return;clearManual();if(playState.playing){stop();requestDraw();return;}if(playState.seconds>=duration()){playState.seconds=0;layerFade.reset();}playState.playing=true;void studioWork.tourUI?.playback('play');playState.lastFrame=0;$('#play').textContent='Pause';playState.frame=requestAnimationFrame(animate);};
async function animate(now){
  if(!playState.playing)return;
  const epoch=playState.playbackEpoch,next=playState.lastFrame?advancePlayback(playState.seconds,now-playState.lastFrame,Number($('#playback-speed').value),duration()):playState.seconds;
  playState.lastFrame=now;
  try{await machinePose.machineSession?.sample(next);}catch(error){if(error.name!=='AbortError')message(error.message,true);}
  if(!playState.playing||epoch!==playState.playbackEpoch)return;
  playState.seconds=next;$('#scrub').value=playState.seconds;draw();
  if(playState.seconds>=duration()){stop();requestDraw();return;}playState.frame=requestAnimationFrame(animate);
}
async function poll(){
  if(printSync.polling||studioWork.busy)return;printSync.polling=true;const update=printSync.stateUpdate;
  try{
    const needsFullState=!printSync.state||printSync.reconnecting||needsTourToolpath(printSync.state);
    const options=!needsFullState&&printSync.stateTag?{headers:{'If-None-Match':printSync.stateTag}}:undefined;
    const response=await fetch('/api/state',options);
    if(response.status===304){printSync.reconnecting=false;printSync.loadedUpdate=update;if(printSync.state)render();return;}
    if(response.status===204){printSync.reconnecting=false;return;} // Still no print open.
    if(!response.ok)throw new Error('Reconnecting to your print…');
    const nextTag=response.headers?.get?.('etag')??null,next=await response.json();if(playState.movieController||studioWork.busy)return;
    // Restarted servers have new session credentials. Reload the page and its
    // viewer connection instead of repeatedly posting with the previous token.
    if(printSync.state?.instanceId&&next.instanceId!==printSync.state.instanceId){window.location.reload();return;}
    if(printSync.reconnecting)message('');
    const refreshUpdatedPrint=()=>refresh(true,false,next,nextTag);
    const metadataOnly=Boolean(printSync.state&&!needsFullState&&next.presentationFingerprint===printSync.state.presentationFingerprint);
    if(metadataOnly)await refreshUpdatedPrint();
    else await working('Loading and checking the updated print…',refreshUpdatedPrint);
    printSync.reconnecting=false;printSync.loadedUpdate=update;if(printSync.state)render();
  }catch(e){printSync.reconnecting=true;agentUI.settled(e);$('#confirm').disabled=true;message('Could not update the print: '+e.message+' Reconnecting…');}
  finally{printSync.polling=false;}
}
function seekTourLayer(startAt,feature='contour'){
  const pathView=viewer.sceneState().pathView;
  if(!pathView)throw Error('The toolpath is still loading.');
  const selected=startAt?(()=>{
    if(!Number.isInteger(startAt.layer)||startAt.layer<1)throw Error('Choose a deposited layer after the first.');
    const move=pathView.moves.find(candidate=>candidate.extruding&&candidate.layer===startAt.layer);
    if(!move)throw Error('That deposited layer is not in this toolpath.');
    return {seconds:move.startSeconds,layer:move.layer,index:layerIndexAt(pathView,move.startSeconds)};
  })():representativeLayer(pathView,{feature});
  if(!selected)throw Error('This toolpath has no deposited layers to show.');
  stop();playState.seconds=selected.seconds;$('#scrub').value=playState.seconds;layerFade.reset();requestDraw();
  return selected;
}
function createStudioTour(){
  return createTourUI({post:api,refresh,working,setTab,isBusy:()=>studioWork.busy,state:()=>printSync.state,seek:seekTourLayer});
}
async function loadStudio(){await studioWork.tourUI.load();await refresh();}
function scheduleChange(){
  if(printSync.changeTimer)clearTimeout(printSync.changeTimer);
  printSync.changeTimer=setTimeout(()=>{
    printSync.changeTimer=null;
    if(studioWork.busy||printSync.polling)scheduleChange();
    else void poll();
  },75);
}
// Pushed changes drive conditional state checks. Request activity only changes
// the state identity through tour gating. A dropped or reopened viewer stream,
// a page becoming visible and a slow heartbeat cover what pushes cannot.
function studioUpdate(event){
  if(event.detail.kind==='progress'){applyProgress(event.detail.status);return;}
  const {kinds=[]}=event.detail;
  if(kinds.includes('print')){printSync.stateUpdate++;if(printSync.state)render();}
  if(kinds.includes('print')||kinds.includes('generation')||kinds.includes('tour')||kinds.includes('requests')&&printSync.state?.tour?.active)scheduleChange();
}
function studioVisible(){if(document.visibilityState==='visible')scheduleChange();}
function stopFallbackPolling(){clearInterval(printSync.stateFallbackTimer);clearInterval(printSync.progressFallbackTimer);printSync.stateFallbackTimer=printSync.progressFallbackTimer=null;}
function startFallbackPolling(){
  if(printSync.stateFallbackTimer)return;
  printSync.stateFallbackTimer=setInterval(poll,15_000);printSync.progressFallbackTimer=setInterval(pollPreparation,1000);
}
function studioConnection(event){
  if(event.detail.open){stopFallbackPolling();void pollPreparation();}
  else startFallbackPolling();
  scheduleChange();
}
function connectStudioUpdates(){
  window.addEventListener('saam-studio-update',studioUpdate);
  window.addEventListener('saam-viewer-connection',studioConnection);
  document.addEventListener('visibilitychange',studioVisible);
  if(viewerConnected())studioConnection({detail:{open:true}});else startFallbackPolling();
}
function disposeStudioSession(){
  if(printSync.changeTimer){clearTimeout(printSync.changeTimer);printSync.changeTimer=null;}
  clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;
  stopFallbackPolling();machinePose.machineSession?.dispose();viewer.dispose();
}
function restoreStudioSession(event){
  const reloadRestoredPrint=()=>refresh(false,true);
  if(event.persisted)working('Restoring your print…',reloadRestoredPrint).catch(error=>message(error.message,true));
}
function connectStudioSession(){
  window.addEventListener('pagehide',disposeStudioSession);
  window.addEventListener('pageshow',restoreStudioSession);
}
// Studio opened with no print waits for one: the person opens a print or the
// tour, or the agent opens one through request_review.
function showNoPrint(error){
  $('#kind-label').textContent='SAAM STUDIO';$('#view-title').textContent='No print open';
  $('#guidance').textContent=NO_PRINT;message('');
}
function reportOpening(error){
  if(error.code==='NO_PRINT')showNoPrint(error);
  else message(error.message,true);
}
const chatUI=initializeChatUI();
function initializeStudio(){
  studioWork.tourUI=createStudioTour();
  working('Opening Studio…',loadStudio).catch(reportOpening);
  connectStudioUpdates();
  connectStudioSession();
}
initializeStudio();
