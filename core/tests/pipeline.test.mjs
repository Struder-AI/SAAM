import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import rhino3dm from 'rhino3dm';
import { defaults, validatePlan, canonical, VERSION, BUILD_DATE } from '../print/plan.mjs';
import { generatePath } from '../print/generate.mjs';
import { exportGriffin, interpretGriffin } from '../export/griffin.mjs';

const rhino = await rhino3dm();
const machine = JSON.parse(readFileSync('machines/ultimaker-s5.json', 'utf8'));

function smallPlan() {
  const plan = defaults();
  plan.geometry = { shape: 'spline-top', runMm: 16, widthMm: 12, cpU: 4, cpV: 4, heightsMm: [[3, 3, 3, 3], [3, 4, 4, 3], [3, 4, 4, 3], [3, 3, 3, 3]] };
  plan.process = { ...plan.process, minimumLayerSeconds: 0 };
  return plan;
}

test('both skills generate one program from one locked plan', () => {
  const plan = smallPlan();
  validatePlan(plan, machine);
  const path = generatePath(plan, machine, rhino);
  assert.equal(path.schema, 'saampath/1');
  assert.ok(path.summary.fullFill.layers > 5, 'the body prints planar layers');
  assert.equal(path.summary.drapedSkin.skinLayers, 2);
  const phases = new Set(path.actions.map(action => action.phase));
  assert.ok(phases.has('planar') && phases.has('draped-skin'), 'both patterns appear in one path');
  // The body stops under the skin, and the skin is what reaches the top.
  const topPlanar = Math.max(...path.actions.filter(a => a.phase === 'planar' && a.volumeMm3 > 0).map(a => a.to[2]));
  const topSkin = Math.max(...path.actions.filter(a => a.phase === 'draped-skin' && a.volumeMm3 > 0).map(a => a.to[2]));
  assert.ok(topSkin > topPlanar, `skin tops out at ${topSkin} above the body at ${topPlanar}`);
});

test('a spline-sided shell reaches both patterns through the locked plan', () => {
  const plan = smallPlan();
  plan.geometry = {
    shape: 'vertical-spline-shell', runMm: 16, widthMm: 12, cpU: 4, cpV: 4,
    xBulgeMm: 2, yInsetMm: 1.5,
    heightsMm: [[3, 3, 3, 3], [3, 5, 5, 3], [3, 5, 5, 3], [3, 3, 3, 3]]
  };
  validatePlan(plan, machine);
  const tooFarLeft = structuredClone(plan);
  tooFarLeft.placement.xMm = 5;
  assert.throws(() => validatePlan(tooFarLeft, machine), /Placement X/,
    'the short-side flare must remain inside the printer bounds');
  const path = generatePath(plan, machine, rhino);
  assert.equal(path.summary.shape, 'vertical-spline-shell');
  assert.ok(path.summary.fullFill.layers > 5);
  assert.equal(path.summary.drapedSkin.skinLayers, 2);
  assert.ok(path.summary.fullFill.unclippedLayers > 0, 'vertical sides retain their ordinary planar body layers');
});

test('an explicit per-print angle override leaves the machine declaration visible', () => {
  const plan = smallPlan();
  plan.skills['draped-skin'].maxAngleDegOverride = 45;
  validatePlan(plan, machine);
  const path = generatePath(plan, machine, rhino);
  assert.equal(path.summary.nonplanarLimit.machineMaxAngleDeg, 15);
  assert.equal(path.summary.nonplanarLimit.effectiveMaxAngleDeg, 45);
  assert.equal(path.summary.nonplanarLimit.experimentalOverride, true);
  const invalid = structuredClone(plan);
  invalid.skills['draped-skin'].maxAngleDegOverride = 90;
  assert.throws(() => validatePlan(invalid, machine), /Experimental non-planar override/);
});

test('strict field checking names the unexpected and missing settings', () => {
  const retired = smallPlan();
  retired.skills['planar-infill'] = {...retired.skills['planar-infill'], maxPatternCell: 400000};
  assert.throws(() => validatePlan(retired, machine),
    /Unexpected or missing fields in plan\.skills\.planar-infill: unexpected maxPatternCell\.$/m);
  const stripped = smallPlan();
  delete stripped.process.layerMm;delete stripped.process.fanPercent;
  assert.throws(() => validatePlan(stripped, machine),
    /Unexpected or missing fields in plan\.process: missing fanPercent, layerMm\.$/m);
  const both = smallPlan();
  both.process = {...both.process, layerHeight: both.process.layerMm};delete both.process.layerMm;
  assert.throws(() => validatePlan(both, machine),
    /Unexpected or missing fields in plan\.process: unexpected layerHeight; missing layerMm\.$/m);
});

test('the export round trips through a strict interpreter', () => {
  const plan = smallPlan();
  const path = generatePath(plan, machine, rhino);
  const code = exportGriffin(path, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE });
  const program = interpretGriffin(code, plan, machine);
  const expected = path.actions.filter(action => action.kind === 'move');
  assert.equal(program.moves.length, expected.length, 'every SAAMpath move appears in the program');
  for (let i = 0; i < expected.length; i++) {
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(expected[i].to[k] - program.moves[i].to[k]) <= 6e-6);
    assert.ok(Math.abs(expected[i].volumeMm3 - program.moves[i].volumeMm3) < 1e-4);
  }
  // The header fields the printer's reader requires.
  for (const key of ['GENERATOR.NAME', 'GENERATOR.VERSION', 'GENERATOR.BUILD_DATE', 'BUILD_VOLUME.TEMPERATURE', `EXTRUDER_TRAIN.${plan.setup.tool}.MATERIAL.GUID`])
    assert.ok(program.header[key]?.trim(), `${key} is present`);
});

test('generation from the same plan is deterministic', () => {
  const plan = smallPlan();
  const first = generatePath(plan, machine, rhino);
  const second = generatePath(plan, machine, rhino);
  assert.equal(canonical(first), canonical(second));
  assert.equal(
    exportGriffin(first, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE }),
    exportGriffin(second, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE }));
});

test('the interpreter rejects programs it cannot account for', () => {
  const plan = smallPlan();
  const path = generatePath(plan, machine, rhino);
  const code = exportGriffin(path, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE });
  const cases = [
    ['unsupported command', code.replace('\nM400', '\nM117 hello\nM400'), /Unsupported|Unrecognized|Malformed/],
    ['move outside the build volume', code.replace(/G1 X[\d.]+/, 'G1 X999'), /Out-of-bounds/],
    ['missing build date', code.replace(/;GENERATOR\.BUILD_DATE:.*\n/, ''), /BUILD_DATE/],
    ['wrong tool', code.replace(/^T\d/m, 'T0'), /Unexpected tool change/]
  ];
  for (const [name, broken, pattern] of cases)
    assert.throws(() => interpretGriffin(broken, plan, machine), pattern, name);
});

