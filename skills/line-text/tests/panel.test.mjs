import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPanel, DEMO_LINES, DEMO_TRIM_BOTTOM_MM, PANEL_COLORS, panelPatch, renderPanel} from '../scripts/panel.mjs';
import {defaults, validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {exportProgram, interpretProgram} from '../../../core/export/registry.mjs';
import {commandedWidthMm, printedWidthMm, WIDTH_SPREAD_PER_LAYER} from '../scripts/spread.mjs';

const panel = buildPanel({lines: DEMO_LINES, trimBottomMm: DEMO_TRIM_BOTTOM_MM});
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const points = strokes => strokes.flatMap(s => s.points);

test('the border and the ring are each one bead: a 2 mm bead at the edge and a 1 mm bead 5 mm inside it', () => {
  const loops = panel.background.borders, {widthMm: w, heightMm: h} = panel;
  assert.equal(loops.length, 2, 'one loop for the border, one for the ring, nothing doubled');
  assert.deepEqual(loops.map(l => l.widthMm), [2, 1]);
  assert.deepEqual(loops.map(l => l.points[0][0]), [1, 7.5], 'bead centerlines: the border centered 1 mm in (its 2 mm band), the ring centered in its 7 to 8 mm band');
  assert.ok(loops.every(l => l.closed && l.points[2][0] === w - l.points[0][0] && l.points[2][1] === h - l.points[0][1]));
  assert.deepEqual(panel.insetRingMm, [7, 8]);
});

test('commanding a width less the measured spread prints the width wanted, and the correction is small at a thin layer', () => {
  near(WIDTH_SPREAD_PER_LAYER, 0.565, 1e-9);
  assert.equal(commandedWidthMm(2, 0.2), 1.887);
  assert.equal(printedWidthMm(commandedWidthMm(2.86, 0.6), 0.6), 2.86, 'the two are inverses');
  // The ladder's own points: a wall commanded at 1 mm on a 0.5 mm layer printed 1.2 mm; 2 mm on 1 mm printed 2.6 mm.
  assert.ok(Math.abs(printedWidthMm(1, 0.5) - 1.2) < 0.1 && Math.abs(printedWidthMm(2, 1) - 2.6) < 0.05);
  assert.throws(() => commandedWidthMm(0.1, 0.6), /spread alone is wider/);
});

test('infill is 25% at 45 and -45 degrees: 2 mm spacing, kept inside the border and out of the ring band', () => {
  const {infill, spacingMm} = panel.background;
  near(spacingMm, 2, 1e-9);
  assert.equal(infill.length, 2);
  const [w, h] = [panel.widthMm, panel.heightMm], bandOuter = 7, bandInner = 8;
  const angles = infill.map(layer => { const [a, b] = layer[0].points; return Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI * 1000) / 1000; });
  assert.ok(Math.abs(Math.abs(angles[0]) - 45) < 1e-6 || Math.abs(Math.abs(angles[0]) - 135) < 1e-6);
  assert.notEqual(Math.sign(Math.tan(angles[0] * Math.PI / 180)), Math.sign(Math.tan(angles[1] * Math.PI / 180)), 'the two layers cross');
  for (const layer of infill) for (const s of layer) for (const [x, y] of s.points) {
    assert.ok(x >= 1.75 - 1e-6 && x <= w - 1.75 + 1e-6 && y >= 1.75 - 1e-6 && y <= h - 1.75 + 1e-6, 'inside the border\'s innermost bead centerline');
    const depth = Math.min(x, y, w - x, h - y);
    assert.ok(!(depth > bandOuter + 1e-6 && depth < bandInner - 1e-6), `an end at ${depth} mm in is inside the ring band`);
  }
  // No infill segment passes through the ring band: its midpoint is never in the band.
  for (const layer of infill) for (const s of layer) {
    const [[x0, y0], [x1, y1]] = s.points;
    for (let t = 0.05; t < 1; t += 0.05) {
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, depth = Math.min(x, y, w - x, h - y);
      assert.ok(!(depth > bandOuter + 1e-3 && depth < bandInner - 1e-3), 'a segment crosses the ring band');
    }
  }
});

test('the lettering keeps its own fonts and weights and sits inside the inner ring with clearance', () => {
  const {lines} = panel.text;
  assert.deepEqual(lines.map(l => l.text), ['Individual', 'Toolpath', 'Control']);
  assert.deepEqual(lines.map(l => l.fontId), ['ems-invite', 'ems-tech', 'hershey-sans-1']);
  assert.ok(lines[2].plan.strokeWidthMm > lines[0].plan.strokeWidthMm, 'Control is bold, heavier than the script');
  assert.ok(lines.every(l => l.plan.parallelCount === 1), 'every letter is one bead wide, nothing side by side');
  assert.deepEqual(lines.map(l => l.plan.beadWidthMm.toFixed(2)), ['1.76', '1.44', '2.86'], 'each line one bead as wide as its stroke');
  const inner = 8 + panel.text.options.clearanceMm;
  for (const line of lines) {
    const w = line.plan.beadWidthMm;
    for (const [x, y] of points(line.strokes)) assert.ok(x - w / 2 >= inner - 1e-6 && x + w / 2 <= panel.widthMm - inner + 1e-6 && y - w / 2 >= inner - 1e-6 && y + w / 2 <= panel.heightMm - inner + 1e-6, `${line.text} reaches the ring clearance`);
  }
  const boxes = lines.map(l => l.boxMm);
  assert.ok(boxes[0][1] > boxes[1][3] && boxes[1][1] > boxes[2][3], 'three lines, top to bottom, not overlapping');
});

test('a panel too small for its lettering is refused, and the preview is a PNG at true scale', () => {
  assert.throws(() => buildPanel({lines: DEMO_LINES, widthMm: 100, heightMm: 100}), /too small/);
  const image = renderPanel(panel);
  assert.deepEqual([...image.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.png.readUInt32BE(16), image.widthPx);
  assert.ok(image.widthPx > panel.widthMm * image.pxPerMm);
});

test('raising Control by 2 mm and trimming the bottom edge with it keeps its margin and shortens the panel by 2 mm', () => {
  const plain = buildPanel({lines: DEMO_LINES.map(({raiseMm, ...l}) => l)}), [a, b, c] = panel.text.lines, [pa, pb, pc] = plain.text.lines;
  near(panel.heightMm, plain.heightMm - 2);
  near(c.boxMm[1], pc.boxMm[1], 1e-9); // Control's distance from the bottom edge is unchanged
  near(a.boxMm[1], pa.boxMm[1] - 2, 1e-9); // the lines above keep their place under the fixed top edge
  near(b.boxMm[1], pb.boxMm[1] - 2, 1e-9);
  near((b.boxMm[1] - c.boxMm[3]), (pb.boxMm[1] - pc.boxMm[3]) - 2, 1e-9); // 2 mm closer to Toolpath
  near(panel.heightMm - a.boxMm[3], plain.heightMm - pa.boxMm[3], 1e-9); // the top margin is unchanged
});

// Applies the patch's top-level fields onto a fresh default plan, the same shallow assignment
// `core/print/cli.mjs adjust` performs for record fields it recognizes; adequate for a plan this
// direct, without pulling in the full geometry-template machinery adjust needs for arbitrary edits.
function applyPatch(machine, patch) {
  const plan = defaults(machine);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'skills') for (const [name, settings] of Object.entries(value)) Object.assign(plan.skills[name], settings);
    else if (key === 'setup') { const {bambu, ...rest} = value; Object.assign(plan.setup, rest); if (bambu) plan.setup.bambu = {...plan.setup.bambu, ...bambu}; }
    else if (key === 'geometry') plan[key] = value; // a full shape object, not a partial patch
    else if (key === 'composition') plan.composition = {...plan.composition, ...value};
    else plan[key] = typeof value === 'object' && !Array.isArray(value) ? {...plan[key], ...value} : value;
  }
  return plan;
}

test('the panel is a plan for two 0.4 mm nozzles: background on the left, lettering on the right starting 0.4 mm up', async () => {
  const machine = loadMachine('bambu-h2d');
  const plan = applyPatch(machine, panelPatch(panel));
  validatePlan(plan, machine);
  const path = generatePath(plan, machine, await rhino()), changes = path.actions.filter(a => a.kind === 'toolChange');
  assert.equal(changes.length, 1, 'one change, left to right');
  const part = a => a.kind === 'move' && a.volumeMm3 > 0 && a.role !== 'prime';
  const deposits = path.actions.filter(part), at = path.actions.findIndex(a => a.kind === 'toolChange');
  const before = path.actions.slice(0, at).filter(part), after = path.actions.slice(at).filter(part);
  assert.ok(before.every(m => m.region === 'background') && after.every(m => m.region === 'lettering'));
  assert.deepEqual([...new Set(before.map(m => +m.to[2].toFixed(6)))], [0.2, 0.4]);
  assert.deepEqual([...new Set(after.map(m => +m.to[2].toFixed(6)))], [1, 1.6, 2.2], 'text starts on top of the 0.4 mm background, in 0.6 mm layers');
  // The lettering region deposits each line's own commanded bead width x 0.6 mm layer x its stroke length,
  // on each of its 3 courses, summed across all three lines (they share the region's one job).
  const length = s => s.points.slice(1).concat(s.closed ? [s.points[0]] : []).reduce((sum, p, i) => sum + Math.hypot(p[0] - s.points[i][0], p[1] - s.points[i][1]), 0);
  const lettering = plan.composition.regions.find(r => r.id === 'lettering').skills['line-network'];
  const expected = lettering.networks.reduce((sum, net) => sum + 3 * 0.6 * net.process.lineWidthMm * net.strokes.reduce((s, stroke) => s + length(stroke), 0), 0);
  const got = after.reduce((sum, m) => sum + m.volumeMm3, 0);
  assert.ok(got > 0 && Math.abs(got / expected - 1) < 1e-6, `${got} != ${expected}`);
  const bytes = exportProgram(path, plan, machine, {generatorVersion: 'test', buildDate: '2026-09-29'});
  assert.ok(bytes.length > 1000, 'the H2D exports it as one two-colour job');
  const program = interpretProgram(bytes, plan, machine);
  assert.deepEqual(new Set(program.filamentUsage.map(u => u.filament)), new Set([0, 1]));
  assert.ok(program.filamentUsage.every(u => u.volumeMm3 > 0), 'both filaments actually deposited');
});
