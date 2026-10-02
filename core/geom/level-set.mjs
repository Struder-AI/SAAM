// Sampled scalar fields yield either genuine level contours or the bounded
// region at/above the level. Sampling and the meaning of the scalar belong to
// callers; both outputs share cell crossings and their topology.

import { requireThat, distance2, TOLERANCE } from './tolerance.mjs';
import { loopArea, dedupe } from '../region/region2d.mjs';

const CHAIN_TOLERANCE = 1e-7;

// Directed pieces keep the high side on the left. Regions require closure;
// contours can end at the sampled domain, without constructing border edges.
function chain(pieces, output) {
  const pool = pieces.map(piece => [...piece]).filter(piece => piece.length >= 2);
  const buckets=new Map(),ends=new Map(),used=new Set();
  const cell=p=>p.map(v=>Math.floor(v/CHAIN_TOLERANCE));
  for(let i=0;i<pool.length;i++){
    const key=cell(pool[i][0]).join('|');
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(i);
    if(output==='curves'){
      const endKey=cell(pool[i].at(-1)).join('|');
      if(!ends.has(endKey))ends.set(endKey,[]);
      ends.get(endKey).push(i);
    }
  }
  const neighbor=(tip,index,endpoint)=>{
    let best=-1,bestDistance=CHAIN_TOLERANCE;
    const [x,y]=cell(tip);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of index.get((x+dx)+'|'+(y+dy))??[]){
      if(used.has(i))continue;
      const d=distance2(tip,pool[i].at(endpoint));
      // Preserve the previous scan's last-index tie rule and output order.
      if(d<bestDistance||(d===bestDistance&&i>best)){bestDistance=d;best=i;}
    }
    return best;
  };
  const loops = [];
  // One bound for the whole walk: a shrinking pool must not cut a long contour
  // short half way round.
  const limit = pool.length + 2;
  for(let start=pool.length-1;start>=0;start--) {
    if(used.has(start))continue;
    let current = [...pool[start]];used.add(start);
    let guard = 0;
    while (distance2(current[0], current[current.length - 1]) > CHAIN_TOLERANCE && guard++ < limit) {
      const best=neighbor(current.at(-1),buckets,0);
      if (best < 0) break;
      used.add(best);current.push(...pool[best].slice(1));
    }
    if(output==='curves'){
      // The initial piece can be inside an open contour. Collect its prefix
      // backwards too, then flatten once to avoid repeated array prepends.
      const prefix=[];
      let head=current[0];
      while(distance2(head,current.at(-1))>CHAIN_TOLERANCE&&guard++<limit){
        const best=neighbor(head,ends,-1);
        if(best<0)break;
        used.add(best);prefix.push(pool[best].slice(0,-1));head=pool[best][0];
      }
      current=[...prefix.reverse().flat(),...current];
      const closed=distance2(current[0],current.at(-1))<=CHAIN_TOLERANCE;
      const points=[];
      for(const point of current)if(!points.length||distance2(points.at(-1),point)>TOLERANCE.point)points.push(point);
      if(closed)while(points.length>1&&distance2(points[0],points.at(-1))<=TOLERANCE.point)points.pop();
      if(closed?points.length>=3&&Math.abs(loopArea(points))>0:points.length>1)loops.push({points,closed});
      continue;
    }
    requireThat(distance2(current[0],current.at(-1))<=CHAIN_TOLERANCE,'Region operation produced an open contour.');
    const closed = dedupe(current);
    // Area is mm², so a chord tolerance in mm cannot decide whether material
    // exists. Retain every nonzero loop assembled on the endpoint grid.
    if (closed.length >= 3 && Math.abs(loopArea(closed)) > 0) loops.push(closed);
  }
  return loops;
}

// Grid points outside the sampled object carry a sentinel value. Interpolating
// linearly against a sentinel would put the boundary essentially on the last
// inside sample, so a `refine` callback may be supplied to locate that crossing
// against the real surface instead of the sampled field.
export const SENTINEL = 1e6;

// Classify the samples without constructing geometry. Uniform high fields
// produce a domain-sized region, but no genuine contour curves.
export function levelSetCoverage(field, level) {
  let min = Infinity, max = -Infinity;
  for (const column of field.values)
    for (const value of column) { if (value < min) min = value; if (value > max) max = value; }
  if (min >= level) return 'all';
  if (max < level) return 'none';
  return 'partial';
}

// Regions are oriented point loops, including the sampled domain's high-side
// boundary. Curves are ordinary {points,closed} polylines without that boundary.
// Equality belongs to the high side; ambiguous cells retain ordered exit/entry
// pairing. This is sampled topology, not a reconstruction of unsampled detail.
export function extractLevelSet(field, level, { output = 'region', refine = null } = {}) {
  const { xs, ys } = field;
  requireThat(xs.length > 1 && ys.length > 1, 'A level set needs a sampled grid.');
  requireThat(output==='region'||output==='curves','Choose level-set region or curves.');
  const interiorSegments=levelSetInteriorSegments(field,level,refine);
  if(output==='curves')return chain(interiorSegments,output);
  const boundarySegments=levelSetBoundarySegments(field,level,refine);
  return chain([...interiorSegments,...boundarySegments],output);
}

function crossingPoint(p,q,level,refine){
  const sentinel=Math.abs(p.value)>=SENTINEL||Math.abs(q.value)>=SENTINEL;
  if(sentinel&&refine){
    const point=p.value>=level?refine([p.x,p.y],[q.x,q.y]):refine([q.x,q.y],[p.x,p.y]);
    if(point)return point;
  }
  const t=(level-p.value)/(q.value-p.value);
  return [p.x+(q.x-p.x)*t,p.y+(q.y-p.y)*t];
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
        const point=crossingPoint(p,q,level,refine);
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
    const point=crossingPoint(p,q,level,refine);
    segments.push(above?[[p.x,p.y],point]:[point,[q.x,q.y]]);
  }
  return segments;
}
