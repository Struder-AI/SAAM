import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {depositionCourses,physicalOrdering} from './physical-order.mjs';
// Skill results describe deposition operations. The composer advances explicit
// planning state through scheduled operations and returns action chunks.

import {ActionAccumulator,planningResult,planContext,planFan,planNozzle,planPark,planTravel,planMove,
  planExtrusion,planDwell,planLayerCooling,planSelection,planProcess} from './planning.mjs';

// Schedule once, then advance explicit motion state through operations. Layer and
// obstacle ledgers are local scheduling work, never shared builder state.
export function planComposition(initialState,skillResults,rules={},onProgress) {
  const resolved=resolveOperationOrder(skillResults,rules,{onProgress,start:initialState.position});
  const operations=resolved.operations.map(op=>{
    const layerId=initialState.selections&&/^planar:[\d.e+-]+$/.test(op.layerId)?'planar:'+Number(Number(op.layerId.slice(7)).toFixed(5)):op.layerId;
    return {...op,layerId};
  });
  const nozzleScene={index:resolved.physical.index,beads:resolved.physical.beads,byStart:resolved.physical.byStart,occupied:new Set(),withinGroups:new Set()};
  const elapsed=new Map(),paid=new Map(),actions=new ActionAccumulator(),layers=new Set();
  const layerIndices=initialState.selections?new Map([...new Set(operations.map(op=>op.layerId))].map((id,i)=>[id,i])):null;
  let state=initialState,completed=0,last=null;
  onProgress?.({stage:'Planning print moves',completed,total:operations.length});
  for(const op of operations){
    if(last&&last.layerId!==op.layerId&&!last.continuous){
      const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});
      state=cooling.state;actions.add(cooling.actions);paid.set(last.layerId,(paid.get(last.layerId)??0)+(cooling.coolingSeconds??0));
    }
    const planned=planOperation(state,layerIndices?{...op,layer:layerIndices.get(op.layerId)}:op,{nozzleScene,layerSeconds:elapsed.get(op.layerId)??0});
    state=planned.state;actions.add(planned.actions);elapsed.set(op.layerId,planned.operationSeconds);layers.add(op.layerId);last=op;
    onProgress?.({stage:'Planning print moves',completed:++completed,total:operations.length});
  }
  if(last&&!last.continuous){const cooled=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});state=cooled.state;actions.add(cooled.actions);}
  return planningResult({...state,operationId:undefined},actions.finish(),{summary:{operationOrder:operations.map(op=>op.id),layers:layers.size,
    physicalOrdering:{substrateDependencies:resolved.physical.substrateDependencies,nozzleDependencies:resolved.physical.nozzleDependencies,
      nozzle:'Effectively infinite sharp cone; 15 degree included angle; carriage unchecked.'}}});
}

export function planOperation(initialState,op,options={}) {
  const entered=planOperationEntry(initialState,op,options.layerSeconds??0);
  const deposited=planPreparedOperation(entered.state,op,options);
  return planningResult(deposited.state,{chunks:[entered.actions,deposited.actions]},{operationSeconds:deposited.operationSeconds});
}

export function planOperationEntry(initialState,op,layerSeconds=0) {
  const contextual=planContext({...initialState,layerSeconds,layerId:op.layerId},op.phase,op.layer,op.sourceOperation??op.id);
  const selected=planSelection(contextual.state,op.filament??initialState.defaultFilament);
  const configured=planProcess(selected.state,op.process);
  const prepared=planOperationStart(configured.state,op);
  return planningResult(prepared.state,{chunks:[selected.actions,prepared.actions]});
}

// The caller has already applied selection, temperature and parking actions.
export function planPreparedOperation(initialState,op,{nozzleScene,finishLayer=false}={}) {
  const strokes=op.strokes;
  const actions=new ActionAccumulator();
  let state=initialState;
  for(const stroke of strokes){
    const approached=planStrokeApproach(state,stroke,op,nozzleScene);
    const depositedStroke=planStrokeDeposition(approached.state,stroke,op);
    state=depositedStroke.state;actions.add(approached.actions);actions.add(depositedStroke.actions);
    for(const point of stroke.points)for(const i of nozzleScene.byStart.get(point)??[])if(nozzleScene.beads[i].operationId===op.id)nozzleScene.occupied.add(i);
    if(!nozzleScene.withinGroups.has(op.id))nozzleScene.withinGroups=new Set([...nozzleScene.withinGroups,op.id]);
  }
  const restored=planOperationEnd(state,op),operationSeconds=restored.state.layerSeconds;
  const cooled=finishLayer?planLayerCooling(restored.state):planningResult(restored.state);
  actions.add(restored.actions);actions.add(cooled.actions);
  return planningResult(planProcess(cooled.state).state,actions.finish(),{operationSeconds});
}

export function planOperationStart(state,op) {
  const fan=op.fanPercent!==undefined?planFan(state,op.fanPercent):planningResult(state);
  if(op.nozzleC===undefined)return fan;
  const parked=planPark(fan.state),heated=planNozzle(parked.state,op.nozzleC);
  return planningResult(heated.state,{chunks:[fan.actions,parked.actions,heated.actions]});
}

export function planOperationEnd(state,op) {
  if(op.nozzleC===undefined)return planningResult(state);
  const parked=planPark(state),restored=planNozzle(parked.state,op.restoreNozzleC);
  return planningResult(restored.state,{chunks:[parked.actions,restored.actions]});
}

function segmentExtras(stroke,op,index) {
  return {role:stroke.role,...(stroke.poses?{pose:stroke.poses[index+1]}:{}),
    ...(stroke.beadWidthMm!==undefined?{beadWidthMm:stroke.beadWidthMm}:{}),
    ...(stroke.beadHeightMm!==undefined?{beadHeightMm:stroke.beadHeightMm}:{}),
    ...(op.regionId?{region:op.regionId}:{}),...(stroke.segmentMetadata?.[index]??{})};
}

export function planStrokeApproach(state,stroke,op,nozzleScene) {
  requireThat(stroke.points.length>=(stroke.stationaryExtrusion?1:2),'An operation stroke needs at least two points or an explicit stationary extrusion.');
  requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
  // Depositing connections are explicit finalized strokes, never late material.
  const travel=planTravel(state,stroke.points[0],nozzleScene,stroke.poses?.[0]);
  return planningResult(travel.state,travel.actions,
    {connected:false,travelKind:travel.travelKind});
}

export function planStrokeDeposition(initialState,stroke,op) {
  const actions=new ActionAccumulator();
  let state=initialState;
  if(stroke.stationaryExtrusion){
    requireThat(stroke.points.length===1&&!stroke.closed,'Stationary extrusion needs one point.');
    const extruded=planExtrusion(state,stroke.stationaryExtrusion.volumeMm3,stroke.stationaryExtrusion.flowMm3S);
    const holdSeconds=stroke.stationaryExtrusion.holdSeconds??0,held=planDwell(extruded.state,holdSeconds);
    state={...held.state,layerSeconds:held.state.layerSeconds+holdSeconds};actions.add(extruded.actions);actions.add(held.actions);
  }
  for(let i=1;i<stroke.points.length;i++){
    const volume=stroke.volumesMm3?stroke.volumesMm3[i-1]:distance(stroke.points[i-1],stroke.points[i])*stroke.beadAreaMm2;
    requireThat(Number.isFinite(volume)&&volume>=0,'Invalid operation deposition volume.');
    const speed=stroke.segmentMetadata?.[i-1]?.speedMmS??stroke.speedMmS;
    requireThat(Number.isFinite(speed),'Invalid operation deposition speed.');
    const moved=planMove(state,stroke.points[i],speed,volume,segmentExtras(stroke,op,i-1));
    state=moved.state;actions.add(moved.actions);
  }
  return planningResult(state,actions.finish());
}

export function scheduleOperations(skillResults,rules={}) {
  return resolveOperationOrder(skillResults,rules).operations;
}

function resolveOperationOrder(skillResults,rules,{onProgress,start}={}){
  const batch=validateOperationBatch(skillResults);
  const declared=prepareOperationDependencies(batch.operations,batch.byId,rules),splitConnectors=new Set();
  for(;;){
    const partition=depositionCourses(batch.operations,{splitConnectors});
    try{return solveCourseOrder(batch,declared,partition,{onProgress,start});}
    catch(error){
      if(!['PRINT_ORDER_CONFLICT','CONTINUOUS_NOZZLE_CONFLICT'].includes(error.code))throw error;
      const affected=new Set(error.operations??[error.operation]);
      const refinable=partition.courses.filter(course=>affected.has(course.id)&&!splitConnectors.has(course.sourceOperation)&&
        course.strokes.length>1&&!course.continuous&&!course.strokes.some(stroke=>stroke.stationaryExtrusion));
      if(!refinable.length)throw error;
      for(const course of refinable)splitConnectors.add(course.sourceOperation);
      onProgress?.({stage:'Refining interruptible connections',completed:splitConnectors.size,total:batch.operations.length});
    }
  }
}

function solveCourseOrder(batch,declared,{courses,groups,sequence},{onProgress,start}){
  const prerequisites=new Map(courses.map(course=>[course.id,new Set([...declared.get(course.sourceOperation)].flatMap(id=>groups.get(id)))]));
  for(const edge of sequence)prerequisites.get(edge.after).add(edge.before);
  const physical=physicalOrdering(courses,{onProgress,prerequisites});
  for(const edge of physical.edges)prerequisites.get(edge.after).add(edge.before);
  const priorityById=prepareOperationPriorities(courses,batch.resultIndex);
  const operations=orderReadyOperations(courses,priorityById,prerequisites,{start,physicalEdges:[...sequence,...physical.edges]});
  return {operations,physical};
}

export function validateOperationBatch(skillResults) {
  const operations = skillResults.flatMap(result => result.operations);
  const resultIndex = new Map(skillResults.flatMap((r,i)=>r.operations.map(op=>[op.id,i])));
  const byId = new Map();
  for (const operation of operations) {
    requireThat(typeof operation.id === 'string' && operation.id && !byId.has(operation.id), 'Duplicate or missing operation id.');
    requireThat(typeof operation.layerId === 'string' && operation.layerId && Number.isFinite(operation.rank), 'Operation needs a layer reference and finite scheduling rank.');
    requireThat(Array.isArray(operation.strokes)&&!operation.travelPolicy,'Operation needs deposition strokes, without runtime travel callbacks.');
    requireThat(operation.order==='given','Scheduling consumes finalized deposition order.');
    byId.set(operation.id, operation);
  }
  return {operations,resultIndex,byId};
}

export function prepareOperationPriorities(operations,resultIndex) {
  return new Map(operations.map((op,index)=>[op.id,{result:op.constructionRank??resultIndex.get(op.sourceOperation??op.id),index}]));
}

export function prepareOperationDependencies(operations,byId,{order=[],dependencies=[]}={}) {
  const prerequisites = new Map(operations.map(op => [op.id, new Set(op.after ?? [])]));
  for (const [id, after] of prerequisites) for (const predecessor of after)
    requireThat(byId.has(predecessor) && id !== predecessor, id===predecessor
      ?`Operation ${id} cannot depend on itself.`:`Operation ${id} depends on unknown operation ${predecessor}; use an exact operation ID.`);
  // Recipe composition entries that name no operation of this path match
  // nothing; a repeated order entry keeps its first place.
  for (const edge of dependencies)
    if (byId.has(edge.before) && byId.has(edge.after) && edge.before !== edge.after) prerequisites.get(edge.after).add(edge.before);
  const sequence = [...new Set(order)].filter(id => byId.has(id));
  // Explicit order is an additional precedence constraint, never permission to
  // bypass geometry/support dependencies. Omitted operations remain schedulable.
  for (let i = 1; i < sequence.length; i++) prerequisites.get(sequence[i]).add(sequence[i - 1]);
  return prerequisites;
}

export function orderReadyOperations(operations,priorityById,prerequisites,{start,physicalEdges=[]}={}) {
  const nodes=operations.map(op=>({op,...priorityById.get(op.id),
    remaining:prerequisites.get(op.id).size,following:[]}));
  const nodesById=new Map(nodes.map(node=>[node.op.id,node]));
  for(const node of nodes)for(const id of prerequisites.get(node.op.id))nodesById.get(id).following.push(node);
  const ready=[],scheduled=[];
  const cursor={point:start??operations[0]?.strokes[0]?.points[0]??[0,0,0],axis:null};
  for(const node of nodes)if(node.remaining===0)ready.push(node);
  while(ready.length){
    const cost=node=>{const stroke=node.op.strokes[0],point=stroke?.points[0]??cursor.point,axis=stroke?.poses?.[0]?.toolAxis;
      return distance(cursor.point,point)+(cursor.axis&&axis?(node.op.process?.lineWidthMm??.4)*(1-cursor.axis.reduce((sum,v,i)=>sum+v*axis[i],0)):0);};
    const chosen=ready.reduce((best,node,i)=>cost(node)<cost(ready[best])-PRINT_RESOLUTION_MM?i:
      Math.abs(cost(node)-cost(ready[best]))<=PRINT_RESOLUTION_MM&&(node.result<ready[best].result||node.result===ready[best].result&&node.index<ready[best].index)?i:best,0);
    const next=ready.splice(chosen,1)[0];scheduled.push(next.op);
    cursor.point=next.op.strokes.at(-1)?.points.at(-1)??cursor.point;cursor.axis=next.op.strokes.at(-1)?.poses?.at(-1)?.toolAxis??null;
    for(const node of next.following)if(--node.remaining===0)ready.push(node);
  }
  if(scheduled.length!==operations.length){
    const unresolved=new Set(nodes.filter(node=>node.remaining).map(node=>node.op.id));
    const done=new Set(),found={ids:[]};
    for(const root of unresolved){
      if(done.has(root)||found.ids.length)continue;
      const stack=[{id:root,after:[...prerequisites.get(root)].filter(id=>unresolved.has(id)),at:0}],positions=new Map([[root,0]]);
      while(stack.length&&!found.ids.length){
        const frame=stack.at(-1);
        if(frame.at===frame.after.length){done.add(frame.id);positions.delete(frame.id);stack.pop();continue;}
        const next=frame.after[frame.at++];
        if(positions.has(next)){found.ids=stack.slice(positions.get(next)).map(item=>item.id);break;}
        if(!done.has(next)){positions.set(next,stack.length);stack.push({id:next,after:[...prerequisites.get(next)].filter(id=>unresolved.has(id)),at:0});}
      }
    }
    const cycle=new Set(found.ids),reasons=physicalEdges.filter(edge=>cycle.has(edge.before)&&cycle.has(edge.after));
    throw Object.assign(Error('Print ordering contains a cycle: '+found.ids.join(' → ')),{code:'PRINT_ORDER_CONFLICT',operations:found.ids,physicalDependencies:reasons});
  }
  return scheduled;
}
