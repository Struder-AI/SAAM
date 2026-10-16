// Source-range planning owns explicit motion/process state and append deltas.
import {saamPath,moveSeconds} from './saampath.mjs';
import {curveAt,curveRange} from './curve-path.mjs';
import {CONTEXT_KEYS,sameContext} from './action-context.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {validatePose,samePose} from './pose.mjs';
import {nozzleMotionRoute} from '../geom/convex-clearance.mjs';

export function createPlanningState({start,process,generatorVersion,motion=null,retracted=false,selection=null,selections=null,sourcePathId=null}) {
  requireThat(Array.isArray(start)&&start.length===3&&start.every(Number.isFinite),'Path planning needs a 3D start position.');
  requireThat(typeof sourcePathId==='string'&&sourcePathId.length>0,'Planning requires an exact compact source identity.');
  validatePose(motion?.initialPose);
  return {sourcePathId,nextTravelId:0,start:[...start],position:[...start],process,baseProcess:process,generatorVersion,motion:{retreatMm:motion?.retreatMm??process.liftMm},initialPose:structuredClone(motion.initialPose),selection,selections,defaultFilament:selection?.filament,
    pose:structuredClone(motion.initialPose),fanPercent:null,nozzleC:selection?.nozzleC??null,retraction:retracted?{filamentMm:process.retractMm,speedMmS:process.retractSpeedMmS}:null,phase:'start',layer:0,layerSeconds:0,parked:false,
    stats:{travelMm:0,retractions:0,printMm:0}};
}

export function planningResult(state,actions={chunks:[]},decisions={}) {
  return {...decisions,state,actions};
}

export function planSelection(state,filament){
  if(!state.selections)return planningResult(state);
  const incoming=state.selections[filament??state.selection.filament];
  requireThat(incoming,'Operation selects an undeclared filament.');
  if(incoming.filament===state.selection.filament)return planningResult(state);
  // The action names material intent. Installed nozzle changes, clearance and
  // retraction debt are resolved by the selected output adapter.
  return appendAction({...state,selection:incoming,process:incoming.process,retraction:null},
    {kind:'toolChange',filament:incoming.filament,phase:state.phase,layer:state.layer,operation:state.operationId});
}

// Operations use resolved settings; omission restores the selected material's
// defaults, never the previous operation's overrides.

export function planProcess(state,process=state.selection?.process??state.baseProcess) {
  return planningResult({...state,process});
}

// A stage detaches its append buffer before publishing it.

export class ActionAccumulator {
  constructor(){this.append=[];}
  add(delta){
    const pending=[delta];
    while(pending.length){
      const current=pending.pop();
      if(current.chunks){for(let i=current.chunks.length-1;i>=0;i--)pending.push(current.chunks[i]);}
      else for(const action of current.append??[])this.append.push(action);
    }
  }
  finish(){const result={append:this.append};this.append=[];return result;}
}
function appendAction(state,action){
  return planningResult(state,{append:[{layerId:state.layerId,operation:state.operationId,...action}]});
}

export function planContext(state,phase,layer,operationId=state.operationId) {
  return planningResult({...state,phase,layer,operationId});
}

export function planMove(state,to,speed,volumeMm3=0,extra={}){
  requireThat(Array.isArray(to)&&to.length===3&&to.every(Number.isFinite)&&Number.isFinite(speed)&&volumeMm3===0,
    'Neutral travel needs finite coordinates/rate; deposition must reference its source range.');
  const pose=extra.pose?validatePose(extra.pose):state.pose,length=distance(state.position,to);
  if(length===0&&samePose(state.pose,pose))return planningResult(state);
  if(extra.durationSeconds!==undefined)requireThat(Number.isFinite(extra.durationSeconds)&&extra.durationSeconds>0,'Travel duration must be finite and positive.');
  const seconds=extra.durationSeconds??moveSeconds(length,speed);
  requireThat(seconds>0||length===0,'Travel duration must be positive.');
  return planTravelCurve(state,to,speed,pose,seconds,extra.durationSeconds);
}
export function planFan(state,percent){
  if(state.fanPercent===percent)return planningResult(state);
  return appendAction({...state,fanPercent:percent},{kind:'fan',percent,phase:state.phase,layer:state.layer});
}
export function planNozzle(state,targetC){
  requireThat(Number.isFinite(targetC)&&targetC>0,'Invalid operation temperature.');
  if(state.nozzleC===targetC)return planningResult(state);
  return appendAction({...state,nozzleC:targetC},{kind:'temperature',targetC,phase:state.phase,layer:state.layer,operation:state.operationId});
}
export function planExtrusion(state,volumeMm3,flowMm3S){
  requireThat(!state.retraction&&Number.isFinite(volumeMm3)&&volumeMm3>0&&Number.isFinite(flowMm3S)&&flowMm3S>0,'Invalid stationary extrusion.');
  return appendAction({...state,layerSeconds:state.layerSeconds+volumeMm3/flowMm3S,parked:false},
    {kind:'inject',operationId:state.operationId,phase:state.phase,layer:state.layer,layerId:state.layerId});
}

export function planRetraction(state) {
  if(state.retraction||!(state.process.retractMm>0))return planningResult(state);
  const retraction={filamentMm:state.process.retractMm,speedMmS:state.process.retractSpeedMmS};
  return appendAction({...state,retraction,stats:{...state.stats,retractions:state.stats.retractions+1}},
    {kind:'retract',...retraction,phase:state.phase,layer:state.layer});
}

export function planRecovery(state) {
  if(!state.retraction)return planningResult(state);
  return appendAction({...state,retraction:null},
    {kind:'recover',...state.retraction,phase:state.phase,layer:state.layer});
}

export function planDwell(state,seconds) {
  requireThat(Number.isFinite(seconds)&&seconds>=0,'Dwell outside limits.');
  return seconds>0?appendAction(state,{kind:'dwell',seconds,phase:state.phase,layer:state.layer}):planningResult(state);
}

export function planPark(state,scene) {
  if(state.parked)return planRetraction(state);
  const pose=state.pose,target=state.position.map((v,i)=>v-pose.toolAxis[i]*state.motion.retreatMm);
  const retracted=planRetraction(state),parked=planTravel(retracted.state,target,scene,pose,{recover:false});
  return planningResult({...parked.state,parked:true},{chunks:[retracted.actions,parked.actions]});
}

export function planLayerCooling(state,scene) {
  const remaining=state.process.minimumLayerSeconds-state.layerSeconds;
  if(!(remaining>0))return planningResult({...state,layerSeconds:0});
  const parked=planPark(state,scene),cooled=planDwell(parked.state,remaining);
  return planningResult({...cooled.state,layerSeconds:0},{chunks:[parked.actions,cooled.actions]},{coolingSeconds:remaining});
}

export function planTravel(state,target,scene,targetPose,{recover=true}={}){
  requireThat(scene?.index&&scene.occupied,'Travel needs the scheduler-owned deposited material scene.');
  validatePose(targetPose);
  const route=nozzleMotionRoute(scene.index,scene.occupied,state.position,target,state.pose,targetPose,{withinGroups:scene.withinGroups,groupPrefixes:scene.groupPrefixes});
  if(route.blocked){
    const operations=[...new Set(route.blocked.map(id=>scene.operationOf(id)))];
    throw Object.assign(Error('Nozzle access is blocked by deposited courses: '+operations.join(', ')),{code:'NOZZLE_ACCESS_BLOCKED',operations,target});
  }
  const travelKind=route.length>1?'routed':'direct';
  const retracted=travelKind==='routed'?planRetraction(state):planningResult(state),actions=new ActionAccumulator();
  actions.add(retracted.actions);const cursor={state:retracted.state};
  for(const next of route){
    const moved=planMove(cursor.state,next.point,state.process.travelSpeedMmS,0,{pose:next.pose});
    cursor.state=moved.state;actions.add(moved.actions);
  }
  const recovered=recover?planRecovery(cursor.state):planningResult(cursor.state);actions.add(recovered.actions);
  return planningResult(recovered.state,actions.finish(),{travelKind});
}
export function materializeActions(chunks){const collector=new ActionAccumulator();collector.add({chunks});return collector.finish().append;}
export function planningPath(state,chunks,summary={},completion){
  const packed=compactExecution(materializeActions(chunks));
  return saamPath({schema:'saam-schedule/1',sourcePathId:state.sourcePathId,initialPosition:state.start,
    initialPose:state.initialPose,motionCurves:packed.motionCurves,execution:packed.execution,
    summary:{...summary,travel:{...state.stats}},...(completion?{completion}:{})});
}

function planTravelCurve(input,to,speed,pose,seconds,durationSeconds){
  const from=input.position,fromPose=input.pose,length=distance(from,to);
  const curveId='travel:'+input.nextTravelId;
  const identical=fromPose.toolAxis.every((v,k)=>v===pose.toolAxis[k])&&fromPose.toolUp.every((v,k)=>v===pose.toolUp[k]);
  const curve={geometry:length?{kind:'polyline',points:[from,[...to]]}:{kind:'point',point:from},
    profiles:{speedMmS:length>0&&durationSeconds!==undefined?length/seconds:speed,pose:identical?pose:{interpolation:'frame',knots:[[0,fromPose],[1,pose]]}}};
  const state={...input,nextTravelId:input.nextTravelId+1,position:[...to],pose,parked:false,
    layerSeconds:input.layerSeconds+seconds,stats:{...input.stats,travelMm:input.stats.travelMm+length}};
  return appendAction(state,{kind:'travel',curveId,from:0,to:1,curve,
    ...(durationSeconds!==undefined?{durationSeconds}:{}),phase:state.phase,layer:state.layer,layerId:state.layerId,
    ...(state.operationId?{operation:state.operationId}:{})});
}

// A whole course/range remains one execution record regardless of vertex count.
// Cooling uses a certified lower duration bound: uncertainty can only add dwell.

export function planDepositRange(input,source,reader,course,prepared=null){
  const {from,to}=course;
  requireThat(input.sourcePathId,'Source-range planning requires a compact source identity.');
  const known=prepared?.range;
  const range=known&&known.lengthMm[1]-known.lengthMm[0]<=PRINT_RESOLUTION_MM?known:curveRange(reader,course.curveId,from,to,{lengthToleranceMm:PRINT_RESOLUTION_MM});
  const end=prepared?.end??curveAt(reader,course.curveId,to,{side:'left'}),profile=source.curves[course.curveId].profiles.speedMmS;
  const maximum=typeof profile==='number'?profile:Math.max(...profile.knots.map(([,value])=>value));
  const seconds=maximum>0?range.lengthMm[0]/maximum:0;
  const lower=input.stats.printMmBounds??[input.stats.printMm,input.stats.printMm];
  const printMmBounds=[lower[0]+range.lengthMm[0],lower[1]+range.lengthMm[1]];
  const state={...input,position:end.point,pose:end.pose,parked:false,layerSeconds:input.layerSeconds+seconds,
    stats:{...input.stats,printMmBounds,printMm:(printMmBounds[0]+printMmBounds[1])/2}};
  return appendAction(state,{kind:'deposit',courseId:course.id,from,to,phase:state.phase,layer:state.layer,
    layerId:state.layerId,operation:state.operationId,...(course.role?{role:course.role}:{})});
}

function compactExecution(actions){
  const motionCurves={},execution=[],cursor={context:null};
  for(const action of actions){
    const context=Object.fromEntries(CONTEXT_KEYS.filter(key=>action[key]!==undefined).map(key=>[key,action[key]]));
    if(!cursor.context||!sameContext(cursor.context,context)){
      const changes=cursor.context?Object.fromEntries(CONTEXT_KEYS.filter(key=>context[key]!==cursor.context[key]).map(key=>[key,context[key]??null])):context;
      execution.push({kind:'context',...(!cursor.context?{reset:true}:{}),...changes});cursor.context=context;
    }
    const physical=Object.fromEntries(Object.entries(action).filter(([key])=>key!=='curve'&&!CONTEXT_KEYS.includes(key)));
    if(action.kind==='travel')motionCurves[action.curveId]=action.curve;
    execution.push(physical);
  }
  return {motionCurves,execution};
}
