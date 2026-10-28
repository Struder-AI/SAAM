// Locate a spatial curve in the finite material bands of prepared slices.
import {controlCurve} from './curve-controls.mjs';
import {curvePlaneIntersections} from './curve-ops.mjs';
import {curvePoint} from './surface-curves.mjs';
import {prepareSurfaceRay,surfaceRayIntersections} from './surface-ray.mjs';
import {pointInRegion,pointSegmentDistance} from '../region/region2d.mjs';
import {sampleSpatialCurve} from './spatial-curve.mjs';
import {dot} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {clipLineToRegion} from './curve-region.mjs';

export function curveSliceContacts(curve,layers,{sampleStepMm,includeRanges=false}){
  const native=controlCurve(curve),[start,end]=native.domain;
  const inRegion=(point,region)=>pointInRegion(point,region)||region.some(loop=>loop.some((a,i)=>pointSegmentDistance(point,a,loop[(i+1)%loop.length])<=PRINT_RESOLUTION_MM));
  const contacts=[];
  for(const layer of layers){
    if(!layer.region.length)continue;
    const direction=layer.direction??layer.slice.normal??[0,0,1],depth=layer.translationMm??layer.heightMm;
    const ray=prepareSurfaceRay(layer.slice,direction,{points:layer.region.flat(),sampleStepMm});
    const touches=point=>surfaceRayIntersections(ray,point).some(hit=>hit.distanceMm>=-depth-PRINT_RESOLUTION_MM&&hit.distanceMm<=PRINT_RESOLUTION_MM&&inRegion(hit.chartPoint,layer.region));
    const intervals=[];
    if(layer.slice.kind==='plane'){
      const normal=layer.slice.normal,offset=dot(normal,layer.slice.origin),bottom=offset-depth*dot(normal,direction);
      const low=curvePlaneIntersections(native,{normal,offset:bottom}),high=curvePlaneIntersections(native,{normal,offset});
      const cuts=[...new Set([start,end,...native.knots.filter(t=>t>start&&t<end),...low.parameters,...high.parameters,
        ...low.coincident.flat(),...high.coincident.flat()])].sort((a,b)=>a-b);
      const probes=[...cuts,...cuts.slice(1).map((to,i)=>(cuts[i]+to)/2)];
      cuts.slice(1).forEach((to,i)=>{
        const from=cuts[i],mid=curvePoint(native,((from+to)/2-start)/(end-start)),signed=dot(normal,mid)-offset;
        if(signed<-depth*dot(normal,direction)-PRINT_RESOLUTION_MM||signed>PRINT_RESOLUTION_MM)return;
        const a=surfaceRayIntersections(ray,curvePoint(native,(from-start)/(end-start)))[0]?.chartPoint;
        const b=surfaceRayIntersections(ray,curvePoint(native,(to-start)/(end-start)))[0]?.chartPoint;
        if(!a||!b)return;
        const delta=b.map((v,k)=>v-a[k]);
        if(Math.hypot(...delta)<=PRINT_RESOLUTION_MM){if(inRegion(a,layer.region))intervals.push([(from-start)/(end-start),(to-start)/(end-start)]);return;}
        const clipped=clipLineToRegion(a,delta,layer.region,{range:[0,1]});
        const kept=[...clipped.spans,...clipped.contacts];
        if(!kept.length&&inRegion(a.map((v,k)=>(v+b[k])/2),layer.region))kept.push([0,1]);
        for(const [lo,hi] of kept)intervals.push([(from+(to-from)*lo-start)/(end-start),(from+(to-from)*hi-start)/(end-start)]);
      });
      for(const t of probes)if(touches(curvePoint(native,(t-start)/(end-start))))intervals.push([(t-start)/(end-start),(t-start)/(end-start)]);
    }else{
      const samples=sampleSpatialCurve(curve,{toleranceMm:PRINT_RESOLUTION_MM/4,sampleStepMm:Math.min(sampleStepMm,layer.heightMm/2)}).samples;
      for(const [i,sample] of samples.entries())if(touches(sample.point))intervals.push([samples[Math.max(0,i-1)].t,samples[Math.min(samples.length-1,i+1)].t]);
    }
    intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const merged=[];
    for(const interval of intervals){const last=merged.at(-1);if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else merged.push(interval);}
    if(merged.length)contacts.push(includeRanges?{index:layer.index,ranges:merged}:layer.index);
  }
  return contacts;
}
