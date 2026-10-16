import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {orderSliceCourses} from './course-order.mjs';
import {precedenceLookup} from './precedence.mjs';
export {orderReadyOperations} from './course-order.mjs';
import {depositionCourses,physicalOrdering,refineCourseStrokes} from './physical-order.mjs';
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
  const nozzleScene={index:resolved.physical.index,beads:resolved.physical.beads,byStart:resolved.physical.byStart,occupied:new Set(),withinGroups:new Set(),groupPrefixes:new Map()};
  const elapsed=new Map(),paid=new Map(),actions=new ActionAccumulator(),layers=new Set();
  const layerIndices=initialState.selections?new Map([...new Set(operations.map(op=>op.layerId))].map((id,i)=>[id,i])):null;
  let state=initialState,completed=0,last=null;
  onProgress?.({stage:'Planning print moves',completed,total:operations.length});
  for(const op of operations){
    if(last&&last.layerId!==op.layerId&&!last.continuous){
      const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)},nozzleScene);
      state=cooling.state;actions.add(cooling.actions);paid.set(last.layerId,(paid.get(last.layerId)??0)+(cooling.coolingSeconds??0));
    }
    const planned=planOperation(state,layerIndices?{...op,layer:layerIndices.get(op.layerId)}:op,{nozzleScene,layerSeconds:elapsed.get(op.layerId)??0});
    state=planned.state;actions.add(planned.actions);elapsed.set(op.layerId,planned.operationSeconds);layers.add(op.layerId);last=op;
    onProgress?.({stage:'Planning print moves',completed:++completed,total:operations.length});
  }
  if(last&&!last.continuous){const cooled=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)},nozzleScene);state=cooled.state;actions.add(cooled.actions);}
  return planningResult({...state,operationId:undefined},actions.finish(),{nozzleScene,summary:{operationOrder:operations.map(op=>op.id),layers:layers.size,
    hierarchy:resolved.hierarchy,physicalOrdering:{substrateDependencies:resolved.physical.substrateDependencies,nozzleDependencies:resolved.physical.nozzleDependencies,materialDependencies:resolved.physical.materialDependencies,
      nozzle:'Effectively infinite sharp cone; 15 degree included angle; carriage unchecked.'}}});
}

export function planOperation(initialState,op,options={}) {
  const entered=planOperationEntry(initialState,op,options);
  const deposited=planPreparedOperation(entered.state,op,options);
  return planningResult(deposited.state,{chunks:[entered.actions,deposited.actions]},{operationSeconds:deposited.operationSeconds});
}

export function planOperationEntry(initialState,op,{layerSeconds=0,nozzleScene}={}) {
  const contextual=planContext({...initialState,layerSeconds,layerId:op.layerId},op.phase,op.layer,op.sourceOperation??op.id);
  const selected=planSelection(contextual.state,op.filament??initialState.defaultFilament);
  const configured=planProcess(selected.state,op.process);
  const prepared=planOperationStart(configured.state,op,nozzleScene);
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
    for(const point of stroke.points)for(const i of nozzleScene.byStart.get(point)??[])if(nozzleScene.beads[i].operationId===op.id){
      nozzleScene.occupied.add(i);nozzleScene.groupPrefixes.set(op.id,Math.max(nozzleScene.groupPrefixes.get(op.id)??-1,i));}
    if(!nozzleScene.withinGroups.has(op.id))nozzleScene.withinGroups=new Set([...nozzleScene.withinGroups,op.id]);
  }
  const restored=planOperationEnd(state,op,nozzleScene),operationSeconds=restored.state.layerSeconds;
  const cooled=finishLayer?planLayerCooling(restored.state,nozzleScene):planningResult(restored.state);
  actions.add(restored.actions);actions.add(cooled.actions);
  return planningResult(planProcess(cooled.state).state,actions.finish(),{operationSeconds});
}

export function planOperationStart(state,op,nozzleScene) {
  const fan=op.fanPercent!==undefined?planFan(state,op.fanPercent):planningResult(state);
  if(op.nozzleC===undefined)return fan;
  const parked=planPark(fan.state,nozzleScene),heated=planNozzle(parked.state,op.nozzleC);
  return planningResult(heated.state,{chunks:[fan.actions,parked.actions,heated.actions]});
}

export function planOperationEnd(state,op,nozzleScene) {
  if(op.nozzleC===undefined)return planningResult(state);
  const parked=planPark(state,nozzleScene),restored=planNozzle(parked.state,op.restoreNozzleC);
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
  const declared=prepareOperationDependencies(batch.operations,batch.byId,rules),splitConnectors=new Set(),splitStrokes=new Map();
  const declaredBefore=precedenceLookup(batch.operations.map(operation=>operation.id),
    [...declared].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  for(;;){
    const partition=depositionCourses(batch.operations,{splitConnectors,splitStrokes});
    try{return solveCourseOrder(batch,declared,partition,{onProgress,start});}
    catch(error){
      if(!['PRINT_ORDER_CONFLICT','CONTINUOUS_NOZZLE_CONFLICT'].includes(error.code))throw error;
      // An authored prerequisite requires the entire source operation first.
      // Subdividing either unchanged path cannot remove a witnessed nozzle hit
      // against that material; reject this contradiction without grid refinement.
      const sourceOf=new Map(partition.courses.map(course=>[course.id,course.sourceOperation]));
      if(declaredBefore.cyclic||error.physicalDependencies?.some(edge=>edge.kind==='nozzle-access'&&
        declaredBefore.has(sourceOf.get(edge.after),sourceOf.get(edge.before))))throw error;
      const affected=new Set(error.refinementCourses??error.operations??[error.operation]);
      const refinable=partition.courses.filter(course=>affected.has(course.id)&&!splitConnectors.has(course.sourceOperation)&&
        course.strokes.length>1&&!course.continuous&&!course.strokes.some(stroke=>stroke.stationaryExtrusion));
      if(!refinable.length){
        if(!refineCourseStrokes(partition,affected,splitStrokes))throw error;
        onProgress?.({stage:'Refining interruptible strokes',completed:splitStrokes.size,total:batch.operations.reduce((count,operation)=>count+operation.strokes.length,0)});continue;
      }
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
  const ordered=orderSliceCourses(courses,priorityById,prerequisites,{start,physicalEdges:[...sequence,...physical.edges]});
  return {...ordered,physical};
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
