// Native height-field slice references. The chart is world XY in millimetres;
// it preserves the source roof or spline, never fits a replacement surface.
import {evaluateSurface,surfaceChartCovers} from './surface-evaluation.mjs';
import {topAt,containsPoint} from './query.mjs';
import {projectToPatch,patchCoversChart} from './field.mjs';
import {normalize,requireThat} from './tolerance.mjs';
import {ROUNDING_RELATIVE,PRINT_RESOLUTION_MM,PROGRAM_STEP_MM} from '../dimensions.mjs';
import {extractLevelSet,SENTINEL} from './level-set.mjs';
import {validateSplineSolid,clampedKnots,splineSolidBounds} from './spline-solid.mjs';

// Use the same authored patch record as spline solids, without requiring it to
// close a solid. Placement precedes evaluation and remains explicit data.
export function heightReferencePatch(authored,shift=[0,0,0]) {
  validateSplineSolid({shape:'spline',patches:[authored]});
  const nu=authored.controlPoints.length,nv=authored.controlPoints[0].length;
  const knotsU=authored.knotsU??clampedKnots(nu,authored.degreeU),knotsV=authored.knotsV??clampedKnots(nv,authored.degreeV);
  const cp=Float64Array.from(authored.controlPoints.flatMap(row=>row.flatMap(p=>{const w=p[3]??1;return [...p.slice(0,3).map((v,k)=>(v+shift[k])*w),w];})));
  return {name:authored.name,nu,nv,orderU:authored.degreeU+1,orderV:authored.degreeV+1,knotsU,knotsV,cp,
    domainU:[knotsU[authored.degreeU],knotsU[nu]],domainV:[knotsV[authored.degreeV],knotsV[nv]]};
}

export function heightReferenceBounds(reference) {
  if(reference.kind==='roof')return reference.geometry.bounds;
  const points=[];
  for(let i=0;i<reference.patch.cp.length;i+=4)points.push(Array.from(reference.patch.cp.slice(i,i+3),v=>v/reference.patch.cp[i+3]));
  return splineSolidBounds({patches:[{controlPoints:[points]}]});
}

// Conservative [low, high] Z of a height reference over the XY points of a
// chart region. A roof's highest crossing exits its solid, so it lies on an
// outward upward triangle of a closed mesh, and on or above any affine spline
// patch covering the whole region. Other roofs keep their solid's bounds.
export function heightReferenceRange(reference,loops){
  const bounds=heightReferenceBounds(reference),points=loops.flat();
  if(reference.kind!=='roof')return [bounds.min[2],bounds.max[2]];
  const solid=reference.geometry;let floor=-Infinity;
  if(solid.kind==='triangle-mesh'){
    const lo=[0,1].map(k=>Math.min(...points.map(p=>p[k]))-PRINT_RESOLUTION_MM),hi=[0,1].map(k=>Math.max(...points.map(p=>p[k]))+PRINT_RESOLUTION_MM);
    const faces=solid.triangles.map(t=>t.map(i=>solid.vertices[i]));
    const winding=Math.sign(faces.reduce((sum,[a,b,c])=>sum+a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]),0));
    const upward=([a,b,c])=>winding*((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>0;
    const meets=face=>[0,1].every(k=>Math.min(...face.map(p=>p[k]))<=hi[k]&&Math.max(...face.map(p=>p[k]))>=lo[k]);
    const low=faces.reduce((low,face)=>upward(face)&&meets(face)?Math.min(low,face[0][2],face[1][2],face[2][2]):low,Infinity);
    if(low<Infinity)floor=low;
  }else if(solid.kind!=='boolean'){
    for(const patch of solid.patches??[])if(patchCoversChart(patch,points)){
      let low=Infinity;for(let i=0;i<patch.cp.length;i+=4)low=Math.min(low,patch.cp[i+2]/patch.cp[i+3]);
      floor=Math.max(floor,low);
    }
  }
  return [Math.max(bounds.min[2],floor),bounds.max[2]];
}

// Area-weighted normal projection over the complete reference footprint.
// A height graph's area element is dX dY / nZ, not uniform XY weight.
export function heightReferenceMetric(reference,{sampleStepMm=.5}={}){
  const bounds=heightReferenceBounds(reference),counts=[0,1].map(k=>Math.max(2,Math.ceil((bounds.max[k]-bounds.min[k])/sampleStepMm)));
  let areaMm2=0,projectedAreaMm2=0,minProjection=1,maxProjection=0;
  for(let i=0;i<counts[0];i++)for(let j=0;j<counts[1];j++){
    const point=[i,j].map((v,k)=>bounds.min[k]+(v+.5)*(bounds.max[k]-bounds.min[k])/counts[k]),top=referenceHeight(reference,...point);
    if(!top||top.patch==='bottom')continue;
    const projected=(bounds.max[0]-bounds.min[0])*(bounds.max[1]-bounds.min[1])/(counts[0]*counts[1]);
    requireThat(top.normal[2]>ROUNDING_RELATIVE,'A height reference has no positive vertical advance.');
    projectedAreaMm2+=projected;areaMm2+=projected/top.normal[2];minProjection=Math.min(minProjection,top.normal[2]);maxProjection=Math.max(maxProjection,top.normal[2]);
  }
  requireThat(areaMm2>0,'The height reference has no measurable surface area.');
  return {meanProjection:projectedAreaMm2/areaMm2,minProjection,maxProjection,areaMm2,sampleStepMm};
}

export function heightSlice(reference,{offsetMm=0,normalDepthMm=0,sampleStepMm=.5}={}) {
  requireThat(['roof','spline'].includes(reference?.kind),'Height slices need a roof or spline reference.');
  requireThat(Number.isFinite(offsetMm)&&Number.isFinite(normalDepthMm)&&normalDepthMm>=0&&Number.isFinite(sampleStepMm)&&sampleStepMm>0,'Invalid height slice offsets/sampling.');
  return {kind:'height-field',reference,offsetMm,normalDepthMm,sampleStepMm};
}

// Exact XY queries recur across translated slices. Identity belongs to the
// immutable source geometry/patch, so offsets never require another projection.
// Eviction only changes recomputation cost, never accepted geometry.
const referenceSamples=new WeakMap();
export function referenceHeight(reference,x,y) {
  const source=reference.kind==='roof'?reference.geometry:reference.patch;
  if(!referenceSamples.has(source)){
    const samples=new Map();referenceSamples.set(source,{samples,oldest:samples.keys()});
  }
  const {samples,oldest}=referenceSamples.get(source);
  const key=`${x},${y}`;
  if(samples.has(key))return samples.get(key);
  const value=evaluateReferenceHeight(reference,x,y);
  if(samples.size>=100000)samples.delete(oldest.next().value);
  samples.set(key,value);return value;
}

function evaluateReferenceHeight(reference,x,y) {
  if(reference.kind==='roof')return topAt(reference.geometry,x,y);
  const hits=projectToPatch(reference.patch,x,y);
  if(!hits.length)return null;
  requireThat(hits.every(hit=>Math.abs(hit.point[2]-hits[0].point[2])<=PRINT_RESOLUTION_MM),'Spline slice folds over its XY chart; choose a single-valued height reference.');
  const hit=hits[0],normal=hit.normal?.[2]<0?hit.normal.map(v=>-v):hit.normal;
  requireThat(normal&&normal[2]>ROUNDING_RELATIVE,'Spline height reference has a vertical or singular normal.');
  return {zMm:hit.point[2],normal,slopeDeg:Math.acos(Math.min(1,normal[2]))*180/Math.PI};
}

export function heightSlicePoint(slice,[x,y]) {
  const top=referenceHeight(slice.reference,x,y);
  requireThat(top,'The height reference does not cover this chart point.');
  return [x,y,top.zMm+slice.offsetMm-slice.normalDepthMm/top.normal[2]];
}

// Translating vertically preserves the source normal. Projected normal-depth
// bands do not: differentiate their actual graph rather than call them exact
// constant-normal offsets. One-sided differences handle a footprint edge.
export function heightSliceNormal(slice,[x,y]) {
  const top=referenceHeight(slice.reference,x,y);
  requireThat(top,'The height reference does not cover this chart point.');
  if(!slice.normalDepthMm)return top.normal;
  // Each mesh facet has constant normal, so its projected-depth graph is a
  // translated plane with that exact one-sided normal. A finite difference
  // across facets would mistake a crease/jump for a smooth local derivative.
  // Mapping still checks chord convergence and actual path slope across it.
  if(top.feature?.startsWith('triangle:'))return top.normal;
  // The slope a print follows: a difference across print resolution.
  const h=PRINT_RESOLUTION_MM;
  const z=heightSlicePoint(slice,[x,y])[2],gradient=[];
  for(const axis of [0,1]) {
    const a=[x,y],b=[x,y];a[axis]-=h;b[axis]+=h;
    const ea=referenceHeight(slice.reference,...a),eb=referenceHeight(slice.reference,...b);
    requireThat(ea||eb,'A height reference has no differentiable neighborhood.');
    const za=ea?ea.zMm+slice.offsetMm-slice.normalDepthMm/ea.normal[2]:z;
    const zb=eb?eb.zMm+slice.offsetMm-slice.normalDepthMm/eb.normal[2]:z;
    gradient.push((zb-za)/(h*((ea?1:0)+(eb?1:0))));
  }
  return normalize([-gradient[0],-gradient[1],1]);
}

// Contours of an evaluated predicate, sampled at the requested spatial pitch
// and bisected to program resolution at each detected crossing. Features wholly
// between grid samples are outside this explicitly sampled topology contract.
export function sampledChartRegion(bounds,stepMm,contains,{surface=null,precisionUv=PRINT_RESOLUTION_MM}={}) {
  requireThat((Array.isArray(stepMm)?stepMm:[stepMm]).every(s=>Number.isFinite(s)&&s>0),'Chart sampling pitch must be positive.');
  const counts=[0,1].map(i=>Math.max(2,Math.ceil((bounds.max[i]-bounds.min[i])/(Array.isArray(stepMm)?stepMm[i]:stepMm))));
  const axes=[0,1].map(axis=>Array.from({length:counts[axis]+3},(_,i)=>bounds.min[axis]+(i-1)*(bounds.max[axis]-bounds.min[axis])/counts[axis]));
  const [xs,ys]=axes,values=xs.map(x=>Float64Array.from(ys,y=>contains([x,y])?SENTINEL:-SENTINEL));
  const crossingWide=(a,b)=>{
    if(surface&&surfaceChartCovers(surface,a)&&surfaceChartCovers(surface,b))return Math.hypot(...evaluateSurface(surface,a).point.map((v,k)=>v-evaluateSurface(surface,b).point[k]))>PROGRAM_STEP_MM;
    return Math.hypot(a[0]-b[0],a[1]-b[1])>(surface?precisionUv:PROGRAM_STEP_MM);
  };
  const refine=(inside,outside)=>{
    let a=inside,b=outside;
    while(crossingWide(a,b)) {
      const middle=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      // Halving has reached floating-point precision: a is the boundary.
      if(middle[0]===a[0]&&middle[1]===a[1]||middle[0]===b[0]&&middle[1]===b[1])break;
      if(contains(middle))a=middle;else b=middle;
    }
    return a;
  };
  return extractLevelSet({xs,ys,values},0,{refine,precision:precisionUv});
}

// The region of the solid on a height slice, where its reference covers it.
export function sectionHeightSlice(geometry,slice,{sampleStepMm=slice.sampleStepMm}={}) {
  const source=geometry.kind==='prepared-mesh'?geometry.mesh:geometry;
  const contains=point=>{
    const top=referenceHeight(slice.reference,...point);
    if(!top)return false;
    const p=heightSlicePoint(slice,point),epsilon=PRINT_RESOLUTION_MM;
    return containsPoint(source,[p[0],p[1],p[2]-epsilon])||containsPoint(source,[p[0],p[1],p[2]+epsilon]);
  };
  return {loops:sampledChartRegion(source.bounds,sampleStepMm,contains),nudgedByMm:0};
}
