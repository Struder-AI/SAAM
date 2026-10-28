// Area-weighted physical normals over a finite reference. Curved/evaluated
// charts retain sampled quadrature evidence, not a certified extrema bound.
import {evaluateSurface,surfaceChartCovers} from './surface-evaluation.mjs';
import {cross,dot,requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {intersect} from '../region/intersection.mjs';
import {regionArea} from '../region/region2d.mjs';

export function surfaceMeanNormal(surface,region=null,{boundsUv,sampleStepMm=.5,direction=null,counts=null}={}){
  const native=surface.patch??surface,bounds=boundsUv??[native.domainU,native.domainV];
  requireThat(bounds.every(b=>b?.length===2&&b.every(Number.isFinite)&&b[1]>b[0]),'Reference mean normal needs a finite chart area.');
  requireThat(Number.isFinite(sampleStepMm)&&sampleStepMm>0,'Reference mean normal needs a positive physical sample step.');
  const spans=bounds.map(b=>b[1]-b[0]),uvAt=p=>p.map((v,k)=>bounds[k][0]+v*spans[k]);
  // Only this clipping workspace is normalized. Retained charts and their
  // native derivative units are unchanged by the quadrature.
  const normalized=region?.map(loop=>loop.map(p=>p.map((v,k)=>(v-bounds[k][0])/spans[k])));
  const areaAt=e=>{
    requireThat(e.normal&&e.du&&e.dv,'Reference mean normal has a singular sampled tangent.');
    const area=Math.hypot(...cross(e.du.map(v=>v*spans[0]),e.dv.map(v=>v*spans[1])));
    requireThat(Number.isFinite(area)&&area>0,'Reference mean normal has a singular sampled area.');
    return area;
  };
  const empty=evidence=>({normal:null,meanNormal:null,areaMm2:0,sampleStepMm,evidence});
  if(surface.kind==='plane'){
    const e=evaluateSurface(surface,uvAt([.5,.5])),areaMm2=areaAt(e)*(normalized?regionArea(normalized):1),evidence={method:'exact-plane',samples:1};
    if(region&&areaMm2<=PRINT_RESOLUTION_MM**2)return empty(evidence);
    requireThat(areaMm2>0,'The reference surface has no area.');
    return {normal:[...e.normal],meanNormal:[...e.normal],areaMm2,sampleStepMm,evidence,
      ...(direction?{minProjection:dot(e.normal,direction),maxProjection:dot(e.normal,direction)}:{})};
  }
  let metricSamples=0;
  if(!counts){
    const extents=[0,0];
    for(let i=0;i<5;i++)for(let j=0;j<5;j++){
      const uv=uvAt([(i+.5)/5,(j+.5)/5]);if(!surfaceChartCovers(surface,uv))continue;
      const e=evaluateSurface(surface,uv);metricSamples++;
      requireThat(e.du&&e.dv,'Reference sampling requires first chart derivatives.');
      extents[0]=Math.max(extents[0],Math.hypot(...e.du)*spans[0]);
      extents[1]=Math.max(extents[1],Math.hypot(...e.dv)*spans[1]);
    }
    requireThat(extents.every(v=>Number.isFinite(v)&&v>0),'Reference sampling metric is singular or uncovered.');
    counts=extents.map(length=>Math.max(2,Math.ceil(length/sampleStepMm)));
  }
  requireThat(counts.length===2&&counts.every(n=>Number.isSafeInteger(n)&&n>0),'Reference sampling counts exceed exact integer representation.');
  const sum=[0,0,0];let areaMm2=0,samples=0,minProjection=Infinity,maxProjection=-Infinity;
  for(let i=0;i<counts[0];i++)for(let j=0;j<counts[1];j++){
    const a=i/counts[0],b=(i+1)/counts[0],c=j/counts[1],d=(j+1)/counts[1];
    const weight=normalized?regionArea(intersect(normalized,[[[a,c],[b,c],[b,d],[a,d]]])):1/counts[0]/counts[1];
    if(!weight)continue;
    const e=evaluateSurface(surface,uvAt([(a+b)/2,(c+d)/2])),area=areaAt(e)*weight;samples++;
    for(let k=0;k<3;k++)sum[k]+=e.normal[k]*area;
    areaMm2+=area;
    if(direction){const projection=dot(e.normal,direction);minProjection=Math.min(minProjection,projection);maxProjection=Math.max(maxProjection,projection);}
  }
  const evidence={method:'sampled-area-midpoint',counts:[...counts],samples,metricSamples,sampleStepMm,
    metric:metricSamples?'sampled-chart-tangents':'native-control-net',projectionRange:'sampled-only'};
  if(region&&areaMm2<=PRINT_RESOLUTION_MM**2)return empty(evidence);
  const length=Math.hypot(...sum);
  requireThat(areaMm2>0&&length>areaMm2*ROUNDING_RELATIVE,'The reference surface has no unambiguous mean stacking normal; specify stack.direction.');
  return {normal:sum.map(v=>v/length),meanNormal:sum.map(v=>v/areaMm2),areaMm2,sampleStepMm,evidence,
    ...(direction?{minProjection,maxProjection}:{})};
}
