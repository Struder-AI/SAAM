// Explicit path transitions. A stage owns its local work; its inputs are read-only.
// Actions are append/replace-tail deltas, never the accumulated program. A merge
// allocates a replacement action; earlier states and returned chunks stay intact.
import {requireThat,distance,TOLERANCE} from '../geom/tolerance.mjs';
import {combRoute,combSegment} from './comb.mjs';
import {uprightPose,validatePose,samePose,bedPoint} from './pose.mjs';
import {requireProcessControl} from './process-controls.mjs';

export const MINIMUM_MOVE_MM=1e-4,NEARBY_MOVE_MM=1,CONNECT_MOVE_MM=2;

export function createPlanningState({start,process,machine,generatorVersion,motion=null,motionBounds,retracted=false}) {
  requireThat(Array.isArray(start)&&start.length===3&&start.every(Number.isFinite),'Path planning needs a 3D start position.');
  return {start:[...start],position:[...start],process,machine,generatorVersion,motion,
    pose:motion?structuredClone(motion.initialPose):null,retracted,phase:'start',layer:0,layerSeconds:0,depositedMaxZ:0,
    ...(motionBounds?{motionBounds}:{}),stats:{joined:0,connected:0,combed:0,hopped:0,travelMm:0,retractions:0,printMm:0}};
}

export function planningResult(state,actions={chunks:[]},decisions={}) {
  return {state,actions,timing:{layerSeconds:state.layerSeconds},accounting:{...state.stats},...decisions};
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
  requireThat(Array.isArray(to)&&to.length===3&&to.every(Number.isFinite)&&Number.isFinite(speed)&&speed>0&&Number.isFinite(volumeMm3)&&volumeMm3>=0,'Invalid path move.');
  const state={...input,stats:{...input.stats}},length=distance(state.position,to);
  if(state.pose){
    const pose=validatePose(extra.pose??state.pose);
    if(length<MINIMUM_MOVE_MM&&samePose(state.pose,pose))return planningResult(input);
    const limited=volumeMm3>0?Math.min(speed,state.process.maxFlowMm3S*length/volumeMm3):speed;
    const seconds=extra.durationSeconds??(length>=MINIMUM_MOVE_MM?length/limited:state.motion.transitionSeconds);
    requireThat(Number.isFinite(seconds)&&seconds>0,'Pose motion needs positive duration.');
    const action={kind:'move',to:[...to],speedMmS:speed,volumeMm3,phase:state.phase,layer:state.layer,
      ...(state.operationId?{operation:state.operationId}:{}),...extra,pose:structuredClone(pose),durationSeconds:seconds};
    state.layerSeconds+=seconds;
    if(volumeMm3>0){state.stats.printMm+=length;state.depositedMaxZ=Math.max(state.depositedMaxZ,state.position[2],to[2]);}
    else state.stats.travelMm+=length;
    state.position=[...to];state.pose=structuredClone(pose);
    return appendAction(state,action);
  }
  requireThat(!extra.pose,'Machine cannot represent oriented/rotary motion.');
  const coordinateDecimals=state.machine.id==='dobot-mg400'?10:5;
  if(length<MINIMUM_MOVE_MM&&state.position.every((v,i)=>Number(v.toFixed(coordinateDecimals))===Number(to[i].toFixed(coordinateDecimals))))return planningResult(input);
  let limited=speed;
  if(volumeMm3>0)limited=Math.min(limited,state.process.maxFlowMm3S*length/volumeMm3);
  const dz=Math.abs(to[2]-state.position[2]);
  if(dz>0)limited=Math.min(limited,state.process.zSpeedMmS*length/dz);
  for(let i=0;i<3;i++)if(Math.abs(to[i]-state.position[i])>0)
    limited=Math.min(limited,state.machine.maxFeedMmS['xyz'[i]]*length/Math.abs(to[i]-state.position[i]));
  const action={kind:'move',to:[...to],speedMmS:limited,volumeMm3,phase:state.phase,layer:state.layer,
    ...(state.operationId?{operation:state.operationId}:{}),...extra};
  const run=state.moveRun;
  let emitted;
  if(run&&state.lastAction===run.action&&mergeableMove(run,action)){
    const replacement={...run.action,to:action.to,volumeMm3:run.action.volumeMm3+volumeMm3,speedMmS:Math.min(run.action.speedMmS,limited)};
    state.moveRun={...run,action:replacement};state.lastAction=replacement;state.lastNonFan=replacement;
    emitted={replaceLast:replacement,append:[]};
  } else {
    state.moveRun={action,from:[...state.position],direction:to.map((v,i)=>(v-state.position[i])/length),density:volumeMm3/length};
    state.lastAction=action;state.lastNonFan=action;emitted={append:[action]};
  }
  state.layerSeconds+=length/limited;
  if(volumeMm3>0){state.stats.printMm+=length;state.depositedMaxZ=Math.max(state.depositedMaxZ,state.position[2],to[2]);}
  else state.stats.travelMm+=length;
  state.position=[...to];
  return planningResult(state,emitted);
}

export function planRetraction(state) {
  if(state.retracted||!(state.process.retractMm>0))return planningResult(state);
  return appendAction({...state,retracted:true,stats:{...state.stats,retractions:state.stats.retractions+1}},
    {kind:'retract',filamentMm:state.process.retractMm,speedMmS:state.process.retractSpeedMmS,phase:state.phase,layer:state.layer});
}

export function planRecovery(state) {
  if(!state.retracted)return planningResult(state);
  return appendAction({...state,retracted:false},
    {kind:'recover',filamentMm:state.process.retractMm,speedMmS:state.process.retractSpeedMmS,phase:state.phase,layer:state.layer});
}

export function planFan(state,percent) {return appendAction(state,{kind:'fan',percent,phase:state.phase,layer:state.layer});}
export function planNozzle(state,targetC) {
  requireProcessControl(state.machine);
  requireThat(Number.isFinite(targetC)&&targetC>0,'Invalid operation temperature.');
  return appendAction(state,{kind:'temperature',targetC,phase:state.phase,layer:state.layer,operation:state.operationId});
}
export function planExtrusion(state,volumeMm3,flowMm3S) {
  requireProcessControl(state.machine);
  requireThat(!state.retracted&&Number.isFinite(volumeMm3)&&volumeMm3>0&&Number.isFinite(flowMm3S)&&flowMm3S>0,'Invalid stationary extrusion.');
  const flow=Math.min(flowMm3S,state.process.maxFlowMm3S);
  return appendAction({...state,layerSeconds:state.layerSeconds+volumeMm3/flow,
    depositedMaxZ:Math.max(state.depositedMaxZ,state.position[2]),moveRun:null},
  {kind:'extrude',volumeMm3,flowMm3S:flow,phase:state.phase,layer:state.layer,operation:state.operationId});
}
export function planDwell(state,seconds) {
  return seconds>0?appendAction(state,{kind:'dwell',seconds,phase:state.phase,layer:state.layer}):planningResult(state);
}

export function travelClearance(state,target=state.position) {
  const clearance=Math.max(state.depositedMaxZ+state.process.liftMm,state.position[2],target[2]);
  requireThat(Number.isFinite(clearance)&&(state.machine.motionChecks==='deferred'||clearance<=(state.motionBounds??state.machine.bounds).max[2]),'Travel clearance exceeds machine/tool Z bounds.');
  return clearance;
}

export function planPark(state) {
  if(state.pose&&!samePose(state.pose,uprightPose())){
    const retracted=planRetraction(state),retreat=planMove(retracted.state,state.position.map((v,i)=>v-state.pose.toolAxis[i]*state.motion.retreatMm),state.process.travelSpeedMmS,0,{travel:'tool-retreat'});
    return planningResult(retreat.state,{chunks:[retracted.actions,retreat.actions]});
  }
  const z=travelClearance(state),retracted=planRetraction(state);
  const lifted=planMove(retracted.state,[state.position[0],state.position[1],z],state.process.zSpeedMmS);
  return planningResult(lifted.state,{chunks:[retracted.actions,lifted.actions]});
}

export function planLayerCooling(state) {
  const remaining=state.process.minimumLayerSeconds-state.layerSeconds;
  if(!(remaining>0))return planningResult({...state,layerSeconds:0});
  const parked=planPark(state),cooled=planDwell(parked.state,remaining);
  return planningResult({...cooled.state,layerSeconds:0},{chunks:[parked.actions,cooled.actions]},{coolingSeconds:remaining});
}

export function canPlanComb(state,target,policy,distanceLimit,from=state.position) {
  if(policy.canTravelDirect)return policy.canTravelDirect(from,target,distanceLimit)
    &&(!policy.combRegion||combSegment(from,target,{...policy,combClearanceMm:policy.directClearanceMm??policy.combClearanceMm}))
    &&(!policy.isTravelClear||policy.isTravelClear(from,target));
  const maxDistance=distanceLimit??policy.maxCombMm;
  if(!policy.combRegion||!(maxDistance>0)||Math.abs(target[2]-from[2])>1e-9)return false;
  if(Math.hypot(target[0]-from[0],target[1]-from[1])>maxDistance)return false;
  return combSegment(from,target,policy)&&(!policy.isTravelClear||policy.isTravelClear(from,target));
}

export function planTravel(state,target,policy,targetPose) {
  if(state.pose&&(targetPose||!samePose(state.pose,uprightPose())))return planPoseTravel(state,target,policy,targetPose);
  const gap=distance(state.position,target);
  if(gap<=1e-9){
    const recovered=planRecovery({...state,stats:{...state.stats,joined:state.stats.joined+1}});
    return {...recovered,travelKind:'joined'};
  }
  const nearby=gap<=NEARBY_MOVE_MM&&canPlanComb(state,target,policy,NEARBY_MOVE_MM);
  const layerStep=!nearby&&gap<=CONNECT_MOVE_MM&&!policy.canTravelDirect&&!state.retracted&&target[2]>state.position[2]&&state.position[2]>=state.depositedMaxZ-1e-9
    &&canPlanComb(state,target,{...policy,combClearanceMm:policy.connectClearanceMm??policy.combClearanceMm},CONNECT_MOVE_MM,[state.position[0],state.position[1],target[2]]);
  const direct=nearby||layerStep||canPlanComb(state,target,policy);
  const route=direct?null:combRoute(state.position,target,policy);
  if(direct||route){
    const actions=new ActionAccumulator();
    let cursor={...state,stats:{...state.stats,combed:state.stats.combed+1}};
    if(!layerStep){const recovered=planRecovery(cursor);cursor=recovered.state;actions.add(recovered.actions);}
    for(const point of route??[target]){
      const moved=planMove(cursor,point,state.process.travelSpeedMmS,0,{travel:layerStep?'layer-step':'combed'});
      cursor=moved.state;actions.add(moved.actions);
    }
    return planningResult(cursor,actions.finish(),{travelKind:'combed'});
  }
  const retracted=planRetraction({...state,stats:{...state.stats,hopped:state.stats.hopped+1}});
  const clearance=travelClearance(retracted.state,target);
  const lifted=planMove(retracted.state,[state.position[0],state.position[1],clearance],state.process.zSpeedMmS);
  const traversed=planMove(lifted.state,[target[0],target[1],clearance],state.process.travelSpeedMmS);
  const descended=planMove(traversed.state,target,state.process.zSpeedMmS),recovered=planRecovery(descended.state);
  return planningResult(recovered.state,{chunks:[retracted.actions,lifted.actions,traversed.actions,descended.actions,recovered.actions]},{travelKind:'hopped'});
}

export function planPoseTravel(state,target,policy,targetPose) {
  const pose=validatePose(targetPose??uprightPose());
  if(distance(state.position,target)<1e-9&&samePose(state.pose,pose)){
    const recovered=planRecovery({...state,stats:{...state.stats,joined:state.stats.joined+1}});
    return {...recovered,travelKind:'joined'};
  }
  if(policy.poseJoinMm>0&&state.lastAction?.operation===state.operationId&&Math.abs(state.position[2]-target[2])<1e-9&&distance(state.position,target)<=policy.poseJoinMm){
    const indexed=planMove({...state,stats:{...state.stats,combed:state.stats.combed+1}},target,state.process.skinSpeedMmS,0,{pose,travel:'surface-index'});
    return {...indexed,travelKind:'combed'};
  }
  const retracted=planRetraction({...state,stats:{...state.stats,hopped:state.stats.hopped+1}});
  const retreated=planMove(retracted.state,state.position.map((v,i)=>v-state.pose.toolAxis[i]*state.motion.retreatMm),state.process.travelSpeedMmS,0,{travel:'tool-retreat'});
  const room=bedPoint(retreated.state.position,state.pose.rotaryDeg,state.motion.rotaryCenterMm);
  const held=bedPoint(room,pose.rotaryDeg,state.motion.rotaryCenterMm,true);
  const oriented=planMove(retreated.state,held,state.process.travelSpeedMmS,0,{pose,durationSeconds:state.motion.transitionSeconds,travel:'reorient'});
  const approach=target.map((v,i)=>v-pose.toolAxis[i]*state.motion.retreatMm);
  const positioned=planMove(oriented.state,approach,state.process.travelSpeedMmS,0,{pose,travel:'position'});
  const approached=planMove(positioned.state,target,state.process.travelSpeedMmS,0,{pose,travel:'approach'}),recovered=planRecovery(approached.state);
  return planningResult(recovered.state,{chunks:[retracted.actions,retreated.actions,oriented.actions,positioned.actions,approached.actions,recovered.actions]},{travelKind:'hopped'});
}

export function planConnection(state,target,policy,speed,volumePerMm,extra,targetPose) {
  const last=state.lastNonFan,gap=distance(state.position,target);
  if(state.retracted||last?.kind!=='move'||!(last.volumeMm3>0)||!(volumePerMm>0)||gap<=1e-9||gap>CONNECT_MOVE_MM)return planningResult(state,undefined,{connected:false});
  if(state.pose&&(targetPose||!samePose(state.pose,uprightPose()))){
    if(!(policy.poseJoinMm>0)||last.operation!==state.operationId||gap>policy.poseJoinMm)return planningResult(state,undefined,{connected:false});
    const moved=planMove({...state,stats:{...state.stats,connected:state.stats.connected+1}},target,speed,gap*volumePerMm,{...extra,connector:true,pose:validatePose(targetPose??uprightPose())});
    return {...moved,connected:true};
  }
  const clearance=policy.connectClearanceMm??policy.combClearanceMm;
  if(!canPlanComb(state,target,{...policy,combClearanceMm:clearance,directClearanceMm:policy.directClearanceMm??clearance},CONNECT_MOVE_MM))return planningResult(state,undefined,{connected:false});
  const moved=planMove({...state,stats:{...state.stats,connected:state.stats.connected+1}},target,speed,gap*volumePerMm,{...extra,connector:true});
  return {...moved,connected:true};
}

// Flatten once, at delivery (or into the legacy adapter's own array). A replacement
// changes only the output array's tail, never the action object that preceded it.
export function materializeActions(actionChunks) {
  const actions=[],pending=[...actionChunks].reverse();
  while(pending.length){
    const delta=pending.pop();
    if(delta.chunks){for(let i=delta.chunks.length-1;i>=0;i--)pending.push(delta.chunks[i]);continue;}
    if(delta.replaceLast){requireThat(actions.length>0,'A merged move needs an earlier action.');actions[actions.length-1]=delta.replaceLast;}
    for(const action of delta.append??[])actions.push(action);
  }
  return actions;
}

export function planningPath(state,actionChunks,summary={}) {
  return {schema:'saampath/1',generatorVersion:state.generatorVersion,units:'mm',materialUnits:'mm3',initialPosition:state.start,
    ...(state.motion?{initialPose:structuredClone(state.motion.initialPose),motionFrame:'part',rotaryCenterMm:state.motion.rotaryCenterMm}:{}),
    actions:materializeActions(actionChunks),summary:{...summary,travel:{...state.stats}}};
}

function mergeableMove(run,next) {
  const previous=run.action,keys=Object.keys(previous).filter(k=>!['to','volumeMm3','speedMmS'].includes(k));
  const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
  const physical=['gapMm','normalHeightMm','slopeDeg','lowerSurfaceGapStartMm','lowerSurfaceGapEndMm','sampledGapErrorMm'];
  if(keys.length!==Object.keys(next).length-3||keys.some(k=>previous[k]!==next[k]&&
    !(physical.includes(k)&&Number.isFinite(previous[k])&&Number.isFinite(next[k])&&close(previous[k],next[k]))))return false;
  if(!close(previous.speedMmS,next.speedMmS)||(previous.volumeMm3>0)!==(next.volumeMm3>0))return false;
  const segmentLength=distance(previous.to,next.to);
  if(!close(run.density,next.volumeMm3/segmentLength))return false;
  const vector=next.to.map((v,i)=>v-run.from[i]),along=vector.reduce((s,v,i)=>s+v*run.direction[i],0);
  const before=previous.to.reduce((s,v,i)=>s+(v-run.from[i])*run.direction[i],0);
  return along>before&&Math.hypot(...vector.map((v,i)=>v-along*run.direction[i]))<=TOLERANCE.plane;
}
