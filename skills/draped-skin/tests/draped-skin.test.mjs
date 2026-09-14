import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import rhino3dm from 'rhino3dm';
import { defaults, validatePlan } from '../../../core/print/plan.mjs';
import { buildShell, translateShell, generatePath } from '../../../core/print/generate.mjs';
import { PathBuilder } from '../../../core/path/builder.mjs';
import { generateDrapedSkin, surveySurface, machineMaxAngle, DRAPED_SKIN_DEFAULTS } from '../scripts/drape.mjs';
import { topAt } from '../../../core/geom/field.mjs';
import { sampleTopSurface } from '../../../core/geom/query.mjs';

const rhino = await rhino3dm();
const machine = JSON.parse(readFileSync('machines/ultimaker-s5.json', 'utf8'));

const gentle = [[4, 4, 4, 4], [4, 5, 5, 4], [4, 5, 5, 4], [4, 4, 4, 4]];
// Tall control heights over a small footprint: too steep to follow.
const steep = [[4, 4, 4, 4], [4, 12, 12, 4], [4, 12, 12, 4], [4, 4, 4, 4]];

function planFor(heightsMm, overrides = {}) {
  const plan = defaults();
  plan.geometry = { shape: 'spline-top', runMm: 18, widthMm: 14, cpU: 4, cpV: 4, heightsMm };
  plan.skills['full-fill'] = { ...plan.skills['full-fill'], enabled: false };
  plan.skills['draped-skin'] = { ...plan.skills['draped-skin'], ...overrides };
  return plan;
}

function run(plan) {
  const shell = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const settings = { ...DRAPED_SKIN_DEFAULTS, ...plan.skills['draped-skin'] };
  const survey = surveySurface(shell, settings, machineMaxAngle(machine));
  const builder = new PathBuilder({
    start: [...machine.tools[plan.setup.tool].startupXY, machine.startup.zAfterStartupMm],
    process: plan.process, machine, generatorVersion: 'test'
  });
  const report = generateDrapedSkin(builder, { shell, plan, machine, survey });
  return { shell, survey, builder, report, path: builder.toPath({}), settings };
}

test('reserve survey reports the complete roof slope without a separate surface pass',()=>{
  const plan=planFor(steep,{surveyStepMm:1.3});
  const shell=translateShell(buildShell(rhino,plan.geometry),81.125,43.375);
  const settings=plan.skills['draped-skin'];
  const survey=surveySurface(shell,settings,machineMaxAngle(machine));
  const reference=sampleTopSurface(shell,{stepMm:settings.surveyStepMm});
  assert.ok(Math.abs(survey.maxSlopeDeg-reference.maxSlopeDeg)<1e-9);
  assert.ok(survey.steepFraction>0);
  assert.throws(()=>surveySurface(shell,{...settings,surveyStepMm:0},15),/Sampling step/);
});

test('skin strokes lie on the surface, not on flat layers', () => {
  const plan = planFor(gentle);
  const { shell, path, settings } = run(plan);
  const layers = settings.layers, thickness = settings.normalMm;
  let checked = 0, distinctHeights = new Set();
  for (const action of path.actions) {
    if (action.kind !== 'move' || !(action.volumeMm3 > 0)) continue;
    const [x, y, z] = action.to;
    const top = topAt(shell, x, y);
    assert.ok(top, 'every printed skin point is over the part');
    const below = layers - 1 - action.layer;
    const expected = top.zMm - below * thickness / Math.cos(top.slopeDeg * Math.PI / 180);
    assert.ok(Math.abs(z - expected) < 1e-6, `skin point at ${z} against surface ${expected}`);
    distinctHeights.add(z.toFixed(2));
    checked++;
  }
  assert.ok(checked > 200, `checked ${checked} skin points`);
  // A flat-layer pattern would put every stroke of a layer at one height.
  assert.ok(distinctHeights.size > 20, `skin follows the surface across ${distinctHeights.size} heights`);
});

test('skins stack at the spacing measured along the surface normal', () => {
  const plan = planFor(gentle, { layers: 3 });
  const { shell, path, settings } = run(plan);
  const sample = path.actions.find(action => action.kind === 'move' && action.volumeMm3 > 0 && action.layer === 0);
  const top = topAt(shell, sample.to[0], sample.to[1]);
  const cosine = Math.cos(top.slopeDeg * Math.PI / 180);
  const expectedGap = settings.normalMm / cosine;
  const above = path.actions.filter(action => action.kind === 'move' && action.volumeMm3 > 0 && action.layer === 1)
    .map(action => ({ action, distance: Math.hypot(action.to[0] - sample.to[0], action.to[1] - sample.to[1]) }))
    .sort((a, b) => a.distance - b.distance)[0];
  assert.ok(above.distance < 1, 'found a point of the next skin above the same place');
  assert.ok(Math.abs((above.action.to[2] - sample.to[2]) - expectedGap) < 0.05,
    `vertical spacing ${above.action.to[2] - sample.to[2]} against ${expectedGap}`);
});

test('surface steeper than the machine limit is excluded and reported, not printed flat', () => {
  const limit = machineMaxAngle(machine);
  const plan = planFor(steep);
  const { shell, survey, report, path } = run(plan);
  assert.ok(survey.maxSlopeDeg > limit, 'this surface really is too steep somewhere');
  assert.ok(report.excludedFraction > 0, 'the excluded area is reported');
  assert.equal(report.limitDeg, limit);
  for (const action of path.actions) {
    if (action.kind !== 'move' || !(action.volumeMm3 > 0)) continue;
    const top = topAt(shell, action.to[0], action.to[1]);
    assert.ok(top.slopeDeg <= limit + 0.5, `printed on ${top.slopeDeg} degree surface, over the ${limit} degree limit`);
  }
});

test('the machine must declare its non-planar limit', () => {
  const withoutLimit = { ...machine, nonplanar: undefined };
  assert.throws(() => machineMaxAngle(withoutLimit), /nonplanar\.maxAngleDeg/);
  const plan = planFor(gentle);
  assert.throws(() => validatePlan(plan, withoutLimit), /nonplanar\.maxAngleDeg/);
});

test('travel over a curved surface clears that surface, not the whole part', () => {
  const plan = planFor(gentle);
  const { shell, path, builder } = run(plan);
  const partMax = shell.bounds.max[2];
  let belowPartMax = 0, travels = 0;
  for (const action of path.actions) {
    if (action.kind !== 'move' || action.volumeMm3 > 0) continue;
    travels++;
    const top = topAt(shell, action.to[0], action.to[1]);
    if (top) assert.ok(action.to[2] >= top.zMm - plan.skills['draped-skin'].normalMm * plan.skills['draped-skin'].layers - 1e-6,
      'travel never drops through the surface');
    if (action.to[2] < partMax + plan.process.liftMm - 1e-6) belowPartMax++;
  }
  assert.ok(travels > 0);
  // Verified adjacent moves retain the local surface policy.
  assert.ok(belowPartMax > 0, 'some travel stays below the full part clearance height');
  assert.ok(builder.stats.combed > 0, 'neighbouring skin strokes cross directly');
});

test('a plan whose reserved skin exceeds the part is rejected', () => {
  // A flat 4 mm top with 4 mm of reserved skin leaves no body at all.
  const flat = [[4, 4, 4, 4], [4, 4, 4, 4], [4, 4, 4, 4], [4, 4, 4, 4]];
  const plan = planFor(flat, { layers: 8, normalMm: 0.5 });
  plan.skills['full-fill'] = { ...plan.skills['full-fill'], enabled: true };
  validatePlan(plan, machine);
  assert.throws(() => generatePath(plan, machine, rhino), /No planar layers fit|reserved/);
});
