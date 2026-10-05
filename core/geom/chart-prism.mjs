// A finite translated surface region is an owned volume. Membership stays in
// its native chart; other families may intersect it without a trimmed B-rep.
import {projectToPatch} from './field.mjs';
import {pointInRegion,pointSegmentDistance} from '../region/region2d.mjs';
import {normalize,cross,dot,requireThat} from './tolerance.mjs';
import {heightSlicePoint,heightReferenceRange,referenceHeight} from './height-slice.mjs';

export function chartPrism(reference,{loopsUv,direction,fromMm,toMm}){
  requireThat(['patch','height-field'].includes(reference.kind)&&fromMm<toMm&&loopsUv.length,'A chart prism needs a surface region and increasing translation bounds.');
  if(reference.kind==='height-field'){
    requireThat(Math.hypot(direction[0],direction[1])<1e-9&&direction[2]>0,'A height-field chart prism translates along positive Z.');
    const [low,high]=heightReferenceRange(reference.reference,loopsUv),points=loopsUv.flat(),min=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),low+reference.offsetMm+fromMm],max=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1])),high+reference.offsetMm+toMm];
    return {kind:'chart-prism',reference,loopsUv,direction:[0,0,1],fromMm,toMm,bounds:{min,max}};
  }
  const d=normalize(direction),seed=Math.abs(d[0])<.9?[1,0,0]:[0,1,0],x=normalize(seed.map((v,k)=>v-dot(seed,d)*d[k])),y=cross(d,x),axes=[x,y,d];
  const cp=Float64Array.from(reference.patch.cp),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<cp.length;i+=4){
    const p=[0,1,2].map(k=>cp[i+k]/cp[i+3]);
    for(let k=0;k<3;k++){cp[i+k]=dot(p,axes[k])*cp[i+3];for(const offset of [fromMm,toMm]){const value=p[k]+offset*d[k];min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);}}
  }
  return {kind:'chart-prism',reference,loopsUv,direction:d,fromMm,toMm,axes,projectedPatch:{...reference.patch,cp},bounds:{min,max}};
}

export function chartPrismContains(prism,point){
  if(point.some((v,k)=>v<prism.bounds.min[k]-1e-8||v>prism.bounds.max[k]+1e-8))return false;
  if(prism.reference.kind==='height-field'){
    const uv=point.slice(0,2);
    if(!pointInRegion(uv,prism.loopsUv))return false;
    // Sampled chart outlines can include a point just outside the source graph.
    // Such a membership query is empty; mapping a requested path there still
    // fails in heightSlicePoint. Invalid/folded references retain their errors.
    if(!referenceHeight(prism.reference.reference,...uv))return false;
    const surface=heightSlicePoint(prism.reference,uv),distance=point[2]-surface[2];
    return distance>prism.fromMm+1e-8&&distance<=prism.toMm+1e-8;
  }
  const p=prism.axes.map(axis=>dot(axis,point));
  return projectToPatch(prism.projectedPatch,p[0],p[1]).some(hit=>{
    const distance=p[2]-hit.point[2],uv=[hit.u,hit.v];
    if(distance<=prism.fromMm+1e-8||distance>prism.toMm+1e-8)return false;
    return pointInRegion(uv,prism.loopsUv)||prism.loopsUv.some(loop=>loop.some((a,i)=>pointSegmentDistance(uv,a,loop[(i+1)%loop.length])<=1e-8));
  });
}
