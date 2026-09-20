import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPanel, DEMO_LINES, DEMO_TRIM_BOTTOM_MM, panelNetworks, renderPanel} from '../scripts/panel.mjs';
import {defaults, validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {exportMotion} from '../../../core/export/griffin.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';

const panel = buildPanel({lines: DEMO_LINES, trimBottomMm: DEMO_TRIM_BOTTOM_MM});
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const points = strokes => strokes.flatMap(s => s.points);

test('the border is whole beads: 2 mm as four 0.5 mm loops and a 1 mm ring as two, 5 mm inside', () => {
  const loops = panel.background.borders, {widthMm: w, heightMm: h} = panel;
  assert.equal(loops.length, 6);
  const insets = loops.map(l => l.points[0][0]);
  assert.deepEqual(insets.map(x => +x.toFixed(6)), [0.25, 0.75, 1.25, 1.75, 7.25, 7.75], 'bead centerlines: 2 mm from the edge, then a ring 5 mm inside it');
  assert.ok(loops.every(l => l.closed && l.points[2][0] === w - l.points[0][0] && l.points[2][1] === h - l.points[0][1]));
  assert.deepEqual(panel.insetRingMm, [7, 8]);
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
  assert.ok(lines.every(l => l.plan.beadWidthMm >= 0.45 - 1e-9 && l.plan.beadWidthMm <= 0.8 + 1e-9), 'beads stay within a 0.6 mm nozzle\'s range');
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

test('the panel is a plan for two nozzles: background on the left, lettering on the right starting 0.4 mm up', async () => {
  const machine = loadMachine('bambu-h2d'), plan = defaults(machine);
  plan.geometry = boxMesh();
  plan.placement = {xMm: 100, yMm: 100};
  for (const settings of Object.values(plan.skills)) settings.enabled = false;
  Object.assign(plan.process, {minimumLayerSeconds: 0});
  Object.assign(plan.skills['line-network'], panelNetworks(panel));
  validatePlan(plan, machine);
  const path = generatePath(plan, machine, await rhino()), changes = path.actions.filter(a => a.kind === 'tool');
  assert.deepEqual(changes.map(a => [a.fromTool, a.toTool]), [[0, 1]], 'one change, left to right');
  const deposits = path.actions.filter(a => a.kind === 'move' && a.volumeMm3 > 0), at = path.actions.indexOf(changes[0]);
  const before = path.actions.slice(0, at).filter(a => a.kind === 'move' && a.volumeMm3 > 0), after = path.actions.slice(at).filter(a => a.kind === 'move' && a.volumeMm3 > 0);
  assert.ok(before.every(m => m.region === 'background') && after.every(m => m.region.startsWith('text-')));
  assert.deepEqual([...new Set(before.map(m => +m.to[2].toFixed(6)))], [0.2, 0.4]);
  assert.deepEqual([...new Set(after.map(m => +m.to[2].toFixed(6)))], [0.7, 1, 1.3], 'text starts on top of the 0.4 mm background, in 0.3 mm layers');
  // Each lettering line deposits its bead width x 0.3 mm layer x its stroke length on each of 3 courses.
  const length = s => s.points.slice(1).concat(s.closed ? [s.points[0]] : []).reduce((sum, p, i) => sum + Math.hypot(p[0] - s.points[i][0], p[1] - s.points[i][1]), 0);
  for (const net of panelNetworks(panel).networks.filter(n => n.id.startsWith('text-'))) {
    const expected = 3 * 0.3 * net.process.lineWidthMm * net.strokes.reduce((sum, s) => sum + length(s), 0);
    const got = after.filter(m => m.region === net.id).reduce((sum, m) => sum + m.volumeMm3, 0);
    assert.ok(got > 0 && Math.abs(got / expected - 1) < 1e-6, `${net.id}: ${got} != ${expected}`);
  }
  assert.throws(() => exportMotion(path, plan), /no validated nozzle-change sequence/, 'and it cannot be exported until the machine declares one');
});
