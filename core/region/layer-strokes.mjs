// Strokes of one slice layer. layerStrokes fills an owned layer region with
// loops and fill in the slice's chart; liftStrokes places them on the slice
// with their bead section. Both are plain functions of their inputs: the slice
// skill (core/print/slices.mjs) chooses the region, the solid mask and the
// angles for each layer.
//
// Offsets run through Clipper2 offsetRegion. BR-059 item 6 (D-041) asks for
// the curve offset with the slice as reference surface instead; measured on
// the 0.2.0 baseline prints it was 5x to over 1000x slower per layer, so the
// switch waits for a decision (.local/0.2.0/worker-A2.md).
import { offsetRegion } from './offset.mjs';
import { perimeterLoops } from './perimeters.mjs';
import { scanlineFill } from './region2d.mjs';
import { difference, intersect, union } from './boolean.mjs';
import { fillPatternStrokes } from './fill-patterns.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { cleanPlanarLoop } from '../geom/polyline.mjs';
import { slicePoint } from '../geom/slice.mjs';
import { requireThat, TOLERANCE } from '../geom/tolerance.mjs';

// region: owned loops in the chart. solid: the part of the region filled solid
// (null when no solid mask applies). Settings: widthMm, loops, fillDensity,
// fillPattern, fillAngleDeg and solidDensity (solid rows), patternAngleDeg (sparse pattern),
// fillOverlap, spacingFactor, sampleStepMm, phaseMm (the gyroid's third
// coordinate), wallToleranceMm.
// -> {walls, infill, fill, interior, sparseRegion, solidRegion}: walls are
// closed loops, outermost first; infill is the sparse pattern and fill the
// solid rows, alternating in direction so each row starts where the last ended.
export function layerStrokes(region, { widthMm, loops, fillDensity, fillPattern, fillAngleDeg, patternAngleDeg,
  solidDensity = 1, fillOverlap, spacingFactor, sampleStepMm, phaseMm = 0, wallToleranceMm = 0, solid = null }) {
  requireThat(Number.isInteger(loops) && loops >= 0 && Number.isFinite(fillDensity) && fillDensity >= 0 && fillDensity <= 1,
    'A slice layer needs a whole loop count and a fill density from 0 to 1.');
  const pitch = lineSpacing(widthMm, { spacingFactor });
  const walls = [];
  for (let ring = 0; ring < loops; ring++) {
    const found = perimeterLoops(region, widthMm / 2 + ring * pitch);
    if (!found.length) break;
    // Simplify only the finished deposition contour to machine precision; the
    // offset region keeps owning material topology.
    for (const loop of found) walls.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', closed: true,
      points: cleanPlanarLoop(loop, wallToleranceMm === 0 ? TOLERANCE.plane : wallToleranceMm), beadWidthMm: widthMm });
  }
  // Fill starts half a bead inside the last loop, less the overlap that welds
  // fill to loops.
  const inset = widthMm * (loops + 0.5 - fillOverlap) - widthMm / 2 + Math.max(0, loops - 1) * (pitch - widthMm);
  const interior = offsetRegion(region, loops > 0 ? -(widthMm / 2 + inset) : -widthMm / 2);
  const dense = fillDensity >= 1;
  const solidRegion = dense ? interior : solid?.length ? intersect(interior, solid) : [];
  const sparseRegion = dense ? [] : solid ? difference(interior, solid) : interior;
  const infill = fillPatternStrokes(sparseRegion, { pattern: fillPattern, widthMm, density: fillDensity, angleDeg: patternAngleDeg,
    zMm: phaseMm, sampleStepMm, spacingFactor })
    .map(stroke => ({ ...stroke, role: 'infill', points: stroke.closed ? [...stroke.points, stroke.points[0]] : stroke.points }));
  const fill = (solidRegion.length ? scanlineFill(solidRegion, pitch / solidDensity, fillAngleDeg) : [])
    .map((row, position) => ({ role: 'fill', closed: false, points: position % 2 ? [row.to, row.from] : [row.from, row.to], scanlineCell: row.cellId }));
  return { walls, infill, fill, interior, sparseRegion, solidRegion };
}

// Material the loops of a layer cover: the band from the region's boundary
// inward, one ring per loop when loops are spaced wider than a bead.
export function loopMaterial(region, { widthMm, loops, spacingFactor }) {
  const pitch = lineSpacing(widthMm, { spacingFactor });
  if (pitch === widthMm) return difference(region, offsetRegion(region, -widthMm * loops));
  return union(Array.from({ length: loops }, (_, ring) => difference(ring ? offsetRegion(region, -ring * pitch) : region,
    offsetRegion(region, -ring * pitch - widthMm))).flat(), []);
}

// Material fill strokes cover: their region grown by half a bead. Coverage
// takes part in booleans, so it is built to the chord tolerance.
export const fillMaterial = (region, widthMm) => region.length ? offsetRegion(region, widthMm / 2, { arcToleranceMm: TOLERANCE.chord }) : [];

// Chart strokes placed on a layer's slice: XYZ points, speed and bead section
// (width × layer height). Closed strokes keep their implicit closing segment.
export function liftStrokes(strokes, { slice, heightMm }, { widthMm, speedMmS }) {
  return strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => slicePoint(slice, point)), speedMmS,
    beadAreaMm2: (stroke.beadWidthMm ?? widthMm) * heightMm }));
}
