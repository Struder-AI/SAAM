import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {affineSurface} from '../geom/affine-surface.mjs';
import {requireThat,normalize,cross,dot} from '../private/toolpath/numeric.mjs';
// Strokes of one slice layer. layerStrokes fills an owned layer region with
// loops and fill in the slice's chart; mapSliceStrokes maps coordinates to XYZ.
// Deposition dimensions belong to core/path/deposition.mjs. Both are plain functions of their inputs: the slice
// skill (core/print/slices.mjs) chooses the region, the solid mask and the
// angles for each layer.
// Physical offsets and pattern queries use the same surface operations.
import { difference, intersect, union } from './intersection.mjs';
import {surfacePatternStrokes} from './surface-patterns.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { cleanPlanarLoop } from '../geom/polyline.mjs';

import {TOLERANCE} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {offsetSliceRegion} from './surface-operations.mjs';
import {metricFillStrokes} from './metric-fill.mjs';

// region: owned loops in the chart. material: the part's sliced material on
// the layer (the region itself by default). Every owner walls all its boundaries.
// outward: loops grow out of material (a brim) and no fill is laid.
// solid: the part of the region filled solid (null when no mask applies).
// Settings: widthMm, loops, fillDensity, fillPattern, fillAngleDeg and
// solidDensity (solid rows), patternAngleDeg (sparse pattern), fillOverlap,
// spacingFactor, sampleStepMm, phaseMm (the gyroid's third coordinate),
// wallToleranceMm.
// -> {walls, infill, fill, interior, sparseRegion, solidRegion}: walls are
// loops, outermost first; infill is the
// sparse pattern and fill the solid rows, alternating in direction so each
// row starts where the last ended.
export function sliceLayerLayout(region, { widthMm, loops, fillDensity, fillOverlap, spacingFactor, sampleStepMm, wallToleranceMm = 0, solid = null,
  material = region, outward = false, slice = null, loopBoundary=region, loopInsetMm=null, offsetOptions={}, fillOrder=null,
}) {
  requireThat(Number.isInteger(loops) && loops >= 0 && Number.isFinite(fillDensity) && fillDensity >= 0 && fillDensity <= 1,
    'A slice layer needs a whole loop count and a fill density from 0 to 1.');
  const pitch = lineSpacing(widthMm, { spacingFactor });
  const offset=(loops,distance)=>offsetSliceRegion(slice,loops,distance,{...offsetOptions,sampleStepMm});
  const boundary = outward ? material : loopBoundary;
  const walls = [];
  for (let ring = 0; ring < loops; ring++) {
    const distance = (loopInsetMm??widthMm/2) + ring * pitch;
    const found=offset(boundary,outward?distance:-distance);
    if (!found.length) break;
    // Simplify only the finished deposition contour to machine precision; the
    // offset region keeps owning material topology.
    const cleaned = found.map(loop => cleanPlanarLoop(loop, wallToleranceMm === 0 ? PRINT_RESOLUTION_MM : wallToleranceMm));
    for (const [loop,points] of cleaned.entries())
      walls.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', ringIndex:ring, edge:{loop,ring},closed: true, points, beadWidthMm: widthMm });
  }
  // Fill reaches half a bead beyond the last loop, less the overlap welding
  // fill to walls. The region offset retains material topology at collapse.
  const inset = widthMm * (loops + 0.5 - fillOverlap) - widthMm / 2 + Math.max(0, loops - 1) * (pitch - widthMm);
  const interior = outward ? [] : fillOrder?.kind==='surface-cells'&&loops===0?region:
    offset(boundary,loops>0?-(loopInsetMm===null?widthMm/2+inset:loopInsetMm+(loops-1)*pitch+widthMm*(1-fillOverlap)):-widthMm/2);
  const dense = fillDensity >= 1;
  const solidRegion = dense ? interior : solid?.length ? intersect(interior, solid) : [];
  const sparseRegion = dense ? [] : solid ? difference(interior, solid) : interior;
  return {walls,interior,solidRegion,sparseRegion};
}

export function layerStrokes(region, options) {
  const {widthMm,fillDensity,fillPattern,fillAngleDeg,patternAngleDeg,solidDensity=1,spacingFactor,sampleStepMm,phaseMm=0,
    slice=null,fillOrder=null,layer=null,direction=null,layoutReference=slice,fillState=null,fillDirection=null}=options;
  const pitch=lineSpacing(widthMm,{spacingFactor});
  const {walls,interior,solidRegion,sparseRegion}=options.preparedLayout??sliceLayerLayout(region,options);
  const fillOptions={pitch,fillDensity,fillPattern,patternAngleDeg,sampleStepMm,direction};
  let constructionReport, nextFillState;
  const reference=slice??horizontalSlice(phaseMm);
  const pattern=fillOrder?.kind==='surface-cells'?[]:surfacePatternStrokes(reference,sparseRegion,fillOptions);
  const infill=pattern.map((stroke,lineIndex)=>({...stroke,role:'infill',fillFamily:stroke.fillFamily??{spacingMm:pitch/fillDensity,lineIndex},points:stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points}));
  let fill=fillOrder?.kind==='surface-cells'?[]:surfacePatternStrokes(reference,solidRegion,{...fillOptions,fillDensity:solidDensity,fillPattern:'rectilinear',patternAngleDeg:fillAngleDeg}).map(stroke=>({...stroke,role:'fill'}));
  if(fillOrder?.kind==='surface-cells'){
    const construct=(region,density)=>metricFillStrokes(slice,region,{widthMm,density,spacingFactor,sampleStepMm,
      toleranceMm:fillOrder.toleranceMm,direction:fillDirection??fillOrder.directions[(layer?.index??0)%fillOrder.directions.length],
      heightMm:layer.heightMm,speedMmS:layer.speedMmS,layoutChart:layoutReference,startU:fillState?.nextU??0,axialStart:fillState?.nextAxial??0});
    const cells=[...(solidRegion.length?[construct(solidRegion,solidDensity)]:[]),...(sparseRegion.length?[construct(sparseRegion,fillDensity)]:[])];
    const metric=cells.length?{...cells.at(-1),strokes:cells.flatMap((cell,i)=>cell.strokes.map(stroke=>({...stroke,...(stroke.orderGroup?{orderGroup:i+':'+stroke.orderGroup}:{})})))}:{strokes:[],report:{points:0},nextU:fillState?.nextU??0,nextAxial:fillState?.nextAxial??0};
    fill=metric.strokes;infill.length=0;constructionReport=metric.report;nextFillState={nextU:metric.nextU,nextAxial:metric.nextAxial};
  }
  return {walls,infill,fill,interior,sparseRegion,solidRegion,constructionReport,nextFillState};

}

// Material the loops of a layer cover: the band inward from the loop boundary,
// one ring per loop when loops are spaced wider than a bead, within the region.
export function loopMaterial(region, { widthMm, loops, spacingFactor }, {outward=false,slice=null,sampleStepMm=.2} = {}) {
  if (outward) return region;
  const pitch = lineSpacing(widthMm, { spacingFactor });
  const offset=distance=>offsetSliceRegion(slice,region,distance,{sampleStepMm});
  if (pitch === widthMm) return difference(region, offset(-widthMm * loops));
  return union(Array.from({ length: loops }, (_, ring) => difference(ring ? offset(-ring * pitch) : region,
    offset(-ring * pitch - widthMm))).flat(), []);
}

// Material fill strokes cover: their region grown by half a bead. Coverage
// takes part in booleans, so it is built to the chord tolerance.
export const fillMaterial = (region, widthMm, {slice=null,sampleStepMm=.2}={}) => region.length ? offsetSliceRegion(slice,region,widthMm/2,{sampleStepMm,arcToleranceMm:TOLERANCE.chord}) : [];

// Coordinate mapping is independent of bead/process calculation. The plane
// chart is isometric; mapped XYZ curve lengths keep physical millimetres.
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
      segmentMetadata:samples.slice(1).map(e=>({surfaceNormal:[...e.normal]}))};
  });
  if(affineSurface(slice))return strokes.map(stroke=>({...stroke,points:stroke.points.map(point=>evaluateSurface(slice,point).point),...(options.frames?{chartPoints:stroke.points,normals:stroke.points.map(point=>evaluateSurface(slice,point).normal),frameSamples:stroke.points.map(point=>sliceFrame(slice,point))}:{})}));
  return strokes.map(stroke=>mapSliceStroke(stroke,slice,options));
}

export function sliceFrame(slice,point){
  const {normal,du:seed}=evaluateSurface(slice,point);
  const u=normalize(seed.map((value,k)=>value-dot(seed,normal)*normal[k])),v=cross(normal,u);
  return {point:[...point,0],u,v,normal};
}

// UV and XY charts have different metrics. Step/chord tolerances are always
// physical XYZ millimetres; quarter probes catch curvature hidden at midpoint.
// Optional geometric frames are data, not a request to rotate a fixed-axis tool.
export function mapSliceStroke(stroke,slice,{sampleStepMm=slice.sampleStepMm??.2,toleranceMm=TOLERANCE.chord,frames=false}={}) {
  requireThat(sampleStepMm>0&&Number.isFinite(sampleStepMm)&&toleranceMm>0&&Number.isFinite(toleranceMm),'Slice mapping needs positive physical tolerances.');
  const chartPoint=point=>slice.kind==='patch'?point.map((x,k)=>{
    const [lo,hi]=[slice.patch.domainU,slice.patch.domainV][k];
    requireThat(x>=lo-PRINT_RESOLUTION_MM&&x<=hi+PRINT_RESOLUTION_MM,'Slice mapping leaves its spline chart.');
    return Math.max(lo,Math.min(hi,x));
  }):point;
  const source=(stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points).map(chartPoint);
  const points=[evaluateSurface(slice,source[0]).point],chartPoints=[source[0]],counts={evaluations:1};
  const split=(a,b,pa,pb)=>{
    const probes=[.25,.5,.75].map(t=>{const chart=a.map((v,k)=>v+t*(b[k]-v));return {chart,point:evaluateSurface(slice,chart).point,t};});
    counts.evaluations+=3;
    const error=Math.max(...probes.map(({point,t})=>Math.hypot(...point.map((v,k)=>v-pa[k]-t*(pb[k]-pa[k])))));
    const polyline=[pa,...probes.map(probe=>probe.point),pb];
    const span=polyline.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-polyline[i][k])),0);
    if(span>sampleStepMm||error>toleranceMm){
      const middle=probes[1];
      requireThat(middle.chart.some((v,k)=>v!==a[k])&&middle.chart.some((v,k)=>v!==b[k]),'Curved slice mapping cannot converge at parameter precision; inspect a discontinuity.');
      split(a,middle.chart,pa,middle.point);split(middle.chart,b,middle.point,pb);
    }else {points.push(pb);chartPoints.push(b);}
  };
  for(let i=1;i<source.length;i++) {counts.evaluations++;split(source[i-1],source[i],points.at(-1),evaluateSurface(slice,source[i]).point);}
  const normals=frames?chartPoints.map(point=>evaluateSurface(slice,point).normal):null;
  const frameSamples=frames?chartPoints.map(point=>sliceFrame(slice,point)):null;
  return {...stroke,closed:false,points,...(frames?{chartPoints,normals,frameSamples,mappingReport:{evaluations:counts.evaluations+chartPoints.length,points:points.length}}:{})};
}
