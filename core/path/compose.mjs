import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
// Skill results describe deposition operations. The composer advances explicit
// planning state through scheduled operations and returns action chunks.

import {prepareTravelPolicy} from './builder.mjs';
import {ActionAccumulator,planningResult,planContext,planFan,planNozzle,planPark,planTravel,planMove,
  planExtrusion,planDwell,planLayerCooling,planSelection,planProcess} from './planning.mjs';

// Schedule once, then advance explicit motion state through operations. Layer and
// obstacle ledgers are local scheduling work, never shared builder state.
export function planComposition(initialState,skillResults,rules={},onProgress,{geometry=[]}={}) {
  const operations=scheduleOperations(skillResults,rules).map(op=>{
    const layerId=initialState.selections&&/^planar:[\d.e+-]+$/.test(op.layerId)?'planar:'+Number(Number(op.layerId.slice(7)).toFixed(5)):op.layerId;
    return {...op,layerId,travelPolicy:prepareTravelPolicy(op.materialGeometry,op.process??initialState.process,geometry)};
  });
  const elapsed=new Map(),paid=new Map(),deposited=[],actions=new ActionAccumulator(),layers=new Set();
  const layerIndices=initialState.selections?new Map([...new Set(operations.map(op=>op.layerId))].map((id,i)=>[id,i])):null;
  let state=initialState,completed=0,last=null;
  onProgress?.({stage:'Planning print moves',completed,total:operations.length});
  for(const op of operations){
    if(last&&last.layerId!==op.layerId&&!last.continuous){
      const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});
      state=cooling.state;actions.add(cooling.actions);paid.set(last.layerId,(paid.get(last.layerId)??0)+(cooling.coolingSeconds??0));
    }
    const planned=planOperation(state,layerIndices?{...op,layer:layerIndices.get(op.layerId)}:op,{deposited,layerSeconds:elapsed.get(op.layerId)??0});
    state=planned.state;actions.add(planned.actions);deposited.push(op.travelPolicy);elapsed.set(op.layerId,planned.operationSeconds);layers.add(op.layerId);last=op;
    onProgress?.({stage:'Planning print moves',completed:++completed,total:operations.length});
  }
  if(last&&!last.continuous){const cooled=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});state=cooled.state;actions.add(cooled.actions);}
  return planningResult({...state,operationId:undefined},actions.finish(),{summary:{operationOrder:operations.map(op=>op.id),layers:layers.size}});
}

export function planOperation(initialState,op,options={}) {
  const entered=planOperationEntry(initialState,op,options.layerSeconds??0);
  const deposited=planPreparedOperation(entered.state,op,options);
  return planningResult(deposited.state,{chunks:[entered.actions,deposited.actions]},{operationSeconds:deposited.operationSeconds});
}

export function planOperationEntry(initialState,op,layerSeconds=0) {
  const contextual=planContext({...initialState,layerSeconds,layerId:op.layerId},op.phase,op.layer,op.id);
  const selected=planSelection(contextual.state,op.filament??initialState.defaultFilament);
  const configured=planProcess(selected.state,op.process);
  const prepared=planOperationStart(configured.state,op);
  return planningResult(prepared.state,{chunks:[selected.actions,prepared.actions]});
}

// The caller has already applied selection, temperature and parking actions.
export function planPreparedOperation(initialState,op,{deposited=[],finishLayer=false}={}) {
  const strokes=op.strokes;
  const actions=new ActionAccumulator();
  const policy=operationTravelPolicy(op.travelPolicy,deposited);
  let state=initialState;
  for(const stroke of strokes){
    const approached=planStrokeApproach(state,stroke,op,policy);
    const depositedStroke=planStrokeDeposition(approached.state,stroke,op);
    state=depositedStroke.state;actions.add(approached.actions);actions.add(depositedStroke.actions);
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

function operationTravelPolicy(policy,deposited) {
  return {...policy,isTravelClear:(from,to)=>(!policy.isTravelClear||policy.isTravelClear(from,to))
    &&!deposited.some(previous=>previous.material?previous.material.blocksSegment(from,to)
      :previous.clearanceFor(from,to)>policy.clearanceFor(from,to)+PRINT_RESOLUTION_MM)};
}

function segmentExtras(stroke,op,index) {
  return {role:stroke.role,...(stroke.poses?{pose:stroke.poses[index+1]}:{}),
    ...(stroke.beadWidthMm!==undefined?{beadWidthMm:stroke.beadWidthMm}:{}),
    ...(stroke.beadHeightMm!==undefined?{beadHeightMm:stroke.beadHeightMm}:{}),
    ...(op.regionId?{region:op.regionId}:{}),...(stroke.segmentMetadata?.[index]??{})};
}

export function planStrokeApproach(state,stroke,op,policy) {
  requireThat(stroke.points.length>=(stroke.stationaryExtrusion?1:2),'An operation stroke needs at least two points or an explicit stationary extrusion.');
  requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
  // Depositing connections are explicit finalized strokes, never late material.
  const travel=planTravel(state,stroke.points[0],policy,stroke.poses?.[0]);
  return planningResult(travel.state,travel.actions,
    {connected:false,travelKind:travel.travelKind});
}

export function planStrokeDeposition(initialState,stroke,op) {
  const actions=new ActionAccumulator();
  let state=initialState;
  if(stroke.stationaryExtrusion){
    requireThat(stroke.points.length===1&&!stroke.closed&&!stroke.poses,'Stationary extrusion needs one unoriented point.');
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

export function scheduleOperations(skillResults, { order = [], dependencies = [] } = {}) {
  const batch=validateOperationBatch(skillResults);
  const priorityById=prepareOperationPriorities(batch.operations,batch.resultIndex);
  const prerequisites=prepareOperationDependencies(batch.operations,batch.byId,{order,dependencies});
  const scheduled=orderReadyOperations(batch.operations,priorityById,prerequisites);
  return scheduled;
}

export function validateOperationBatch(skillResults) {
  const operations = skillResults.flatMap(result => result.operations);
  const resultIndex = new Map(skillResults.flatMap((r,i)=>r.operations.map(op=>[op.id,i])));
  const byId = new Map();
  for (const operation of operations) {
    requireThat(typeof operation.id === 'string' && operation.id && !byId.has(operation.id), 'Duplicate or missing operation id.');
    requireThat(typeof operation.layerId === 'string' && operation.layerId && Number.isFinite(operation.rank), 'Operation needs a layer reference and finite scheduling rank.');
    requireThat(Array.isArray(operation.strokes)&&operation.materialGeometry&&!operation.travelPolicy,
      'Operation needs deposition strokes and material geometry data.');
    requireThat(operation.order==='given','Scheduling consumes finalized deposition order.');
    byId.set(operation.id, operation);
  }
  return {operations,resultIndex,byId};
}

export function prepareOperationPriorities(operations,resultIndex) {
  // Dependencies express what must exist first. Among ready operations, keep
  // skills near the same physical height, even when a skill's rank is merely
  // its construction order (for example draped skin).
  // An atomic continuous operation stays intact; this is a preference, not a
  // height-difference gate or permission to split its deposition.
  const heights=new Map(operations.map(op=>[op.id,op.strokes.reduce((z,s)=>s.points.reduce((h,p)=>Math.max(h,p[2]),z),-Infinity)]));
  return new Map(operations.map((op,index)=>[op.id,{height:heights.get(op.id),result:op.constructionRank??resultIndex.get(op.id),index}]));
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

export function orderReadyOperations(operations,priorityById,prerequisites) {
  // Kahn's topological ordering with the same stable priority as the former
  // ready-list sort. Each dependency is visited once; unrelated ready work
  // stays in a heap instead of being rescanned and resorted after every layer.
  const nodes=operations.map(op=>({op,...priorityById.get(op.id),
    remaining:prerequisites.get(op.id).size,following:[]}));
  const nodesById=new Map(nodes.map(node=>[node.op.id,node]));
  for(const node of nodes)for(const id of prerequisites.get(node.op.id))nodesById.get(id).following.push(node);
  const compare=(a,b)=>a.height-b.height||a.result-b.result||a.op.rank-b.op.rank||a.index-b.index;
  const ready=[],scheduled=[];
  const push=node=>{
    let i=ready.length;ready.push(node);
    while(i){const parent=(i-1)>>1;if(compare(ready[parent],node)<=0)break;ready[i]=ready[parent];i=parent;}
    ready[i]=node;
  };
  const pop=()=>{
    const first=ready[0],last=ready.pop();
    if(ready.length){
      let i=0;
      while(i*2+1<ready.length){
        let child=i*2+1;
        if(child+1<ready.length&&compare(ready[child+1],ready[child])<0)child++;
        if(compare(last,ready[child])<=0)break;
        ready[i]=ready[child];i=child;
      }
      ready[i]=last;
    }
    return first;
  };
  for(const node of nodes)if(node.remaining===0)push(node);
  while(ready.length){
    const next=pop();scheduled.push(next.op);
    for(const node of next.following)if(--node.remaining===0)push(node);
  }
  requireThat(scheduled.length===operations.length,'Composition dependencies contain a cycle.');
  return scheduled;
}
