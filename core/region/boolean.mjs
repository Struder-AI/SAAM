// Boolean operations on planar regions.
//
// This is where several solids meet: rather than building a boolean B-rep, each
// solid is sectioned on its own and the layers are combined here. A slicer only
// ever needs the result one layer at a time, so the hard 3D problem - surface
// intersection curves and tolerance-consistent shell stitching - never has to
// be posed. The same operation reserves material under a top surface, by
// intersecting a section with the level set of the reserve height.
//
// Method: split every loop of A where it crosses a loop of B (and the reverse),
// classify each resulting piece by whether its midpoint lies inside the other
// region, keep the pieces the operation calls for, and chain them back into
// closed loops.
//
// Coincident/collinear edges are split into an arrangement and classified on
// both sides, so repeated section boundaries do not need artificial nudges.

import { TOLERANCE, requireThat, distance2 } from '../geom/tolerance.mjs';
import { pointInRegion, loopArea, dedupe } from './region2d.mjs';

const CHAIN_TOLERANCE = 1e-7;

export const union = (a, b) => combine(a, b, 'union');
export const intersect = (a, b) => combine(a, b, 'intersect');
export const difference = (a, b) => combine(a, b, 'difference');

function combine(a, b, operation) {
  const left = a.map(dedupe).filter(loop => loop.length >= 3);
  const right = b.map(dedupe).filter(loop => loop.length >= 3);
  if (!left.length) return operation === 'union' ? right.map(loop => [...loop]) : [];
  if (!right.length) return operation === 'intersect' ? [] : left.map(loop => [...loop]);

  // Classify both sides of every arrangement edge. This also handles identical
  // sections and shared/collinear edges, which local top/bottom masks need.
  const segments=[...left,...right].flatMap(loop=>loop.map((p,i)=>[p,loop[(i+1)%loop.length]]));
  const result=new Map();
  const contains=p=>{const l=pointInRegion(p,left),r=pointInRegion(p,right);return operation==='union'?l||r:operation==='intersect'?l&&r:l&&!r;};
  const key=p=>p.map(v=>Math.round(v/1e-7)).join(',');
  for(const [p,q] of segments){
    const dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);if(length<1e-8)continue;
    const cuts=[0,1];
    for(const [c,d] of segments){
      const ex=d[0]-c[0],ey=d[1]-c[1],ax=c[0]-p[0],ay=c[1]-p[1],det=dx*ey-dy*ex;
      if(Math.abs(det)>1e-12){
        const t=(ax*ey-ay*ex)/det,u=(ax*dy-ay*dx)/det;
        if(t>1e-9&&t<1-1e-9&&u>=-1e-9&&u<=1+1e-9)cuts.push(t);
      } else if(Math.abs(ax*dy-ay*dx)<1e-8*length)for(const v of [c,d]){
        const t=((v[0]-p[0])*dx+(v[1]-p[1])*dy)/(length*length);if(t>1e-9&&t<1-1e-9)cuts.push(t);
      }
    }
    cuts.sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++){
      if((cuts[i]-cuts[i-1])*length<1e-7)continue;
      const start=[p[0]+dx*cuts[i-1],p[1]+dy*cuts[i-1]],end=[p[0]+dx*cuts[i],p[1]+dy*cuts[i]],mid=[(start[0]+end[0])/2,(start[1]+end[1])/2];
      const epsilon=1e-7,l=contains([mid[0]-dy/length*epsilon,mid[1]+dx/length*epsilon]),r=contains([mid[0]+dy/length*epsilon,mid[1]-dx/length*epsilon]);
      if(l===r)continue;
      const edge=l?[start,end]:[end,start];result.set(key(edge[0])+'>'+key(edge[1]),edge);
    }
  }
  return chain([...result.values()]);
}

// Reassemble kept pieces into closed loops end to end.
function chain(pieces) {
  const pool = pieces.map(piece => [...piece]).filter(piece => piece.length >= 2);
  const loops = [];
  // One bound for the whole walk: a shrinking pool must not cut a long contour
  // short half way round.
  const limit = pool.length + 2;
  while (pool.length) {
    let current = pool.pop();
    let guard = 0;
    while (distance2(current[0], current[current.length - 1]) > CHAIN_TOLERANCE && guard++ < limit) {
      const tip = current[current.length - 1];
      let best = -1, bestDistance = CHAIN_TOLERANCE;
      for (let i = 0; i < pool.length; i++) {
        const d = distance2(tip, pool[i][0]);
        if (d <= bestDistance) { bestDistance = d; best = i; }
      }
      if (best < 0) break;
      current.push(...pool.splice(best, 1)[0].slice(1));
    }
    requireThat(distance2(current[0],current[current.length-1])<=CHAIN_TOLERANCE,'Region operation produced an open contour.');
    const closed = dedupe(current);
    if (closed.length >= 3 && Math.abs(loopArea(closed)) > TOLERANCE.chord) loops.push(closed);
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
  const { xs, ys, values } = field;
  requireThat(xs.length > 1 && ys.length > 1, 'A level set needs a sampled grid.');
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
  // A level set can meet the sampled domain boundary. Close its high side
  // along that boundary instead of implicitly joining an open contour by a chord.
  const border=[];
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
  return chain(segments.map(segment => [...segment]));
}
