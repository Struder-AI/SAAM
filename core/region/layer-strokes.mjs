import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,normalize,cross,dot} from '../private/toolpath/numeric.mjs';
// Strokes of one slice layer. layerStrokes fills an owned layer region with
// loops and fill in the slice's chart; mapSliceStrokes maps coordinates to XYZ.
// Deposition dimensions belong to core/path/deposition.mjs. Both are plain functions of their inputs: the slice
// skill (core/print/slices.mjs) chooses the region, the solid mask and the
// angles for each layer.
//
// Offsets run through Clipper2 offsetRegion. BR-059 item 6 (D-041) asks for
// the curve offset with the slice as reference surface instead; measured on
// the 0.2.0 baseline prints it was 5x to over 1000x slower per layer (DEVLOG,
// 2026-09-28 slice skill), so the switch waits for a decision.
import { offsetRegion } from './offset.mjs';
import { perimeterLoops } from './perimeters.mjs';
import { scanlineFill } from './region2d.mjs';
import { difference, intersect, union } from './intersection.mjs';
import { fillPatternStrokes } from './fill-patterns.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { cleanPlanarLoop } from '../geom/polyline.mjs';

import {TOLERANCE} from '../geom/tolerance.mjs';

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
export function layerStrokes(region, { widthMm, loops, fillDensity, fillPattern, fillAngleDeg, patternAngleDeg,
  solidDensity = 1, fillOverlap, spacingFactor, sampleStepMm, phaseMm = 0, wallToleranceMm = 0, solid = null,
  material = region, outward = false }) {
  requireThat(Number.isInteger(loops) && loops >= 0 && Number.isFinite(fillDensity) && fillDensity >= 0 && fillDensity <= 1,
    'A slice layer needs a whole loop count and a fill density from 0 to 1.');
  const pitch = lineSpacing(widthMm, { spacingFactor });
  const boundary = outward ? material : region;
  const walls = [];
  for (let ring = 0; ring < loops; ring++) {
    const distance = widthMm / 2 + ring * pitch;
    const found = outward ? offsetRegion(boundary, distance) : perimeterLoops(boundary, distance);
    if (!found.length) break;
    // Simplify only the finished deposition contour to machine precision; the
    // offset region keeps owning material topology.
    const cleaned = found.map(loop => cleanPlanarLoop(loop, wallToleranceMm === 0 ? TOLERANCE.plane : wallToleranceMm));
    for (const points of cleaned)
      walls.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', closed: true, points, beadWidthMm: widthMm });
  }
  // Fill reaches half a bead beyond the last loop, less the overlap welding
  // fill to walls. The region offset retains material topology at collapse.
  const inset = widthMm * (loops + 0.5 - fillOverlap) - widthMm / 2 + Math.max(0, loops - 1) * (pitch - widthMm);
  const interior = outward ? [] : offsetRegion(boundary, loops > 0 ? -(widthMm / 2 + inset) : -widthMm / 2);
  const dense = fillDensity >= 1;
  const solidRegion = dense ? interior : solid?.length ? intersect(interior, solid) : [];
  const sparseRegion = dense ? [] : solid ? difference(interior, solid) : interior;
  const infill = fillPatternStrokes(sparseRegion, { pattern: fillPattern, widthMm, density: fillDensity, angleDeg: patternAngleDeg,
    zMm: phaseMm, sampleStepMm, spacingFactor })
    .map((stroke,lineIndex) => ({ ...stroke, role: 'infill',fillFamily:{spacingMm:pitch/fillDensity,lineIndex},points: stroke.closed ? [...stroke.points, stroke.points[0]] : stroke.points }));
  const fill = directedFillStrokes(solidRegion,{spacingMm:pitch/solidDensity,angleDeg:fillAngleDeg});
  return { walls, infill, fill, interior, sparseRegion, solidRegion };
}

export function directedFillStrokes(region,{spacingMm,angleDeg,reverseRows=false,role='fill'}) {
  const rows=region.length?scanlineFill(region,spacingMm,angleDeg):[];
  const sequence=reverseRows?rows.toReversed():rows;
  const radians=angleDeg*Math.PI/180;
  return sequence.map((row,position)=>({role,closed:false,points:position%2?[row.to,row.from]:[row.from,row.to],scanlineCell:row.cellId,fillFamily:{direction:[Math.cos(radians),Math.sin(radians)],spacingMm,lineIndex:position}}));
}

// Material the loops of a layer cover: the band inward from the loop boundary,
// one ring per loop when loops are spaced wider than a bead, within the region.
export function loopMaterial(region, { widthMm, loops, spacingFactor }, {outward=false} = {}) {
  if (outward) return region;
  const pitch = lineSpacing(widthMm, { spacingFactor });
  if (pitch === widthMm) return difference(region, offsetRegion(region, -widthMm * loops));
  return union(Array.from({ length: loops }, (_, ring) => difference(ring ? offsetRegion(region, -ring * pitch) : region,
    offsetRegion(region, -ring * pitch - widthMm))).flat(), []);
}

// Material fill strokes cover: their region grown by half a bead. Coverage
// takes part in booleans, so it is built to the chord tolerance.
export const fillMaterial = (region, widthMm) => region.length ? offsetRegion(region, widthMm / 2, { arcToleranceMm: TOLERANCE.chord }) : [];

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
  if(slice.kind==='plane')return strokes.map(stroke=>({...stroke,points:stroke.points.map(point=>evaluateSurface(slice,point).point),...(options.frames?{chartPoints:stroke.points,normals:stroke.points.map(()=>[...slice.normal]),frameSamples:stroke.points.map(point=>sliceFrame(slice,point))}:{})}));
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
    requireThat(x>=lo-1e-9&&x<=hi+1e-9,'Slice mapping leaves its spline chart.');
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
