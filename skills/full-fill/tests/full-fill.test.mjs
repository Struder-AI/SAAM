import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import rhino3dm from 'rhino3dm';
import { defaults } from '../../../core/print/plan.mjs';
import { buildShell, translateShell } from '../../../core/print/generate.mjs';
import { PathBuilder } from '../../../core/path/builder.mjs';
import { generateFullFill } from '../scripts/fill.mjs';
import { sectionShell } from '../../../core/geom/shell.mjs';
import { regionArea } from '../../../core/region/region2d.mjs';

const rhino = await rhino3dm();
const machine = JSON.parse(readFileSync('machines/ultimaker-s5.json', 'utf8'));

function planFor(geometry, overrides = {}) {
  const plan = defaults();
  // Each shape has its own parameter set; replace rather than merge.
  plan.geometry = { ...geometry };
  plan.skills['draped-skin'] = { ...plan.skills['draped-skin'], enabled: false };
  plan.skills['full-fill'] = { ...plan.skills['full-fill'], ...overrides };
  return plan;
}

function run(plan) {
  const shell = translateShell(buildShell(rhino, plan.geometry), plan.placement.xMm, plan.placement.yMm);
  const builder = new PathBuilder({
    start: [...machine.tools[plan.setup.tool].startupXY, machine.startup.zAfterStartupMm],
    process: plan.process, machine, generatorVersion: 'test'
  });
  const report = generateFullFill(builder, { shell, plan, reserve: null });
  return { shell, builder, report, path: builder.toPath({}) };
}

test('the pattern follows each shape, not a fixed outline', () => {
  const wedge = run(planFor({ shape: 'wedge', runMm: 20, widthMm: 12, baseMm: 2, angleDeg: 15 }));
  assert.ok(wedge.report.layers > 10);
  // A wedge narrows with height, so later layers carry fewer fill rows.
  const rows = new Map();
  for (const action of wedge.path.actions)
    if (action.kind === 'move' && action.role === 'fill') rows.set(action.layer, (rows.get(action.layer) ?? 0) + 1);
  const layers = [...rows.keys()].sort((a, b) => a - b);
  assert.ok(rows.get(layers[layers.length - 1]) < rows.get(layers[0]), 'the top of a wedge holds less fill than the base');

  const dome = run(planFor({ shape: 'spline-top', runMm: 18, widthMm: 14, cpU: 4, cpV: 4, heightsMm: [[4, 4, 4, 4], [4, 5.5, 5.5, 4], [4, 5.5, 5.5, 4], [4, 4, 4, 4]] }));
  assert.ok(dome.report.layers > 10);
  assert.ok(dome.report.fillRows > 100);
});

test('each layer is filled solid within a bead of its own cross section', () => {
  const plan = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 3 });
  const { shell, path } = run(plan);
  const width = plan.process.lineWidthMm;
  const deposited = new Map();
  for (const action of path.actions)
    if (action.kind === 'move' && action.volumeMm3 > 0)
      deposited.set(action.layer, (deposited.get(action.layer) ?? 0) + action.volumeMm3);
  const section = sectionShell(shell, 1.0);
  const expected = Math.abs(regionArea(section.loops)) * plan.process.layerMm;
  const middle = deposited.get(4);
  // Solid fill deposits the layer's own volume, allowing for the perimeter
  // overlap and the half bead the outline stands in from the wall.
  assert.ok(middle > expected * 0.85 && middle < expected * 1.05, `layer volume ${middle} against ${expected}`);
});

test('fill direction alternates between layers', () => {
  const plan = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 2 }, { fillAnglesDeg: [0, 90] });
  const { path } = run(plan);
  const spread = layer => {
    const strokes = path.actions.filter(action => action.kind === 'move' && action.role === 'fill' && action.layer === layer);
    assert.ok(strokes.length > 4, `layer ${layer} has fill`);
    return {
      x: new Set(strokes.map(action => action.to[0].toFixed(3))).size,
      y: new Set(strokes.map(action => action.to[1].toFixed(3))).size
    };
  };
  // Rows run along X at 0 degrees, so they end at many distinct Y values and
  // only two distinct X values. At 90 degrees that is the other way round.
  const flat = spread(2), upright = spread(3);
  assert.ok(flat.y > flat.x, `0 degree layer: ${flat.y} distinct Y against ${flat.x} distinct X`);
  assert.ok(upright.x > upright.y, `90 degree layer: ${upright.x} distinct X against ${upright.y} distinct Y`);
});

test('travel between fill strokes stays down instead of lifting over the part', () => {
  const plan = planFor({ shape: 'box', runMm: 25, widthMm: 20, heightMm: 2 });
  const { builder } = run(plan);
  const stats = builder.stats;
  assert.ok(stats.combed > 20 * stats.hopped, `combed ${stats.combed} against hopped ${stats.hopped}`);
  // The wedge demo retracts for every stroke; here retraction is rare.
  assert.ok(stats.retractions < stats.combed / 20, `retractions ${stats.retractions}`);
  assert.ok(stats.travelMm < stats.printMm / 5, `travel ${stats.travelMm} against print ${stats.printMm}`);
});

test('lifted traverses clear the whole part while combing stays down', () => {
  const plan = planFor({ shape: 'wedge', runMm: 20, widthMm: 12, baseMm: 2, angleDeg: 15 });
  const { shell, path } = run(plan);
  const partMax = shell.bounds.max[2];
  let lifted = 0;
  let previous=path.initialPosition;
  for (const action of path.actions) {
    if(action.kind!=='move')continue;
    if(!action.volumeMm3&&Math.hypot(action.to[0]-previous[0],action.to[1]-previous[1])>1e-6&&action.to[2]>partMax){
      assert.ok(action.to[2]>=partMax+plan.process.liftMm-1e-6);lifted++;
    }
    previous=action.to;
  }
  assert.ok(lifted > 0, 'some travel does lift');
  assert.ok(partMax > 4, 'the part is tall enough for this to matter');
});

test('an unsupported layer height or missing setting is rejected before generation', async () => {
  const { validatePlan } = await import('../../../core/print/plan.mjs');
  const plan = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 3 });
  plan.skills['full-fill'].perimeters = 2.5;
  assert.throws(() => validatePlan(plan, machine), /perimeters must be an integer/);
  const spelling = planFor({ shape: 'box', runMm: 20, widthMm: 15, heightMm: 3 });
  spelling.skills['full-fill'].perimiters = 2;
  assert.throws(() => validatePlan(spelling, machine), /Unexpected or missing fields/);
});
