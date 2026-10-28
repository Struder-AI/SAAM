import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {affineSurface} from '../geom/affine-surface.mjs';
import {requireThat,normalize,cross} from '../private/toolpath/numeric.mjs';
import {surfaceTangentFrame} from '../geom/surface-frame.mjs';
// One slice member's wall loops and fill regions in its chart; mapSliceStrokes
// maps chart coordinates to XYZ. Deposition dimensions belong to
// core/path/deposition.mjs. These are plain functions of their inputs: Slice
// (core/print/slices.mjs) supplies the region, the full-fill regions and the
// member's choices. Physical offsets use the shared surface operations.
import { difference, intersect } from './intersection.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { cleanPlanarLoop } from '../geom/polyline.mjs';

import {TOLERANCE} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {offsetSliceRegion} from './surface-operations.mjs';
import {perimeterLoops} from './perimeters.mjs';
import {regionComponents,pointInRegion,pointSegmentDistance} from './region2d.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

// region: owned loops in the chart. material: the part's sliced material on
// the layer (the region itself by default). Every owner walls all its boundaries.
// outward: loops grow out of material (a brim) and no fill is laid.
// solid: the part of the region filled solid (null when no mask applies).
// Settings: widthMm, loops, fillDensity, fillOverlap, spacingFactor,
// sampleStepMm and wallToleranceMm.
// sliceWallStrokes -> wall loops, outermost first; sliceFillRegions ->
// {interior, solidRegion, sparseRegion}.
export function sliceWallStrokes(region, {widthMm,loops,spacingFactor,sampleStepMm,wallToleranceMm=0,
  material=region,outward=false,slice=null,loopBoundary=region,loopInsetMm=null,offsetOptions={}}) {
  requireThat(Number.isInteger(loops)&&loops>=0,'A slice member needs a nonnegative whole wall count.');
  const pitch = lineSpacing(widthMm, { spacingFactor });
  const boundary = outward ? material : loopBoundary;
  const walls = [];
  for (let ring = 0; ring < loops; ring++) {
    const distance = (loopInsetMm??widthMm/2) + ring * pitch;
    const found=!outward&&(!slice||slice.kind==='plane')?perimeterLoops(boundary,distance,{arcToleranceMm:PRINT_RESOLUTION_MM,...offsetOptions}):
      offsetSliceRegion(slice,boundary,outward?distance:-distance,{...offsetOptions,sampleStepMm});
    if (!found.length) break;
    // Only plane coordinates are millimetres. Surface offsets already simplify
    // physically; applying a planar millimetre tolerance to UV destroys that work.
    const cleaned = !slice||slice.kind==='plane'?found.map(loop => cleanPlanarLoop(loop, wallToleranceMm === 0 ? PRINT_RESOLUTION_MM : wallToleranceMm)):found;
    for (const [loop,points] of cleaned.entries())
      walls.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', ringIndex:ring, edge:{loop,ring},closed: true,
        directionRequired:false,seamRequired:false,points,beadWidthMm:widthMm });
  }
  return walls;
}

export function sliceFillRegions(region, walls, {widthMm,loops,fillDensity,fillOverlap=0,spacingFactor,sampleStepMm,
  solid=null,outward=false,slice=null,loopInsetMm=null,offsetOptions={}}) {
  requireThat(Number.isFinite(fillDensity)&&fillDensity>=0&&fillDensity<=1,'A slice member needs a fill density from 0 to 1.');
  requireThat(Number.isFinite(fillOverlap)&&fillOverlap>=0,'Wall/fill overlap must be finite and nonnegative.');
  const pitch=lineSpacing(widthMm,{spacingFactor});
  // Each component reserves only the walls that fit there. A collapsed later
  // ring must not erase the fillable interior left by its earlier walls.
  const components=outward||loops===0?[]:regionComponents(region);
  const contains=(component,point)=>pointInRegion(point,component)||component.some(loop=>loop.some((a,i)=>{
    const b=loop[(i+1)%loop.length],guard=ROUNDING_RELATIVE*Math.max(1,...a.map(Math.abs),...b.map(Math.abs));
    return pointSegmentDistance(point,a,b)<=guard;
  }));
  const interior=outward?[]:loops===0?region:components.flatMap(component=>{
    const wallDomain=loopInsetMm<0?offsetSliceRegion(slice,component,-loopInsetMm,{...offsetOptions,sampleStepMm}):component;
    const emitted=walls.filter(wall=>(wall.chartPoints??wall.points).some(point=>contains(wallDomain,point)));
    const count=emitted.length?Math.max(...emitted.map(wall=>wall.ringIndex??wall.edge?.ring??0))+1:0;
    if(count===0)return component;
    const inset=(loopInsetMm??widthMm/2)+(count-1)*pitch+widthMm/2-widthMm*fillOverlap;
    return intersect(component,offsetSliceRegion(slice,component,-inset,{...offsetOptions,sampleStepMm}));
  });
  const dense = fillDensity >= 1;
  const solidRegion = dense ? interior : solid?.length ? intersect(interior, solid) : [];
  const sparseRegion = dense ? [] : solid?.length ? difference(interior, solid) : interior;
  return {interior,solidRegion,sparseRegion};
}

// Coordinate mapping is independent of bead/process calculation. The plane
// chart is isometric; mapped XYZ curve lengths keep physical millimetres.
function admittedChartPoint(slice,point){
  if(slice.kind!=='patch')return point;
  return point.map((x,k)=>{
    const [lo,hi]=[slice.patch.domainU,slice.patch.domainV][k],fraction=(x-lo)/(hi-lo);
    requireThat(fraction>=-TOLERANCE.domainFraction&&fraction<=1+TOLERANCE.domainFraction,'Slice mapping leaves its spline chart.');
    return Math.max(lo,Math.min(hi,x));
  });
}
const exactPlane=slice=>slice.kind==='plane'||slice.kind==='slice-chart'&&exactPlane(slice.slice);
export function mapSliceStrokes(strokes, slice, options={}) {
  if(strokes.some(stroke=>stroke.surfaceSamples))return strokes.map(stroke=>{
    requireThat(stroke.surfaceSamples?.length>1,'An evaluated field stroke needs at least two samples.');
    const {surfaceSamples:samples,cellWidthsMm,widthAxis,...curve}=stroke;
    const widthsMm=samples.slice(1).map((e,i)=>{
      const tangent=normalize(e.point.map((v,k)=>v-samples[i].point[k])),across=normalize(e[widthAxis]);
      return (cellWidthsMm[i]+cellWidthsMm[i+1])/2*Math.hypot(...cross(across,tangent));
    });
    return {...curve,points:samples.map(e=>e.point),chartPoints:samples.map(e=>[e.u,e.v]),
      normals:samples.map(e=>e.normal),referenceAlong:samples.map(e=>e.dv),widthsMm,
      segmentMetadata:samples.slice(1).map(e=>({surfaceNormal:[...e.normal],materialRole:stroke.materialRole,cellDirection:stroke.cellDirection})),
      mappingReport:{method:'producer-samples',correspondence:'chart-samples',guarantee:'producer-samples-only',
        points:samples.length,evaluations:0,...(stroke.mappingReport?{producerEvidence:stroke.mappingReport}:{})}};
  });
  if(affineSurface(slice))return strokes.map(stroke=>{
    const chart=stroke.points.map(point=>admittedChartPoint(slice,point)),exact=exactPlane(slice);
    return {...stroke,points:chart.map(point=>evaluateSurface(slice,point).point),
      ...(options.frames?{chartPoints:chart,normals:chart.map(point=>evaluateSurface(slice,point).normal),frameSamples:chart.map(point=>sliceFrame(slice,point))}:{}),
      mappingReport:{method:exact?'exact-affine':'affine-direct',correspondence:exact?'continuous-affine-segments':'chart-samples',
        guarantee:exact?'exact-affine-correspondence':'classified-affine',...(exact?{continuousBoundMm:0}:{}),
        points:chart.length,evaluations:chart.length*(options.frames?3:1)}};
  });
  return strokes.map(stroke=>mapSliceStroke(stroke,slice,options));
}

export function sliceFrame(slice,point){
  return {point:[...point,0],...surfaceTangentFrame(evaluateSurface(slice,point))};
}

// UV and XY charts have different metrics. Step/chord tolerances are always
// physical XYZ millimetres; quarter probes catch curvature hidden at midpoint.
// Optional geometric frames are data, not a request to rotate a fixed-axis tool.
export function mapSliceStroke(stroke,slice,{sampleStepMm=slice.sampleStepMm??.2,toleranceMm=TOLERANCE.chord,frames=false}={}) {
  requireThat(sampleStepMm>0&&Number.isFinite(sampleStepMm)&&toleranceMm>0&&Number.isFinite(toleranceMm),'Slice mapping needs positive physical tolerances.');
  const source=(stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points).map(point=>admittedChartPoint(slice,point));
  const points=[evaluateSurface(slice,source[0]).point],chartPoints=[source[0]],sourceSamples=[{segment:0,t:0}],
    counts={evaluations:1,acceptedSegments:0,maxAcceptedSampledErrorMm:0,maxAcceptedSampledSpanMm:0};
  const split=(a,b,pa,pb,segment,from=0,to=1)=>{
    const probes=[.25,.5,.75].map(t=>{const chart=a.map((v,k)=>v+t*(b[k]-v));return {chart,point:evaluateSurface(slice,chart).point,t};});
    counts.evaluations+=3;
    const error=Math.max(...probes.map(({point,t})=>Math.hypot(...point.map((v,k)=>v-pa[k]-t*(pb[k]-pa[k])))));
    const polyline=[pa,...probes.map(probe=>probe.point),pb];
    const span=polyline.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-polyline[i][k])),0);
    if(span>sampleStepMm||error>toleranceMm){
      const middle=probes[1];
      requireThat(middle.chart.some((v,k)=>v!==a[k])&&middle.chart.some((v,k)=>v!==b[k]),'Curved slice mapping cannot converge at parameter precision; inspect a discontinuity.');
      const at=(from+to)/2;
      split(a,middle.chart,pa,middle.point,segment,from,at);split(middle.chart,b,middle.point,pb,segment,at,to);
    }else {
      counts.acceptedSegments++;counts.maxAcceptedSampledErrorMm=Math.max(counts.maxAcceptedSampledErrorMm,error);
      counts.maxAcceptedSampledSpanMm=Math.max(counts.maxAcceptedSampledSpanMm,span);
      points.push(pb);chartPoints.push(b);sourceSamples.push({segment,t:to});
    }
  };
  for(let i=1;i<source.length;i++) {counts.evaluations++;split(source[i-1],source[i],points.at(-1),evaluateSurface(slice,source[i]).point,i-1);}
  const normals=frames?chartPoints.map(point=>evaluateSurface(slice,point).normal):null;
  const frameSamples=frames?chartPoints.map(point=>sliceFrame(slice,point)):null;
  const transported={};
  for(const key of ['sourceParameters','curveParameters'])if(stroke[key]){
    const values=stroke[key],closing=values[0]+(values.at(-1)>=values[0]?1:-1);
    transported[key]=sourceSamples.map(({segment,t})=>values[segment]+t*((values[segment+1]??closing)-values[segment]));
  }
  for(const key of ['widthsMm','heightsMm','flowMultipliers','segmentMetadata'])if(stroke[key])
    transported[key]=sourceSamples.slice(1).map(({segment})=>stroke[key][segment]);
  return {...stroke,...transported,closed:false,points,...(frames?{chartPoints,normals,frameSamples}:{}),
    mappingReport:{method:'adaptive-quarter-probes',correspondence:'chart-samples',guarantee:'sampled-targets-only',sampleStepMm,toleranceMm,
      ...counts,evaluations:counts.evaluations+(frames?2*chartPoints.length:0),points:points.length}};
}
