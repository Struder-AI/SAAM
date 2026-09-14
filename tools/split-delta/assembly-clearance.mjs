import {sub,dot,railBodyPoint} from '../../core/machine/split-delta.mjs';
export {railBodyPoint};

const clamp=x=>Math.max(0,Math.min(1,x));
// Minimum distance between finite segments: interior stationary point plus
// the four boundary minima. This also handles parallel and zero-length segments.
export function segmentDistance(p,q,r,s){
  const u=sub(q,p),v=sub(s,r),w=sub(p,r),a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w);
  const candidates=[[0,c?clamp(e/c):0],[1,c?clamp((e+b)/c):0],[a?clamp(-d/a):0,0],[a?clamp((b-d)/a):0,1]],det=a*c-b*b;
  if(det>1e-12*a*c){const t=(b*e-c*d)/det,h=(a*e-b*d)/det;if(t>=0&&t<=1&&h>=0&&h<=1)candidates.push([t,h]);}
  return Math.min(...candidates.map(([t,h])=>Math.hypot(...w.map((x,i)=>x+t*u[i]-h*v[i]))));
}

export const CLEARANCE={railRadiusMm:10,gapMm:1,railMountOffsetMm:25};
// The spherical pivot sits on an inward mounting bracket, not inside the rail.
// Kinematic rail coordinates describe that pivot's straight trajectory.
// Rails retain their full configured extent, even when the viewer trims them.
// Every rod/rail pair, including its own rail, uses the full rod length.
// No nozzle, plate, carriage housing, socket body, drive or frame beam model.
export function assemblyClearance(g,state,{stopEarly=true,...options}={}){
  const opts={...CLEARANCE,...options},rr=g.rodDiameterMm/2;
  let minGapMm=Infinity,worst=null;
  const record=(gap,kind,i,j)=>{if(gap<minGapMm){minGapMm=gap;worst={kind,i,j,gapMm:gap};}return gap<opts.gapMm;};
  for(let i=0;i<6;i++){
    if(record(Math.min(state.points[i][2],state.carriages[i][2])-rr,'rod-bed',i,null)&&stopEarly)return {passed:false,minGapMm,worst};
    for(let j=0;j<i;j++)if(record(segmentDistance(state.points[i],state.carriages[i],state.points[j],state.carriages[j])-2*rr,'rod-rod',i,j)&&stopEarly)return {passed:false,minGapMm,worst};
    for(let j=0;j<6;j++){
      if(record(segmentDistance(state.points[i],state.carriages[i],railBodyPoint(g,j,g.railMinMm),railBodyPoint(g,j,g.railMaxMm))-rr-opts.railRadiusMm,'rod-rail',i,j)&&stopEarly)return {passed:false,minGapMm,worst};
    }
  }
  return {passed:minGapMm>=opts.gapMm,minGapMm,worst};
}
