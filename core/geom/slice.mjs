import {evaluateSurface} from './surface-evaluation.mjs';
// Slices: surfaces that cut a solid and give its toolpath a reference. A slice
// is a plain record with a 2D chart. section(geometry, slice) returns the
// solid's region on it as loops in that chart (outer loops counterclockwise,
// holes clockwise, seen from the slice normal), and evaluateSurface maps chart
// points back to XYZ.
//
//  plane  {origin, normal, xAxis, yAxis}: the orthonormal chart
//         p = origin + a·xAxis + b·yAxis. It is isometric, so planar region
//         code, the XY-plane curve offset included, runs on it unchanged. The
//         horizontal plane is the identity chart at height z: chart = XY.
//  patch  {patch}: a NURBS patch; the chart is its (u,v), the curve offset's
//         surface mode. Its region is where it lies inside the solid
//         (surface-surface intersection, ../region/section.mjs).
//  height-field {reference, offsetMm, normalDepthMm}: native roof/spline
//         evaluation in world XY; sampled topology with refined boundaries.
//
// A family stacks one base slice: layer k is the base translated along a
// direction, so every layer keeps the same chart and a chart point names the
// same column of material in every layer. Neighbouring layers therefore
// compare by 2D booleans alone.
import { heightSlicePoint, heightReferenceBounds,heightReferenceMetric } from './height-slice.mjs';
import { evaluate } from './nurbs.mjs';
import {projectToPatch} from './field.mjs';
import { regionArea } from '../region/region2d.mjs';
import { intersect } from '../region/intersection.mjs';
import { requireThat, add, scale, dot, cross, normalize } from './tolerance.mjs';

const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

export function prepareSliceRay(slice,direction){
  const d=normalize(direction);
  if(slice.kind!=='patch')return {slice,direction:d};
  const seed=Math.abs(d[0])<.9?[1,0,0]:[0,1,0],x=normalize(seed.map((v,k)=>v-dot(seed,d)*d[k])),axes=[x,cross(d,x),d],cp=Float64Array.from(slice.patch.cp);
  for(let i=0;i<cp.length;i+=4){const point=[0,1,2].map(k=>cp[i+k]/cp[i+3]);for(let k=0;k<3;k++)cp[i+k]=dot(point,axes[k])*cp[i+3];}
  return {slice,direction:d,axes,patch:{...slice.patch,cp}};
}

// Signed distance from point backwards along direction, with native chart data.
export function sliceRayIntersections(prepared,point){
  const {slice,direction:d}=prepared;
  if(slice.kind==='patch'){
    const p=prepared.axes.map(axis=>dot(axis,point));
    return projectToPatch(prepared.patch,p[0],p[1]).map(hit=>({distanceMm:p[2]-hit.point[2],chartPoint:[hit.u,hit.v]}));
  }
  if(slice.kind==='height-field'){
    requireThat(Math.hypot(d[0],d[1])<1e-8,'A height-field nominal-course query requires its vertical stack direction.');
    const chartPoint=point.slice(0,2),surface=heightSlicePoint(slice,chartPoint);
    return [{distanceMm:(point[2]-surface[2])/d[2],chartPoint}];
  }
  const denominator=dot(slice.normal,d);if(Math.abs(denominator)<1e-9)return [];
  const distanceMm=dot(slice.normal,point.map((v,k)=>v-slice.origin[k]))/denominator,p=point.map((v,k)=>v-distanceMm*d[k]-slice.origin[k]);
  return [{distanceMm,chartPoint:[dot(p,slice.xAxis),dot(p,slice.yAxis)]}];
}

export const horizontalSlice = z => {
  requireThat(Number.isFinite(z), 'A horizontal slice needs a finite height.');
  return { kind: 'plane', origin: [0, 0, z], normal: [0, 0, 1], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
};

// Any plane. The chart's x axis is the given one, or world X (world Y when the
// normal is near X) projected into the plane; y completes a right-handed
// chart, so counterclockwise is seen from the normal.
export function planeSlice({ origin, normal, xAxis = null }) {
  requireThat(vector(origin) && vector(normal), 'A plane slice needs an origin and a normal.');
  const n = normalize(normal);
  const seed = xAxis ?? (Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  requireThat(vector(seed), 'A plane slice x axis is a 3D vector.');
  const x = normalize(add(seed, scale(n, -dot(seed, n))));
  return { kind: 'plane', origin: [...origin], normal: n, xAxis: x, yAxis: cross(n, x) };
}

export function patchSlice(patch) {
  requireThat(patch?.cp && patch.domainU && patch.domainV, 'A patch slice needs a NURBS patch.');
  return { kind: 'patch', patch,referencePatch:patch,translation:[0,0,0] };
}

export function translateSlice(slice, v) {
  requireThat(vector(v), 'A slice translation is a 3D vector.');
  if (slice.kind === 'plane') return { ...slice, origin: add(slice.origin, v) };
  if (slice.kind === 'height-field') {
    requireThat(v[0] === 0 && v[1] === 0, 'Height-reference families currently translate along Z only.');
    return { ...slice, offsetMm: slice.offsetMm + v[2] };
  }
  requireThat(slice.kind === 'patch', `Unsupported slice kind ${slice.kind}.`);
  const cp = Float64Array.from(slice.patch.cp);
  for (let i = 0; i < cp.length; i += 4) for (let k = 0; k < 3; k++) cp[i + k] += v[k] * cp[i + 3];
  return { ...slice, patch: { ...slice.patch, cp },translation:add(slice.translation??[0,0,0],v) };
}

export function sliceChartStep(slice,stepMm){
  if(slice.kind!=='patch')return [stepMm,stepMm];
  const {domainU:[u0,u1],domainV:[v0,v1]}=slice.patch,speeds=[0,0];
  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
    const e=evaluate(slice.patch,u0+(u1-u0)*i/4,v0+(v1-v0)*j/4);
    speeds[0]=Math.max(speeds[0],Math.hypot(...e.du));speeds[1]=Math.max(speeds[1],Math.hypot(...e.dv));
  }
  requireThat(speeds.every(v=>v>0),'Slice chart has a singular sampling metric.');
  return speeds.map(v=>stepMm/v);
}

// Whether region loops reach the slice's own edge. A plane has none; a patch's
// is its (u,v) domain boundary.
export function touchesSliceEdge(slice, loops) {
  return sliceBoundaryEdges(slice,loops).length>0;
}

export function sliceBoundaryEdges(slice,loops) {
  if (slice.kind !== 'patch') return [];
  const { domainU: [u0, u1], domainV: [v0, v1] } = slice.patch;
  const eu = 1e-7 * (u1 - u0) + 1e-9, ev = 1e-7 * (v1 - v0) + 1e-9;
  const tests=[['u-min',([u])=>u-u0<=eu],['u-max',([u])=>u1-u<=eu],['v-min',([,v])=>v-v0<=ev],['v-max',([,v])=>v1-v<=ev]];
  return tests.filter(([,test])=>loops.some(loop=>loop.some(test))).map(([edge])=>edge);
}

// Integrate the oriented area vector, not unweighted vertex normals. The UV
// grid is bounded by a physical pitch derived from the patch control net.
export function patchMeanNormal(patch,region=null,{sampleStepMm=.5,direction=null}={}) {
  const [u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
  const extents=[0,1].map(axis=>{
    let max=0;
    for(let i=0;i<patch.nu;i++)for(let j=0;j<patch.nv;j++){
      const ni=i+(axis===0?1:0),nj=j+(axis===1?1:0);if(ni>=patch.nu||nj>=patch.nv)continue;
      const a=(i*patch.nv+j)*4,b=(ni*patch.nv+nj)*4;
      max=Math.max(max,Math.hypot(...[0,1,2].map(k=>patch.cp[a+k]/patch.cp[a+3]-patch.cp[b+k]/patch.cp[b+3])));
    }
    return max*(axis===0?patch.nu-1:patch.nv-1);
  });
  const counts=extents.map(length=>Math.max(2,Math.ceil(length/sampleStepMm))),sum=[0,0,0];let areaMm2=0,minProjection=Infinity,maxProjection=-Infinity;
  for(let i=0;i<counts[0];i++)for(let j=0;j<counts[1];j++){
    const uv=[u0+(i+.5)*(u1-u0)/counts[0],v0+(j+.5)*(v1-v0)/counts[1]];
    const hu=(u1-u0)/counts[0]/2,hv=(v1-v0)/counts[1]/2;
    const weight=region?regionArea(intersect(region,[[[uv[0]-hu,uv[1]-hv],[uv[0]+hu,uv[1]-hv],[uv[0]+hu,uv[1]+hv],[uv[0]-hu,uv[1]+hv]]])):4*hu*hv;
    if(!weight)continue;
    const e=evaluate(patch,...uv),area=cross(e.du,e.dv);
    if(direction){const projection=dot(normalize(area),direction);minProjection=Math.min(minProjection,projection);maxProjection=Math.max(maxProjection,projection);}
    for(let k=0;k<3;k++)sum[k]+=area[k]*weight;
    areaMm2+=Math.hypot(...area)*weight;
  }
  requireThat(areaMm2>0&&Math.hypot(...sum)>areaMm2*1e-9,'The reference patch has no unambiguous mean stacking normal; specify stack.direction.');
  return {normal:normalize(sum),meanNormal:sum.map(v=>v/areaMm2),areaMm2,sampleStepMm,...(direction?{minProjection,maxProjection}:{})};
}

// A stack of one base slice: layer k is the base translated along the unit
// direction by firstLayerMm + k·pitchMm, so each layer sits one pitch above the
// last and the first one first-layer height above the base. Direction defaults
// to a plane's normal and must advance a plane (d·n > 0). Only layers that
// reach into bounds (the owned volume's box) past its low side are listed,
// numbered from the base, so a family confined to a band keeps the layer
// numbers of the whole stack. heightMm is the layer's thickness: along the
// normal for a plane, along the direction for a patch.
//
// {base, direction?, pitchMm, firstLayerMm}, {min, max} ->
// {base, direction, pitchMm, firstLayerMm, layers: [{index, offsetMm, heightMm, slice}]}
export function sliceFamily({ base, direction = null, normalRegion = null, pitchMm, firstLayerMm }, bounds) {
  requireThat(['plane', 'patch', 'height-field'].includes(base?.kind), 'A slice family needs a plane, patch or height reference.');
  requireThat(Number.isFinite(pitchMm) && pitchMm > 0 && Number.isFinite(firstLayerMm) && firstLayerMm > 0,
    'A slice family needs a positive pitch and first-layer height; it would never advance.');
  requireThat(vector(bounds?.min) && vector(bounds?.max), 'A slice family needs the owned volume bounds.');
  if(base.kind==='height-field') {
    requireThat(!direction||direction[0]===0&&direction[1]===0&&direction[2]>0,'Height-reference families translate along positive Z.');
    requireThat(!base.normalDepthMm,'Translated height families do not imply normal-offset stacks.');
    const referenceBounds=heightReferenceBounds(base.reference),metric=heightReferenceMetric(base.reference,{sampleStepMm:base.sampleStepMm}),translationStepMm=pitchMm/metric.meanProjection,firstTranslationMm=firstLayerMm/metric.meanProjection,layers=[];
    const firstIndex=Math.min(0,Math.floor((bounds.min[2]-referenceBounds.max[2]-base.offsetMm-firstTranslationMm)/translationStepMm+1e-9)+1);
    requireThat(Number.isSafeInteger(firstIndex)&&Number.isSafeInteger(Math.ceil((bounds.max[2]-referenceBounds.min[2]-base.offsetMm-firstTranslationMm)/translationStepMm)),'Height-family indices exceed exact integer representation.');
    for(let referenceIndex=firstIndex;;referenceIndex++) {
      const index=referenceIndex-firstIndex,offsetMm=firstTranslationMm+referenceIndex*translationStepMm;
      if(referenceBounds.min[2]+base.offsetMm+offsetMm>bounds.max[2]+1e-9)break;
      if(referenceBounds.max[2]+base.offsetMm+offsetMm<=bounds.min[2]+1e-9)continue;
      const translationMm=referenceIndex===0?firstTranslationMm:translationStepMm;
      layers.push({index,referenceIndex,offsetMm,targetGapMm:referenceIndex===0?firstLayerMm:pitchMm,translationMm,heightMm:translationMm,direction:[0,0,1],thicknessMetric:'normal-projection',slice:translateSlice(base,[0,0,offsetMm])});
    }
    return {base,direction:[0,0,1],pitchMm,firstLayerMm,translationStepMm,firstTranslationMm,meanProjection:metric.meanProjection,minProjectedGapMm:translationStepMm*metric.minProjection,maxProjectedGapMm:translationStepMm*metric.maxProjection,gapMetric:'area-mean-normal-projection',layers};
  }
  const metric=base.kind==='patch'?patchMeanNormal(base.patch):null;
  const d = normalize(direction ?? (metric?metric.normal:base.normal));
  const range=metric?patchMeanNormal(base.patch,null,{direction:d}):null;
  const advance = base.kind === 'plane' ? dot(d, base.normal) : 1;
  requireThat(advance > 1e-9, 'The stacking direction must advance the plane along its normal.');
  const meanProjection=metric?dot(metric.meanNormal,d):advance;
  requireThat(meanProjection>1e-9,'The stacking direction has no positive mean normal advance.');
  const translationStepMm=pitchMm/meanProjection,firstTranslationMm=firstLayerMm/meanProjection;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [0, 1, 2].map(k => (i >> k) & 1 ? bounds.max[k] : bounds.min[k]));
  const along = base.kind === 'plane' ? base.normal : d;
  const lo = Math.min(...corners.map(c => dot(along, c))), hi = Math.max(...corners.map(c => dot(along, c)));
  // A patch's own extent along the direction, before translation.
  const [low, high] = base.kind === 'patch' ? patchExtent(base.patch, d) : [0, 0];
  // Translating by the first layer, then by whole pitches, keeps a horizontal
  // family's heights bit-identical to base + first + k·pitch.
  const start = translateSlice(base, scale(d, firstTranslationMm)), layers = [];
  const baseHigh=base.kind==='plane'?dot(base.normal,base.origin):high;
  const firstIndex=Math.min(0,Math.floor(((lo-baseHigh)/advance-firstTranslationMm)/translationStepMm+1e-9)+1);
  requireThat(Number.isSafeInteger(firstIndex)&&Number.isSafeInteger(Math.ceil(((hi-baseHigh)/advance-firstTranslationMm)/translationStepMm)),'Slice-family indices exceed exact integer representation.');
  for (let referenceIndex = firstIndex; ; referenceIndex++) {
    const slice = referenceIndex ? translateSlice(start, scale(d, referenceIndex * translationStepMm)) : start;
    const t = firstTranslationMm + referenceIndex * translationStepMm;
    const [bottom, top] = base.kind === 'plane' ? [dot(base.normal, slice.origin), dot(base.normal, slice.origin)] : [low + t, high + t];
    if (bottom > hi + 1e-9) break;
    if (top <= lo + 1e-9) continue;
    const index=referenceIndex-firstIndex,stepMm=referenceIndex===0?firstTranslationMm:translationStepMm;
    layers.push({ index, referenceIndex, offsetMm:t, targetGapMm:referenceIndex===0?firstLayerMm:pitchMm,translationMm:stepMm,heightMm: stepMm * advance, direction:d, slice });
  }
  return { base, direction: d, pitchMm, firstLayerMm,translationStepMm,firstTranslationMm,minProjectedGapMm:translationStepMm*(range?.minProjection??advance),maxProjectedGapMm:translationStepMm*(range?.maxProjection??advance),gapMetric:'area-mean-normal-projection',meanProjection,layers };
}

// Range of a patch along a unit direction, from its control hull.
function patchExtent(patch, d) {
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < patch.cp.length; i += 4) {
    const w = patch.cp[i + 3], h = (patch.cp[i] * d[0] + patch.cp[i + 1] * d[1] + patch.cp[i + 2] * d[2]) / w;
    low = Math.min(low, h); high = Math.max(high, h);
  }
  return [low, high];
}
