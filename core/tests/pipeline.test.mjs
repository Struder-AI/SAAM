import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rhino3dm from 'rhino3dm';
import { defaults, validatePlan, canonical, VERSION, BUILD_DATE } from '../print/plan.mjs';
import { generatePath } from '../print/generate.mjs';
import { exportGriffin, interpretGriffin } from '../export/griffin.mjs';
import { makePreview, checkPreview } from '../print/cli.mjs';

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
    ['unsupported command', code.replace('\nM400', '\nM117 hello\nM400'), /Unsupported|Unrecognized/],
    ['move outside the build volume', code.replace(/G1 X[\d.]+/, 'G1 X999'), /leaves the build volume/],
    ['missing build date', code.replace(/;GENERATOR\.BUILD_DATE:.*\n/, ''), /BUILD_DATE/],
    ['wrong tool', code.replace(/^T\d/m, 'T0'), /locks T1|selects T0/]
  ];
  for (const [name, broken, pattern] of cases)
    assert.throws(() => interpretGriffin(broken, plan, machine), pattern, name);
});

test('a preview writes a bundle, records no approvals, and reopens identically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saam-shell-'));
  try {
    const { checks } = await makePreview(directory, { plan: smallPlan() });
    assert.equal(checks.mode, 'development');
    assert.match(checks.approvals, /none/);
    assert.equal(checks.physicalValidation, 'not performed');
    const written = await readFile(join(directory, 'exports/griffin-gcode/part.gcode'), 'utf8');
    assert.ok(written.startsWith(';START_OF_HEADER'));
    const reopened = await checkPreview(directory);
    assert.equal(reopened.exportHash, checks.exportHash, 'reopening regenerates the same bytes');
    // Nothing in the bundle claims a human approved anything.
    const bundle = await readFile(join(directory, 'checks.json'), 'utf8');
    assert.ok(!/approved/i.test(bundle.replace(/"approvals":\s*"[^"]*"/, '')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an edited export is caught when the print is reopened', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saam-shell-'));
  try {
    await makePreview(directory, { plan: smallPlan() });
    const file = join(directory, 'exports/griffin-gcode/part.gcode');
    const code = await readFile(file, 'utf8');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, code.replace(/G0 Z20 F300/, 'G0 Z21 F300'));
    await assert.rejects(() => checkPreview(directory), /does not match the plan/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
