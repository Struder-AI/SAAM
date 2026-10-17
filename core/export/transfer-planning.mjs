// Selected-machine preparation realizes endpoint transfers against the exact
// prefix of deposited source ranges. Numerical collision shapes remain Geometry's.
import {nozzleMotionRoute} from '../geom/convex-clearance.mjs';
import {prepareRangeScene} from '../path/physical-order.mjs';
import {prepareCurvePath,curveAt} from '../path/curve-path.mjs';
import {createPlanningState,planningPath,planningResult,ActionAccumulator,planMove,planRetraction,planRecovery,planDepositRange,planExtrusion} from '../path/planning.mjs';
import {joinSaamPath} from '../path/saampath.mjs';
import {NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {resolveSourceOrder} from '../path/compose.mjs';
import {planExecutionPath} from '../path/schedule.mjs';

export function prepareMachineExecution(saved,nozzleGeometry,{nozzleGeometries=null,retreatMm}={}){
  const order=resolveSourceOrder(saved.deposition,prepareCurvePath(saved.deposition),
    {start:saved.schedule.initialPosition,nozzleGeometry,nozzleGeometries});
  const schedule=planExecutionPath(saved.deposition,{sourcePathId:saved.sourcePathId,order});
  return realizeMachineTransfers(joinSaamPath({sourcePathId:saved.sourcePathId,deposition:saved.deposition,schedule}),nozzleGeometry,{nozzleGeometries,retreatMm});
}

export function planMachineTravel(state,target,scene,targetPose,{recover=true}={}){
  const route=nozzleMotionRoute(scene.index,scene.occupied,state.position,target,state.pose,targetPose,
    {bounds:scene.depositedBounds,clearanceMm:state.process.liftMm,withinGroups:scene.withinGroups,groupPrefixes:scene.groupPrefixes,...scene.geometryForFilament(state.selection?.filament)});
  if(route.blocked){
    const operations=[...new Set(route.blocked.map(id=>scene.operationOf(id)))];
    throw Object.assign(Error('Selected nozzle access is blocked by deposited work: '+operations.join(', ')),
      {code:'NOZZLE_ACCESS_BLOCKED',operations,target});
  }
  const actions=new ActionAccumulator(),withdrawn=route.length>1?planRetraction(state):planningResult(state),cursor={state:withdrawn.state};
  actions.add(withdrawn.actions);
  for(const next of route){const move=planMove(cursor.state,next.point,state.process.travelSpeedMmS,0,{pose:next.pose});cursor.state=move.state;actions.add(move.actions);}
  const recovered=recover?planRecovery(cursor.state):planningResult(cursor.state);actions.add(recovered.actions);
  return planningResult(recovered.state,actions.finish());
}

function planMachinePark(state,scene){
  const target=state.position.map((v,i)=>v-state.pose.toolAxis[i]*state.motion.retreatMm),withdrawn=planRetraction(state);
  const moved=planMachineTravel(withdrawn.state,target,scene,state.pose,{recover:false});
  return planningResult({...moved.state,parked:true},{chunks:[withdrawn.actions,moved.actions]});
}

export function realizeMachineTransfers(saved,nozzleGeometry,{nozzleGeometries=null,retreatMm}={}){
  const source=saved.deposition,schedule=saved.schedule,reader=prepareCurvePath(source),motion=prepareCurvePath({curves:schedule.motionCurves});
  const courses=new Map(Object.values(source.operations).flatMap(op=>(op.courses??[]).map(course=>[course.id,{course,op}]))),units=[],byEntry=new Map();
  for(const [index,entry] of schedule.execution.entries()){
    if(entry.kind!=='deposit'&&entry.kind!=='inject')continue;
    const found=entry.kind==='deposit'?courses.get(entry.courseId):null,operation=found?.op??source.operations[entry.operationId];
    const ranges=found?[{...found.course,from:entry.from,to:entry.to,...(entry.reverse?{reverse:true}:{})}]:[];
    const unit={id:'machine:'+index,sourceOperation:operation.id,layerId:operation.layerId,operation,ranges,process:source.processes[operation.processId]};
    units.push(unit);byEntry.set(entry,unit);
  }
  const scene=prepareRangeScene(source,reader,units,{nozzleGeometry,nozzleGeometries}),actions=new ActionAccumulator();
  const cursor={state:createPlanningState({...source.planning,start:schedule.initialPosition,motion:{...source.planning.motion,initialPose:schedule.initialPose,
    ...(retreatMm===undefined?{}:{retreatMm})},sourcePathId:saved.sourcePathId})};
  function append(result){cursor.state=result.state;actions.add(result.actions);}
  for(const entry of schedule.execution){
    if(entry.kind==='context'){
      const {kind,reset,...context}=entry;
      const operation=Object.hasOwn(context,'operation')?source.operations[context.operation]:source.operations[cursor.state.operationId];
      cursor.state={...cursor.state,...(reset?{phase:undefined,layer:undefined,layerId:undefined,operationId:undefined}:{}),...context,
        ...(Object.hasOwn(context,'operation')?{operationId:context.operation}:{}),...(operation?{process:source.processes[operation.processId]}:{})};continue;
    }
    if(entry.kind==='travel'){
      const target=curveAt(motion,entry.curveId,entry.to,{side:'left'});append(planMachineTravel(cursor.state,target.point,scene,target.pose));continue;
    }
    if(entry.kind==='deposit'||entry.kind==='inject'){
      const unit=byEntry.get(entry),start=entry.kind==='inject'?{point:unit.operation.injection.at,pose:unit.operation.injection.pose}:
        curveAt(reader,unit.ranges[0].curveId,entry.reverse?entry.to:entry.from,entry.reverse?{side:'left'}:{});
      append(planMachineTravel(cursor.state,start.point,scene,start.pose));
      if(entry.kind==='deposit')append(planDepositRange(cursor.state,source,reader,unit.ranges[0],scene.byId.get(unit.id).records[0]));
      else {const injection=unit.operation.injection;append(planExtrusion(cursor.state,injection.volumeMm3,injection.flowMm3S));}
      scene.recordDeposit(unit.id,unit.ranges.length);continue;
    }
    if(entry.kind==='retract'){append(planRetraction(cursor.state));continue;}
    if(entry.kind==='recover'){append(planRecovery(cursor.state));continue;}
    if(entry.kind==='toolChange')cursor.state={...cursor.state,selection:source.planning.selections?.[entry.filament]??{filament:entry.filament}};
    if(entry.kind==='temperature')append(planMachinePark(cursor.state,scene));
    actions.add({append:[{phase:cursor.state.phase,layer:cursor.state.layer,layerId:cursor.state.layerId,operation:cursor.state.operationId,...entry}]});
  }
  if(!cursor.state.parked)append(planMachinePark(cursor.state,scene));
  const prepared=planningPath(cursor.state,[actions.finish()],schedule.summary,{contract:NEUTRAL_PATH_CONTRACT,nozzleGeometry,
    ...(nozzleGeometries?{nozzleGeometries}:{}),transfers:'resolved'});
  return joinSaamPath({sourcePathId:saved.sourcePathId,deposition:source,schedule:prepared});
}
