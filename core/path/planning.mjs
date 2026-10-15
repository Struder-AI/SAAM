import {saamPath,moveSeconds} from './saampath.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
// Explicit path transitions. A stage owns its local work; its inputs are read-only.
// Actions are append/replace-tail deltas, never the accumulated program. A merge
// allocates a replacement action; earlier states and returned chunks stay intact.
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {uprightPose,validatePose,samePose} from './pose.mjs';
import {nozzleMotionRoute} from '../geom/convex-clearance.mjs';

export function createPlanningState({start,process,generatorVersion,motion=null,retracted=false,selection=null,selections=null}) {
  requireThat(Array.isArray(start)&&start.length===3&&start.every(Number.isFinite),'Path planning needs a 3D start position.');
  return {start:[...start],position:[...start],process,baseProcess:process,generatorVersion,motion:{retreatMm:motion?.retreatMm??process.liftMm},initialPose:motion?.initialPose??null,selection,selections,defaultFilament:selection?.filament,
    pose:motion?.initialPose?structuredClone(motion.initialPose):null,retraction:retracted?{filamentMm:process.retractMm,speedMmS:process.retractSpeedMmS}:null,phase:'start',layer:0,layerSeconds:0,parked:false,
    stats:{joined:0,connected:0,combed:0,hopped:0,travelMm:0,retractions:0,printMm:0}};
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
  return appendAction({...state,selection:incoming,process:incoming.process,retraction:null,moveRun:null},
    {kind:'toolChange',filament:incoming.filament,phase:state.phase,layer:state.layer,operation:state.operationId});
}

// Operations use resolved settings; omission restores the selected material's
// defaults, never the previous operation's overrides.
export function planProcess(state,process=state.selection?.process??state.baseProcess) {
  return planningResult({...state,process});
}

// Local emission storage for ONE planning stage, never shared planning state.
// A child may replace a tail emitted by this stage or amend the incoming stage's
// tail. Retain only that amendment and the surviving local appends. Finalization
// detaches the buffer, so reusing the collector cannot mutate a published result.
export class ActionAccumulator {
  constructor() {this.append=[];this.replaceLast=undefined;}
  add(delta) {
    const pending=[delta];
    while(pending.length){
      const current=pending.pop();
      if(current.chunks){for(let i=current.chunks.length-1;i>=0;i--)pending.push(current.chunks[i]);continue;}
      if(current.replaceLast){
        if(this.append.length)this.append[this.append.length-1]=current.replaceLast;
        else this.replaceLast=current.replaceLast;
      }
      for(const action of current.append??[])this.append.push(action);
    }
  }
  finish() {
    const actions={...(this.replaceLast?{replaceLast:this.replaceLast}:{}),append:this.append};
    this.append=[];this.replaceLast=undefined;
    return actions;
  }
}

function appendAction(state,action) {
  return planningResult({...state,lastAction:action,...(action.kind!=='fan'?{lastNonFan:action}:{})},{append:[action]});
}

export function planContext(state,phase,layer,operationId=state.operationId) {
  return planningResult({...state,phase,layer,operationId});
}

export function planMove(input,to,speed,volumeMm3=0,extra={}) {
  requireThat(Array.isArray(to)&&to.length===3&&to.every(Number.isFinite)&&Number.isFinite(speed)&&Number.isFinite(volumeMm3)&&volumeMm3>=0,'Invalid path move.');
  const state={...input,stats:{...input.stats}},length=distance(state.position,to);
  const pose=extra.pose?validatePose(extra.pose):null;
  if(length===0){
    requireThat(volumeMm3===0,'Stationary deposition needs an explicit extrusion action.');
    if(!pose||samePose(state.pose??uprightPose(),pose))return planningResult(input);
  }
  const seconds=pose?(extra.durationSeconds??moveSeconds(length,speed)):moveSeconds(length,speed);
  // A reorientation at a fixed point is untimed: the machine turns at its own rate.
  requireThat(seconds>0||length===0,'Motion needs positive duration.');
  const {durationSeconds:requestedDuration,...properties}=extra;
  const action={...properties,kind:'move',to:[...to],speedMmS:pose&&length>0&&requestedDuration!==undefined?length/seconds:speed,volumeMm3,phase:state.phase,layer:state.layer,layerId:state.layerId,
    ...(state.operationId?{operation:state.operationId}:{}),...(pose?{pose:structuredClone(pose),...(length===0&&seconds>0?{durationSeconds:seconds}:{})}:{})};
  const run=state.moveRun;
  let emitted,shortenedMm=0;
  if(run&&state.lastAction===run.action&&mergeableMove(run,action)){
    const previousLength=distance(run.from,run.action.to),combinedLength=distance(run.from,to);
    const duration=(run.action.durationSeconds??moveSeconds(previousLength,run.action.speedMmS))+seconds;
    const replacement={...run.action,to:action.to,volumeMm3:run.action.volumeMm3+volumeMm3,speedMmS:combinedLength/duration};
    shortenedMm=previousLength+length-combinedLength;
    state.moveRun={...run,action:replacement};state.lastAction=replacement;state.lastNonFan=replacement;
    emitted={replaceLast:replacement,append:[]};
  } else {
    state.moveRun=length>0?{action,from:[...state.position],direction:to.map((v,i)=>(v-state.position[i])/length),density:volumeMm3/length}:null;
    state.lastAction=action;state.lastNonFan=action;emitted={append:[action]};
  }
  state.layerSeconds+=seconds;
  if(volumeMm3>0)state.stats.printMm+=length-shortenedMm;
  else state.stats.travelMm+=length-shortenedMm;
  state.position=[...to];state.pose=pose?structuredClone(pose):null;state.parked=false;
  return planningResult(state,emitted);
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

export function planFan(state,percent) {return appendAction(state,{kind:'fan',percent,phase:state.phase,layer:state.layer});}
export function planNozzle(state,targetC) {
  requireThat(Number.isFinite(targetC)&&targetC>0,'Invalid operation temperature.');
  return appendAction(state,{kind:'temperature',targetC,phase:state.phase,layer:state.layer,operation:state.operationId});
}
export function planExtrusion(state,volumeMm3,flowMm3S) {
  requireThat(!state.retraction&&Number.isFinite(volumeMm3)&&volumeMm3>0&&Number.isFinite(flowMm3S)&&flowMm3S>0,'Invalid stationary extrusion.');
  const flow=flowMm3S;
  return appendAction({...state,layerSeconds:state.layerSeconds+volumeMm3/flow,moveRun:null,parked:false},
  {kind:'extrude',volumeMm3,flowMm3S:flow,phase:state.phase,layer:state.layer,layerId:state.layerId,operation:state.operationId});
}
export function planDwell(state,seconds) {
  requireThat(Number.isFinite(seconds)&&seconds>=0,'Dwell outside limits.');
  return seconds>0?appendAction(state,{kind:'dwell',seconds,phase:state.phase,layer:state.layer}):planningResult(state);
}

export function planPark(state,scene) {
  if(state.parked)return planRetraction(state);
  const pose=state.pose??uprightPose(),target=state.position.map((v,i)=>v-pose.toolAxis[i]*state.motion.retreatMm);
  const retracted=planRetraction(state),parked=planTravel(retracted.state,target,scene,pose,{recover:false});
  return planningResult({...parked.state,parked:true},{chunks:[retracted.actions,parked.actions]});
}

export function planLayerCooling(state,scene) {
  const remaining=state.process.minimumLayerSeconds-state.layerSeconds;
  if(!(remaining>0))return planningResult({...state,layerSeconds:0});
  const parked=planPark(state,scene),cooled=planDwell(parked.state,remaining);
  return planningResult({...cooled.state,layerSeconds:0},{chunks:[parked.actions,cooled.actions]},{coolingSeconds:remaining});
}

export function planTravel(state,target,scene,targetPose=uprightPose(),{recover=true}={}){
  requireThat(scene?.index&&scene.occupied,'Travel needs the scheduler-owned deposited material scene.');
  const current=state.pose??uprightPose(),route=nozzleMotionRoute(scene.index,scene.occupied,state.position,target,current,targetPose,{withinGroups:scene.withinGroups,groupPrefixes:scene.groupPrefixes});
  if(route.blocked)throw Object.assign(Error('Nozzle access is blocked by deposited courses: '+[...new Set(route.blocked.map(i=>scene.beads[i].operationId))].join(', ')),
    {code:'NOZZLE_ACCESS_BLOCKED',operations:[...new Set(route.blocked.map(i=>scene.beads[i].operationId))],target});
  const retracted=distance(state.position,target)>PRINT_RESOLUTION_MM?planRetraction(state):planningResult(state),actions=new ActionAccumulator();
  actions.add(retracted.actions);const cursor={state:retracted.state};
  for(const next of route){
    const oriented=!samePose(next.pose,uprightPose())||!samePose(cursor.state.pose??uprightPose(),next.pose);
    const moved=planMove(cursor.state,next.point,state.process.travelSpeedMmS,0,oriented?{pose:next.pose}:{});
    cursor.state=moved.state;actions.add(moved.actions);
  }
  const recovered=recover?planRecovery(cursor.state):planningResult(cursor.state);actions.add(recovered.actions);
  return planningResult(recovered.state,actions.finish(),{travelKind:route.length>1?'routed':'direct'});
}

// Flatten once at delivery. A replacement
// changes only the output array's tail, never the action object that preceded it.
export function materializeActions(actionChunks) {
  const accumulator=new ActionAccumulator();
  accumulator.add({chunks:actionChunks});
  const {replaceLast,append}=accumulator.finish();
  requireThat(!replaceLast,'A merged move needs an earlier action.');
  return append;
}

export function planningPath(state,actionChunks,summary={},completion) {
  return saamPath({schema:'saampath/1',generatorVersion:state.generatorVersion,units:'mm',materialUnits:'mm3',initialPosition:state.start,
    ...(state.initialPose?{initialPose:structuredClone(state.initialPose)}:{}),
    actions:materializeActions(actionChunks),summary:{...summary,travel:{...state.stats}},...(completion?{completion}:{} )});
}

function mergeableMove(run,next) {
  const previous=run.action,omitted=['to','volumeMm3','speedMmS','durationSeconds'],keys=Object.keys(previous).filter(k=>!omitted.includes(k));
  const close=(a,b)=>Math.abs(a-b)<=ROUNDING_RELATIVE*Math.max(1,Math.abs(a),Math.abs(b));
  const physical=['gapMm','normalHeightMm','slopeDeg','lowerSurfaceGapStartMm','lowerSurfaceGapEndMm','sampledGapErrorMm'];
  if(keys.length!==Object.keys(next).filter(k=>!omitted.includes(k)).length||keys.some(k=>previous[k]!==next[k]&&
    !(k==='pose'&&previous.pose&&next.pose&&samePose(previous.pose,next.pose))&&
    !(physical.includes(k)&&Number.isFinite(previous[k])&&Number.isFinite(next[k])&&close(previous[k],next[k]))))return false;
  if(!close(previous.speedMmS,next.speedMmS)||(previous.volumeMm3>0)!==(next.volumeMm3>0))return false;
  const segmentLength=distance(previous.to,next.to);
  if(segmentLength===0)return false;
  if(!close(run.density,next.volumeMm3/segmentLength))return false;
  const vector=next.to.map((v,i)=>v-run.from[i]),along=vector.reduce((s,v,i)=>s+v*run.direction[i],0);
  const before=previous.to.reduce((s,v,i)=>s+(v-run.from[i])*run.direction[i],0);
  // Every accepted endpoint stays in a tube of half print resolution around the
  // original run axis, so the merged chord departs from every original point by
  // less than print resolution; successive merges cannot accumulate flattening.
  return along>before&&Math.hypot(...vector.map((v,i)=>v-along*run.direction[i]))<=PRINT_RESOLUTION_MM/2;
}
