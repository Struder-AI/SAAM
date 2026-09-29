// Native height-field slice references. The chart is world XY in millimetres;
// it preserves the source roof or spline, never fits a replacement surface.
import {topAt,containsPoint} from './query.mjs';
import {projectToPatch} from './field.mjs';
import {normalize,requireThat,TOLERANCE} from './tolerance.mjs';
import {levelSetRegion,SENTINEL} from '../region/boolean.mjs';
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

// Area-weighted normal projection over the complete reference footprint.
// A height graph's area element is dX dY / nZ, not uniform XY weight.
export function heightReferenceMetric(reference,{sampleStepMm=.5}={}){
  const bounds=heightReferenceBounds(reference),counts=[0,1].map(k=>Math.max(2,Math.ceil((bounds.max[k]-bounds.min[k])/sampleStepMm)));
  let areaMm2=0,projectedAreaMm2=0,minProjection=1,maxProjection=0;
  for(let i=0;i<counts[0];i++)for(let j=0;j<counts[1];j++){
    const point=[i,j].map((v,k)=>bounds.min[k]+(v+.5)*(bounds.max[k]-bounds.min[k])/counts[k]),top=referenceHeight(reference,...point);
    if(!top||top.patch==='bottom')continue;
    const projected=(bounds.max[0]-bounds.min[0])*(bounds.max[1]-bounds.min[1])/(counts[0]*counts[1]);
    requireThat(top.normal[2]>1e-9,'A height reference has no positive vertical advance.');
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

export function referenceHeight(reference,x,y) {
  if(reference.kind==='roof')return topAt(reference.geometry,x,y);
  const hits=projectToPatch(reference.patch,x,y);
  if(!hits.length)return null;
  requireThat(hits.every(hit=>Math.abs(hit.point[2]-hits[0].point[2])<=TOLERANCE.point),'Spline slice folds over its XY chart; choose a single-valued height reference.');
  const hit=hits[0],normal=hit.normal?.[2]<0?hit.normal.map(v=>-v):hit.normal;
  requireThat(normal&&normal[2]>1e-9,'Spline height reference has a vertical or singular normal.');
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
  const h=Math.max(TOLERANCE.point*10,Math.min(.001,slice.sampleStepMm/100));
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
// and bisected to point tolerance at each detected crossing. Features wholly
// between grid samples are outside this explicitly sampled topology contract.
export function sampledChartRegion(bounds,stepMm,contains) {
  requireThat((Array.isArray(stepMm)?stepMm:[stepMm]).every(s=>Number.isFinite(s)&&s>0),'Chart sampling pitch must be positive.');
  const counts=[0,1].map(i=>Math.max(2,Math.ceil((bounds.max[i]-bounds.min[i])/(Array.isArray(stepMm)?stepMm[i]:stepMm))));
  const axes=[0,1].map(axis=>Array.from({length:counts[axis]+3},(_,i)=>bounds.min[axis]+(i-1)*(bounds.max[axis]-bounds.min[axis])/counts[axis]));
  const [xs,ys]=axes,values=xs.map(x=>Float64Array.from(ys,y=>contains([x,y])?SENTINEL:-SENTINEL));
  const refine=(inside,outside)=>{
    let a=inside,b=outside;
    while(Math.hypot(a[0]-b[0],a[1]-b[1])>TOLERANCE.point) {
      const middle=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      requireThat(middle[0]!==a[0]||middle[1]!==a[1],'Chart boundary refinement cannot progress at floating-point precision.');
      if(contains(middle))a=middle;else b=middle;
    }
    return a;
  };
  return levelSetRegion({xs,ys,values},0,{refine});
}

export function sectionHeightSlice(geometry,slice,{sampleStepMm=slice.sampleStepMm,fullCrossing=true}={}) {
  const source=geometry.kind==='prepared-mesh'?geometry.mesh:geometry;
  const contains=point=>{
    const top=referenceHeight(slice.reference,...point);
    if(!top) {
      requireThat(!fullCrossing||slice.reference.kind!=='spline'||!topAt(source,...point),'Spline slice domain stops over the part; extend the reference to fully cross its material.');
      return false;
    }
    const p=heightSlicePoint(slice,point),epsilon=TOLERANCE.point*2;
    return containsPoint(source,[p[0],p[1],p[2]-epsilon])||containsPoint(source,[p[0],p[1],p[2]+epsilon]);
  };
  return {loops:sampledChartRegion(source.bounds,sampleStepMm,contains),nudgedByMm:0};
}
