// Machine travel: the scheduled routes, realized for the selected machine.
// The Scheduler already routed every travel past deposited work for nozzle
// types containing the selected nozzles. Export adds only what depends on the
// machine and process: retraction when a travel is longer than the comb
// distance, recovery before material flows again, and parking (retract and
// retreat along the tool) at temperature changes and at the end.
import {requireThat,distance} from '../private/export/numeric.mjs';
import {contextualActions} from '../path/action-context.mjs';
import {pathInitialPosition,pathInitialPose} from '../path/curve-path.mjs';
import {uprightPose} from '../path/pose.mjs';

const isTravel=action=>action.kind==='move'&&typeof action.entityId==='string'&&action.entityId.startsWith('travel:');

// Yields {action, context, index} like contextualActions; index counts source actions.
export function* machineTravel(path,{retreatMm}={}){
  const source=path.deposition,planning=source.planning,base=planning.process;
  const state={position:pathInitialPosition(path),pose:pathInitialPose(path)??uprightPose(),process:base,
    retraction:planning.retracted&&base.retractMm>0?{filamentMm:base.retractMm,speedMmS:base.retractSpeedMmS}:null,
    parked:null,travel:[],context:{},index:0};
  const retreat=retreatMm??planning.motion?.retreatMm??base.liftMm;
  const at=(action,context=state.context)=>({action:{phase:context.phase,layer:context.layer,...action},context,index:state.index});
  function* retract(){
    if(state.retraction||!(state.process.retractMm>0))return;
    state.retraction={filamentMm:state.process.retractMm,speedMmS:state.process.retractSpeedMmS};
    yield at({kind:'retract',...state.retraction});
  }
  function* recover(){if(state.retraction){yield at({kind:'recover',...state.retraction});state.retraction=null;}}
  function* move(to,pose){
    yield at({kind:'move',to:[...to],speedMmS:state.process.travelSpeedMmS,volumeMm3:0,...(pose?{pose}:{})});
    state.position=[...to];state.pose=pose??state.pose;
  }
  // Leaving a park returns along the tool axis before following the route.
  function* unpark(){if(state.parked){const {from,pose}=state.parked;state.parked=null;yield* move(from,pose);}}
  function* park(){
    yield* retract();
    if(state.parked)return;
    const from=state.position,pose=state.pose;
    yield* move(from.map((v,i)=>v-pose.toolAxis[i]*retreat),pose);
    state.parked={from,pose};
  }
  // A travel retracts only when the route it takes is longer than the comb distance.
  function* flushTravel(){
    const legs=state.travel;if(!legs.length)return;state.travel=[];
    const length=legs.reduce((sum,{action},i)=>sum+distance(i?legs[i-1].action.to:state.parked?.from??state.position,action.to),0);
    if(length>state.process.maxCombMm)yield* retract();
    yield* unpark();
    for(const leg of legs){yield leg;state.position=[...leg.action.to];state.pose=leg.action.pose??state.pose;}
    yield* recover();
  }
  for(const item of contextualActions(path)){
    const {action,context,index}=item;state.index=index;state.context=context;
    const operation=context.operation!==undefined?source.operations[context.operation]:undefined;
    if(operation)state.process=source.processes[operation.processId]??state.process;
    if(isTravel(action)){state.travel.push(item);continue;}
    yield* flushTravel();
    if(action.kind==='temperature'){yield* park();yield item;continue;}
    if(action.kind==='retract'){if(!state.retraction)yield* retract();continue;}
    if(action.kind==='recover'){yield* unpark();yield* recover();continue;}
    // Deposition, including zero-material movement, starts unparked and recovered.
    if(action.kind==='move'||action.kind==='extrude'){yield* unpark();yield* recover();}
    if(action.kind==='move'){state.position=[...action.to];state.pose=action.pose??state.pose;}
    yield item;
  }
  yield* flushTravel();
  yield* park();
  requireThat(state.travel.length===0,'Machine travel left an unrealized route.');
}
