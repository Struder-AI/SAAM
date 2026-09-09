// Generation: locked plan in, SAAMpath out.
//
// The order is fixed by the geometry, not by a further planning step. If a
// draped skin is selected, its survey runs first because it decides how much
// material the planar body must leave under the top surface; the body then
// fills up to that reserved surface, and the skin follows the surface down to
// it. With no skin selected the body simply fills the whole solid.

import { makeShell, assertClosed } from '../geom/shell.mjs';
import { boxShell, wedgeShell, splineTopShell, splineSideShell, verticalSplineSideShell } from '../geom/shapes.mjs';
import { PathBuilder } from '../path/builder.mjs';
import { generateFullFill } from '../../skills/full-fill/scripts/fill.mjs';
import { generateDrapedSkin, surveySurface, machineMaxAngle, DRAPED_SKIN_DEFAULTS } from '../../skills/draped-skin/scripts/drape.mjs';
import { validatePlan, VERSION } from './plan.mjs';
import { requireThat } from '../geom/tolerance.mjs';

export function buildShell(rhino, geometry) {
  if (geometry.shape === 'box') return boxShell(rhino, { xMm: geometry.runMm, yMm: geometry.widthMm, zMm: geometry.heightMm ?? 10 });
  if (geometry.shape === 'wedge') return wedgeShell(rhino, { runMm: geometry.runMm, widthMm: geometry.widthMm, baseMm: geometry.baseMm ?? 2, angleDeg: geometry.angleDeg ?? 15 });
  if (geometry.shape === 'spline-shell') return splineSideShell(rhino, {
    runMm: geometry.runMm, widthMm: geometry.widthMm, cpU: geometry.cpU, cpV: geometry.cpV,
    longSideInsetMm: geometry.longSideInsetMm, shortSideOutsetMm: geometry.shortSideOutsetMm,
    heights: (i, j) => geometry.heightsMm[i][j]
  });
  if (geometry.shape === 'vertical-spline-shell') return verticalSplineSideShell(rhino, {
    runMm: geometry.runMm, widthMm: geometry.widthMm, cpU: geometry.cpU, cpV: geometry.cpV,
    xBulgeMm: geometry.xBulgeMm, yInsetMm: geometry.yInsetMm,
    heights: (i, j) => geometry.heightsMm[i][j]
  });
  return splineTopShell(rhino, {
    runMm: geometry.runMm, widthMm: geometry.widthMm, cpU: geometry.cpU, cpV: geometry.cpV,
    heights: (i, j) => geometry.heightsMm[i][j]
  });
}

// Placement moves the whole shell onto the bed by shifting control points; the
// patches keep their parameterisation, so sections and surface solves are
// unaffected apart from the translation.
export function translateShell(shell, dx, dy) {
  const patches = shell.patches.map(patch => {
    const cp = Float64Array.from(patch.cp);
    for (let i = 0; i < cp.length; i += 4) {
      const w = cp[i + 3];
      cp[i] += dx * w;
      cp[i + 1] += dy * w;
    }
    return { ...patch, cp };
  });
  const moved = makeShell(patches, { name: shell.name });
  moved.surfaces = shell.surfaces;
  return assertClosed(moved);
}

export function generatePath(plan, machine, rhino) {
  validatePlan(plan, machine);
  const placed = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const process = plan.process;
  const fill = plan.skills['full-fill'], skin = plan.skills['draped-skin'];

  const builder = new PathBuilder({
    start: [...machine.tools[plan.setup.tool].startupXY, machine.startup.zAfterPrimeMm],
    process, machine, generatorVersion: VERSION
  });
  builder.setContext('start', 0);
  builder.fan(0);

  let survey = null;
  if (skin.enabled) {
    const declaredLimitDeg = machineMaxAngle(machine);
    const effectiveLimitDeg = skin.maxAngleDegOverride ?? declaredLimitDeg;
    survey = surveySurface(placed, { ...DRAPED_SKIN_DEFAULTS, ...skin }, effectiveLimitDeg);
    survey.declaredLimitDeg = declaredLimitDeg;
    survey.experimentalOverride = skin.maxAngleDegOverride !== null && skin.maxAngleDegOverride !== declaredLimitDeg;
    requireThat(Number.isFinite(survey.maxMm), 'The top surface survey found no surface to skin.');
  }

  const summary = { generatorVersion: VERSION, shape: plan.geometry.shape };
  if (fill.enabled) summary.fullFill = generateFullFill(builder, { shell: placed, plan, reserve: survey });
  if (skin.enabled) summary.drapedSkin = generateDrapedSkin(builder, { shell: placed, plan, machine, survey });

  builder.setContext('finish', 0);
  builder.retract();
  builder.move([builder.position[0], builder.position[1], placed.bounds.max[2] + process.liftMm], process.zSpeedMmS);
  builder.fan(0);

  summary.boundsMm = placed.bounds;
  summary.clearance = 'operator responsibility; no collision model implemented';
  summary.physicalValidation = 'not performed';
  if (survey) summary.nonplanarLimit = {
    machineMaxAngleDeg: survey.declaredLimitDeg,
    effectiveMaxAngleDeg: survey.limitDeg,
    experimentalOverride: survey.experimentalOverride,
    surfaceMaxSlopeDeg: Number(survey.maxSlopeDeg.toFixed(3)),
    excludedAreaPercent: Number((survey.steepFraction * 100).toFixed(2))
  };
  return builder.toPath(summary);
}
