// thick-lip: a finishing skill that thickens the top of a vase-wall into a
// rigid edge, instead of leaving the single bead a spiral or level ending
// prints on its own.
//
// This recovers a real, robot-tested idea from an earlier StruderBot-only
// version of this project (a Dobot lip that grew inward perimeters from a
// frozen hex rim). That version derived its geometry by hand for one regular
// hexagon (edge cutback, corner chord midpoints) and grew every added
// perimeter purely inward from the frozen outer wall. Here the corner-cutback
// math is replaced entirely by the shared convex-section offset that
// vase-wall and full-fill already use, so it works for any convex vase-wall
// section, not just a hexagon - and every step's ring set is centered on the
// wall's own printed centerline rather than kept flush with its outer face,
// so a bead directly below is never left without support on one side.
//
// The frozen outer section is queried once, at the boundary Z, and reused
// unchanged for every lip layer: only Z advances, XY does not. This is the
// fix for a real robot-confirmed failure in the old version, where growing a
// lip directly off a raw spiral end tore ("an unsupported extrusion-on chord
// from the partial-side end of the spiral to a fixed corner start"). Freezing
// the section requires a phase-neutral, fully closed boundary to grow from,
// which is exactly what vase-wall's endTransition:'level' produces and a raw
// spiral does not; composition enforces that dependency, not this file.
import {createSectionQuery} from '../../../core/geom/query.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {loopArea} from '../../../core/region/region2d.mjs';
import {cleanPlanarLoop} from '../../../core/geom/polyline.mjs';
import {planarPolicy} from '../../../core/path/builder.mjs';
import {convexLoop} from '../../vase-wall/scripts/vase.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

// steps is an explicit, maker-authored schedule: one array entry per lip
// layer, each the number of perimeters that layer prints. There is no
// automatic width-to-path-count math - toolpath reliability across a wide
// perimeter jump is exactly what this skill is still being validated
// against, so the schedule stays literal and inspectable rather than derived.
export const THICK_LIP_DEFAULTS = {
  enabled: false, part: null,
  steps: [2], minFeatureMm: 0.4
};
const OFFSET_PRECISION_MM = 0.00001;

export function thickLipResult({shell, plan, id = 'thick-lip', after = [], zStartMm}) {
  const settings = {...THICK_LIP_DEFAULTS, ...plan.skills['thick-lip']}, process = plan.process, width = process.lineWidthMm;
  const sectionAt = createSectionQuery(shell, {minFeatureMm: settings.minFeatureMm});
  const cut = sectionAt(zStartMm), outer = convexLoop(cut.loops);
  requireThat(Math.abs(cut.nudgedByMm ?? 0) <= settings.minFeatureMm / 4, 'Lip boundary section needed an unexpectedly large nudge; check the vase-wall ending Z.');
  // insetMm is measured from the true (unbeaded) outer surface, exactly as
  // vase-wall measures its own single centerline (insetMm = width/2). A
  // centered ring set can need insetMm below that - even negative, an
  // outward dilation - once a step asks for more than a couple of
  // perimeters; that is the intended behavior; centering is not bounded to
  // stay inside the wall printed below it.
  function ringAt(insetMm) {
    const inset = offsetRegion([outer], -insetMm, {precisionMm: OFFSET_PRECISION_MM, arcToleranceMm: settings.minFeatureMm / 4});
    requireThat(inset.length === 1 && loopArea(inset[0]) > 0, `Lip ring offset ${insetMm.toFixed(3)} mm from the outer wall (positive = inward) collapsed; adjust the steps schedule.`);
    return cleanPlanarLoop(inset[0]);
  }
  const spacing = width, baselineInsetMm = width / 2;

  const operations = [];
  let previous = after, z = zStartMm;
  settings.steps.forEach((n, stepIndex) => {
    z += process.layerMm;
    // Rings are centered on the wall's own centerline (offset 0 from
    // baselineInsetMm), not flush with its outer face: for n rings, offsets
    // run symmetrically from -(n-1)/2 to +(n-1)/2 spacing units, so whatever
    // is printed here always straddles the exact same line the terminal
    // wall bead below it followed.
    const mid = (n - 1) / 2;
    const strokes = Array.from({length: n}, (_, i) => ({
      role: `lip-step-${stepIndex}`, closed: true, beadAreaMm2: width * process.layerMm, speedMmS: process.planarSpeedMmS,
      points: ringAt(baselineInsetMm + (i - mid) * spacing).map(p => [...p, z])
    }));
    const operationId = `${id}:${operations.length}`;
    operations.push({
      id: operationId, layerId: 'lip:' + z, phase: 'planar', layer: operations.length, rank: z,
      after: [...previous], strokes, order: 'nearest',
      travelPolicy: planarPolicy([outer], {layerZ: z, liftMm: process.liftMm, maxCombMm: process.maxCombMm, lineWidthMm: width})
    });
    previous = [operationId];
  });
  return {
    id, operations,
    report: {
      steps: settings.steps, startMm: zStartMm, topMm: z,
      scope: 'Independently closed rings stacked above a level vase-wall rim, each step centered on the wall\'s own centerline rather than kept flush with its outer face; ordinary planar travel between rings, no continuous-spiral phase constraint to preserve. No physical validation.'
    }
  };
}
