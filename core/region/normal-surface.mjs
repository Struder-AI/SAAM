// Shared ambient normal offsets. Distinct from intrinsic boundary offsets.
// Mesh strips use interpolated selected-face vertex normals (an explicitly
// smooth normal field over faceted positions); native splines retain derivatives.
import {add,scale,distance,requireThat} from '../geom/tolerance.mjs';
export function normalSurfacePoint(chart,u,v,offsetMm){
  requireThat(Number.isFinite(offsetMm),'Surface offset must be finite.');
  const e=chart.at(u,v);return {...e,reference:e.point,point:add(e.point,scale(e.normal,offsetMm)),u,v};
}
export function sampleSurfaceCurve(chart,uvAt,offsetMm,{toleranceMm=.01,maxStepMm=1,maxPoints=100000}={}){
  let calls=0;const at=t=>{requireThat(++calls<=maxPoints,'Surface sampling exhausted maxPoints; increase the cladding budget.');return {...normalSurfacePoint(chart,...uvAt(t),offsetMm),t};};
  const first=at(0),last=at(1),out=[first];
  const split=(a,b,depth=0,midpoint=null)=>{
    // Parent quarter points are the children's midpoints. Retain their native
    // parameters and derivatives instead of solving the same surface again.
    const ts=[.25,.5,.75],q=ts.map(t=>t===.5&&midpoint?midpoint:at(a.t+(b.t-a.t)*t));
    const error=Math.max(...q.map((p,i)=>distance(p.point,a.point.map((x,k)=>x+(b.point[k]-x)*ts[i]))));
    if(error<=toleranceMm&&distance(a.point,b.point)<=maxStepMm){out.push(b);return;}
    requireThat(depth<25,'Surface offset sampling failed to converge.');split(a,q[1],depth+1,q[0]);split(q[1],b,depth+1,q[2]);
  };
  split(first,last);return out;
}
