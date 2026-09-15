import {pointInRegion,pointSegmentDistance,segmentIntersection,regionComponents} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {TOLERANCE} from '../geom/tolerance.mjs';
const span=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

// Prepared for one fixed layer, like its segment index. Share the closure when
// the composer copies a policy for individual travels; build only if needed.
export function prepareCombCorners(loops,clearance) {
  let corners,components;
  const prepared=new Map();
  return (from,to)=>{
    if(!from||!to)return corners??=offsetRegion(loops,-(clearance+0.05)).flat();
    components??=regionComponents(loops);
    const component=components.find(region=>pointInRegion(from,region)&&pointInRegion(to,region));
    if(!component)return [];
    if(!prepared.has(component))prepared.set(component,offsetRegion(component,-(clearance+0.05)).flat());
    return prepared.get(component);
  };
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
  if(!policy.combRegion||!(policy.maxCombMm>0)||(!policy.combSurfaceZ&&Math.abs(from[2]-to[2])>1e-9)||span(from,to)>policy.maxCombMm)return null;
  if(policy.combSurfaceZ&&!(Number.isFinite(policy.combStepMm)&&policy.combStepMm>0))return null;
  // A graph cannot repair an endpoint outside its usable footprint/surface.
  // Reject it before evaluating heights at hundreds of unreachable corners.
  if(!combSegment(from,from,policy)||!combSegment(to,to,policy))return null;
  if(policy.canTravelDirect&&(!policy.canTravelDirect(from,from,policy.maxCombMm)||!policy.canTravelDirect(to,to,policy.maxCombMm)))return null;
  // Build and check the actual emitted XYZ polyline for every visibility edge.
  // A clear endpoint chord never authorizes an unchecked detour over a deposit.
  const edge=(a,b)=>{
    if(!a||!b||!combSegment(a,b,policy))return null;
    const steps=policy.combSurfaceZ?Math.max(1,Math.ceil(span(a,b)/policy.combStepMm)):1;
    const points=[];let previous=a,length=0;
    for(let i=1;i<=steps;i++){
      const t=i/steps,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
      const point=i===steps?b:[x,y,policy.combSurfaceZ(x,y)];
      if(!point.every(Number.isFinite)||(policy.canTravelDirect&&!policy.canTravelDirect(previous,point,policy.maxCombMm))
        ||(policy.isTravelClear&&!policy.isTravelClear(previous,point)))return null;
      length+=Math.hypot(...point.map((v,j)=>v-previous[j]));points.push(point);previous=point;
    }
    return {points,length};
  };
  const direct=edge(from,to);
  if(direct&&direct.length<=policy.maxCombMm)return direct.points;
  // Leave margin for the offset routine's 0.02 mm arc chord approximation.
  const corners=policy.combCorners?policy.combCorners(from,to):offsetRegion(policy.combRegion,-((policy.combClearanceMm??0)+0.05)).flat();
  if(corners.length>256)return null;
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  // Triangle inequality excludes corners/edges that cannot reach the target
  // within the route budget, before expensive surface/material queries.
  const nodes=[from,to,...corners.filter(p=>span(from,p)+span(p,to)<=policy.maxCombMm)
    .map(([x,y])=>[x,y,policy.combSurfaceZ?policy.combSurfaceZ(x,y):to[2]])
    .filter(p=>p.every(Number.isFinite)&&distance(from,p)+distance(p,to)<=policy.maxCombMm)];
  const cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),edges=[],visited=new Set();cost[0]=0;
  for(let step=0;step<nodes.length;step++){
    let best=-1;
    for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(best<0||cost[i]<cost[best]))best=i;
    if(best<0||cost[best]>policy.maxCombMm)return null;
    if(best===1){const route=[];for(let i=1;i!==0;i=previous[i])route.unshift(...edges[i]);return route;}
    visited.add(best);
    for(let i=0;i<nodes.length;i++)if(!visited.has(i)){
      const lowerBound=cost[best]+distance(nodes[best],nodes[i]);
      if(lowerBound>=cost[i]||lowerBound+distance(nodes[i],to)>policy.maxCombMm)continue;
      const connection=edge(nodes[best],nodes[i]);
      if(!connection)continue;
      const candidate=cost[best]+connection.length;
      if(candidate<cost[i]&&candidate<=policy.maxCombMm){cost[i]=candidate;previous[i]=best;edges[i]=connection.points;}
    }
  }
  return null;
}
