// Skill results describe deposition operations. The composer advances explicit
// planning state through scheduled operations and returns action chunks.
import { requireThat, distance } from '../geom/tolerance.mjs';
import { orderStrokes, orderScanlineCells } from './builder.mjs';
import {ActionAccumulator,planningResult,planContext,planFan,planNozzle,planPark,planConnection,planTravel,planMove,
  planExtrusion,planDwell,planLayerCooling} from './planning.mjs';

// Schedule once, then advance explicit motion state through operations. Layer and
// obstacle ledgers are local scheduling work, never shared builder state.
export function planComposition(initialState,skillResults,rules={},onProgress) {
  const operations=scheduleOperations(skillResults,rules),remaining=new Map(),elapsed=new Map(),deposited=[],actions=new ActionAccumulator();
  let state=initialState,completed=0;
  onProgress?.({stage:'Planning print moves',completed,total:operations.length});
  for(const op of operations)remaining.set(op.layerId,(remaining.get(op.layerId)??0)+1);
  for(const op of operations){
    const lastInLayer=remaining.get(op.layerId)===1;
    const planned=planOperation(state,op,{deposited,layerSeconds:elapsed.get(op.layerId)??0,finishLayer:lastInLayer&&!op.continuous});
    state=planned.state;actions.add(planned.actions);
    deposited.push(op.travelPolicy);elapsed.set(op.layerId,planned.operationSeconds);
    remaining.set(op.layerId,remaining.get(op.layerId)-1);
    onProgress?.({stage:'Planning print moves',completed:++completed,total:operations.length});
  }
  return planningResult({...state,operationId:undefined},actions.finish(),
    {summary:{operationOrder:operations.map(op=>op.id),layers:remaining.size}});
}

export function planOperation(initialState,op,{deposited=[],layerSeconds=0,finishLayer=false}={}) {
  const contextual=planContext({...initialState,layerSeconds},op.phase,op.layer,op.id);
  const prepared=planOperationStart(contextual.state,op);
  const strokes=op.order==='nearest'?orderStrokes(op.strokes,prepared.state.position)
    :op.order==='nearest-cells'?orderScanlineCells(op.strokes,prepared.state.position):op.strokes;
  const actions=new ActionAccumulator();actions.add(prepared.actions);
  const policy=operationTravelPolicy(op.travelPolicy,deposited);
  let state=prepared.state;
  for(const stroke of strokes){
    const approached=planStrokeApproach(state,stroke,op,policy);
    const depositedStroke=planStrokeDeposition(approached.state,stroke,op);
    state=depositedStroke.state;actions.add(approached.actions);actions.add(depositedStroke.actions);
  }
  const restored=planOperationEnd(state,op),operationSeconds=restored.state.layerSeconds;
  const cooled=finishLayer?planLayerCooling(restored.state):planningResult(restored.state);
  actions.add(restored.actions);actions.add(cooled.actions);
  return planningResult(cooled.state,actions.finish(),{operationSeconds});
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
      :previous.clearanceFor(from,to)>policy.clearanceFor(from,to)+1e-9)};
}

function segmentExtras(stroke,op,index) {
  return {role:stroke.role,...(stroke.poses?{pose:stroke.poses[index+1]}:{}),
    ...(op.regionId?{region:op.regionId}:{}),...(stroke.segmentMetadata?.[index]??{})};
}

export function planStrokeApproach(state,stroke,op,policy) {
  requireThat(stroke.points.length>=(stroke.stationaryExtrusion?1:2),'An operation stroke needs at least two points or an explicit stationary extrusion.');
  requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
  const connection=op.connectNearby&&!stroke.stationaryExtrusion
    ?planConnection(state,stroke.points[0],policy,stroke.speedMmS,
      stroke.volumesMm3?stroke.volumesMm3[0]/distance(stroke.points[0],stroke.points[1]):stroke.beadAreaMm2,
      segmentExtras(stroke,op,0),stroke.poses?.[0])
    :planningResult(state,undefined,{connected:false});
  if(connection.connected)return connection;
  const travel=planTravel(connection.state,stroke.points[0],policy,stroke.poses?.[0]);
  return planningResult(travel.state,{chunks:[connection.actions,travel.actions]},
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
    const moved=planMove(state,stroke.points[i],stroke.speedMmS,volume,segmentExtras(stroke,op,i-1));
    state=moved.state;actions.add(moved.actions);
  }
  return planningResult(state,actions.finish());
}

export function scheduleOperations(skillResults, { order = [], dependencies = [], batchLayers = 1 } = {}) {
  const batch=validateOperationBatch(skillResults,batchLayers);
  const priorityById=prepareOperationPriorities(batch.operations,batch.resultIndex,batchLayers);
  const prerequisites=prepareOperationDependencies(batch.operations,batch.byId,{order,dependencies});
  const scheduled=orderReadyOperations(batch.operations,priorityById,prerequisites);
  return scheduled;
}

export function validateOperationBatch(skillResults,batchLayers) {
  requireThat(Number.isInteger(batchLayers) && batchLayers >= 1 && batchLayers <= 20, 'Batch size must be 1–20 layers.');
  const operations = skillResults.flatMap(result => result.operations);
  const resultIndex = new Map(skillResults.flatMap((r,i)=>r.operations.map(op=>[op.id,i])));
  const byId = new Map();
  for (const operation of operations) {
    requireThat(typeof operation.id === 'string' && operation.id && !byId.has(operation.id), 'Duplicate or missing operation id.');
    requireThat(typeof operation.layerId === 'string' && operation.layerId && Number.isFinite(operation.rank), 'Operation needs a layer reference and finite scheduling rank.');
    requireThat(Array.isArray(operation.strokes) && operation.travelPolicy && typeof operation.travelPolicy.clearanceFor==='function',
      'Operation needs strokes and a travel policy.');
    requireThat(operation.order!=='nearest'||operation.strokes.every(s=>s.closed&&Number.isFinite(s.beadAreaMm2)&&!s.volumesMm3&&!s.poses),
      'Nearest ordering requires closed strokes with a uniform bead area.');
    requireThat(operation.order!=='nearest-cells'||(!operation.continuous&&operation.strokes.every(s=>s.scanlineCell!==undefined&&!s.closed&&!s.poses)),
      'Nearest cell ordering requires grouped open strokes without tool poses.');
    byId.set(operation.id, operation);
  }
  return {operations,resultIndex,byId};
}

export function prepareOperationPriorities(operations,resultIndex,batchLayers) {
  // Dependencies express what must exist first. Among ready operations, keep
  // skills near the same physical height, even when a skill's rank is merely
  // its construction order (for example surface-normal rimming or draped skin).
  // An atomic continuous operation stays intact; this is a preference, not a
  // height-difference gate or permission to split its deposition.
  const heights=new Map(operations.map(op=>[op.id,op.strokes.reduce((z,s)=>s.points.reduce((h,p)=>Math.max(h,p[2]),z),-Infinity)]));
  const levels=[...new Set(heights.values())].sort((a,b)=>a-b);
  const bands=new Map(levels.map((z,i)=>[z,Math.floor(i/batchLayers)]));
  return new Map(operations.map((op,index)=>[op.id,{band:bands.get(heights.get(op.id)),result:resultIndex.get(op.id),index}]));
}

export function prepareOperationDependencies(operations,byId,{order=[],dependencies=[]}={}) {
  const prerequisites = new Map(operations.map(op => [op.id, new Set(op.after ?? [])]));
  for (const edge of dependencies) {
    requireThat(edge && byId.has(edge.before) && byId.has(edge.after), 'Unknown composition dependency.');
    prerequisites.get(edge.after).add(edge.before);
  }
  for (const [id, after] of prerequisites) for (const predecessor of after)
    requireThat(byId.has(predecessor) && id !== predecessor, 'Unknown or self-dependent operation: ' + id);
  requireThat(new Set(order).size === order.length && order.every(id => byId.has(id)), 'Duplicate or unknown operation in composition order.');
  // Explicit order is an additional precedence constraint, never permission to
  // bypass geometry/support dependencies. Omitted operations remain schedulable.
  for (let i = 1; i < order.length; i++) prerequisites.get(order[i]).add(order[i - 1]);
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
  const compare=(a,b)=>a.band-b.band||a.result-b.result||a.op.rank-b.op.rank||a.index-b.index;
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
