// full-fill: solid planar layers for any closed shell.
//
// Each layer is the shell's own section at that height, so the pattern follows
// whatever the part actually is rather than a parameterised outline. Perimeter
// loops are inward offsets of that section; the interior is filled solid at the
// bead spacing, with the fill direction alternating between layers.
//
// When a draped skin is also being printed, the body must stop short of the top
// surface by the skin's thickness. That reservation arrives as a height field
// and is applied by intersecting each layer with the level set where the
// reserved surface is still above the layer - the general form of the wedge
// demo's flat "core plane".

import { sectionShell } from '../../../core/geom/shell.mjs';
import { offsetRegion, scanlineFill, regionArea } from '../../../core/region/region2d.mjs';
import { intersect, levelSetRegion, levelSetCoverage } from '../../../core/region/boolean.mjs';
import { planarPolicy, orderStrokes } from '../../../core/path/builder.mjs';
import { requireThat, distance2 } from '../../../core/geom/tolerance.mjs';

export const FULL_FILL_DEFAULTS = {
  perimeters: 2,
  fillAnglesDeg: [45, 135],
  fillOverlap: 0.15,
  minFeatureMm: 0.4
};

// Layer heights from the first layer up to the top of what this skill prints.
export function layerHeights(process, fromMm, toMm) {
  const heights = [];
  for (let index = 0; ; index++) {
    const z = fromMm + process.firstLayerMm + index * process.layerMm;
    if (z > toMm + 1e-9) break;
    heights.push(z);
    if (heights.length > 20000) throw new Error('Layer count exceeds the supported limit.');
  }
  return heights;
}

export function generateFullFill(builder, { shell, plan, reserve = null }) {
  const process = plan.process, settings = { ...FULL_FILL_DEFAULTS, ...plan.skills['full-fill'] };
  const width = process.lineWidthMm;
  const top = reserve ? reserve.maxMm : shell.bounds.max[2];
  const heights = layerHeights(process, shell.bounds.min[2], top);
  requireThat(heights.length > 0, 'No planar layers fit below the reserved surface; the part is thinner than one layer.');

  const report = { layers: 0, skippedLayers: 0, unclippedLayers: 0, areaMm2: 0, perimeterLoops: 0, fillRows: 0, nudgedLayers: 0 };
  for (const [index, z] of heights.entries()) {
    const height = index === 0 ? process.firstLayerMm : process.layerMm;
    const speed = index === 0 ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const section = sectionShell(shell, z, { minFeatureMm: settings.minFeatureMm });
    if (section.nudgedByMm) report.nudgedLayers++;
    // Below the reserved surface the body prints solid; where the skin has
    // claimed the material, the body stops. A layer entirely below the reserve
    // needs no clipping at all, which is the common case low down in the part.
    let region = section.loops;
    if (reserve) {
      const coverage = levelSetCoverage(reserve.field, z);
      if (coverage === 'none') { report.skippedLayers++; continue; }
      if (coverage === 'partial') region = intersect(section.loops, levelSetRegion(reserve.field, z));
      else report.unclippedLayers++;
    }
    if (!region.length || regionArea(region) < width * width) { report.skippedLayers++; continue; }

    builder.setContext('planar', index);
    if (index === 1) builder.fan(process.fanPercent);
    const strokes = [];
    let inner = region;
    for (let ring = 0; ring < settings.perimeters; ring++) {
      const loops = offsetRegion(region, -(width / 2 + ring * width));
      if (!loops.length) break;
      for (const loop of loops) strokes.push({ role: ring === 0 ? 'perimeter' : 'perimeter-inner', closed: true, points: loop });
      inner = loops;
      report.perimeterLoops += loops.length;
    }
    // Fill starts half a bead inside the last perimeter, less the overlap that
    // welds fill to perimeter.
    const inset = width * (settings.perimeters + 0.5 - settings.fillOverlap) - width / 2;
    const fillRegion = settings.perimeters > 0 ? offsetRegion(region, -(width / 2 + inset)) : region;
    const angle = settings.fillAnglesDeg[index % settings.fillAnglesDeg.length];
    const rows = fillRegion.length ? scanlineFill(fillRegion, width, angle) : [];
    report.fillRows += rows.length;
    // Alternate direction down the rows so consecutive strokes end where the
    // next one starts; the travel planner then joins or combs instead of hopping.
    rows.forEach((row, position) => {
      const points = position % 2 ? [row.to, row.from] : [row.from, row.to];
      strokes.push({ role: 'fill', closed: false, points });
    });

    const policy = planarPolicy(region, {
      layerZ: z,
      liftMm: process.liftMm,
      maxCombMm: process.maxCombMm,
      lineWidthMm: width
    });
    printStrokes(builder, strokes, z, height, speed, policy, { fillFirst: false });
    builder.finishLayer(z + process.liftMm);
    report.layers++;
    report.areaMm2 += regionArea(region);
  }
  return report;
}

// Print ordered strokes at one height. Ordering is nearest-first, and fill rows
// keep their generated order so the boustrophedon survives.
export function printStrokes(builder, strokes, z, height, speed, policy, { fillFirst = false } = {}) {
  const loops = strokes.filter(stroke => stroke.closed);
  const lines = strokes.filter(stroke => !stroke.closed);
  const ordered = fillFirst
    ? [...orderStrokes(lines, builder.position), ...orderStrokes(loops, builder.position)]
    : [...orderStrokes(loops, builder.position), ...lines];
  for (const stroke of ordered) {
    const points = stroke.points.map(point => [point[0], point[1], z]);
    builder.travelTo(points[0], policy);
    for (let i = 1; i < points.length; i++) {
      const length = distance2(points[i - 1], points[i]);
      builder.move(points[i], speed, length * builder.process.lineWidthMm * height, { role: stroke.role });
    }
  }
}
