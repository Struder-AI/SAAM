import {createTourUI,needsTourToolpath} from './tour-ui.mjs';
import { advancePlayback, frameAtTime, displayPoint, exportMovie } from './playback.mjs';
import { createProjection } from './camera.mjs';
import { buildToolpathView, toolpathFrame, toolpathStyle, createLayerFade, layerKey, remainingLayerMs, layerIndexAt, layerEndSeconds, stepLayerIndex, TOOLPATH_COLORS } from './toolpath-view.mjs';
import {buildGeometryView,createGeometryRenderer,pickGeometry,visibleGeometryEdgeSegments} from './mesh-view.mjs';
import {buildMaterialScene,createMaterialRenderer} from './material-view.mjs';
import {hasSkill,regionRows,recipeRows,robotRows,materialGrams,claddingPatternName,claddingSubstrateName} from './settings.mjs';
import {sourceSession,machineCameras} from './studio/machine-session.mjs';
import {transform,untransform,machineFitBounds,boundsCorners,drawMachineCanvas,machinePalette} from './machine-view.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
const exportedThisSession=new Set();
const exportKey=()=>state?.printId+':'+state?.exportHash;
let tourUI;
let generationTarget=null,progressPolling=false,acknowledging=false;
import {TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createAgentUI} from './agent-ui.mjs';
import {presentableView} from './work-state.mjs';
const agentUI=createAgentUI({onActivity:active=>tourUI?.activity(active),onRequests:requests=>{
  if(!state?.work)return;
  state.work.requests=requests;
  if(needsTourToolpath(state))scheduleChange();
},onPresentation:()=>{if(!busy)void acknowledgeDisplayedView().catch(error=>message(error.message,true));}});
let state,tab='geometry',selected=null,yaw=-0.78,tilt=0.62,zoom=1,playing=false,frame=0,busy=false,fitBounds=null,seconds=0,lastFrame=0,polling=false,reconnecting=false;
const canvas=$('#canvas');
let polygons=[],drag=null,moved=false;
let pan=[0,0];
let redrawFrame=0;
let pathView,meshView;
let geometryScene,geometryRenderer,geometryProject,geometryError='';
let materialScene,materialRenderer,materialError='';
const layerFade=createLayerFade();
let movieController=null,movieUrl=null;
let machineSession=null,playbackEpoch=0,requestingPose=null;
let playbackCache=null;
let exportNameState=null;
let manualValues=null,manualJog=null,manualDescriptor=null;
const cameras=machineCameras();
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
window.addEventListener('pagehide',saveView);
function requestDraw(){
  if(!redrawFrame)redrawFrame=requestAnimationFrame(()=>{redrawFrame=0;draw();});
}
function clearProgramView(){
  playbackCache=null;
  clearManual();
  if(cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));
  cameras.reset();
  pathView=null;materialScene=null;materialRenderer?.dispose();materialRenderer=null;
  machineSession?.dispose();machineSession=null;
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
  : ['Material',state.plan.setup.material+' · '+state.plan.setup.nozzleC+'°C'+(state.plan.setup.filamentColor?' · '+state.plan.setup.filamentColor:'')+(state.plan.setup.amsSlot?' · intended AMS slot '+state.plan.setup.amsSlot:'')];
const vaseSettings=state=>{
  if(state.plan.composition?.regions?.length)return [];
  const vase=state.plan.skills?.['vase-wall'];
  return vase?.enabled?[
    [vase.pathMode==='segmented'?'Segmented paths':'Vase wall',vase.pattern?(vase.pathMode==='segmented'?'Repeated sleeve motif with travel between gaps':'Continuous motif wrapped around the sleeve'):'One continuous spiral; '+(vase.endTransition==='level'?'level rim':'spiral rim')],
    ['Path component',vase.part??'Part'],
    ['Path height range',vase.zStartMm+'–'+(vase.zEndMm??'geometry top')+' mm above component base'],
    ['Path sampling',vase.sampleStepMm+' mm maximum step'+(vase.pattern?'':' · '+vase.toleranceMm+' mm tolerance')]
  ]:[];
};
function machineSettings(state,rows){
  const d=state.plan.setup.dobot??state.plan.setup.denso;
  if(!d)return rows;
  const omitted=new Set(['Bed temperature','Build volume temperature','Retraction','Cooling fan','Filament diameter','Material flow limit']);
  return [...rows.filter(([name])=>!omitted.has(name)),...robotRows(state.plan)];
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
async function working(text,task,{preview=true}={}){
  if(busy)return;busy=true;stop();if(preview)agentUI.loading();activity(text);if(state)render();$('#open-print').disabled=true;
  // Paint the indicator before local parsing/drawing can occupy the UI thread.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  let failure;
  try{return await task();}catch(error){failure=error;throw error;}
  finally{busy=false;if(preview)agentUI.settled(failure||(tab==='toolpath'&&(state?.generationError||state?.programError)));activity();$('#open-print').disabled=false;if(state)render();}
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
          ...(clad.pattern==='crossed-helices'?[['Helices','Opposite winding on successive shells; each rises from bottom to top']]:[['Axial passes',surface?'Local surface spacing with partial passes':'Full height']]),['Between passes','Extrusion off'],...robotRows(state.plan)];
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
        rows.push(['Wall paths',selections.some(s=>s.pathMode==='segmented')?'Includes segmented paths with travel':selections.some(s=>s.pattern)?'Continuous motif wrapped around the sleeve':'Continuous spiral within its assigned region']);
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
const view=()=>views[state?.kind==='shell'?'shell':'wedge'];
const label=id=>{const edge=geometryScene?.edgeFeatures.get(id);return edge?edge.names.map(label).join(' / ')+' · edge '+edge.number:view().names[id]??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());};

// Part bounds come from the display proxy both packages write, so the camera
// and the bed grid do not need to know which shape produced them.
let waveBoundsMoves=null,waveDisplayBounds=null;
function partBounds() {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of state.geometry.vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  if(tab==='toolpath'&&state.program&&hasSkill(state.plan,'wave-overhangs')){
    if(waveBoundsMoves!==state.program.moves){
      waveBoundsMoves=state.program.moves;waveDisplayBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
      for(const move of waveBoundsMoves)if(move.extruding&&move.phase==='wave-overhangs')for(const p of [move.from,move.to])for(let i=0;i<3;i++){
        const v=p[i]-(i===0?state.plan.placement.xMm:i===1?state.plan.placement.yMm:0);
        waveDisplayBounds.min[i]=Math.min(waveDisplayBounds.min[i],v);waveDisplayBounds.max[i]=Math.max(waveDisplayBounds.max[i],v);
      }
    }
    for(let i=0;i<3;i++){min[i]=Math.min(min[i],waveDisplayBounds.min[i]);max[i]=Math.max(max[i],waveDisplayBounds.max[i]);}
  }
  return {min,max};
}

async function api(route,data) {
  const target=(route==='generate'||route==='tour'&&data?.action!=='finish'&&(data?.step??state?.tour?.step)>=L.playback)
    ?{printId:state?.printId,planHash:route==='generate'?data?.planHash:null}:null;
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
    if(generationTarget!==target||job.printId!==target.printId||target.planHash&&job.planHash!==target.planHash)return;
    target.planHash??=job.planHash;$('#cancel-generation').hidden=!job.cancellable;
    if(job.progress&&['preparing','generating','importing'].includes(job.status))activity(job.progress.stage,job.progress.total>0?job.progress.completed/job.progress.total:null);
  }catch{/* The owning generation call reports failures. */}finally{progressPolling=false;}
}
setInterval(pollPreparation,250);
$('#cancel-generation').onclick=async()=>{
  const target=generationTarget;if(!target)return;
  $('#cancel-generation').disabled=true;
  try{const result=await(await api('cancel-generation',{planHash:target.planHash})).json();
    if(result.cancelled){if(state)state.generationCancelled=true;message('Toolpath calculation cancelled.');}
    else if(result.committing)message('The calculation finished; saving its checked file.');
  }catch(error){message(error.message,true);}finally{$('#cancel-generation').disabled=false;}
};
async function refresh(follow=false,reopen=false) {
  const response=await fetch('/api/state');if(!response.ok)throw new Error((await response.json()).error);
  const next=await response.json(),loaded=state?.printId===next.printId?state:null,previous=!reopen?loaded:null;
  agentUI.received(next.work);
  if(!previous||previous.revision!==next.revision||previous.exportHash!==next.exportHash)clearManual();
  if(next.program){
    // Rebind serializable metadata before attaching the proxy-backed move store.
    if(playbackCache?.printId===next.printId&&playbackCache.exportHash===next.exportHash&&playbackCache.planHash===next.planHash){await machineSession?.bind(next);next.program=playbackCache.program;}
    else try{
      const decoded=await decodeInWorker(next);
      next.program={...next.program,...decoded,summary:{...decoded.summary,...next.program.summary}};
    }catch(error){next.programError=error.message;delete next.program;next.toolpathApproved=false;}
  }
  state=next;
  const tourActive=state.tour?.active&&state.tour.directory===state.localPrintDirectory;
  const chatConfirmed=follow&&previous&&!previous.geometryApproved&&state.geometryApproved&&!tourActive;
  // Metadata can change while the exact same source/move buffers are reused.
  $('#kind-label').textContent=(state.review.generation?.mode==='development'?'Development preview · ':'')+state.machine.name;
  $('#skin-label').textContent=view().skinLabel;
  document.title='SAAM Studio · '+state.printName;
  $('#open-print').title='Open print: '+state.printName;
  if(!geometryScene||loaded?.geometry.geometryVersion!==state.geometry.geometryVersion){
    geometryScene=buildGeometryView(state.geometry,35,state.tourExample?.id==='surface-drape'?['top']:[]);meshView=geometryScene.topology;
    try{geometryRenderer??=createGeometryRenderer();geometryError=geometryRenderer?'':'Shading needs WebGL2; showing flat surfaces.';}
    catch(error){geometryError='Shading unavailable: '+error.message;}
  }
  // Geometry-only tour responses deliberately omit source. Retain at most the
  // current print's decoded view so Back/Continue can reuse unchanged bytes.
  if(!state.program){
    if(!(state.tour?.active&&state.tour.step<L.playback&&playbackCache?.printId===state.printId&&playbackCache.planHash===state.planHash))clearProgramView();
  }else{
    if(pathView?.moves!==state.program.moves)pathView=buildToolpathView(state.program.moves);
    playbackCache={printId:state.printId,planHash:state.planHash,exportHash:state.exportHash,program:state.program};
  }
  if(state.program&&materialScene?.moves!==state.program.moves){
    materialError='';
    try{
      materialRenderer??=createMaterialRenderer();
      if(materialRenderer&&state.program.previewMaterial){materialScene={...state.program.previewMaterial,moves:state.program.moves,plan:state.plan,geometry:state.geometry};delete state.program.previewMaterial;}
      else if(materialRenderer)materialScene=await buildMaterialScene(state.program.moves,state.plan,state.geometry,
        {onProgress:progress=>activity('Preparing material view…',progress)});
      else materialError='3D material rendering needs WebGL2. Showing toolpath lines.';
    }catch(error){materialScene=null;materialError='Material view unavailable: '+error.message+' Showing toolpath lines.';}
  }
  layerFade.reset();
  if(previous?.exportHash!==next.exportHash){stop();seconds=duration();if(cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));cameras.reset();fitBounds=null;}
  if(!previous) {
    stop();selected=null;fitBounds=null;zoom=1;pan=[0,0];seconds=duration();
    cameras.reset();$('#follow-plate').checked=true;
    if(state.tourExample?.id==='surface-drape'){yaw=-.45;tilt=.52;zoom=1.25;}
    tab=state.tourExample?(tourUI?.initialTab()??'geometry'):state.program?'toolpath':state.geometryApproved?'toolpath':'geometry';
    if(!state.tourExample)restoreView();
  }
  else if(follow&&previous.planHash!==state.planHash){if(!tourActive||!state.geometryApproved)tab=state.geometryApproved?'toolpath':'geometry';message('Updated from chat.');}
  else if(chatConfirmed)tab='toolpath';
  else if(follow&&state.planApproved&&!previous.program&&state.program)tab='toolpath';
  if(!selected||!state.geometry.labels.includes(selected)&&(!geometryScene.edgeFeatures.has(selected)||previous?.geometry.geometryVersion!==state.geometry.geometryVersion))selectFeature(null);
  machineColors=machineTheme();
  if(machineSession?.scene){
    const d=machineSession.scene.descriptor;$('#machine-basis').textContent=d.basis;
    $('#machine-limitations').replaceChildren(...d.limitations.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    await machineSession.sample(seconds,{manual:manualValues,jog:manualJog});
  }else{$('#machine-basis').textContent='';$('#machine-limitations').replaceChildren();}
  render();
  await acknowledgeDisplayedView();
  if(needsTourToolpath(state)||chatConfirmed&&(!state.program||state.programError)){
    activity('Preparing your toolpath…');
    try{await api('generate',{development:false,planHash:state.planHash});return refresh(follow);}
    catch(error){state.generationError=error.message;message(error.message,true);render();}
  }
}
async function acknowledgeDisplayedView(){
  if(acknowledging)return;
  acknowledging=true;
  try{
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const view=presentableView(state,tab,{requiresToolpath:needsTourToolpath(state)});
  if(view.ready){
    agentUI.present({...state.work,...view});
    const presented=await tourUI?.acknowledgeView(state,tab);
    if(presented)agentUI.updated(presented);
  }
  }finally{acknowledging=false;}
}
async function decodeInWorker(snapshot){
  activity('Loading your toolpath…');
  machineSession?.dispose();requestingPose=null;
  machineSession=sourceSession(new Worker('/studio/source-worker.mjs',{type:'module'}));
  return machineSession.load({printId:snapshot.printId,revision:snapshot.revision,exportHash:snapshot.exportHash,sourceTransport:snapshot.sourceTransport,
    plan:snapshot.plan,machine:snapshot.machine,program:{sources:snapshot.program.sources}});
}
function table(entries) {
  const dl=document.createElement('dl');
  for(const [key,value]of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  return dl;
}
function render() {
  $('#repair-review').hidden=tab!=='geometry'||!state.importRepair||state.geometryApproved;
  $('#repair-summary').textContent=state.importRepair??'';
  $('#stage-label').hidden=!state.inspection;
  $('#view-title').textContent={geometry:'Your geometry',toolpath:'Your toolpath'}[tab];
  $('#guidance').textContent={geometry:'Check the shape and dimensions.',toolpath:'Inspect the full toolpath before exporting.'}[tab];
  $('#guidance').hidden=!$('#guidance').textContent;
  $('#facts').replaceChildren(table(view().facts(state,tab)));
  $('#more-settings').hidden=tab!=='toolpath';
  $('#print-setup').hidden=tab!=='toolpath';
  $('#print-setup-values').textContent=state.machine.name+' · '+state.plan.setup.material;
  const suggestedName=state.printName??'';
  if(!exportNameState||exportNameState.printId!==state.printId)exportNameState={printId:state.printId,suggested:suggestedName,value:suggestedName,dirty:false};
  else if(!exportNameState.dirty&&exportNameState.suggested!==suggestedName)Object.assign(exportNameState,{suggested:suggestedName,value:suggestedName});
  const exportNameInput=$('#export-name');
  if(document.activeElement!==exportNameInput)exportNameInput.value=exportNameState.value;
  exportNameInput.disabled=busy;$('#export-name-row').hidden=tab!=='toolpath'||!state.program||Boolean(state.inspection);
  $('#settings-detail').replaceChildren(table([...view().facts(state,'plan'),...machineSettings(state,view().settings(state)),...recipeRows(state.plan,state.machine)]));
  $('#planar-label').textContent=hasSkill(state.plan,'line-network')?'Line networks':hasSkill(state.plan,'pipe-cladding')?'Body':'Flat layers';
  $('.dot.planar').style.background=TOOLPATH_COLORS.skyBlue;
  const samples=$('#axial-colors');samples.replaceChildren();samples.hidden=!hasSkill(state.plan,'pipe-cladding')||!pathView;
  const sampledPhases=new Set();
  if(!samples.hidden)for(const [index,group] of pathView.groups.entries()){
    const move=pathView.moves[group.first];
    const swatch={planar:{name:'Body · Sky blue',color:TOOLPATH_COLORS.skyBlue},'vase-wall':{name:'Vase substrate · Orange',color:TOOLPATH_COLORS.orange},'cladding-axial':{name:'Axial · Teal',color:TOOLPATH_COLORS.teal},'cladding-hoop':{name:'Circumferential · Orange',color:TOOLPATH_COLORS.orange},'cladding-helix-forward':{name:'Helix A · Teal',color:TOOLPATH_COLORS.teal},'cladding-helix-reverse':{name:'Helix B · Orange',color:TOOLPATH_COLORS.orange}}[move.phase];
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
  const ready=tab==='geometry'||(tab==='toolpath'&&state.geometryApproved);
  $('#confirm').disabled=!ready||busy;
  $('#confirm').textContent=tab==='geometry'?(state.geometryApproved?'View toolpath':'Confirm geometry'):!state.program||state.programError||state.review.generation?.mode!=='production'?'Generate toolpath':state.toolpathApproved?(exportedThisSession.has(exportKey())?'Export again':'Export print file'):'Confirm settings & export';
  if($('#reviewed-download'))$('#reviewed-download').hidden=$('#reviewed-download').dataset.exportKey!==exportKey();
  $('#review-note').textContent=state.outputAvailability??(tab==='toolpath'?(state.generationError??state.programError??(!state.program?'Generate the toolpath to review it with all printing settings.':!state.geometryApproved?'Confirm geometry before reviewing this as a real print.':state.program.notice??state.program.envelope?.notice??'Review the settings and full toolpath together before exporting.')):'');
  $('#playback').hidden=tab!=='toolpath'||!state.program;
  $('#play').disabled=busy||!state.program||Boolean(state.programError);
  $('#selection').hidden=tab==='toolpath';
  canvas.setAttribute('aria-label',tab==='toolpath'?'Toolpath viewer. Previous layer opacity is adjustable. Drag or use arrow keys to rotate; scroll to zoom.':'Part viewer. Drag or use arrow keys to rotate; scroll to zoom; click a surface or edge to see its name.');
  $('#scrub').max=duration();$('#scrub').value=seconds;
  $('#rotary-view').hidden=!machineSession?.scene&&!state.plan.setup.denso;
  $('#fit-program').hidden=cameras.mode==='machine';
  updateMachineStatus();
  $$('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.classList.toggle('done',!!state[{geometry:'geometryApproved',toolpath:'toolpathApproved'}[b.dataset.tab]]);b.disabled=busy||b.dataset.tab==='toolpath'&&!state.program&&!state.geometryApproved;});
  // Explicit local scratch adapters can describe historical paths without
  // assigning them a current skill or presenting manufacturing approval controls.
  $('#confirm').hidden=Boolean(state.inspection);
  if(state.tourExample)$('#view-title').textContent=state.printName+(tab==='toolpath'?' · toolpath':'');
  tourUI?.render(state);
  if(state.inspection){
    const inspection=state.inspection;
    $('#stage-label').textContent='DEVELOPMENT INSPECTION';
    $('#view-title').textContent=inspection.title;
    $('#guidance').textContent=inspection.description;
    $('#guidance').hidden=!inspection.description;
    $('#facts').replaceChildren(table(inspection.facts));
    $('#settings-detail').replaceChildren(table(inspection.settings));
    $('#review-note').textContent=inspection.note;
  }
  requestDraw();
}
function selectFeature(id){selected=id;$('#selection').textContent=id?label(id):'Click a surface or edge to see its name';requestDraw();}
function setTab(next){if(!state)return;clearManual();if(next!=='toolpath'&&cameras.mode==='machine')useCamera(cameras.switch('ghost',cameraState()));tab=next;stop();layerFade.reset();render();}

function draw({target=canvas,width=canvas.clientWidth,height=canvas.clientHeight,ratio=devicePixelRatio||1,
  position=seconds,now=performance.now(),fadeState=layerFade,updateUI=true,
  playbackSpeed=playing?Number($('#playback-speed').value):0,machineState=machineDisplay(position)}={}) {
  const ctx=target.getContext('2d'),seconds=position;
  function segment(a,b,color,width=1){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  if(updateUI&&redrawFrame){cancelAnimationFrame(redrawFrame);redrawFrame=0;}
  if(!state)return;
  if(updateUI){if(!playing&&!movieController)requestMachinePose();updateMachineStatus();}
  if(target.width!==Math.round(width*ratio)||target.height!==Math.round(height*ratio)){target.width=Math.round(width*ratio);target.height=Math.round(height*ratio);}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.globalAlpha=1;
  // Paint the CSS ellipse into the pixels too: movies have no CSS background.
  ctx.save();ctx.translate(width/2,height/2);ctx.scale(width/Math.SQRT2,height/Math.SQRT2);
  const background=ctx.createRadialGradient(0,0,0,0,0,1);background.addColorStop(0,'#f8faf1');background.addColorStop(1,'#eaf0e0');
  ctx.fillStyle=background;ctx.fillRect(-1,-1,2,2);ctx.restore();
  const bounds=partBounds(),skinPhase=view().skinPhase;
  const project=createProjection(tab==='toolpath'&&fitBounds?fitBounds:bounds,width,height,yaw,tilt,zoom,pan,tab==='toolpath'&&cameras.mode==='machine');
  const referenceProject=tab==='toolpath'&&machineState?.pose&&!$('#follow-plate').checked?p=>{
    const {xMm,yMm}=state.plan.placement,q=transform(machineState.pose.part,[p[0]+xMm,p[1]+yMm,p[2]]);
    return project([q[0]-xMm,q[1]-yMm,q[2]]);
  }:project;
  const previousLayerOpacity=Number($('#previous-layer-opacity').value)/100;
  const strokeScale={lineWidthMm:state.plan.process.lineWidthMm,pixelsPerMm:project.pixelsPerMm,previousLayerOpacity};
  ctx.globalAlpha=1;
  for(let x=bounds.min[0]-10;x<=bounds.max[0]+10;x+=5)segment(referenceProject([x,bounds.min[1]-10,0]),referenceProject([x,bounds.max[1]+10,0]),'#dbe1d4',.6);
  for(let y=bounds.min[1]-10;y<=bounds.max[1]+10;y+=5)segment(referenceProject([bounds.min[0]-10,y,0]),referenceProject([bounds.max[0]+10,y,0]),'#dbe1d4',.6);
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
    if(!geometryRenderer&&geometryScene.edgeFeatures.has(selected))for(const [a,b]of visibleGeometryEdgeSegments(geometryScene,project,selected))segment(a,b,'#eb591f',3);
    if(updateUI)$('#selection').textContent=selected?label(selected):geometryError||'Click a surface or edge to see its name';
  }
  if(tab==='toolpath'&&state.program) {
    const moves=state.program.moves,at=frameAtTime(moves,seconds),count=at.completed,placement=state.plan.placement,showTravel=$('#travel').checked;
    if(updateUI)$('#layer-label').textContent='Layer '+(layerIndexAt(pathView,seconds)+1)+'/'+pathView.groups.length;
    const center=state.plan.setup.denso?.rotaryCenterMm??[0,0,0],angle=at.rotaryDeg??0;
    const machine=machineState?.pose,follow=$('#follow-plate').checked;
    const local=p=>{const q=machine?(follow?p:transform(machine.part,p)):displayPoint(p,angle,center,!state.plan.setup.denso||follow);return [q[0]-placement.xMm,q[1]-placement.yMm,q[2]];};
    if(state.plan.setup.denso&&!machine?.hasBed){
      const radius=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1])*.65;
      let prior=null;
      for(let i=0;i<=80;i++){const a=i*Math.PI/40,q=project(local([center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a),center[2]]));if(prior)segment(prior,q,'#718d91',1);prior=q;}
      segment(project(local(center)),project(local([center[0]+radius,center[1],center[2]])),'#507b89',2);
    }
    const solidView=!!materialScene&&!!materialRenderer;
    const materialProject=p=>project(local(p));materialProject.pixelsPerMm=project.pixelsPerMm;
    if(machine&&!solidView)drawMachineCanvas(ctx,machine,{project:materialProject,mode:cameras.mode,palette:machineColors,filter:c=>c.role!=='tool'});
    const detail=!solidView||showTravel||materialScene.unsupported.length?toolpathFrame(pathView,count,showTravel):{segments:[]};
    if(updateUI)$('#viewer-detail').textContent=solidView
      ?(materialScene.unsupported.length?'Line view for '+materialScene.unsupported.join(', ')+': surface frames unavailable.':'')
      :materialError||(detail.overview?'Layer overview · detail follows playback. Export keeps every point.':detail.reduced?'Curves simplified for display (0.02 mm). Export keeps every point.':'');
    const displayed=detail.partial?[...detail.segments,{...detail.partial,to:moves[count].from}]:detail.segments;
    const current=moves[at.active];
    const currentLayer=current?.phase==='finish'?moves.findLast(m=>m.extruding):current;
    const fade=fadeState.frame(currentLayer,now,remainingLayerMs(pathView,at.active,seconds,playbackSpeed)),styles=new Map();
    if(solidView){
      try{
        materialRenderer.draw(materialScene,{at,current:currentLayer,fade,project:materialProject,width,height,ratio,skinPhase,previousLayerOpacity,machine,machineMode:cameras.mode,machinePalette:machineColors});
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
    // Stationary injection has duration and volume but no line segment. Show
    // its source-decoded location without inventing a simulated filled rivet.
    for(const event of state.program.events??[])if(event.kind==='injection'&&seconds>=event.startSeconds){
      const p=project(local(event.positionMm)),active=seconds<event.startSeconds+event.seconds;
      ctx.beginPath();ctx.arc(p[0],p[1],active?7:4,0,Math.PI*2);ctx.strokeStyle='#b85c28';ctx.lineWidth=2;ctx.stroke();
      if(active){ctx.fillStyle='#b85c28';ctx.font='12px Segoe UI';ctx.fillText(`Injecting ${event.volumeMm3.toFixed(2)} mm³ · ${event.nozzleC}°C`,p[0]+11,p[1]-8);}
    }
    if(updateUI&&fade.fading&&!playing)requestDraw();
    if(current&&at.fraction<1&&(current.extruding||showTravel)&&!(solidView&&materialScene?.supported[at.active])){
      const style=toolpathStyle(current,current,skinPhase,undefined,strokeScale);segment(project(local(current.from)),project(local(at.point)),style.color,style.width);
    }
    if(machine&&!solidView)drawMachineCanvas(ctx,machine,{project:materialProject,mode:cameras.mode,palette:machineColors,filter:c=>c.role==='tool'});
    if(at.point&&!manualValues){const axis=at.toolAxis??[0,0,-1],p=project(local(at.point)),q=project(local(at.point.map((v,i)=>v-axis[i]*6)));if(!machine?.hasTool)segment(p,q,'#273e36',3);ctx.beginPath();ctx.arc(p[0],p[1],machine?.hasTool?2:3,0,Math.PI*2);ctx.fillStyle='#273e36';ctx.fill();
      if(updateUI)$('#time-label').textContent=clock(seconds)+' / '+clock(duration());
    }
  }
  const projectedOrigin=referenceProject([0,0,0]),origin=tab==='toolpath'?projectedOrigin:[width-48,height-42];
  ctx.globalAlpha=tab==='toolpath'?1:.65;
  ctx.font='10px Segoe UI';
  for(const [point,name,color] of [[[5,0,0],'X','#b26751'],[[0,5,0],'Y','#659a7a'],[[0,0,5],'Z','#638599']]){
    const p=referenceProject(point),end=tab==='toolpath'?p:[origin[0]+(p[0]-projectedOrigin[0])*5/project.pixelsPerMm,origin[1]+(p[1]-projectedOrigin[1])*5/project.pixelsPerMm];segment(origin,end,color,tab==='toolpath'?1.5:1);
    if(Math.hypot(end[0]-origin[0],end[1]-origin[1])>1){ctx.fillStyle=color;ctx.fillText(name,end[0]+4,end[1]-4);}
  }
  ctx.globalAlpha=1;
  ctx.font='10px Segoe UI';ctx.fillStyle='#71836b';ctx.fillText('5 mm grid',18,height-18);
}

canvas.onpointerdown=e=>{if(e.button>2)return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,pan:e.shiftKey||e.button===1||e.button===2};moved=false;};
canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>2)moved=true;if(drag.pan){pan[0]+=dx;pan[1]+=dy;}else{yaw+=dx*.008;tilt=Math.max(-1.5,Math.min(1.5,tilt+dy*.008));}drag.x=e.clientX;drag.y=e.clientY;requestDraw();};
canvas.onpointerup=e=>{const select=drag&&!drag.pan&&!moved;drag=null;if(select&&tab!=='toolpath'&&geometryProject){const rect=canvas.getBoundingClientRect();selectFeature(pickGeometry(geometryScene,geometryProject,e.clientX-rect.left,e.clientY-rect.top,{edges:true}));}};
canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null;};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.08,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));requestDraw();},{passive:false});
canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;if(e.shiftKey){pan[0]+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;pan[1]+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}else{if(e.key==='ArrowLeft')yaw-=.1;else if(e.key==='ArrowRight')yaw+=.1;else if(e.key==='ArrowUp')tilt-=.1;else tilt+=.1;}e.preventDefault();requestDraw();};
new ResizeObserver(requestDraw).observe(canvas);
$$('[data-view]').forEach(b=>b.onclick=()=>{const mode=b.dataset.view;if(mode==='iso'){yaw=-.78;tilt=.62;}if(mode==='side'){yaw=0;tilt=0;}if(mode==='top'){yaw=0;tilt=Math.PI/2;}requestDraw();});
function worldToDisplay(p,pose=machineSample()?.pose){const q=$('#follow-plate').checked&&pose?untransform(pose.part,p):p;return [q[0]-state.plan.placement.xMm,q[1]-state.plan.placement.yMm,q[2]];}
function fitMachine(){return machineSession?.scene?machineFitBounds(machineSession.scene,machineSample()?.pose,p=>worldToDisplay(p)):null;}
function fitDisplayedPart(bounds=partBounds()){
  const pose=machineSample()?.pose;if(!pose||$('#follow-plate').checked)return null;
  const {xMm,yMm}=state.plan.placement,points=boundsCorners(bounds).map(p=>worldToDisplay(transform(pose.part,[p[0]+xMm,p[1]+yMm,p[2]]),pose));
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
    for(const move of state.program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){
      const v=p[i]-(i===0?state.plan.placement.xMm:i===1?state.plan.placement.yMm:0);
      fitBounds.min[i]=Math.min(fitBounds.min[i],v);fitBounds.max[i]=Math.max(fitBounds.max[i],v);
    }
    fitBounds=fitDisplayedPart(fitBounds)??fitBounds;fitBounds.allMoves=true;
    $('#travel').checked=true;$('#fit-program').textContent='Fit part';
  }
  zoom=1;pan=[0,0];requestDraw();
};
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
async function approval(stage){
  const response=await api('approve',{stage,actor:'Local user',revision:state.revision});
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
}
$('#export-name').oninput=event=>{if(!exportNameState)return;exportNameState.value=event.target.value;exportNameState.dirty=event.target.value!==exportNameState.suggested;};
$('#confirm').onclick=async()=>{
  if(busy||!state)return;message('');
  if(tourUI?.active()&&tab!=='geometry'){
    if(state.tour?.step!==L.export)return;
    try{await working('Downloading your reviewed file…',async()=>{await download('tour-export',{revision:state.revision,exportHash:state.exportHash});await api('tour',{action:'finish'});await tourUI.load();render();},{preview:false});}
    catch(e){message(e.message,true);await refresh(false);}return;
  }
  try{
    await working(tab==='toolpath'?'Checking your toolpath…':'Saving geometry confirmation…',async()=>{
    if(tab==='geometry'){
      if(!state.geometryApproved)await approval('geometry');
      if(!state.program||state.programError||state.review.generation?.mode!=='production'){activity('Calculating toolpath');await api('generate',{development:false});tab='toolpath';await refresh();}
      else{setTab('toolpath');await acknowledgeDisplayedView();}
    }
    else if(!state.program||state.programError||state.review.generation?.mode!=='production'){activity('Calculating toolpath');await api('generate',{development:false});tab='toolpath';await refresh();}
    else {if(!state.toolpathApproved)await approval('toolpath');await download();}
    message('');
    },{preview:tab==='geometry'||!state.program||Boolean(state.programError)||state.review.generation?.mode!=='production'});
  }catch(e){message(e.message,true);}
};
async function openPrint(path){
  if(busy)return;
  saveView();
  $('#picker-message').textContent='';$('#print-picker').close();
  try{await working('Opening and checking your saved print…',async()=>{await api('open',{path});await tourUI?.load();await refresh(false,true);message('');});}
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
$('#import-stl').onclick=()=>{if(busy)return;$('#stl-file').value='';$('#stl-file').click();};
$('#stl-file').onchange=async()=>{
  const file=$('#stl-file').files[0];if(!file||busy)return;
  if(file.size>64*1024*1024){message('Choose an STL file up to 64 MiB.',true);return;}
  try{await working('Importing your STL…',async()=>{
    const query=new URLSearchParams({name:file.name,printId:state.printId});
    const target={printId:state.printId,planHash:null};generationTarget=target;
    let response;
    try{response=await fetch('/api/import-stl?'+query,{method:'POST',headers:{'X-SAAM-Token':token,'Content-Type':'application/octet-stream'},body:file});}
    finally{if(generationTarget===target)generationTarget=null;}
    if(!response.ok)throw Error((await response.json()).error);
    await tourUI.load();await refresh(false,true);message('');
  });}catch(error){message(error.message,true);await tourUI.load();await refresh(false,true);}
};
$('#open-path').onsubmit=event=>{event.preventDefault();openPrint($('#print-path').value.trim());};
$('#travel').onchange=requestDraw;
$('#follow-plate').onchange=()=>{const fit=mode=>mode==='machine'?fitMachine():fitDisplayedPart();cameras.refit(fit);fitBounds=fit(cameras.mode);$('#fit-program').textContent='Fit all moves';saveView();requestDraw();};
$('#playback-speed').oninput=()=>{$('#speed-label').value=$('#playback-speed').value+'×';};
$('#previous-layer-opacity').oninput=()=>{$('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';saveView();requestDraw();};
$('#manual-reset').onclick=()=>{clearManual();requestDraw();};
$('#scrub').oninput=()=>{clearManual();stop();layerFade.reset();seconds=Number($('#scrub').value);requestDraw();};
function stepLayer(direction){
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
    const response=await fetch('/api/revision?'+new URLSearchParams({fingerprint:state?.fingerprint??''}));if(!response.ok)throw new Error('Reconnecting to your print…');
    const next=await response.json();if(movieController||busy)return;
    // Restarted servers have new session credentials. Reload the page and its
    // viewer connection instead of repeatedly posting with the previous token.
    if(state?.instanceId&&next.instanceId!==state.instanceId){window.location.reload();return;}
    if(reconnecting)message('');
    if(state&&!reconnecting&&next.reviewUpdate&&next.presentationFingerprint===state.presentationFingerprint){
      Object.assign(state,next.reviewUpdate,{fingerprint:next.fingerprint,tour:next.tour});render();
    }
    else if(!state||reconnecting||next.fingerprint!==state.fingerprint||needsTourToolpath(state))await working('Loading and checking the updated print…',()=>refresh(true));
    else if(next.tour&&JSON.stringify(next.tour)!==JSON.stringify(state.tour)){
      // Lesson gates, guidance and start-layer choices do not change the source.
      // Updating them must not stop playback, fade the preview or rebuild scenes.
      state.tour=next.tour;render();
    }
    reconnecting=false;
  }catch(e){reconnecting=true;agentUI.settled(e);$('#confirm').disabled=true;message('Could not update the print: '+e.message+' Reconnecting…');}
  finally{polling=false;}
}
tourUI=createTourUI({post:api,refresh,working,setTab,isBusy:()=>busy,state:()=>state,seek:startAt=>{
  if(!Number.isInteger(startAt?.layer)||startAt.layer<1)throw Error('Your agent must choose an infill layer for this tour.');
  let move,first;for(const candidate of state.program?.moves??[])if(candidate.extruding){
    first??=candidate;
    if(candidate.layer===startAt.layer&&(startAt.fallback||/infill/.test(candidate.operation??'')&&!/solid|walls/.test(candidate.operation??''))){move=candidate;break;}
  }
  if(!move&&startAt.fallback)move=first;
  if(!move)throw Error('That layer has no sparse infill. Ask your agent to choose another startAt layer.');
  stop();seconds=move.startSeconds;$('#scrub').value=seconds;layerFade.reset();requestDraw();
  return {layer:move.layer};
}});
working('Opening Studio…',async()=>{await tourUI.load();await refresh();}).catch(e=>message(e.message,true));
let changeTimer;
function scheduleChange(){clearTimeout(changeTimer);changeTimer=setTimeout(()=>{if(busy||polling)scheduleChange();else void poll();},75);}
window.addEventListener('saam-studio-change',event=>{if(event.detail.kinds.some(kind=>kind==='print'||kind==='tour'))scheduleChange();});
setInterval(poll,1000);
window.addEventListener('pagehide',()=>machineSession?.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)working('Restoring your print…',()=>refresh(false,true)).catch(error=>message(error.message,true));});
