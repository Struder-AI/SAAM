import {createTourUI,needsTourToolpath} from './tour-ui.mjs';
import { advancePlayback, exportMovie } from './playback.mjs';
import { createLayerFade, layerEndSeconds, stepLayerIndex, TOOLPATH_COLORS } from './toolpath-view.mjs';
import {hasSkill,regionRows,recipeRows,robotRows,materialGrams,claddingPatternName,claddingSubstrateName,nextExportName} from './settings.mjs';
import {sourceSession,machineCameras} from './studio/machine-session.mjs';
import {machineFitBounds,boundsCorners,machinePalette} from './machine-view.mjs';
import {point,invert} from '../core/machine/rigid.mjs';
import {createViewerRenderer} from './viewer-renderer.mjs';
import {planRefreshNavigation} from './refresh-plan.mjs';
import {prepareStudioState,withoutPreviewMaterial} from './studio-state.mjs';
import {studioControls} from './studio-controls.mjs';
import {viewerConnected} from './viewer-session.mjs';
import {createRelayPanel} from './relay-panel.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
const relayPanel=$('meta[name="saam-relay"]').content==='on'?createRelayPanel({token}):null;
const NO_PRINT='No print is open. Open a saved print, import an STL, start the tour, or ask your chat to make a part.';
const exportedThisSession=new Set();
const exportKey=()=>state?.printId+':'+state?.exportHash;
let tourUI;
let generationTarget=null,progressPolling=false,acknowledging=false;
import {TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createAgentUI} from './agent-ui.mjs';
const agentUI=initializeAgentInterface();
function initializeAgentInterface(){return createAgentUI({onActivity:active=>tourUI?.activity(active),onRequests:requests=>{
  if(!state?.work)return;
  state.work.requests=requests;
  if(needsTourToolpath(state))scheduleChange();
},onPresentation:()=>{if(!busy)void acknowledgeDisplayedView().catch(error=>message(error.message,true));},getStage:()=>tab});}
let state,stateTag=null,tab='geometry',selected=null,yaw=-0.78,tilt=0.62,zoom=1,playing=false,frame=0,busy=false,generating=false,fitBounds=null,seconds=0,lastFrame=0,polling=false,reconnecting=false;
const canvas=$('#canvas');
let drag=null,moved=false;
let pan=[0,0];
// View bursts go to the server for agents; failures never reach the person.
// Material detail drops while the view moves and the measured frame cost is
// high; one full-detail frame follows when motion stops.
// ?motion-quality=N pins a level, still frames included, to inspect or time it.
const pinnedQuality=/^[0-2]$/.test(new URLSearchParams(location.search).get('motion-quality')??'')?Number(new URLSearchParams(location.search).get('motion-quality')):null;
const layerFade=createLayerFade();
let movieController=null,movieUrl=null;
let machineSession=null,playbackEpoch=0,requestingPose=null;
let activePresentation=null;
let exportNameState=null;
let manualValues=null,manualJog=null,manualDescriptor=null;
const cameras=machineCameras();
const viewer=createViewerRenderer({canvas,pinnedQuality,reportPerformance:burst=>void fetch('/api/view-performance',{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify(burst)}).catch(()=>{})});
const phaseSwatches={planar:{name:'Body · Sky blue',color:TOOLPATH_COLORS.skyBlue},'vase-wall':{name:'Vase substrate · Orange',color:TOOLPATH_COLORS.orange},
  'cladding-axial':{name:'Axial · Teal',color:TOOLPATH_COLORS.teal},'cladding-hoop':{name:'Circumferential · Orange',color:TOOLPATH_COLORS.orange},
  'cladding-helix-forward':{name:'Helix A · Teal',color:TOOLPATH_COLORS.teal},'cladding-helix-reverse':{name:'Helix B · Orange',color:TOOLPATH_COLORS.orange}};
const cameraState=()=>({yaw,tilt,zoom,pan:[...pan],fitBounds});
function useCamera(c){if(c)({yaw,tilt,zoom,pan,fitBounds}=c);}
function machineSample(t=seconds){return machineSession?.current(t,{manual:manualValues,jog:manualJog})??null;}
function machineDisplay(t=seconds){const sample=machineSample(t);return manualValues&&sample?.snapshot?.status!=='ready'?(machineSession?.held(t)??sample):sample;}
function clearManual(){manualValues=null;manualJog=null;requestingPose=null;}
function updateManualControls(sample){
  const descriptor=machineSession?.scene?.descriptor,controls=descriptor?.controls??[];
  $('#manual-position').hidden=tab!=='toolpath'||cameras.mode!=='machine'||!controls.length;
  if(descriptor!==manualDescriptor){
    manualDescriptor=descriptor;$('#manual-sliders').replaceChildren();
    controls.forEach((c,i)=>{
      const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),output=document.createElement('output');
      row.className='manual-axis';input.id='manual-axis-'+i;input.type='range';input.step=c.step;input.min=c.min;input.max=c.max;
      label.htmlFor=input.id;label.textContent=c.label;output.htmlFor=input.id;
      input.oninput=()=>{
        const values=machineSession?.held(seconds)?.snapshot?.controlValues;if(!values?.length)return;
        stop();manualValues=[...values];manualValues[i]=Number(input.value);manualJog={axis:i,from:[...values]};requestingPose=null;requestDraw();
      };
      row.append(label,output,input);$('#manual-sliders').append(row);
    });
  }
  const values=sample?.snapshot?.controlValues??manualValues;
  $$('#manual-sliders input').forEach((input,i)=>{
    input.disabled=busy||!values?.length||!machineSession?.held(seconds);
    if(!values?.length)return;
    input.min=Math.min(controls[i].min,values[i]);input.max=Math.max(controls[i].max,values[i]);input.value=values[i];
    input.previousElementSibling.value=(Math.abs(values[i])<.05?0:values[i]).toFixed(1)+' '+controls[i].unit;
  });
  $('#manual-reset').disabled=busy||!manualValues;
  $('#manual-status').textContent=manualValues?(machineSession?.error||sample?.snapshot?.diagnostics.map(d=>d.message).join(' · ')||(sample?'Manual pose · playback paused':'Solving pose…')):'';
}
function machineTheme(){const style=getComputedStyle(canvas);return Object.fromEntries(Object.keys(machinePalette).map(role=>[role,style.getPropertyValue('--machine-'+role).trim()||machinePalette[role]]));}
let machineColors=machinePalette;
function updateMachineStatus(sample=machineSample()){
  const scene=machineSession?.scene,pose=sample?.pose;
  $('#machine-control').hidden=tab!=='toolpath'||!state?.program;
  $('#machine-view').checked=cameras.mode==='machine';$('#machine-view').disabled=busy||(!pose&&cameras.mode!=='machine');
  $('#machine-info').hidden=tab!=='toolpath'||(!scene&&!machineSession?.error);
  const diagnostic=sample?.snapshot?.diagnostics.map(d=>d.message).join(' · ');
  $('#machine-diagnostics').textContent=machineSession?.error||diagnostic||'';
  $('#machine-diagnostics').hidden=!$('#machine-diagnostics').textContent;
  $('#machine-status').textContent=machineSession?.error?'Machine model unavailable · see Machine model':'';
  if(!$('#machine-status').textContent)$('#machine-status').textContent=!scene?'Machine model unavailable':!sample?'Loading machine pose…':!pose?'Machine pose unavailable · see Machine model':
    (cameras.mode==='ghost'?'Ghost':'Machine')+(manualValues?' · manual pose':' · simulated motion')+(sample.snapshot.status==='partial'||sample.snapshot.diagnostics.some(d=>d.code!=='jog-boundary')?' · limited model':'');
  updateManualControls(sample);
}
function requestMachinePose(){
  const key=JSON.stringify([seconds,manualValues,manualJog]);
  if(tab!=='toolpath'||!machineSession?.scene||machineSample()||requestingPose?.key===key)return;
  const session=machineSession,t=seconds;
  const promise=session.sample(t,{manual:manualValues,jog:manualJog}).then(()=>{if(machineSession===session&&seconds===t)requestDraw();}).catch(error=>{if(error.name!=='AbortError')message(error.message,true);})
    .finally(()=>{if(requestingPose?.promise===promise)requestingPose=null;});
  requestingPose={key,promise};
}
const viewStorageKey=()=> 'saam-view:'+state?.printId;
function saveView(){
  if(!state||movieController)return;
  try{sessionStorage.setItem(viewStorageKey(),JSON.stringify({exportHash:state.exportHash,yaw,tilt,zoom,pan,fitBounds,seconds,tab,
    speed:Number($('#playback-speed').value),previousLayerOpacity:Number($('#previous-layer-opacity').value),travel:$('#travel').checked,followPlate:$('#follow-plate').checked,machineCameras:cameras.snapshot(cameraState())}));}catch{}
}
function restoreView(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(viewStorageKey()));if(!saved)return;
    if([saved.yaw,saved.tilt,saved.zoom].every(Number.isFinite)){yaw=saved.yaw;tilt=saved.tilt;zoom=saved.zoom;}
    if(Array.isArray(saved.pan)&&saved.pan.length===2&&saved.pan.every(Number.isFinite))pan=saved.pan;
    if(Number.isFinite(saved.speed))$('#playback-speed').value=saved.speed;
    $('#speed-label').value=$('#playback-speed').value+'×';
    if(Number.isFinite(saved.previousLayerOpacity))$('#previous-layer-opacity').value=saved.previousLayerOpacity;
    $('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';
    $('#travel').checked=saved.travel===true;$('#follow-plate').checked=saved.followPlate!==false;
    if(saved.exportHash===state.exportHash){
      if(Number.isFinite(saved.seconds))seconds=Math.max(0,Math.min(duration(),saved.seconds));
      if(saved.fitBounds?.min?.length===3&&saved.fitBounds?.max?.length===3&&[...saved.fitBounds.min,...saved.fitBounds.max].every(Number.isFinite))fitBounds=saved.fitBounds;
      if(['geometry','toolpath'].includes(saved.tab)&&(saved.tab!=='toolpath'||state.program))tab=saved.tab;
      if(machineSession?.scene)useCamera(cameras.restore(saved.machineCameras));
    }
    $('#fit-program').textContent=fitBounds?.allMoves?'Fit part':'Fit all moves';
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
  machineSession?.dispose();machineSession=null;
}
const message=(text,error=false)=>{$('#message').textContent=text;$('#message').classList.toggle('error',error);};
const presentedState=()=>activePresentation?.presentedState??state;
// A toolpath is being (re)generated and a faded preview is on offer, so the
// geometry action should return to it rather than start a fresh calculation.
const generationPending=()=>generating||agentUI.generating()||Boolean(activePresentation?.retained&&activePresentation.program);
// The toolpath pane never goes empty. Without a current program it shows a faded
// placeholder — the previous toolpath when one is retained, otherwise the part
// being sliced — through first generation, regeneration, reload and failure.
const showingGeometry=()=>tab!=='toolpath'||!presentedState()?.program;
const duration=()=>presentedState()?.program?.summary.motionSeconds??0;
const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
const round2=v=>Number(v).toFixed(2);
const materialFact=program=>program.summary.materialModel==='relay-estimate'
  ? ['Material estimate',round2(materialGrams(program.summary.estimatedRelayVolumeMm3))+' g from relay timing; unverified']
  : [program.envelope?'Part material estimate':'Material estimate',round2(materialGrams(program.summary.volumeMm3??program.volumeMm3))+' g'];
const materialSetup=state=>state.plan.setup.dobot||state.plan.setup.denso
  ? ['Extrusion','External relay control · '+state.plan.setup.material]
  : ['Material',state.plan.setup.material+' · '+state.plan.setup.nozzleC+'°C'+(state.plan.setup.filamentColor?' · '+state.plan.setup.filamentColor:'')+(state.plan.setup.ams?' · intended AMS '+state.plan.setup.ams.unit+' slot '+state.plan.setup.ams.slot:'')];
const vaseSettings=state=>{
  if(state.plan.composition?.regions?.length)return [];
  const vase=state.plan.skills?.['vase-wall'];
  return vase?.enabled?[
    [vase.pathMode==='segmented'?'Segmented paths':'Vase wall',vase.pattern?(vase.pathMode==='segmented'?'Repeated sleeve pattern with travel between gaps':'Continuous pattern wrapped around the sleeve'):'One continuous spiral; '+(vase.endTransition==='level'?'level rim':'spiral rim')],
    ['Path component',vase.part??'Part'],
    ['Path height range',vase.zStartMm+'–'+(vase.zEndMm??'geometry top')+' mm above component base'],
    ['Path sampling',vase.sampleStepMm+' mm maximum step'+(vase.pattern?'':' · '+vase.toleranceMm+' mm tolerance')]
  ]:[];
};
function machineSettings(state,rows){
  const d=state.plan.setup.dobot??state.plan.setup.denso;
  if(!d)return rows;
  const omitted=new Set(['Bed temperature','Build volume temperature','Retraction','Cooling fan','Filament diameter','Material flow limit']);
  return [...rows.filter(([name])=>!omitted.has(name)),...robotRows(state.plan,state.machine)];
}
function stop(){if(playing)void tourUI?.playback('pause');playing=false;playbackEpoch++;lastFrame=0;cancelAnimationFrame(frame);$('#play').textContent='Play';}
function activity(text='',fraction=null){
  $('#activity').hidden=!text;$('#activity-label').textContent=text;
  const measured=Number.isFinite(fraction);
  $('#activity-percent').hidden=!measured;$('#activity-progress').hidden=!measured;
  if(measured){const value=Math.min(1,Math.max(0,fraction));$('#activity-percent').textContent=Math.floor(value*100)+'%';$('#activity-progress').value=value;}
  $('#activity-detail').textContent=measured?'Progress for this stage.':'Please wait. Studio is working.';
  $('main').setAttribute('aria-busy',String(!!text));
}
async function working(text,task,{preview=true,stage=null}={}){
  if(busy)return;busy=true;stop();if(preview)agentUI.loading(stage);activity(text);if(state)render();$('#open-print').disabled=true;
  // Paint the indicator before local parsing/drawing can occupy the UI thread.
  await painted();
  let failure;
  try{return await task();}catch(error){failure=error;throw error;}
  finally{busy=false;if(preview)agentUI.settled(failure||(tab==='toolpath'&&(state?.generationError||state?.programError)));activity();$('#open-print').disabled=false;if(state)render();}
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
    eyebrow:'DEVELOPMENT PREVIEW',skinPhase:'draped-skin',skinLabel:'Draped skin',exportName:'part.gcode',
    // Faces are named by the shape that built them, so the label is the name.
    names:{},
    facts(state,tab) {
      const {geometry:g,setup:s,process:p}=state.plan,fill=state.plan.skills['full-fill'],skin=state.plan.skills['draped-skin'],normal=state.plan.skills['planar-infill'],network=state.plan.skills['line-network'];
      const shape={assembly:'Assembly',box:'Box',wedge:'Wedge','spline-tube':'Bumpy spline tube',"spline-top":'Spline top surface',"spline-shell":'Tapered spline shell',"vertical-spline-shell":'Vertical spline shell'}[g.shape]??g.shape;
      if(tab==='geometry') {
        const bounds=state.geometry.boundsMm;
        const rows=[['Shape',shape],['Footprint',round2(bounds.max[0]-bounds.min[0])+' × '+round2(bounds.max[1]-bounds.min[1])+' mm'],['Height',round2(bounds.max[2]-bounds.min[2])+' mm']];
        if(g.shape==='mesh'&&g.source?.format==='stl')rows.push(['STL units',g.source.units+(g.source.unitsInferred?' · assumed from size':'')+' · change in chat']);
        if(g.shape==='pipe')rows.push(['Bore / outside diameter',2*g.innerRadiusMm+' / '+2*g.outerRadiusMm+' mm'],['Wall thickness',round2(g.outerRadiusMm-g.innerRadiusMm)+' mm']);
        if(g.shape==='spline-top'||g.shape==='spline-shell')rows.push(['Surface',g.cpU+' × '+g.cpV+' control points']);
        if(g.shape==='spline-shell')rows.push(['Side taper','Long sides in '+g.longSideInsetMm+' mm · short sides out '+g.shortSideOutsetMm+' mm']);
        if(g.shape==='vertical-spline-shell'){
          rows.push(['Surface',g.cpU+' × '+g.cpV+' control points']);
          rows.push(['Vertical wall outline','X out '+g.xBulgeMm+' mm · Y in '+g.yInsetMm+' mm']);
        }
        const textRows=(geometry,prefix='')=>{if(geometry.shape==='text')for(const feature of geometry.features)rows.push([prefix+feature.id,(feature.mode==='raised'?'Raised':'Recessed')+' “'+feature.text+'” · '+feature.depthMm+' mm']);};
        textRows(g);
        if(g.shape==='assembly')for(const part of g.parts){rows.push([part.id,part.geometry.shape+' at '+[part.xMm,part.yMm,part.zMm].join(', ')+' mm']);textRows(part.geometry,part.id+' · ');}
        if(g.shape==='spline-tube')rows.push(['Circular bore',2*g.innerRadiusMm+' mm'],['Substrate height',g.heightMm+' mm'],['Outer spline',g.controlPoints.length+' × '+g.controlPoints[0].length+' control points'],['Surface meaning','Full-fill boundary; cladding builds outward']);
        return rows;
      }
      if(tab==='plan'&&state.plan.composition?.regions?.length)return [materialSetup(state),
        ['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],...regionRows(state.plan)];
      if(tab==='plan'&&hasSkill(state.plan,'pipe-cladding')){
        const clad=state.plan.skills['pipe-cladding'],surface=Boolean(clad.surface);
        return [materialSetup(state),['Substrate',claddingSubstrateName(state.plan)],
          ['Exterior',clad.shells+' shells · '+claddingPatternName(clad)],[surface?'Normal thickness per shell':'Radial thickness per shell',clad.normalMm+' mm'],
          ['Nozzle tilt',clad.tiltDeg+(surface?'° from the downward surface tangent toward the surface':'° inward from downward')],
          ...(clad.pattern==='crossed-helices'?[['Helices','Opposite winding on successive shells; each rises from bottom to top']]:[['Axial passes',surface?'Local surface spacing with partial passes':'Full height']]),['Between passes','Extrusion off'],...robotRows(state.plan,state.machine)];
      }
      if(tab==='plan')return [materialSetup(state),['Nozzle',(state.machine.tools.find(t=>t.index===s.tool)?.label??'#'+(s.tool+1))+' · '+s.core],['Layer height',p.layerMm+' mm'],
        ['Body',network?.enabled?network.networks.length+' independent line networks · '+network.layers+' courses':normal?.enabled?normal.perimeters+' walls · '+(normal.density===0?'hollow':Math.round(normal.density*100)+'% '+(normal.pattern??'rectilinear')+' infill'):fill.enabled?fill.perimeters+' perimeters + solid fill':'Not printed'],...vaseSettings(state),
        ...(normal?.enabled&&fill.enabled?[['Solid surfaces',fill.bottomLayers+' bottom / '+fill.topLayers+' top layers']]:[]),
        ...(skin.enabled?[['Draped skin',skin.layers+' × '+skin.normalMm+' mm along the surface'],['Roof component',skin.part??'Part roof']]:[]),
        ...(hasSkill(state.plan,'wave-overhangs')?[['Wave overhangs',state.plan.skills['wave-overhangs'].slices.length+' spline slices · '+state.plan.skills['wave-overhangs'].lineSpacingMm+' mm surface spacing']]:[]),
        ...(state.plan.geometry.shape==='assembly'?[['Fill sequencing',(state.plan.composition?.batchLayers??1)+' layer(s) per component'],['Filled components',fill.parts?.join(', ')||'All']]:[])];
      if(!state.program)return [];
      const limit=state.pathSummary?.nonplanarLimit;
      const pathCount=state.pathSummary?.vaseWall?.paths;
      const waveLayers=state.pathSummary?.waveOverhangs?.length??0;
      const rows=[state.pathSummary?.lineNetwork?['Network courses',state.pathSummary.lineNetwork.layers+' × '+state.pathSummary.lineNetwork.networks+' faces']:pathCount&&!state.pathSummary?.fullFill&&!state.pathSummary?.drapedSkin?['Deposition paths',String(pathCount)]:['Layers',(state.pathSummary?.fullFill?.layers??0)+' flat + '+(state.pathSummary?.drapedSkin?.skinLayers??0)+' draped'+(waveLayers?' + '+waveLayers+' wave slice(s)':'')],
        [state.program.envelope?'Printing motion':'Estimated motion',Math.round(duration()/60)+' min'],materialFact(state.program)];
      if(state.program.summary?.materialModel==='relay-estimate')rows.push(['Material intent',round2(materialGrams(state.program.volumeMm3))+' g; not metered']);
      if(hasSkill(state.plan,'vase-wall')){
        const regions=state.plan.composition?.regions??[];
        const selections=regions.length?regions.filter(r=>r.skills['vase-wall']).map(r=>({...state.plan.skills['vase-wall'],...r.skills['vase-wall']})):[state.plan.skills['vase-wall']];
        rows.push(['Wall paths',selections.some(s=>s.pathMode==='segmented')?'Includes segmented paths with travel':selections.some(s=>s.pattern)?'Continuous pattern wrapped around the sleeve':'Continuous spiral within its assigned region']);
      }
      if(hasSkill(state.plan,'pipe-cladding'))rows.push(['Exterior shells',state.plan.skills['pipe-cladding'].shells+' · '+claddingPatternName(state.plan.skills['pipe-cladding'])],['Motion model','Nominal Cartesian + rotary; robot feasibility deferred']);
      if(state.pathSummary?.pipeCladding?.partialAxialPasses!==undefined&&state.plan.skills['pipe-cladding'].pattern!=='crossed-helices')rows.push(['Partial vertical passes',String(state.pathSummary.pipeCladding.partialAxialPasses)],['Full vertical passes',String(state.pathSummary.pipeCladding.fullAxialPasses)]);
      if(state.plan.composition?.regions?.length)rows.push(...regionRows(state.plan));
      if(state.pathSummary?.waveOverhangs)for(const w of state.pathSummary.waveOverhangs)rows.push(['Wave slice · '+w.slice,w.waves+' fronts · '+(w.continuity?.passes??'unverified')+' continuous pass(es) · '+w.residualsUv.length+' residual region(s) within sampling tolerance']);
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
const view=()=>views.shell;
const label=id=>{const edge=viewer.sceneState().edge(id);return edge?edge.names.map(label).join(' / ')+' · edge '+edge.number:view().names[id]??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());};

// Part bounds come from the display proxy both packages write, so the camera
// and the bed grid do not need to know which shape produced them.
let waveBoundsMoves=null,waveDisplayBounds=null;
function partBounds() {
  const shown=tab==='toolpath'?(presentedState()??state):state;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of shown.geometry.vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  if(tab==='toolpath'&&shown.program&&hasSkill(shown.plan,'wave-overhangs')){
    if(waveBoundsMoves!==shown.program.moves){
      waveBoundsMoves=shown.program.moves;waveDisplayBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
      for(const move of waveBoundsMoves)if(move.extruding&&move.phase==='wave-overhangs')for(const p of [move.from,move.to])for(let i=0;i<3;i++){
        const v=p[i]-(i===0?shown.plan.placement.xMm:i===1?shown.plan.placement.yMm:0);
        waveDisplayBounds.min[i]=Math.min(waveDisplayBounds.min[i],v);waveDisplayBounds.max[i]=Math.max(waveDisplayBounds.max[i],v);
      }
    }
    for(let i=0;i<3;i++){min[i]=Math.min(min[i],waveDisplayBounds.min[i]);max[i]=Math.max(max[i],waveDisplayBounds.max[i]);}
  }
  return {min,max};
}

async function api(route,data) {
  const target=(route==='generate'||route==='tour'&&data?.action!=='finish'&&(data?.step??state?.tour?.step)>=L.playback)
    ?{printId:state?.printId,generationHash:route==='generate'?data?.generationHash:null}:null;
  if(target)generationTarget=target;
  try{
    const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({...data,printId:state?.printId})});
    if(!response.ok){const result=await response.json();throw Object.assign(new Error(result.error),{code:result.code});}
    return response;
  }finally{if(target===generationTarget){generationTarget=null;$('#cancel-generation').hidden=true;}}
}
async function pollPreparation(){
  const target=generationTarget;if(!target||progressPolling)return;
  progressPolling=true;
  try{
    const response=await fetch('/api/preparation');if(!response.ok)return;
    const job=await response.json();
    applyProgress(job,target);
  }catch{/* The owning generation call reports failures. */}finally{progressPolling=false;}
}
function applyProgress(job,target=generationTarget){
  if(!target||generationTarget!==target||!job||job.studioInstanceId&&state&&job.studioInstanceId!==state.instanceId
    ||job.printId!==target.printId||target.generationHash&&job.generationHash!==target.generationHash)return;
  target.generationHash??=job.generationHash;
  $('#cancel-generation').hidden=!job.cancellable;
  if(job.progress&&['preparing','generating','importing'].includes(job.status))
    activity(job.progress.stage,job.progress.total>0?job.progress.completed/job.progress.total:null);
}
$('#cancel-generation').onclick=async()=>{
  const target=generationTarget;if(!target)return;
  $('#cancel-generation').disabled=true;
  try{const result=await(await api('cancel-generation',{generationHash:target.generationHash})).json();
    if(result.cancelled){if(state)state.generationCancelled=true;message('Toolpath calculation cancelled.');}
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
  const loaded=state?.printId===fetched.printId?state:null,previous=!reopen?loaded:null;
  agentUI.received(fetched.work);
  const presentationChanged=!previous||previous.generationHash!==fetched.generationHash||previous.exportHash!==fetched.exportHash
    ||previous.geometry.geometryVersion!==fetched.geometry.geometryVersion;
  if(presentationChanged)clearManual();
  const scenes=viewer.sceneState();
  const adopted=await prepareStudioState(fetched,{previous,follow,presentation:activePresentation,
    pathMoves:scenes.pathMoves,materialMoves:scenes.materialMoves,decode:decodeInWorker,
    // Serializable metadata is bound before the proxy-backed cached move store is adopted.
    bind:bindCachedProgram});
  state=adopted.state;stateTag=fetchedTag;
  return {adopted,loaded,previous,presentationChanged,follow};
}
async function presentStudioState({adopted,loaded,previous,presentationChanged,follow}) {
  // Metadata can change while the exact same source/move buffers are reused.
  $('#kind-label').textContent=(state.review.generation?.mode==='development'?'Development preview · ':'')+state.machine.name;
  document.title='SAAM Studio · '+state.printName;
  $('#open-print').title='Open print: '+state.printName;
  // Geometry keys off the previously loaded state's version (null on a print
  // switch), not a value stored on geometryScene, so a different print always
  // rebuilds even when the two share a geometryVersion counter.
  if(!viewer.sceneState().hasGeometry||!loaded||loaded.geometry.geometryVersion!==state.geometry.geometryVersion)
    viewer.publishGeometry({geometry:state.geometry,featureEdges:state.tourExample?.id==='surface-drape'?['top']:[]});
  const presentation=await applyProgramPresentation(adopted.presentation,state);state=presentation.state;
  if(presentationChanged)layerFade.reset();
  const navigation=planRefreshNavigation(previous,state,{follow,tab,seconds,duration:presentation.duration,selected,
    hasSelectedEdge:viewer.sceneState().hasSelectedEdge(selected),tourInitialTab:!previous&&state.tourExample?tourUI?.initialTab():undefined});
  applyRefreshNavigation(navigation);
  machineColors=machineTheme();
  if(machineSession?.scene){
    const d=machineSession.scene.descriptor;$('#machine-basis').textContent=d.basis;
    $('#machine-limitations').replaceChildren(...d.limitations.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    await machineSession.sample(seconds,{manual:manualValues,jog:manualJog});
  }else{$('#machine-basis').textContent='';$('#machine-limitations').replaceChildren();}
  render();
  await acknowledgeDisplayedView();
}
async function ensureTourGeneration(follow=false){
  if(needsTourToolpath(state)){
    activity('Preparing your toolpath…');
    try{
      await api('generate',{development:false,generationHash:state.generationHash});
      await presentStudioState(await loadAndAdoptStudioState(follow));
    }
    catch(error){state.generationError=error.message;message(error.message,true);render();}
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
    publication=await viewer.publishProgram({moves:next.program.moves,plan:next.plan,geometry:next.geometry,previewMaterial:next.program.previewMaterial,
      buildPath:decision.effects.buildPath,buildMaterial:decision.effects.buildMaterial,onProgress:progress=>activity('Preparing material view…',progress)});}
  const state=publication?.previewMaterialConsumed?withoutPreviewMaterial(next):next;
  activePresentation={...decision.model,
    presentedState:decision.model.presentedState===next?state:decision.model.presentedState,
    program:decision.model.presentedState===next?state.program:decision.model.program};
  return {duration:duration(),state};
}
function applyRefreshNavigation(decision){
  if(decision.resetExport){stop();seconds=decision.seconds;if(cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));cameras.reset();fitBounds=null;}
  if(decision.resetView) {
    stop();selected=null;fitBounds=null;zoom=1;pan=[0,0];seconds=decision.seconds;
    cameras.reset();$('#follow-plate').checked=true;
    if(decision.surfaceDrape){yaw=-.45;tilt=.52;zoom=1.25;}
  }
  tab=decision.tab;
  if(decision.notice)message(decision.notice);
  if(decision.restoreSavedView)restoreView();
  if(decision.resetSelection)selectFeature(null);
}
async function acknowledgeDisplayedView(){
  if(acknowledging)return;
  acknowledging=true;
  try{
  await painted();
  if(agentUI.presentState(state,tab,{requiresToolpath:needsTourToolpath(state)})){
    const presented=await tourUI?.acknowledgeView(state,tab);
    if(presented)agentUI.updated(presented);
  }
  }finally{acknowledging=false;}
}
async function decodeInWorker(snapshot){
  activity('Loading your toolpath…');
  machineSession?.dispose();requestingPose=null;
  machineSession=sourceSession(new Worker('/studio/source-worker.mjs',{type:'module'}));
  return machineSession.load({printId:snapshot.printId,revision:snapshot.revision,exportHash:snapshot.exportHash,
    plan:snapshot.plan,machine:snapshot.machine,program:{sources:snapshot.program.sources}});
}
function bindCachedProgram(snapshot){return machineSession?.bind(snapshot);}
function table(entries) {
  const dl=document.createElement('dl');
  for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  return dl;
}
function selectStudioPresentation(state,tab,{facts,settings}){
  const inspection=state.inspection;
  if(inspection)return {stage:'DEVELOPMENT INSPECTION',title:inspection.title,guidance:inspection.description,
    facts:inspection.facts,settings:inspection.settings,reviewNote:inspection.note};
  const title=state.tourExample?state.printName+(tab==='toolpath'?' · toolpath':''):{geometry:'Your geometry',toolpath:'Your toolpath'}[tab];
  const guidance={geometry:'Check the shape and dimensions.',toolpath:'Inspect the full toolpath before exporting.'}[tab];
  const reviewNote=state.outputAvailability??(tab==='toolpath'?(state.generationError??state.programError??(!state.program
    ?'Generate the toolpath to review it with all printing settings.'
    :state.program.notice??state.program.envelope?.notice??'Review the settings and full toolpath together before exporting.')):'');
  return {stage:null,title,guidance,facts:facts(),settings:settings(),reviewNote};
}
function render() {
  const presentation=selectStudioPresentation(state,tab,{facts:()=>view().facts(state,tab),
    settings:()=>[...view().facts(state,'plan'),...machineSettings(state,view().settings(state)),...recipeRows(state.plan,state.machine)]});
  $('#repair-review').hidden=tab!=='geometry'||!state.importRepair;
  $('#repair-summary').textContent=state.importRepair??'';
  $('#stage-label').textContent=presentation.stage??'';$('#stage-label').hidden=!presentation.stage;
  $('#view-title').textContent=presentation.title;
  $('#guidance').textContent=presentation.guidance;$('#guidance').hidden=!presentation.guidance;
  $('#facts').replaceChildren(table(presentation.facts));
  $('#more-settings').hidden=tab!=='toolpath';
  $('#print-setup').hidden=tab!=='toolpath';
  $('#print-setup-values').textContent=state.machine.name+' · '+state.plan.setup.material;
  const suggestedName=state.printName??'';
  if(!exportNameState||exportNameState.printId!==state.printId)exportNameState={printId:state.printId,suggested:suggestedName,value:suggestedName,dirty:false};
  else if(!exportNameState.dirty&&exportNameState.suggested!==suggestedName)Object.assign(exportNameState,{suggested:suggestedName,value:suggestedName});
  const exportNameInput=$('#export-name');
  if(document.activeElement!==exportNameInput)exportNameInput.value=exportNameState.value;
  $('#settings-detail').replaceChildren(table(presentation.settings));
  $('#planar-label').textContent=hasSkill(state.plan,'line-network')?'Line networks':hasSkill(state.plan,'pipe-cladding')?'Body':'Flat layers';
  $('.dot.planar').style.background=TOOLPATH_COLORS.skyBlue;
  const pathView=viewer.sceneState().pathView;
  const samples=$('#axial-colors');samples.replaceChildren();samples.hidden=!hasSkill(state.plan,'pipe-cladding')||!pathView;
  const sampledPhases=new Set();
  if(!samples.hidden)for(const [index,group] of pathView.groups.entries()){
    const move=pathView.moves[group.first];
    const swatch=phaseSwatches[move.phase];
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
  $('#skin-label').textContent=hasSkill(state.plan,'pipe-cladding')?(state.plan.skills['pipe-cladding'].pattern==='crossed-helices'?'Crossed helices':'Circumferential'):hasSkill(state.plan,'wave-overhangs')?'Wave fronts':hasSkill(state.plan,'vase-wall')?'Skin / paths':view().skinLabel;
  const reviewed=$('#reviewed-download'),controls=studioControls(state,{tab,busy,generating,pending:generationPending(),staleProgram:Boolean(activePresentation?.retained&&activePresentation.program),
    tourActive:Boolean(tourUI?.active()),exported:exportedThisSession.has(exportKey()),currentExportKey:exportKey(),inspection:state.inspection,
    machineView:cameras.mode==='machine',reviewedExportKey:reviewed?.dataset.exportKey});
  exportNameInput.disabled=controls.exportName.disabled;$('#export-name-row').hidden=controls.exportName.hidden;
  $('#confirm').disabled=controls.confirm.disabled;$('#confirm').textContent=controls.confirm.label;$('#confirm').hidden=controls.confirm.hidden;
  $('#confirm').setAttribute('aria-disabled',controls.confirm['aria-disabled']);
  if(reviewed)reviewed.hidden=controls.reviewedDownload.hidden;
  $('#review-note').textContent=presentation.reviewNote;
  $('#playback').hidden=controls.playback.hidden;$('#play').disabled=controls.playback.playDisabled;
  $('#selection').hidden=controls.selection.hidden;
  canvas.setAttribute('aria-label',controls.canvas.label);canvas.classList.toggle('stale-toolpath',controls.canvas.stale);
  $('#scrub').max=duration();$('#scrub').value=seconds;
  $('#rotary-view').hidden=!machineSession?.scene&&!state.plan.setup.denso;
  $('#fit-program').hidden=controls.fitProgram.hidden;
  updateMachineStatus();
  // Keep the tabs live during a toolpath generation: the geometry pane stays
  // reachable (and crisp), and the toolpath pane stays reachable whenever its
  // faded preview is available, so navigating between them never cancels work.
  $$('[data-tab]').forEach(b=>{const policy=controls.tabs[b.dataset.tab];b.classList.toggle('active',b.dataset.tab===tab);b.classList.toggle('done',Boolean(policy.done));b.disabled=policy.disabled;});
  tourUI?.render(state);
  // The active-work fade is pane-specific, so re-evaluate it on every render in
  // case the tab changed without new agent activity arriving.
  agentUI.reflectFade();
  requestDraw();
}
function selectFeature(id){selected=id;$('#selection').textContent=id?label(id):'Click a surface or edge to see its name';requestDraw();}
function setTab(next){if(!state)return;clearManual();if(next!=='toolpath'&&cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));tab=next;stop();layerFade.reset();render();}

function readViewerSnapshot(options={}) {
  if(!state)return {state:null,target:options.target??canvas,updateUI:options.updateUI??true};
  const position=options.position??seconds,updateUI=options.updateUI??true,shown=tab==='toolpath'?(presentedState()??state):state;
  return {target:options.target??canvas,width:options.width??canvas.clientWidth,height:options.height??canvas.clientHeight,
    ratio:options.ratio??(devicePixelRatio||1),position,frameNow:options.now??performance.now(),fadeState:options.fadeState??layerFade,updateUI,
    playbackSpeed:options.playbackSpeed??(playing?Number($('#playback-speed').value):0),machineState:options.machineState??machineDisplay(position),
    state,shown,tab,selected,selectionLabel:selected?label(selected):'',showGeometry:showingGeometry(),
    camera:{yaw,tilt,zoom,pan:[...pan],fitBounds},bounds:partBounds(),skinPhase:view().skinPhase,cameraMode:cameras.mode,machineColors,
    settings:{showTravel:$('#travel').checked,followPlate:$('#follow-plate').checked,previousLayerOpacity:Number($('#previous-layer-opacity').value)/100},
    playing,manualPose:Boolean(manualValues),duration:duration(),interaction:drag?(drag.pan?'pan':'orbit'):null,
    performanceContext:{tab,view:cameras.mode,solid:tab==='toolpath'&&viewer.sceneState().solid,moves:state?.program?.moves.length??0,canvasCss:[canvas.clientWidth,canvas.clientHeight],
      devicePixelRatio:+(devicePixelRatio||1).toFixed(3),userAgent:navigator.userAgent}};
}
function applyViewerAnnotations(annotations) {
  if(!state)return;
  if(!playing&&!movieController)requestMachinePose();
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
  return {drag:{...drag},moved,yaw,tilt,pan:[...pan]};
}
function applyCanvasDrag(next){
  drag.x=next.drag.x;drag.y=next.drag.y;moved=next.moved;
  pan[0]=next.pan[0];pan[1]=next.pan[1];yaw=next.yaw;tilt=next.tilt;
  viewer.noteMotion(drag.pan?'pan':'orbit');requestDraw();
}
function beginCanvasDrag(e){
  if(e.button>2)return;
  e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
  drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,pan:e.shiftKey||e.button===1||e.button===2};moved=false;
}
function moveCanvasDrag(e){
  if(!drag)return;
  const current=readCanvasDrag();
  const next=planCanvasDrag(current,{x:e.clientX,y:e.clientY});
  applyCanvasDrag(next);
}
function endCanvasDrag(e){
  const select=drag&&!drag.pan&&!moved;drag=null;viewer.flushPerformance();
  if(select&&tab!=='toolpath'){const rect=canvas.getBoundingClientRect();selectFeature(viewer.pick({x:e.clientX-rect.left,y:e.clientY-rect.top}));}
}
function cancelCanvasDrag(){drag=null;}
function suppressCanvasContextMenu(e){e.preventDefault();}
function connectCanvasPointerEvents(){
  canvas.onpointerdown=beginCanvasDrag;canvas.onpointermove=moveCanvasDrag;canvas.onpointerup=endCanvasDrag;
  canvas.onpointercancel=canvas.onlostpointercapture=cancelCanvasDrag;
  canvas.oncontextmenu=suppressCanvasContextMenu;
}
connectCanvasPointerEvents();
canvas.addEventListener('wheel',e=>{e.preventDefault();viewer.noteMotion('zoom');zoom=Math.max(.08,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));requestDraw();},{passive:false});
canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;if(e.shiftKey){pan[0]+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;pan[1]+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}else{if(e.key==='ArrowLeft')yaw-=.1;else if(e.key==='ArrowRight')yaw+=.1;else if(e.key==='ArrowUp')tilt-=.1;else tilt+=.1;}e.preventDefault();viewer.noteMotion(e.shiftKey?'pan':'orbit');requestDraw();};
new ResizeObserver(requestDraw).observe(canvas);
$$('[data-view]').forEach(b=>b.onclick=()=>{const mode=b.dataset.view;if(mode==='iso'){yaw=-.78;tilt=.62;}if(mode==='side'){yaw=0;tilt=0;}if(mode==='top'){yaw=0;tilt=Math.PI/2;}requestDraw();});
function worldToDisplay(p,pose=machineSample()?.pose){const plan=(presentedState()??state).plan,q=$('#follow-plate').checked&&pose?point(invert(pose.part),p):p;return [q[0]-plan.placement.xMm,q[1]-plan.placement.yMm,q[2]];}
function fitMachine(){return machineSession?.scene?machineFitBounds(machineSession.scene,machineSample()?.pose,p=>worldToDisplay(p)):null;}
function fitDisplayedPart(bounds=partBounds()){
  const pose=machineSample()?.pose;if(!pose||$('#follow-plate').checked)return null;
  const {xMm,yMm}=(presentedState()??state).plan.placement,points=boundsCorners(bounds).map(p=>worldToDisplay(point(pose.part,[p[0]+xMm,p[1]+yMm,p[2]]),pose));
  return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
$('#machine-view').onchange=()=>{
  clearManual();
  const next=$('#machine-view').checked?'machine':'ghost';
  useCamera(cameras.switch(next,cameraState(),{yaw,tilt,zoom:1,pan:[0,0],fitBounds:fitMachine()}));
  $('#fit-program').hidden=next==='machine';$('#fit-program').textContent=fitBounds?.allMoves?'Fit part':'Fit all moves';updateMachineStatus();saveView();requestDraw();
};
$('#reset-view').onclick=()=>{zoom=1;pan=[0,0];yaw=-.78;tilt=.62;fitBounds=cameras.mode==='machine'?fitMachine():fitDisplayedPart();$('#fit-program').textContent='Fit all moves';requestDraw();};
$('#fit-program').onclick=()=>{
  if(fitBounds?.allMoves){fitBounds=fitDisplayedPart();$('#fit-program').textContent='Fit all moves';}
  else {
    const part=partBounds();
    fitBounds={min:[part.min[0],part.min[1],0],max:[part.max[0],part.max[1],0]};
    const shown=presentedState()??state;
    for(const move of shown.program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){
      const v=p[i]-(i===0?shown.plan.placement.xMm:i===1?shown.plan.placement.yMm:0);
      fitBounds.min[i]=Math.min(fitBounds.min[i],v);fitBounds.max[i]=Math.max(fitBounds.max[i],v);
    }
    fitBounds=fitDisplayedPart(fitBounds)??fitBounds;fitBounds.allMoves=true;
    $('#travel').checked=true;$('#fit-program').textContent='Fit part';
  }
  zoom=1;pan=[0,0];requestDraw();
};
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
async function approval(){
  const response=await api('approve',{actor:'Local user',revision:state.revision});
  const result=await response.json();
  Object.assign(state,result.approval);
  if(!result.approval.programAvailable){delete state.program;clearProgramView();}
}
async function download(route='deliver',data={}){
  const name=$('#export-name').value.trim();if(!name)throw Error('Enter a print name before exporting.');
  const key=exportKey(),response=await api(route,{...data,name,downloadLink:true});
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
    Object.assign(exportNameState,{value:nextName,dirty:true});
  }
}
$('#export-name').oninput=event=>{if(!exportNameState)return;exportNameState.value=event.target.value;exportNameState.dirty=event.target.value!==exportNameState.suggested;};
$('#confirm').onclick=async()=>{
  if((busy&&!generating)||!state)return;message('');
  if(tourUI?.active()&&tab!=='geometry'){
    if(!state.program||state.programError||state.review.generation?.mode!=='production')return;
    try{await working('Downloading your reviewed file…',async()=>{await download('tour-export',{revision:state.revision,exportHash:state.exportHash});await api('tour',{action:'finish'});await tourUI.load();render();},{preview:false});}
    catch(e){message(e.message,true);await refresh(false);}return;
  }
  const validProgram=state.program&&!state.programError&&state.review.generation?.mode==='production';
  // While a toolpath is still computing, Next just returns to its faded pane; it
  // must not launch a second calculation or cancel the pending one.
  if(!validProgram&&generationPending()){if(tab==='geometry')setTab('toolpath');return;}
  try{
    await working(tab==='toolpath'?'Checking your toolpath…':'Preparing your toolpath…',async()=>{
    if(tab==='geometry'){
      if(validProgram){setTab('toolpath');await acknowledgeDisplayedView();}
      else{activity('Calculating toolpath');generating=true;try{await api('generate',{development:false});tab='toolpath';await refresh();}finally{generating=false;}}
    }
    else if(!validProgram){activity('Calculating toolpath');generating=true;try{await api('generate',{development:false});tab='toolpath';await refresh();}finally{generating=false;}}
    else {if(!state.toolpathApproved)await approval();await download();}
    message('');
    },{preview:tab==='geometry'||!validProgram,stage:'toolpath'});
  }catch(e){message(e.message,true);}
};
async function openPrint(path){
  if(busy)return;
  saveView();
  $('#picker-message').textContent='';$('#print-picker').close();
  const loadSavedPrint=async()=>{await api('open',{path});await tourUI?.load();await refresh(false,true);message('');};
  try{await working('Opening and checking your saved print…',loadSavedPrint);}
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
function chooseSTL(){$('#stl-file').value='';$('#stl-file').click();}
// With no print open there is no printer to inherit: ask for one first,
// defaulting to the printer of the most recently changed print.
async function choosePrinter(){
  $('#machine-message').textContent='Loading printers…';$('#import-machine').replaceChildren();$('#machine-picker').showModal();
  try{
    const response=await fetch('/api/machines');if(!response.ok)throw Error('Could not list printers.');
    const {machines,defaultId}=await response.json();
    for(const machine of machines){const option=document.createElement('option');option.value=machine.id;option.textContent=machine.name;option.selected=machine.id===defaultId;$('#import-machine').append(option);}
    $('#machine-message').textContent='';$('#import-machine').focus();
  }catch(error){$('#machine-message').textContent=error.message;}
}
$('#import-stl').onclick=()=>{if(busy)return;if(state)chooseSTL();else void choosePrinter();};
$('#machine-form').onsubmit=event=>{event.preventDefault();if(!$('#import-machine').value)return;$('#machine-picker').close();chooseSTL();};
$('#close-machine-picker').onclick=()=>$('#machine-picker').close();
$('#stl-file').onchange=async()=>{
  const file=$('#stl-file').files[0];if(!file||busy)return;
  if(file.size>64*1024*1024){message('Choose an STL file up to 64 MiB.',true);return;}
  try{await working('Importing your STL…',async()=>{
    const query=new URLSearchParams(state?{name:file.name,printId:state.printId}:{name:file.name,machineId:$('#import-machine').value});
    const target={printId:state?.printId??null,generationHash:null},firstPrint=!state;generationTarget=target;
    let response;
    try{response=await fetch('/api/import-stl?'+query,{method:'POST',headers:{'X-SAAM-Token':token,'Content-Type':'application/octet-stream'},body:file});}
    finally{if(generationTarget===target)generationTarget=null;}
    if(!response.ok)throw Error((await response.json()).error);
    await tourUI.load();await refresh(false,true);message('');
    if(firstPrint)relayPanel?.close();
  });}catch(error){message(error.message,true);await tourUI.load();if(state)await refresh(false,true);}
};
$('#open-path').onsubmit=event=>{event.preventDefault();openPrint($('#print-path').value.trim());};
$('#travel').onchange=requestDraw;
$('#follow-plate').onchange=()=>{const fit=mode=>mode==='machine'?fitMachine():fitDisplayedPart();cameras.refit(fit);fitBounds=fit(cameras.mode);$('#fit-program').textContent='Fit all moves';saveView();requestDraw();};
$('#playback-speed').oninput=()=>{$('#speed-label').value=$('#playback-speed').value+'×';};
$('#previous-layer-opacity').oninput=()=>{$('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';saveView();requestDraw();};
$('#manual-reset').onclick=()=>{clearManual();requestDraw();};
$('#scrub').oninput=()=>{clearManual();stop();layerFade.reset();seconds=Number($('#scrub').value);requestDraw();};
function stepLayer(direction){
  const pathView=viewer.sceneState().pathView;
  if(busy||!pathView||!pathView.groups.length)return;
  clearManual();stop();layerFade.reset();
  seconds=layerEndSeconds(pathView,stepLayerIndex(pathView,seconds,direction));
  $('#scrub').value=seconds;requestDraw();
}
$('#prev-layer').onclick=()=>stepLayer(-1);
$('#next-layer').onclick=()=>stepLayer(1);
$('#cancel-movie').onclick=()=>movieController?.abort();
$('#export-movie').onclick=async()=>{
  if(busy||!state?.program)return;
  clearManual();
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
      draw:async frame=>{const machineState=await machineSession?.sample(frame.seconds,{signal:controller.signal});controller.signal.throwIfAborted();draw({target,width,height,ratio,position:frame.seconds,now:frame.now,fadeState,updateUI:false,playbackSpeed:speed,machineState});},
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
$('#play').onclick=()=>{if(busy||!state?.program||state.programError)return;clearManual();if(playing){stop();requestDraw();return;}if(seconds>=duration()){seconds=0;layerFade.reset();}playing=true;void tourUI?.playback('play');lastFrame=0;$('#play').textContent='Pause';frame=requestAnimationFrame(animate);};
async function animate(now){
  if(!playing)return;
  const epoch=playbackEpoch,next=lastFrame?advancePlayback(seconds,now-lastFrame,Number($('#playback-speed').value),duration()):seconds;
  lastFrame=now;
  try{await machineSession?.sample(next);}catch(error){if(error.name!=='AbortError')message(error.message,true);}
  if(!playing||epoch!==playbackEpoch)return;
  seconds=next;$('#scrub').value=seconds;draw();
  if(seconds>=duration()){stop();requestDraw();return;}frame=requestAnimationFrame(animate);
}
async function poll(){
  if(polling||busy)return;polling=true;
  try{
    const needsFullState=!state||reconnecting||needsTourToolpath(state);
    const options=!needsFullState&&stateTag?{headers:{'If-None-Match':stateTag}}:undefined;
    const response=await fetch('/api/state',options);
    if(response.status===304){reconnecting=false;return;}
    if(response.status===204){reconnecting=false;return;} // Still no print open.
    if(!response.ok)throw new Error('Reconnecting to your print…');
    const nextTag=response.headers?.get?.('etag')??null,next=await response.json();if(movieController||busy)return;
    // Restarted servers have new session credentials. Reload the page and its
    // viewer connection instead of repeatedly posting with the previous token.
    if(state?.instanceId&&next.instanceId!==state.instanceId){window.location.reload();return;}
    if(reconnecting)message('');
    const refreshUpdatedPrint=()=>refresh(true,false,next,nextTag);
    const metadataOnly=Boolean(state&&!needsFullState&&next.presentationFingerprint===state.presentationFingerprint),firstPrint=!state;
    if(metadataOnly)await refreshUpdatedPrint();
    else await working('Loading and checking the updated print…',refreshUpdatedPrint);
    // The chat opened the first print into an empty Studio: show it.
    if(firstPrint)relayPanel?.close();
    reconnecting=false;
  }catch(e){reconnecting=true;agentUI.settled(e);$('#confirm').disabled=true;message('Could not update the print: '+e.message+' Reconnecting…');}
  finally{polling=false;}
}
function seekTourLayer(startAt){
  if(!Number.isInteger(startAt?.layer)||startAt.layer<1)throw Error('Your agent must choose an infill layer for this tour.');
  let move,first;for(const candidate of state.program?.moves??[])if(candidate.extruding){
    first??=candidate;
    if(candidate.layer===startAt.layer&&(startAt.fallback||/infill/.test(candidate.operation??'')&&!/solid|walls/.test(candidate.operation??''))){move=candidate;break;}
  }
  if(!move&&startAt.fallback)move=first;
  if(!move)throw Error('That layer has no sparse infill. Ask your agent to choose another startAt layer.');
  stop();seconds=move.startSeconds;$('#scrub').value=seconds;layerFade.reset();requestDraw();
  return {layer:move.layer};
}
function createStudioTour(){
  return createTourUI({post:api,refresh,working,setTab,isBusy:()=>busy,state:()=>state,seek:seekTourLayer});
}
async function loadStudio(){await tourUI.load();await refresh();}
let changeTimer,stateFallbackTimer,progressFallbackTimer;
function scheduleChange(){
  if(changeTimer)clearTimeout(changeTimer);
  changeTimer=setTimeout(()=>{
    changeTimer=null;
    if(busy||polling)scheduleChange();
    else void poll();
  },75);
}
// Pushed changes drive conditional state checks. Request activity only changes
// the state identity through tour gating. A dropped or reopened viewer stream,
// a page becoming visible and a slow heartbeat cover what pushes cannot.
function studioUpdate(event){
  if(event.detail.kind==='progress'){applyProgress(event.detail.status);return;}
  const {kinds=[]}=event.detail;
  if(kinds.includes('print')||kinds.includes('tour')||kinds.includes('requests')&&state?.tour?.active)scheduleChange();
}
function studioVisible(){if(document.visibilityState==='visible')scheduleChange();}
function stopFallbackPolling(){clearInterval(stateFallbackTimer);clearInterval(progressFallbackTimer);stateFallbackTimer=progressFallbackTimer=null;}
function startFallbackPolling(){
  if(stateFallbackTimer)return;
  stateFallbackTimer=setInterval(poll,15_000);progressFallbackTimer=setInterval(pollPreparation,1000);
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
  if(changeTimer){clearTimeout(changeTimer);changeTimer=null;}
  stopFallbackPolling();machineSession?.dispose();viewer.dispose();
}
function restoreStudioSession(event){
  const reloadRestoredPrint=()=>refresh(false,true);
  if(event.persisted)working('Restoring your print…',reloadRestoredPrint).catch(error=>message(error.message,true));
}
function connectStudioSession(){
  window.addEventListener('pagehide',disposeStudioSession);
  window.addEventListener('pageshow',restoreStudioSession);
}
// Studio opened with no print (a relay computer at launch) waits for one: the
// person opens a print or the tour, or the chat opens one through request_review.
function showNoPrint(error){
  $('#kind-label').textContent='SAAM STUDIO';$('#view-title').textContent='No print open';
  $('#guidance').textContent=error.message;message('');
  relayPanel?.open();
}
function reportOpening(error){
  if(error.code==='NO_PRINT')showNoPrint(error);
  else message(error.message,true);
}
function initializeStudio(){
  tourUI=createStudioTour();
  working('Opening Studio…',loadStudio).catch(reportOpening);
  connectStudioUpdates();
  connectStudioSession();
}
initializeStudio();
