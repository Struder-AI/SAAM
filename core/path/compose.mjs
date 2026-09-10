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
    requireThat(Array.isArray(operation.strokes) && operation.travelPolicy && typeof operation.travelPolicy.clearanceFor==='function'
      && Number.isFinite(operation.clearanceZ), 'Operation needs strokes and a travel policy.');
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
  const pending = [...operations], completed = new Set(), scheduled = [];
  while (pending.length) {
    const ready = pending.filter(op => [...prerequisites.get(op.id)].every(id => completed.has(id)));
    requireThat(ready.length > 0, 'Composition dependencies contain a cycle.');
    ready.sort((a, b) => bands.get(heights.get(a.id))-bands.get(heights.get(b.id))
      || resultIndex.get(a.id)-resultIndex.get(b.id) || a.rank-b.rank || operations.indexOf(a)-operations.indexOf(b));
    const next = ready[0];
    pending.splice(pending.indexOf(next), 1);
    scheduled.push(next); completed.add(next.id);
  }
  return scheduled;
}

export function composeResults(builder, results, rules = {}) {
  const operations = scheduleOperations(results, rules);
  const remaining = new Map(), elapsed = new Map();
  const deposited=[];
  for (const op of operations) remaining.set(op.layerId, (remaining.get(op.layerId) ?? 0) + 1);
  for (const op of operations) {
    builder.setContext(op.phase, op.layer);
    builder.operationId = op.id;
    builder.layerSeconds = elapsed.get(op.layerId) ?? 0;
    if (op.fanPercent !== undefined) builder.fan(op.fanPercent);
    const strokes = op.order === 'nearest' ? orderStrokes(op.strokes, builder.position)
      : op.order === 'nearest-cells' ? orderScanlineCells(op.strokes, builder.position) : op.strokes;
    for (const stroke of strokes) {
      requireThat(stroke.points.length >= 2, 'An operation stroke needs at least two points.');
      requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
      // PathBuilder tracks deposited height per segment. These local queries
      // retain the existing restrictions on direct/combed moves only.
      const policy = { ...op.travelPolicy };
      // Geometry queries, not the scheduling rank, decide whether an earlier
      // operation blocks direct travel. Rank need not mean physical height.
      const destinationClearance=op.travelPolicy.clearanceFor(builder.position,stroke.points[0]);
      if(deposited.some(previous=>previous.travelPolicy.clearanceFor(builder.position,stroke.points[0])>destinationClearance+1e-9)) {
        policy.canTravelDirect=()=>false; policy.maxCombMm=0;
      }
      builder.travelTo(stroke.points[0], policy,stroke.poses?.[0]);
      for (let i = 1; i < stroke.points.length; i++) {
        const volume = stroke.volumesMm3 ? stroke.volumesMm3[i - 1]
          : distance(stroke.points[i - 1], stroke.points[i]) * stroke.beadAreaMm2;
        requireThat(Number.isFinite(volume) && volume >= 0, 'Invalid operation deposition volume.');
        builder.move(stroke.points[i], stroke.speedMmS, volume,
          { role: stroke.role, ...(stroke.poses?{pose:stroke.poses[i]}:{}), ...(op.regionId?{region:op.regionId}:{}), ...(stroke.segmentMetadata?.[i - 1] ?? {}) });
      }
    }
    deposited.push(op);
    elapsed.set(op.layerId, builder.layerSeconds);
    remaining.set(op.layerId, remaining.get(op.layerId) - 1);
    if (remaining.get(op.layerId) === 0 && !op.continuous) builder.finishLayer();
  }
  builder.operationId = undefined;
  return { operationOrder: operations.map(op => op.id), layers: remaining.size,clearanceZ:builder.clearanceZ() };
}
