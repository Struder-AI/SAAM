import {pointInRegion,pointSegmentDistance,segmentIntersection} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {TOLERANCE} from '../geom/tolerance.mjs';
const span=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

// Prepared for one fixed layer, like its segment index. Share the closure when
// the composer copies a policy for individual travels; build only if needed.
export function prepareCombCorners(loops,clearance) {
  let corners;
  return ()=>corners??=offsetRegion(loops,-(clearance+0.05)).flat();
}
export function combSegment(a,b,policy) {
  const loops=policy.combRegion,clear=policy.combClearanceMm??0;
  const index=policy.combIndex,inside=p=>index?index.contains(p):pointInRegion(p,loops);
  if(!loops||!inside(a)||!inside(b)||!inside([(a[0]+b[0])/2,(a[1]+b[1])/2]))return false;
  const threshold=Math.max(clear,1e-8)-Math.min(clear/2,TOLERANCE.plane);
  // Only boundary segments in the swept travel box can cross or approach it.
  const edges=index?index.inBox([Math.min(a[0],b[0])-threshold,Math.min(a[1],b[1])-threshold],
    [Math.max(a[0],b[0])+threshold,Math.max(a[1],b[1])+threshold]):loops.flatMap(loop=>loop.map((c,i)=>[c,loop[(i+1)%loop.length]]));
  for(const [c,d] of edges){
    if(segmentIntersection(a,b,c,d))return false;
    const distance=Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
    if(distance<threshold)return false;
  }
  return true;
}

// Bounded visibility graph inside an inset region. Failure falls back to a hop.
export function combRoute(from,to,policy) {
  if(policy.canTravelDirect||!policy.combRegion||!(policy.maxCombMm>0)||Math.abs(from[2]-to[2])>1e-9||span(from,to)>policy.maxCombMm)return null;
  const a=from.slice(0,2),b=to.slice(0,2);
  if(combSegment(a,b,policy))return [to];
  // Leave margin for the offset routine's 0.02 mm arc chord approximation.
  const corners=policy.combCorners?policy.combCorners():offsetRegion(policy.combRegion,-((policy.combClearanceMm??0)+0.05)).flat();
  if(corners.length>256)return null;
  const nodes=[a,b,...corners],cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();cost[0]=0;
  for(let step=0;step<nodes.length;step++){
    let best=-1;
    for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(best<0||cost[i]<cost[best]))best=i;
    if(best<0||cost[best]>policy.maxCombMm)return null;
    if(best===1){const route=[];for(let i=1;i!==0;i=previous[i])route.unshift([...nodes[i],to[2]]);return route;}
    visited.add(best);
    for(let i=0;i<nodes.length;i++)if(!visited.has(i)){
      const candidate=cost[best]+span(nodes[best],nodes[i]);
      if(candidate<cost[i]&&candidate<=policy.maxCombMm&&combSegment(nodes[best],nodes[i],policy)){cost[i]=candidate;previous[i]=best;}
    }
  }
  return null;
}
