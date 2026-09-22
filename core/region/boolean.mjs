// Compatibility entry for planar booleans and the existing sampled level sets.
// Every region boolean uses the shared Clipper2 implementation. Level-set
// extraction below is a separate construction and retains its current scope.

import { requireThat, distance2 } from '../geom/tolerance.mjs';
import { loopArea, dedupe } from './region2d.mjs';

export { union, intersect, difference } from './intersection.mjs';

const CHAIN_TOLERANCE = 1e-7;

// Reassemble kept pieces into closed loops end to end.
function chain(pieces) {
  const pool = pieces.map(piece => [...piece]).filter(piece => piece.length >= 2);
  const buckets=new Map(),used=new Set();
  const cell=p=>p.map(v=>Math.floor(v/CHAIN_TOLERANCE));
  for(let i=0;i<pool.length;i++){
    const key=cell(pool[i][0]).join('|');
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(i);
  }
  const loops = [];
  // One bound for the whole walk: a shrinking pool must not cut a long contour
  // short half way round.
  const limit = pool.length + 2;
  for(let start=pool.length-1;start>=0;start--) {
    if(used.has(start))continue;
    let current = [...pool[start]];used.add(start);
    let guard = 0;
    while (distance2(current[0], current[current.length - 1]) > CHAIN_TOLERANCE && guard++ < limit) {
      const tip = current[current.length - 1];
      let best = -1, bestDistance = CHAIN_TOLERANCE;
      const [x,y]=cell(tip);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of buckets.get((x+dx)+'|'+(y+dy))??[]){
        if(used.has(i))continue;
        const d=distance2(tip,pool[i][0]);
        // Preserve the previous scan's last-index tie rule and output order.
        if(d<bestDistance||(d===bestDistance&&i>best)){bestDistance=d;best=i;}
      }
      if (best < 0) break;
      used.add(best);current.push(...pool[best].slice(1));
    }
    requireThat(distance2(current[0],current[current.length-1])<=CHAIN_TOLERANCE,'Region operation produced an open contour.');
    const closed = dedupe(current);
    // Area is mm², so a chord tolerance in mm cannot decide whether material
    // exists. Retain every nonzero loop assembled on the endpoint grid.
    if (closed.length >= 3 && Math.abs(loopArea(closed)) > 0) loops.push(closed);
  }
  return loops;
}

// Region where a sampled height field is at or above `level`, as closed loops.
// Used to reserve material under a top surface: the body may fill only where
// the surface is still far enough above this layer, and to mark the area the
// non-planar angle limit allows.
//
// Grid points outside the sampled object carry a sentinel value. Interpolating
// linearly against a sentinel would put the boundary essentially on the last
// inside sample, so a `refine` callback may be supplied to locate that crossing
// against the real surface instead of the sampled field.
export const SENTINEL = 1e6;

// A sampled field may lie wholly above or wholly below the level, in which case
// there is no contour at all and an empty loop list would be a lie: it means
// "everywhere", not "nowhere". Callers must ask which.
export function levelSetCoverage(field, level) {
  let min = Infinity, max = -Infinity;
  for (const column of field.values)
    for (const value of column) { if (value < min) min = value; if (value > max) max = value; }
  if (min >= level) return 'all';
  if (max < level) return 'none';
  return 'partial';
}

export function levelSetRegion(field, level, { refine = null } = {}) {
  const { xs, ys } = field;
  requireThat(xs.length > 1 && ys.length > 1, 'A level set needs a sampled grid.');
  const interiorSegments=levelSetInteriorSegments(field,level,refine);
  const boundarySegments=levelSetBoundarySegments(field,level,refine);
  return chain([...interiorSegments,...boundarySegments]);
}

function levelSetInteriorSegments({xs,ys,values},level,refine){
  const segments = [];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const corners = [
        { x: xs[i], y: ys[j], value: values[i][j] },
        { x: xs[i + 1], y: ys[j], value: values[i + 1][j] },
        { x: xs[i + 1], y: ys[j + 1], value: values[i + 1][j + 1] },
        { x: xs[i], y: ys[j + 1], value: values[i][j + 1] }
      ];
      // Walking the cell counter-clockwise, a crossing that leaves the high
      // side starts a contour segment and one that enters it ends the segment.
      // Emitting them in that order keeps the region at or above the level on
      // the left, so the pieces chain into correctly wound closed loops.
      const exits = [], entries = [];
      for (let e = 0; e < 4; e++) {
        const p = corners[e], q = corners[(e + 1) % 4];
        const above = p.value >= level, next = q.value >= level;
        if (above === next) continue;
        const sentinel = Math.abs(p.value) >= SENTINEL || Math.abs(q.value) >= SENTINEL;
        let point;
        if (sentinel && refine) point = above ? refine([p.x, p.y], [q.x, q.y]) : refine([q.x, q.y], [p.x, p.y]);
        if (!point) {
          const t = (level - p.value) / (q.value - p.value);
          point = [p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t];
        }
        (above ? exits : entries).push(point);
      }
      for (let k = 0; k < Math.min(exits.length, entries.length); k++) segments.push([exits[k], entries[k]]);
    }
  return segments;
}

function levelSetBoundarySegments({xs,ys,values},level,refine){
  // A level set can meet the sampled domain boundary. Close its high side
  // along that boundary instead of implicitly joining an open contour by a chord.
  const border=[],segments=[];
  const sample=(i,j)=>({x:xs[i],y:ys[j],value:values[i][j]});
  for(let i=0;i<xs.length-1;i++)border.push(sample(i,0));
  for(let j=0;j<ys.length-1;j++)border.push(sample(xs.length-1,j));
  for(let i=xs.length-1;i>0;i--)border.push(sample(i,ys.length-1));
  for(let j=ys.length-1;j>0;j--)border.push(sample(0,j));
  for(let i=0;i<border.length;i++){
    const p=border[i],q=border[(i+1)%border.length],above=p.value>=level,next=q.value>=level;
    if(!above&&!next)continue;
    if(above&&next){segments.push([[p.x,p.y],[q.x,q.y]]);continue;}
    let point;
    if(refine&&(Math.abs(p.value)>=SENTINEL||Math.abs(q.value)>=SENTINEL))point=above?refine([p.x,p.y],[q.x,q.y]):refine([q.x,q.y],[p.x,p.y]);
    if(!point){const t=(level-p.value)/(q.value-p.value);point=[p.x+t*(q.x-p.x),p.y+t*(q.y-p.y)];}
    segments.push(above?[[p.x,p.y],point]:[point,[q.x,q.y]]);
  }
  return segments;
}
