import {requireThat,dot,normalize,cross} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,PROGRAM_STEP_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {prepareSurfaceRay,surfaceRayIntersections} from '../geom/surface-ray.mjs';
import {pointInRegion} from './region2d.mjs';

const predecessorQueries=new WeakMap();
const preparePredecessors=(references,direction,sampleStepMm)=>{
  if(!predecessorQueries.has(references))predecessorQueries.set(references,new Map());
  const cached=predecessorQueries.get(references),key=JSON.stringify(direction);
  if(cached.has(key))return cached.get(key);
  const groups=new Map();
  for(const reference of references){
    const frame=reference.frame,parallel=frame&&frame.direction.every((v,k)=>Math.abs(v-direction[k])<=ROUNDING_RELATIVE);
    const surface=parallel?frame.base:reference.slice,groupKey=parallel?frame.base:reference;
    if(!groups.has(groupKey))groups.set(groupKey,{query:prepareSurfaceRay(surface,direction,{points:reference.region.flat(),sampleStepMm}),entries:[]});
    groups.get(groupKey).entries.push({id:reference.id,region:reference.region,offsetMm:parallel?frame.offsetMm:0});
  }
  const prepared=[...groups.values()];for(const group of prepared)group.entries.sort((a,b)=>a.offsetMm-b.offsetMm);
  cached.set(key,prepared);return prepared;
};

// Prepared normal thickness or translation advance defines every local gap.
// There is no completed-material query and no technique/surface dispatch.
export function sliceGapCurves(curves,surface,gap){
  requireThat(gap&&((Number.isFinite(gap.normalMm)&&gap.normalMm>0)||(Number.isFinite(gap.advanceMm)&&gap.advanceMm>0&&gap.direction)),'Slice needs an explicit positive gap description.');
  if(gap.normalMm!==undefined)return curves.map(curve=>({...curve,heightMm:gap.normalMm}));
  const direction=normalize(gap.direction),substrate=gap.substrate??null;
  if(substrate)requireThat(substrate.origin?.length===3&&substrate.origin.every(Number.isFinite)&&substrate.normal?.length===3&&substrate.normal.every(Number.isFinite),'A substrate plane needs a finite origin and normal.');
  const substrateNormal=substrate?normalize(substrate.normal):null,projection=substrateNormal?dot(direction,substrateNormal):0;
  const bounded=substrate&&Math.abs(projection)>ROUNDING_RELATIVE;
  const advanceAt=point=>bounded?Math.max(0,Math.min(gap.advanceMm,
    dot(point.map((v,k)=>v-substrate.origin[k]),substrateNormal)/projection)):gap.advanceMm;
  const boundaryAt=point=>dot(point.map((v,k)=>v-substrate.origin[k]),substrateNormal)-gap.advanceMm*projection;
  const references=gap.references?preparePredecessors(gap.references,direction,gap.sampleStepMm):[];
  const heightAt=uv=>{
    const e=evaluateSurface(surface,uv),cosine=dot(e.normal,direction);
    requireThat(cosine>ROUNDING_RELATIVE,'Stack direction is tangent to or reverses across its slice.');
    const local={advance:advanceAt(e.point),found:false};
    for(const group of references)for(const hit of surfaceRayIntersections(group.query,e.point)){
      let lo=0,hi=group.entries.length;
      while(lo<hi){const middle=(lo+hi)>>1;if(group.entries[middle].offsetMm<=hit.distanceMm+PRINT_RESOLUTION_MM)lo=middle+1;else hi=middle;}
      for(let index=lo-1;index>=0;index--){
        const reference=group.entries[index],distance=hit.distanceMm-reference.offsetMm;
        if(distance>local.advance+PRINT_RESOLUTION_MM)break;
        if(reference.id!==gap.referenceId&&pointInRegion(hit.chartPoint,reference.region)){local.advance=Math.max(0,Math.min(local.advance,distance));local.found=true;}
      }
    }
    if(gap.requiresReference&&!local.found)return 0;
    return local.advance*cosine;
  };
  return curves.map(curve=>{
    const source=curve.closed?[...curve.chartPoints,curve.chartPoints[0]]:curve.chartPoints;
    const chartPoints=[source[0]],originIndices=[];
    for(let i=1;i<source.length;i++){
      const a=evaluateSurface(surface,source[i-1]).point,b=evaluateSurface(surface,source[i]).point;
      if(gap.references){
        const addSamples=(lo,hi,ha,hb)=>{
          const middle=lo.map((v,k)=>(v+hi[k])/2),hm=heightAt(middle),length=Math.hypot(...evaluateSurface(surface,hi).point.map((v,k)=>v-evaluateSurface(surface,lo).point[k]));
          if(length>PROGRAM_STEP_MM&&(length>gap.sampleStepMm||Math.abs(hm-(ha+hb)/2)>PRINT_RESOLUTION_MM/16)){
            if(middle.some((v,k)=>v!==lo[k]&&v!==hi[k])){addSamples(lo,middle,ha,hm);addSamples(middle,hi,hm,hb);return;}
          }
          chartPoints.push(hi);originIndices.push(i-1);
        };
        addSamples(source[i-1],source[i],heightAt(source[i-1]),heightAt(source[i]));continue;
      }
      if(bounded&&boundaryAt(a)*boundaryAt(b)<0){
        let lo=0,hi=1;
        for(;;){const t=(lo+hi)/2,uv=source[i-1].map((v,k)=>v+t*(source[i][k]-v)),value=boundaryAt(evaluateSurface(surface,uv).point);
          if(Math.abs(value)<=PRINT_RESOLUTION_MM/16||t===lo||t===hi){chartPoints.push(uv);originIndices.push(i-1);break;}
          if(value*boundaryAt(a)>0)lo=t;else hi=t;
        }
      }
      chartPoints.push(source[i]);originIndices.push(i-1);
    }
    const samples=chartPoints.map(uv=>evaluateSurface(surface,uv));
    const heights=gap.references?chartPoints.map(heightAt):samples.map(e=>{
      const cosine=dot(e.normal,direction);
      requireThat(cosine>ROUNDING_RELATIVE,'Stack direction is tangent to or reverses across its slice.');
      const advance=advanceAt(e.point);
      return advance*cosine;
    });
    if(gap.references&&heights.every(h=>h<=0))return null;
    const uniform=Math.max(...heights)-Math.min(...heights)<=PRINT_RESOLUTION_MM/16;
    if(uniform&&heights[0]>0)return {...curve,heightMm:heights[0]};
    const heightsMm=heights.slice(1).map((h,i)=>(h+heights[i])/2);
    // Preserve process/cell data through nominal-gap and bed subdivisions.
    return {...curve,closed:false,points:samples.map(e=>e.point),chartPoints,normals:samples.map(e=>e.normal),
      frameSamples:curve.frameSamples?samples.map((e,i)=>{const u=normalize(e.du.map((v,k)=>v-dot(e.du,e.normal)*e.normal[k]));return {point:[...chartPoints[i],0],u,v:cross(e.normal,u),normal:e.normal};}):undefined,heightsMm,
      ...(curve.widthsMm?{widthsMm:originIndices.map(i=>curve.widthsMm[i])}:{}),
      ...(curve.flowMultipliers?{flowMultipliers:originIndices.map(i=>curve.flowMultipliers[i])}:{}),
      segmentMetadata:originIndices.map((index,i)=>({...curve.segmentMetadata?.[index],surfaceNormal:samples[i].normal,normalGapMm:heightsMm[i]}))};
  }).filter(curve=>curve!==null);
}
