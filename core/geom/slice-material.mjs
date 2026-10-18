// Nominal owned slice volumes, independent of emitted beads or machine motion.
// Native planes clip segments exactly in their chart. Evaluated charts use the
// same bounded ray representation as material preparation at print resolution.
import {prepareSurfaceRay,surfaceRayIntersections} from './surface-ray.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {clipLineToRegion} from './curve-region.mjs';
import {pointInRegion,pointSegmentDistance} from '../region/region2d.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {normalize,dot} from './tolerance.mjs';

const onRegion=(p,loops)=>pointInRegion(p,loops)||loops.some(loop=>loop.some((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<=ROUNDING_MM));

export function prepareSliceMaterial(layer,{sampleStepMm=.2}={}){
  const {slice,region}=layer;
  if(!slice||!region?.length)return null;
  const center=region[0][0],normal=evaluateSurface(slice,center).normal;
  const direction=normalize(layer.direction??layer.gap?.direction??normal);
  const advance=layer.translationMm??layer.gap?.advanceMm??(layer.heightMm??layer.gap?.normalMm)/Math.abs(dot(normal,direction));
  const points=slice.kind==='plane'?region.flat().flatMap(uv=>{const p=evaluateSurface(slice,uv).point;return [p,p.map((v,k)=>v-advance*direction[k])];}):null;
  const bounds=points?{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))}:null;
  return {slice,region,direction,advance,bounds,query:prepareSurfaceRay(slice,direction,{points:region.flat(),sampleStepMm})};
}

export function sliceMaterialTouches(material,points){
  if(!material||!points.length)return false;
  const {slice,region,advance,query}=material;
  if(material.bounds&&[0,1,2].some(k=>Math.max(...points.map(p=>p[k]))<material.bounds.min[k]-ROUNDING_MM||Math.min(...points.map(p=>p[k]))>material.bounds.max[k]+ROUNDING_MM))return false;
  const holds=hit=>hit.distanceMm>-advance+ROUNDING_MM&&hit.distanceMm<=ROUNDING_MM&&onRegion(hit.chartPoint,region);
  if(points.some(point=>surfaceRayIntersections(query,point).some(holds)))return true;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(slice.kind==='plane'){
      const first=surfaceRayIntersections(query,a)[0],last=surfaceRayIntersections(query,b)[0];
      if(!first||!last)continue;
      const delta=last.distanceMm-first.distanceMm;
      let low=0,high=1;
      if(delta===0){if(first.distanceMm<=-advance+ROUNDING_MM||first.distanceMm>ROUNDING_MM)continue;}
      else {
        const cuts=[(-advance+ROUNDING_MM-first.distanceMm)/delta,(ROUNDING_MM-first.distanceMm)/delta].sort((x,y)=>x-y);
        low=Math.max(low,cuts[0]);high=Math.min(high,cuts[1]);if(low>=high)continue;
      }
      const d=last.chartPoint.map((v,k)=>v-first.chartPoint[k]);
      if(Math.hypot(...d)===0){if(onRegion(first.chartPoint,region))return true;continue;}
      const clipped=clipLineToRegion(first.chartPoint,d,region,{range:[low,high]});
      if([...clipped.spans,...clipped.contacts].some(([lo,hi])=>hi>lo))return true;
    }else{
      // Curved chart projection is nonlinear. Retain every print-resolution
      // footprint sample rather than inferring an affine chart from endpoints.
      const count=Math.ceil(Math.hypot(...b.map((v,k)=>v-a[k]))/PRINT_RESOLUTION_MM);
      for(let j=1;j<count;j++)if(surfaceRayIntersections(query,a.map((v,k)=>v+(b[k]-v)*j/count)).some(holds))return true;
    }
  }
  return false;
}
