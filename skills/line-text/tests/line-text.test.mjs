import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {FONTS, loadFont, readManifest} from '../scripts/catalog.mjs';
import {fontMetrics, parsePathData, parseStrokeFont} from '../scripts/strokefont.mjs';
import {chainStrokes, layoutText, strokeBounds} from '../scripts/layout.mjs';
import {fusionWidth} from '../scripts/measure.mjs';
import {depositionEstimate, planLineText, rankFonts} from '../scripts/plan.mjs';
import {collapseMarks, concentricLoops, lineText, snapJunctions} from '../scripts/compile.mjs';
import {encodePng, rasterize} from '../scripts/raster.mjs';
import {specimenPng, specimenScene, specimenSvg} from '../scripts/specimen.mjs';
import {inflateSync} from 'node:zlib';

const glyph = (line, index, stroke = 0) => ({line, index, stroke, char: 'x'});

test('path data covers relative, curved, closed and dot subpaths', () => {
  const strokes = parsePathData('M10 10h20v20 l-20 0 z M50 50 c10 0 20 10 20 20 M5 5L5 5');
  assert.equal(strokes[0].closed, true);
  assert.deepEqual(strokes[0].points, [[10, 10], [30, 10], [30, 30], [10, 30]]);
  assert.equal(strokes[1].closed, false);
  assert.ok(strokes[1].points.length > 2 && strokes[1].points.at(-1).every((v, i) => Math.abs(v - [70, 70][i]) < 1e-9), 'cubic flattens to its end point');
  assert.deepEqual(strokes[2], {closed: false, dot: true, points: [[5, 5]]});
  assert.equal(parsePathData('M0 0 L10 0 L10 10 L0 10 L0 0')[0].closed, true, 'a stroke that returns to its start is closed');
});

test('stroke fonts decode entities and apply kerning by glyph name and character', () => {
  const svg = `<svg><font horiz-adv-x="500"><font-face units-per-em="1000" ascent="800" descent="-200"/>
    <glyph unicode="A" glyph-name="A" horiz-adv-x="600" d="M0 0 L300 700 L600 0"/>
    <glyph unicode="&#x56;" glyph-name="V" horiz-adv-x="600" d="M0 700 L300 0 L600 700"/>
    <glyph unicode="&amp;" glyph-name="ampersand" d="M0 0 L100 100"/>
    <hkern g1="A" g2="V" k="80"/></font></svg>`;
  const font = parseStrokeFont(svg, {id: 'tiny'});
  assert.ok(font.glyphs.has('V') && font.glyphs.has('&'));
  assert.equal(font.glyphs.get('&').advance, 500, 'font default advance applies');
  assert.equal(font.kerning.get('AV'), 80);
});

test('every bundled font parses, covers printable ASCII and matches its manifest', () => {
  const manifest = readManifest();
  assert.ok(manifest, 'fonts/manifest.json exists; run build-manifest.mjs');
  for (const entry of FONTS) {
    const font = loadFont(entry.id);
    for (let c = 32; c < 127; c++) assert.ok(font.glyphs.has(String.fromCharCode(c)), `${entry.id} lacks ${String.fromCharCode(c)}`);
    const row = manifest.fonts.find(f => f.id === entry.id);
    assert.equal(row?.measured.sha256, font.sha256, `${entry.id} changed since manifest.json was built; rerun build-manifest.mjs`);
  }
});

test('capital height is measured from the glyphs, not the font header', () => {
  // EMS Casual Hand declares cap-height 500 but its capitals rise past 900.
  assert.ok(fontMetrics(loadFont('ems-casual-hand')).capHeight > 800);
  assert.ok(Math.abs(fontMetrics(loadFont('hershey-sans-1')).capHeight - 662) < 1);
});

test('layout scales to the requested capital height, kerns and refuses missing glyphs', () => {
  const font = loadFont('relief-single-line'), laid = layoutText(font, 'HEIZ', {heightMm: 10});
  assert.ok(Math.abs(strokeBounds(laid.strokes).max[1] - 10) < 1e-6);
  const kerned = strokeBounds(layoutText(font, 'AV', {heightMm: 10}).strokes), plain = strokeBounds(layoutText(font, 'AV', {heightMm: 10, kerning: false}).strokes);
  assert.ok(kerned.max[0] < plain.max[0], 'the A-V pair pulls together');
  assert.throws(() => layoutText(font, 'a中', {heightMm: 10}), /no glyph for/);
  const two = layoutText(font, 'A\nA', {heightMm: 10, lineHeightFactor: 2});
  assert.ok(Math.abs(strokeBounds(two.strokes).min[1] + 20) < 1e-6, 'second line sits one line pitch lower');
});

test('fusion width finds where strokes join or a counter fills in', () => {
  const two = [{closed: false, points: [[0, 0], [500, 0]]}, {closed: false, points: [[0, 100], [500, 100]]}];
  assert.ok(Math.abs(fusionWidth(two) - 100) < 1.5);
  const ring = {closed: true, points: Array.from({length: 64}, (_, i) => [100 * Math.cos(i / 64 * 2 * Math.PI), 100 * Math.sin(i / 64 * 2 * Math.PI)])};
  assert.ok(Math.abs(fusionWidth([ring]) - 200) < 3, 'the hole closes when the bead is as wide as the ring');
  assert.equal(fusionWidth([two[0]]), Infinity);
  assert.ok(Math.abs(fusionWidth([{closed: false, points: [[0, 0], [500, 0]]}, {closed: false, points: [[0, 10], [500, 10]]}, {closed: false, points: [[0, 200], [500, 200]]}], {baseUnits: 30}) - 190) < 3,
    'a near-miss under the join baseline is not counted as a gap');
});

test('the plan follows size: fine, single bead, then parallel beads that sum to the wanted stroke', () => {
  const font = loadFont('relief-single-line'), ordinary = [0.3, 0.8], experimental = [0.3, 2];
  const at = (h, range, extra = {}) => planLineText({font, text: 'Hello', heightMm: h, beadRangeMm: range, ...extra});
  assert.equal(at(3, ordinary, {weight: 'light'}).regime, 'fine');
  const small = at(6, ordinary);
  assert.equal(small.regime, 'single-bead');
  assert.ok(Math.abs(small.beadWidthMm - 0.48) < 1e-9);
  assert.equal(at(10, ordinary).parallelCount, 1);
  const big = at(40, ordinary);
  assert.equal(big.regime, 'parallel');
  assert.ok(big.beadWidthMm <= 0.8 + 1e-9 && Math.abs(big.strokeWidthMm - big.requestedStrokeMm) < 1e-2, 'beads stay within the widest bead and add up to the wanted stroke');
  assert.equal(at(20, experimental).parallelCount, 1, 'a 2 mm bead carries a stroke that needs parallel beads at 0.8 mm');
  const wide = at(80, experimental);
  assert.ok(wide.parallelCount >= 2 && wide.beadWidthMm <= 2 + 1e-9);
  assert.equal(at(12, ordinary).parallelCount, 1, 'a stroke only slightly over the widest bead stays a single, lighter bead');
});

test('a font whose counters cannot hold the stroke reduces its weight, and too small a size is reported', () => {
  const allure = loadFont('ems-allure'), range = [0.3, 0.8];
  const reduced = planLineText({font: allure, text: 'Hello', heightMm: 20, beadRangeMm: range});
  assert.equal(reduced.feasible, true);
  assert.ok(reduced.strokeWidthMm < reduced.requestedStrokeMm && reduced.warnings.length === 1);
  const tiny = planLineText({font: allure, text: 'Hello', heightMm: 3, beadRangeMm: range});
  assert.equal(tiny.feasible, false);
  assert.ok(tiny.limit.minHeightMm > 3);
  assert.throws(() => planLineText({font: allure, text: 'Hello', heightMm: 3, beadRangeMm: range, onInfeasible: 'error'}), /cannot hold the thinnest bead/);
});

test('ranking prefers feasible fonts, then the requested style, and skips fonts missing a glyph', () => {
  const rows = rankFonts({text: 'Hello', heightMm: 12, intent: ['formal', 'script'], beadRangeMm: [0.3, 0.8]});
  assert.ok(rows[0].intentMatches.length >= 2 && rows[0].plan.feasible);
  assert.equal(rankFonts({text: 'Hello', heightMm: 12, intent: ['label'], beadRangeMm: [0.3, 0.8]})[0].intentMatches.includes('label'), true);
  const tinyRows = rankFonts({text: 'Hello', heightMm: 3, intent: ['script'], beadRangeMm: [0.3, 0.8]});
  assert.equal(tinyRows.at(-1).feasible, false, 'infeasible fonts sort last');
});

test('junction snapping closes near-misses within a glyph and leaves real gaps', () => {
  const stem = {closed: false, points: [[0, 0], [0, 10]], glyph: glyph(0, 0, 0)};
  const near = {closed: false, points: [[5, 5], [0.2, 5]], glyph: glyph(0, 0, 1)};
  const far = {closed: false, points: [[5, 8], [1.5, 8]], glyph: glyph(0, 0, 2)};
  const elsewhere = {closed: false, points: [[5, 2], [0.2, 2]], glyph: glyph(0, 1, 0)};
  const [, a, b, c] = snapJunctions([stem, near, far, elsewhere], 0.3);
  assert.deepEqual(a.points.at(-1), [0, 5]);
  assert.deepEqual(b.points.at(-1), [1.5, 8]);
  assert.deepEqual(c.points.at(-1), [0.2, 2], 'strokes of another glyph are not snapped');
});

test('compiled letters leave no near-miss gaps between strokes of a glyph', () => {
  const font = loadFont('relief-single-line'), heightMm = 20, tol = 0.03 * heightMm;
  const gaps = strokes => {
    let count = 0;
    strokes.forEach((s, i) => {
      if (s.closed) return;
      for (const end of [s.points[0], s.points.at(-1)]) {
        const d = Math.min(Infinity, ...strokes.filter((_, j) => j !== i).flatMap(o => o.points.slice(1).concat(o.closed ? [o.points[0]] : []).map((b, k) => {
          const a = o.points[k], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy, t = len2 ? Math.max(0, Math.min(1, ((end[0] - a[0]) * dx + (end[1] - a[1]) * dy) / len2)) : 0;
          return Math.hypot(end[0] - a[0] - t * dx, end[1] - a[1] - t * dy);
        })));
        if (d > 1e-3 && d <= tol) count++;
      }
    });
    return count;
  };
  let raw = 0, compiled = 0;
  for (const ch of 'ABEGKMRZaegkqtx') {
    raw += gaps(layoutText(font, ch, {heightMm}).strokes);
    compiled += gaps(lineText({font, text: ch, heightMm, beadRangeMm: [0.3, 2], chain: false}).network.strokes);
  }
  assert.ok(raw > 0, 'the font really has near-miss gaps to close');
  assert.equal(compiled, 0);
});

test('a mark a bead would cover collapses to a dot and a covered dot is dropped', () => {
  const diamond = {closed: true, points: [[0, 0], [1, 1], [2, 0], [1, -1]], glyph: glyph(0, 0)};
  const stem = {closed: false, points: [[0, 5], [0, 20]], glyph: glyph(0, 1)};
  const stray = {closed: false, dot: true, points: [[0.3, 10]], glyph: glyph(0, 1, 1)};
  const out = collapseMarks([diamond, stem, stray], 1.2);
  assert.equal(out.length, 2);
  assert.ok(out[0].dot && out[0].points[0][0] === 1);
  assert.equal(collapseMarks([diamond], 0.5)[0].closed, true, 'a loop wider than two beads stays a loop');
});

test('chaining joins strokes end to end without adding points', () => {
  const a = {closed: false, points: [[0, 0], [5, 0]], glyph: glyph(0, 0)}, b = {closed: false, points: [[5.1, 0], [9, 3]], glyph: glyph(0, 1)};
  const [joined] = chainStrokes([a, b], 0.2);
  assert.equal(joined.points.length, 4);
  assert.equal(chainStrokes([a, b], 0.05).length, 2);
});

test('concentric loops lay n beads across a stroke: sides as loops, odd count keeps the centerline', () => {
  const line = [{closed: false, points: [[0, 0], [20, 0]], glyph: glyph(0, 0)}];
  const three = concentricLoops(line, {beadWidthMm: 1, pitchMm: 1, parallelCount: 3});
  assert.equal(three.filter(s => s.closed).length, 1);
  assert.equal(three.filter(s => !s.closed).length, 1, 'the centerline bead');
  const ys = three.find(s => s.closed).points.map(p => p[1]);
  assert.ok(Math.abs(Math.max(...ys) - 1) < 0.01 && Math.abs(Math.min(...ys) + 1) < 0.01, 'outer bead centerlines one pitch either side, so the row is 3 mm wide');
  const two = concentricLoops(line, {beadWidthMm: 1, pitchMm: 1, parallelCount: 2});
  assert.equal(two.length, 1);
  assert.ok(Math.abs(Math.max(...two[0].points.map(p => p[1])) - 0.5) < 0.01);
});

async function printed(result, height) {
  const machine = loadMachine('bambu-h2d'), plan = defaults(machine);
  plan.geometry = boxMesh(); plan.placement = {xMm: 60, yMm: 60};
  for (const settings of Object.values(plan.skills)) settings.enabled = false;
  Object.assign(plan.process, {firstLayerMm: height, layerMm: height, lineWidthMm: result.process.lineWidthMm, firstLayerSpeedMmS: 20, planarSpeedMmS: 20, maxFlowMm3S: 25, minimumLayerSeconds: 0, experimentalDeposition: true});
  Object.assign(plan.skills['line-network'], result.lineNetwork);
  validatePlan(plan, machine);
  const path = generatePath(plan, machine, await rhino());
  return {path, moves: path.actions.filter(a => a.kind === 'move' && a.volumeMm3 > 0)};
}

test('a single-bead word passes line-network validation and deposits every stroke on every course', async () => {
  const result = lineText({font: loadFont('relief-single-line'), text: 'SAAM', heightMm: 20, beadRangeMm: [0.3, 2], layers: 2});
  assert.equal(result.plan.parallelCount, 1);
  const {path, moves} = await printed(result, 1);
  assert.equal(path.summary.lineNetwork.strokes, result.network.strokes.length * 2);
  assert.ok(moves.length > 0 && moves.every(m => m.role === 'line-network'));
  assert.deepEqual([...new Set(moves.map(m => m.layer))], [0, 1]);
});

test('a parallel-bead word deposits its concentric loops through the same interface', async () => {
  const result = lineText({font: loadFont('hershey-sans-1'), text: 'Hi', heightMm: 60, weight: 'bold', beadRangeMm: [0.3, 2], layers: 1});
  assert.ok(result.plan.parallelCount >= 2);
  assert.ok(result.network.strokes.some(s => s.closed));
  const {path} = await printed(result, 1);
  assert.equal(path.summary.lineNetwork.strokes, result.network.strokes.length);
  assert.ok(result.report.extentMm[1] >= 60, 'text is at least its requested height, plus the bead');
});

test('the rasterizer draws round-capped beads at their width with anti-aliased edges', () => {
  // The bead spans y = 4.3 to 8.3, so pixel row 4 (4.0-5.0) is 70% covered and row 3 is empty.
  const rgb = rasterize({widthPx: 40, heightPx: 12, groups: [{color: [0, 0, 0], shapes: [{points: [[10, 6.3], [30, 6.3]], widthPx: 4}]}]});
  const at = (x, y) => rgb[(y * 40 + x) * 3];
  assert.ok(at(20, 5) < 5 && at(20, 6) < 5, 'the bead is solid across its width');
  assert.equal(at(20, 1), 255, 'well outside stays background');
  assert.equal(at(20, 3), 255, 'just past the edge stays background');
  assert.ok(Math.abs(at(20, 4) - 255 * 0.3) < 20, 'the edge pixel is partial coverage, not aliased');
  assert.ok(at(8, 6) < 200 && at(4, 6) === 255, 'the round cap extends half a width past the end');
  const dot = rasterize({widthPx: 9, heightPx: 9, groups: [{color: [0, 0, 0], shapes: [{points: [[4.5, 4.5]], widthPx: 5}]}]});
  assert.ok(dot[(4 * 9 + 4) * 3] < 5, 'a single point draws a dot');
});

test('a PNG carries its signature, size and exactly the pixels rasterized', () => {
  const rgb = rasterize({widthPx: 7, heightPx: 5, groups: []}), png = encodePng(7, 5, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 7);
  assert.equal(png.readUInt32BE(20), 5);
  const idat = png.indexOf('IDAT') + 4, length = png.readUInt32BE(idat - 8);
  assert.equal(inflateSync(png.subarray(idat, idat + length)).length, 5 * (1 + 7 * 3));
});

test('the specimen scene numbers only fonts that can hold the word and reports the rest omitted', () => {
  const scene = specimenScene({text: 'Hello', heightMm: 12, intent: ['script'], beadRangeMm: [0.3, 0.8], limit: 4});
  assert.deepEqual(scene.rows.map(r => r.n), [1, 2, 3, 4]);
  assert.ok(scene.rows[0].fontId && scene.omitted === 11 - 4);
  const small = specimenScene({text: 'Hello', heightMm: 3, beadRangeMm: [0.3, 0.8], limit: 20});
  assert.ok(!small.rows.some(r => r.fontId === 'ems-allure'), 'a font that cannot hold the bead is left out, not drawn wrongly');
  assert.ok(small.omitted >= 1);
  assert.match(specimenSvg(scene), /^<svg[\s\S]*1 {2}/);
});

test('the PNG specimen fits the chat image budget and scales down for large text', () => {
  const small = specimenPng(specimenScene({text: 'Hi', heightMm: 10, beadRangeMm: [0.3, 0.8], limit: 3}));
  assert.equal(small.png.readUInt32BE(16), small.widthPx);
  assert.ok(small.pxPerMm <= 10 && small.widthPx <= 1500 && small.heightPx <= 2500);
  const big = specimenPng(specimenScene({text: 'SAAM', heightMm: 120, beadRangeMm: [0.3, 2], limit: 2}));
  assert.ok(big.pxPerMm < 10 && big.widthPx <= 1500 && big.heightPx <= 2500, 'large text shrinks the scale instead of the image growing');
});

test('deposition estimate slows a wide bead to the flow limit and leaves a narrow bead at process speed', () => {
  const wide = depositionEstimate({beadWidthMm: 1.92, layerMm: 1, planarSpeedMmS: 40, maxFlowMm3S: 4, beadLengthMm: 578.5, layers: 1});
  assert.equal(wide.limitedBy, 'flow');
  assert.ok(Math.abs(wide.effectiveSpeedMmS - 2.08) < 0.01, 'the default 4 mm3/s limit runs a 2 mm bead at 1 mm layers at about 2 mm/s');
  assert.ok(Math.abs(wide.flowAtSpeedMm3S - 4) < 0.01);
  assert.ok(wide.printMinutes > 4, 'the slow speed shows up in the time');
  assert.equal(depositionEstimate({beadWidthMm: 1.92, layerMm: 1, planarSpeedMmS: 40, maxFlowMm3S: 30}).effectiveSpeedMmS, 15.63);
  const fine = depositionEstimate({beadWidthMm: 0.48, layerMm: 0.2, planarSpeedMmS: 40, maxFlowMm3S: 4});
  assert.equal(fine.limitedBy, 'speed');
  assert.equal(fine.effectiveSpeedMmS, 40);
});
