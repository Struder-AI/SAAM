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
import { clipOpenPaths, difference, intersect, union } from './intersection.mjs';
import { fillPatternStrokes } from './fill-patterns.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { cleanPlanarLoop } from '../geom/polyline.mjs';
import { slicePoint, sliceNormal } from '../geom/slice.mjs';
import { evaluate } from '../geom/nurbs.mjs';
import { requireThat, TOLERANCE, normalize, cross, dot } from '../geom/tolerance.mjs';

// Loops on boundaries between owners: the one place this choice is made (the
// owner is deciding, 2026-09-28). true: every owner lays its loops along every
// boundary of its own region, those it shares with other owners included.
// false: loops follow only the part's material boundary, clipped to the owner's
// region, and fill reaches past an owner boundary by fillOverlap.
export const LOOPS_ON_OWNER_BOUNDARIES = true;

// The boundary a layer's loops and fill are measured from, and whether loops
// are clipped to the region: see LOOPS_ON_OWNER_BOUNDARIES.
export function loopBoundary(region, { material = region, share = null, outward = false }) {
  if (outward) return { boundary: material, clipped: false };
  return LOOPS_ON_OWNER_BOUNDARIES || !share ? { boundary: region, clipped: false } : { boundary: material, clipped: true };
}

// region: owned loops in the chart. material: the part's sliced material on
// the layer (the region itself by default). share: null when the owner holds
// all of material, else {within, claims}: its volume section (null for the
// whole plane) and the sections it yields. loopBoundary chooses what the loops
// follow. outward: loops grow out of material (a brim) and no fill is laid.
// solid: the part of the region filled solid (null when no mask applies).
// Settings: widthMm, loops, fillDensity, fillPattern, fillAngleDeg and
// solidDensity (solid rows), patternAngleDeg (sparse pattern), fillOverlap,
// spacingFactor, sampleStepMm, phaseMm (the gyroid's third coordinate),
// wallToleranceMm.
// -> {walls, infill, fill, interior, sparseRegion, solidRegion}: walls are
// loops, outermost first (open where the region cuts them); infill is the
// sparse pattern and fill the solid rows, alternating in direction so each
// row starts where the last ended.
export function layerStrokes(region, { widthMm, loops, fillDensity, fillPattern, fillAngleDeg, patternAngleDeg,
  solidDensity = 1, fillOverlap, spacingFactor, sampleStepMm, phaseMm = 0, wallToleranceMm = 0, solid = null,
  material = region, share = null, outward = false }) {
  requireThat(Number.isInteger(loops) && loops >= 0 && Number.isFinite(fillDensity) && fillDensity >= 0 && fillDensity <= 1,
    'A slice layer needs a whole loop count and a fill density from 0 to 1.');
  const pitch = lineSpacing(widthMm, { spacingFactor });
  const { boundary, clipped } = loopBoundary(region, { material, share, outward });
  const walls = [];
  for (let ring = 0; ring < loops; ring++) {
    const distance = widthMm / 2 + ring * pitch;
    const found = outward ? offsetRegion(boundary, distance) : perimeterLoops(boundary, distance);
    if (!found.length) break;
    // Simplify only the finished deposition contour to machine precision; the
    // offset region keeps owning material topology.
    const cleaned = found.map(loop => cleanPlanarLoop(loop, wallToleranceMm === 0 ? TOLERANCE.plane : wallToleranceMm));
    for (const { points, closed } of clipped ? clipLoops(cleaned, region, widthMm) : cleaned.map(points => ({ points, closed: true })))
      walls.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', closed, points, beadWidthMm: widthMm });
  }
  // Fill starts half a bead inside the last loop, less the overlap that welds
  // fill to loops; past a boundary between owners it reaches by the overlap.
  const inset = widthMm * (loops + 0.5 - fillOverlap) - widthMm / 2 + Math.max(0, loops - 1) * (pitch - widthMm);
  let interior = outward ? [] : offsetRegion(boundary, loops > 0 ? -(widthMm / 2 + inset) : -widthMm / 2);
  if (clipped && interior.length) {
    const reach = widthMm * (0.5 - fillOverlap);
    if (share.within) interior = intersect(interior, offsetRegion(share.within, -reach));
    if (share.claims.length) interior = difference(interior, offsetRegion(share.claims, reach));
  }
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

const pathLength = points => points.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0, 0);
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-7;
// Closed loops clipped to a region. A loop wholly inside stays closed; a cut
// loop becomes open pieces, the two meeting at its start joined into one.
// Pieces shorter than half a bead are dropped: they would deposit a blob.
function clipLoops(loops, region, widthMm) {
  const out = [];
  for (const loop of loops) {
    const path = [...loop, loop[0]], total = pathLength(path);
    const pieces = clipOpenPaths([path], region);
    if (total - pieces.reduce((sum, piece) => sum + pathLength(piece), 0) <= 1e-6 * Math.max(1, total)) { out.push({ points: loop, closed: true }); continue; }
    const head = pieces.find(p => same(p[0], loop[0])), tail = pieces.find(p => p !== head && same(p.at(-1), loop[0]));
    const joined = head && tail ? [[...tail, ...head.slice(1)], ...pieces.filter(p => p !== head && p !== tail)] : pieces;
    for (const points of joined) if (pathLength(points) >= widthMm / 2) out.push({ points, closed: false });
  }
  return out;
}

// Material the loops of a layer cover: the band inward from the loop boundary,
// one ring per loop when loops are spaced wider than a bead, within the region.
// options: {material, share, outward} as for layerStrokes.
export function loopMaterial(region, { widthMm, loops, spacingFactor }, options = {}) {
  const { boundary, clipped } = loopBoundary(region, options);
  if (options.outward) return region;
  const band = loopBand(boundary, { widthMm, loops, spacingFactor });
  return clipped ? intersect(band, region) : band;
}
function loopBand(material, { widthMm, loops, spacingFactor }) {
  const pitch = lineSpacing(widthMm, { spacingFactor });
  if (pitch === widthMm) return difference(material, offsetRegion(material, -widthMm * loops));
  return union(Array.from({ length: loops }, (_, ring) => difference(ring ? offsetRegion(material, -ring * pitch) : material,
    offsetRegion(material, -ring * pitch - widthMm))).flat(), []);
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
  if(slice.kind==='plane')return strokes.map(stroke=>({...stroke,points:stroke.points.map(point=>slicePoint(slice,point)),...(options.frames?{chartPoints:stroke.points,normals:stroke.points.map(()=>[...slice.normal]),frameSamples:stroke.points.map(point=>sliceFrame(slice,point))}:{})}));
  return strokes.map(stroke=>mapSliceStroke(stroke,slice,options));
}

export function sliceFrame(slice,point){
  const normal=sliceNormal(slice,point),seed=slice.kind==='plane'?slice.xAxis:slice.kind==='patch'?evaluate(slice.patch,...point).du:[1,0,-normal[0]/normal[2]];
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
  const points=[slicePoint(slice,source[0])],chartPoints=[source[0]],counts={evaluations:1};
  const split=(a,b,pa,pb)=>{
    const probes=[.25,.5,.75].map(t=>{const chart=a.map((v,k)=>v+t*(b[k]-v));return {chart,point:slicePoint(slice,chart),t};});
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
  for(let i=1;i<source.length;i++) {counts.evaluations++;split(source[i-1],source[i],points.at(-1),slicePoint(slice,source[i]));}
  const normals=frames?chartPoints.map(point=>sliceNormal(slice,point)):null;
  const frameSamples=frames?chartPoints.map(point=>sliceFrame(slice,point)):null;
  return {...stroke,closed:false,points,...(frames?{chartPoints,normals,frameSamples,mappingReport:{evaluations:counts.evaluations+chartPoints.length,points:points.length}}:{})};
}
