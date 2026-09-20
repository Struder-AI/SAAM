import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {analyzeMeasurements, buildLadder, ladderNetworks, ladderPatch, predictWidths, ROUNDED_EXCESS} from '../scripts/ladder.mjs';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('the ladder is two low rails across the wall ends, around walls at 15 mm centerline pitch on their own layer grids', () => {
  const {networks, walls, placed, extentMm} = ladderNetworks();
  assert.deepEqual(placed.map(w => w.xMm), [0.125, 15.125, 30.125, 45.125, 60.125, 75.125], 'centerline to centerline, the first wall\'s outer face at x = 0');
  assert.deepEqual(extentMm, [76.375, 20], 'no wider than the walls: 75 mm between outer centerlines plus half of each outer wall');
  assert.deepEqual(walls.map(w => w.layerMm), [0.125, 0.25, 0.5, 0.75, 1, 1.25], 'layer height is half the commanded width');
  assert.deepEqual(walls.map(w => w.courses), [24, 12, 6, 4, 3, 2]);
  assert.deepEqual(walls.map(w => w.heightMm), [3, 3, 3, 3, 3, 2.5], 'as many whole courses as fit under 3 mm');
  const frame = networks[0];
  assert.equal(frame.id, 'frame');
  assert.equal(frame.layers, 2);
  assert.equal(frame.process, undefined, 'the rails use the nominal process width and layer height');
  assert.deepEqual(frame.strokes.map(s => s.closed), [false, false], 'two rails, not a box: the outer walls are the sides');
  assert.deepEqual(frame.strokes.map(s => s.points), [[[0.125, 0.2], [75.125, 0.2]], [[0.125, 19.8], [75.125, 19.8]]],
    'each rail runs from the first wall to the last, inside the wall ends by half its own width');
  for (const wall of placed) {
    const net = networks.find(n => n.id === wall.id);
    assert.equal(net.process.lineWidthMm, wall.widthMm);
    assert.equal(net.layers, wall.courses);
    assert.deepEqual(net.strokes[0].points, [[wall.xMm, 0], [wall.xMm, 20]]);
  }
});

test('the printed footprint is no wider or longer than the test walls', () => {
  const built = buildLadder({machineId: 'bambu-h2d'});
  const widthOf = n => n.process?.lineWidthMm ?? 0.4;
  const ink = built.lineNetwork.networks.flatMap(n => n.strokes.flatMap(s => s.points.map(([x, y]) => ({x, y, w: widthOf(n), wall: n.id !== 'frame'}))));
  const xs = ink.flatMap(p => [p.x - p.w / 2, p.x + p.w / 2]);
  const wallXs = ink.filter(p => p.wall).flatMap(p => [p.x - p.w / 2, p.x + p.w / 2]);
  near(Math.min(...xs), Math.min(...wallXs));
  near(Math.max(...xs), Math.max(...wallXs));
  near(Math.min(...xs), 0);
  near(Math.max(...xs) - Math.min(...xs), built.extentMm[0]);
  const rails = ink.filter(p => !p.wall);
  assert.ok(rails.every(p => p.y - p.w / 2 >= -1e-9 && p.y + p.w / 2 <= 20 + 1e-9), 'the rails sit within the walls\' length');
});

test('the machine limits decide which walls can be commanded, and why the others cannot', () => {
  const h2d = buildLadder({machineId: 'bambu-h2d'});
  assert.deepEqual(h2d.skipped.map(w => w.widthMm), [0.25, 2.5]);
  assert.match(h2d.skipped[0].reason, /lineWidthMm must be between 0\.3 and 2/);
  assert.equal(h2d.experimental, true, 'the 1 to 2 mm walls need experimental deposition');
  assert.deepEqual(h2d.lineNetwork.networks.map(n => n.id), ['frame', 'wall-0p5', 'wall-1', 'wall-1p5', 'wall-2']);
  assert.deepEqual(h2d.extentMm, [46.25, 20], 'the rails span only the four walls that print');
  assert.equal(h2d.lineNetwork.layers, 12);
  // Only the 0.5 mm wall is allowed on the S5, and one wall has nothing to tie to.
  assert.throws(() => buildLadder({machineId: 'ultimaker-s5'}), /needs at least two walls/);
  const s5 = buildLadder({machineId: 'ultimaker-s5', widthsMm: [0.4, 0.5, 0.6]});
  assert.equal(s5.experimental, false, 'a tool without an experimental envelope stays ordinary');
  assert.equal(s5.skipped.length, 0);
});

test('predictions compare the rectangle volume model with a rounded bead of equal area', () => {
  assert.deepEqual(predictWidths(1, 0.5), {rectangleMm: 1, roundedMm: 1.1073});
  near(ROUNDED_EXCESS, 0.2146, 1e-4);
});

test('caliper readings are compared with both models and fitted', () => {
  const {walls} = buildLadder({machineId: 'bambu-h2d'});
  // A bead that really is rounded: every reading is the rounded prediction, three per wall with small scatter.
  const readings = Object.fromEntries(walls.filter(w => w.feasible).map(w => [String(w.widthMm), [w.roundedMm - 0.01, w.roundedMm, w.roundedMm + 0.01]]));
  const result = analyzeMeasurements(walls, readings);
  assert.equal(result.rows.length, 4);
  assert.ok(result.meanAbsoluteErrorMm.roundedModel < 0.005 && result.meanAbsoluteErrorMm.rectangleModel > 0.1, 'the rounded model explains rounded readings and the rectangle does not');
  near(result.meanExcessOverLayer, ROUNDED_EXCESS, 0.005);
  near(result.fit.slope, 1 + ROUNDED_EXCESS / 2, 0.01); // layer is half the width, so a rounded bead measures 10.7% over at every width
  assert.throws(() => analyzeMeasurements(walls, {'0.5': [0.5, -1]}), /positive numbers/);
  assert.throws(() => analyzeMeasurements(walls, {}), /No readings/);
});

test('the ladder patch validates, generates, and prints fine courses before the thick ones above them', async () => {
  const built = buildLadder({machineId: 'bambu-h2d'}), machine = loadMachine('bambu-h2d');
  const patch = ladderPatch(built, {placement: [100, 100]});
  assert.equal(patch.skills['line-network'].enabled, true);
  assert.ok(Object.entries(patch.skills).every(([name, s]) => name === 'line-network' || s.enabled === false));
  const plan = defaults(machine);
  plan.geometry = boxMesh();
  for (const [name, settings] of Object.entries(patch.skills)) Object.assign(plan.skills[name], settings);
  Object.assign(plan.process, patch.process, {minimumLayerSeconds: 0});
  plan.placement = {xMm: patch.placement.xMm, yMm: patch.placement.yMm};
  validatePlan(plan, machine);
  const path = generatePath(plan, machine, await rhino()), moves = path.actions.filter(a => a.kind === 'move' && a.volumeMm3 > 0);
  const volume = region => moves.filter(m => m.region === region).reduce((s, m) => s + m.volumeMm3, 0);
  for (const w of built.walls.filter(x => x.feasible)) near(volume(w.id), 20 * w.widthMm * w.layerMm * w.courses, 1e-6);
  near(volume('frame'), 2 * 45 * 0.4 * 0.2 * 2, 1e-6);
  near(moves.reduce((s, m) => s + m.volumeMm3, 0), 314.4, 1e-6);
  // Courses that share a height print finest first, so the thickest wall's course goes on last.
  const at = (region, z) => moves.findIndex(m => m.region === region && Math.abs(m.to[2] - z) < 1e-9);
  assert.ok(at('wall-0p5', 0.5) < at('wall-1', 0.5), 'the finer wall first where courses share a height');
  assert.ok(at('wall-1', 1) < at('wall-2', 1), 'and the thickest wall last');
});
