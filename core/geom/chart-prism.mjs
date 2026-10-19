// A finite translated surface region is an owned volume. Membership stays in
// its native chart; other families may intersect it without a trimmed B-rep.
import {projectToPatch} from './field.mjs';
import {pointInRegion,pointSegmentDistance} from '../region/region2d.mjs';
import {normalize,cross,dot,requireThat,TOLERANCE} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

export function chartPrism(reference,{loopsUv,direction,fromMm,toMm}){
  requireThat(reference.kind==='patch'&&fromMm<toMm&&loopsUv.length,'A chart prism needs a surface region and increasing translation bounds.');
  const d=normalize(direction),seed=Math.abs(d[0])<.9?[1,0,0]:[0,1,0],x=normalize(seed.map((v,k)=>v-dot(seed,d)*d[k])),y=cross(d,x),axes=[x,y,d];
  const cp=Float64Array.from(reference.patch.cp),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<cp.length;i+=4){
    const p=[0,1,2].map(k=>cp[i+k]/cp[i+3]);
    for(let k=0;k<3;k++){cp[i+k]=dot(p,axes[k])*cp[i+3];for(const offset of [fromMm,toMm]){const value=p[k]+offset*d[k];min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);}}
  }
  return {kind:'chart-prism',reference,loopsUv,direction:d,fromMm,toMm,axes,projectedPatch:{...reference.patch,cp},bounds:{min,max}};
}

export function chartPrismContains(prism,point,{boundaryToleranceMm=PRINT_RESOLUTION_MM}={}){
  if(point.some((v,k)=>v<prism.bounds.min[k]-PRINT_RESOLUTION_MM||v>prism.bounds.max[k]+PRINT_RESOLUTION_MM))return false;
  const p=prism.axes.map(axis=>dot(axis,point));
  return projectToPatch(prism.projectedPatch,p[0],p[1]).some(hit=>{
    const distance=p[2]-hit.point[2],uv=[hit.u,hit.v];
    if(distance<=prism.fromMm+boundaryToleranceMm||distance>prism.toMm+boundaryToleranceMm)return false;
    return pointInRegion(uv,prism.loopsUv)||prism.loopsUv.some(loop=>loop.some((a,i)=>pointSegmentDistance(uv,a,loop[(i+1)%loop.length])<=TOLERANCE.parameter));
  });
}
