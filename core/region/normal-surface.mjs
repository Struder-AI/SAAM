// Shared ambient normal offsets. Distinct from intrinsic boundary offsets.
// Mesh strips use interpolated selected-face vertex normals (an explicitly
// smooth normal field over faceted positions); native splines retain derivatives.
import {add,scale,distance,requireThat} from '../geom/tolerance.mjs';
export function normalSurfacePoint(chart,u,v,offsetMm){
  requireThat(Number.isFinite(offsetMm),'Surface offset must be finite.');
  const e=chart.at(u,v);return {...e,reference:e.point,point:add(e.point,scale(e.normal,offsetMm)),u,v};
}
export function sampleSurfaceCurve(chart,uvAt,offsetMm,{toleranceMm=.01,maxStepMm=1}={}){
  const at=t=>{const p={...normalSurfacePoint(chart,...uvAt(t),offsetMm),t};requireThat(p.point.every(Number.isFinite),'Surface sampling reached a point the chart cannot evaluate.');return p;};
  const first=at(0),last=at(1),out=[first];
  const split=(a,b,midpoint=null)=>{
    // Parent quarter points are the children's midpoints. Retain their native
    // parameters and derivatives instead of solving the same surface again.
    const ts=[.25,.5,.75],q=ts.map(t=>t===.5&&midpoint?midpoint:at(a.t+(b.t-a.t)*t));
    const error=Math.max(...q.map((p,i)=>distance(p.point,a.point.map((x,k)=>x+(b.point[k]-x)*ts[i]))));
    if(error<=toleranceMm&&distance(a.point,b.point)<=maxStepMm){out.push(b);return;}
    requireThat(q[1].t>a.t&&q[1].t<b.t,'Surface offset sampling cannot refine further: its parameter midpoint is no longer distinct from the interval ends.');split(a,q[1],q[0]);split(q[1],b,q[2]);
  };
  split(first,last);return out;
}
