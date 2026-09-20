// Skill results describe deposition operations. Only this composer writes the
// final sequence, connecting travel and layer cooling through one PathBuilder.
import { requireThat, distance } from '../geom/tolerance.mjs';
import { orderStrokes, orderScanlineCells } from './builder.mjs';

export function scheduleOperations(results, { order = [], dependencies = [], batchLayers = 1 } = {}) {
  requireThat(Number.isInteger(batchLayers) && batchLayers >= 1 && batchLayers <= 20, 'Batch size must be 1–20 layers.');
  const operations = results.flatMap(result => result.operations);
  const resultIndex = new Map(results.flatMap((r,i)=>r.operations.map(op=>[op.id,i])));
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
  // Dependencies express what must exist first. Among ready operations, keep
  // skills near the same physical height, even when a skill's rank is merely
  // its construction order (for example surface-normal rimming or draped skin).
  // An atomic continuous operation stays intact; this is a preference, not a
  // height-difference gate or permission to split its deposition.
  const heights=new Map(operations.map(op=>[op.id,op.strokes.reduce((z,s)=>s.points.reduce((h,p)=>Math.max(h,p[2]),z),-Infinity)]));
  const levels=[...new Set(heights.values())].sort((a,b)=>a-b);
  const bands=new Map(levels.map((z,i)=>[z,Math.floor(i/batchLayers)]));
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
  // Kahn's topological ordering with the same stable priority as the former
  // ready-list sort. Each dependency is visited once; unrelated ready work
  // stays in a heap instead of being rescanned and resorted after every layer.
  const nodes=operations.map((op,index)=>({op,index,band:bands.get(heights.get(op.id)),result:resultIndex.get(op.id),
    remaining:prerequisites.get(op.id).size,following:[]}));
  const nodesById=new Map(nodes.map(node=>[node.op.id,node]));
  for(const node of nodes)for(const id of prerequisites.get(node.op.id))nodesById.get(id).following.push(node);
  // Within a height, keep one nozzle's work together so each change is paid for once.
  const compare=(a,b)=>a.band-b.band||(a.op.tool??0)-(b.op.tool??0)||a.result-b.result||a.op.rank-b.op.rank||a.index-b.index;
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

export function composeResults(builder, results, rules = {}, onProgress) {
  const operations = scheduleOperations(results, rules);
  const remaining = new Map(), elapsed = new Map();
  const deposited=[];
  let completed=0;
  onProgress?.({stage:'Planning print moves',completed,total:operations.length});
  for (const op of operations) remaining.set(op.layerId, (remaining.get(op.layerId) ?? 0) + 1);
  for (const op of operations) {
    builder.setContext(op.phase, op.layer);
    builder.operationId = op.id;
    if (op.tool !== undefined) builder.switchTool(op.tool);
    builder.layerSeconds = elapsed.get(op.layerId) ?? 0;
    if (op.fanPercent !== undefined) builder.fan(op.fanPercent);
    // Heat at clearance, before approaching the work. Restore at clearance too.
    if(op.nozzleC!==undefined){builder.park();builder.nozzle(op.nozzleC);}
    const strokes = op.order === 'nearest' ? orderStrokes(op.strokes, builder.position)
      : op.order === 'nearest-cells' ? orderScanlineCells(op.strokes, builder.position) : op.strokes;
    for (const stroke of strokes) {
      requireThat(stroke.points.length >= (stroke.stationaryExtrusion?1:2), 'An operation stroke needs at least two points or an explicit stationary extrusion.');
      requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
      // PathBuilder tracks deposited height per segment. These local queries
      // retain the existing restrictions on direct/combed moves only.
      const policy = { ...op.travelPolicy };
      // Geometry queries, not the scheduling rank, decide whether an earlier
      // operation blocks direct travel. Rank need not mean physical height.
      policy.isTravelClear=(from,to)=> (!op.travelPolicy.isTravelClear||op.travelPolicy.isTravelClear(from,to))
        &&!deposited.some(previous=>previous.material
          ?previous.material.blocksSegment(from,to)
          :previous.clearanceFor(from,to)>op.travelPolicy.clearanceFor(from,to)+1e-9);
      builder.travelTo(stroke.points[0], policy,stroke.poses?.[0]);
      if(stroke.stationaryExtrusion){
        requireThat(stroke.points.length===1&&!stroke.closed&&!stroke.poses,'Stationary extrusion needs one unoriented point.');
        builder.extrude(stroke.stationaryExtrusion.volumeMm3,stroke.stationaryExtrusion.flowMm3S);
        builder.dwell(stroke.stationaryExtrusion.holdSeconds??0);
        builder.layerSeconds+=stroke.stationaryExtrusion.holdSeconds??0;
      }
      for (let i = 1; i < stroke.points.length; i++) {
        const volume = stroke.volumesMm3 ? stroke.volumesMm3[i - 1]
          : distance(stroke.points[i - 1], stroke.points[i]) * stroke.beadAreaMm2;
        requireThat(Number.isFinite(volume) && volume >= 0, 'Invalid operation deposition volume.');
        builder.move(stroke.points[i], stroke.speedMmS, volume,
          { role: stroke.role, ...(stroke.poses?{pose:stroke.poses[i]}:{}), ...(op.regionId?{region:op.regionId}:{}), ...(stroke.segmentMetadata?.[i - 1] ?? {}) });
      }
    }
    if(op.nozzleC!==undefined){builder.park();builder.nozzle(op.restoreNozzleC);}
    deposited.push(op.travelPolicy);
    elapsed.set(op.layerId, builder.layerSeconds);
    remaining.set(op.layerId, remaining.get(op.layerId) - 1);
    if (remaining.get(op.layerId) === 0 && !op.continuous) builder.finishLayer();
    onProgress?.({stage:'Planning print moves',completed:++completed,total:operations.length});
  }
  builder.operationId = undefined;
  return { operationOrder: operations.map(op => op.id), layers: remaining.size };
}
