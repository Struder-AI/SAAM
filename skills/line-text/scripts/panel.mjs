import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {loadFont} from './catalog.mjs';
import {lineText} from './compile.mjs';
import {layoutText} from './layout.mjs';
import {encodePng, rasterize} from './raster.mjs';
import {commandedWidthMm} from './spread.mjs';

// A flat panel made of two parts printed by different nozzles, each in its own colour: a background of one
// fat border bead, one ring bead inset from it and sparse crossed infill on the first nozzle, and lettering on
// top of it from a second. Every outline and every letter stroke is one bead, never beads side by side. This
// builds every part's centerline strokes and draws a true-scale preview of the *printed* widths; the widths
// commanded are smaller by the measured spread (spread.mjs). On a Bambu H2D with two equal nozzles the plan
// exports as a two-colour job; mixed nozzle diameters are not supported yet (BR-058).

export const PANEL_DEFAULTS = Object.freeze({
  background: {beadMm: 0.5, layerMm: 0.2, layers: 2, density: 0.25, anglesDeg: [45, -45], borderMm: 2, ringInsetMm: 5, ringMm: 1, nozzleMm: 0.4},
  text: {nozzleMm: 0.4, layerMm: 0.6, layers: 3, beadRangeMm: [0.3, 3.5], clearanceMm: 4, lineGapMm: 8}
});

// The filament colours the two nozzles are declared with: the preview's border blue and lettering orange.
export const PANEL_COLORS = Object.freeze({background: '#34689E', text: '#C4541E'});

const rectLoop = ([x0, y0, x1, y1]) => ({closed: true, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]});
const inset = (w, h, d) => [d, d, w - d, h - d];

// One bead around the panel: a closed loop on the centerline of a band `thicknessMm` wide, `fromMm` in from the edge.
// `widthMm` is the printed width of that bead, so a 2 mm border is one 2 mm bead.
const bandLoop = (w, h, fromMm, thicknessMm) => ({...rectLoop(inset(w, h, fromMm + thicknessMm / 2)), widthMm: thicknessMm});

// The parameter interval where the line p0 + t d lies inside a box [xa, ya, xb, yb], or null.
function within(p0, d, [xa, ya, xb, yb]) {
  let lo = -Infinity, hi = Infinity;
  for (const [o, dir, a, b] of [[p0[0], d[0], xa, xb], [p0[1], d[1], ya, yb]]) {
    if (Math.abs(dir) < 1e-12) { if (o < a || o > b) return null; continue; }
    const [t0, t1] = [(a - o) / dir, (b - o) / dir];
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
  }
  return lo < hi ? [lo, hi] : null;
}

// Parallel infill lines at one angle across `region`, leaving out a ring band that carries its own
// beads. A line ends at the edge of whatever bead it meets; its rounded end then reaches half a bead
// into that bead, so the two fuse.
function hatch(w, h, {angleDeg, spacingMm, region, band}) {
  const a = angleDeg * Math.PI / 180, d = [Math.cos(a), Math.sin(a)], n = [-Math.sin(a), Math.cos(a)];
  const across = [[region[0], region[1]], [region[2], region[1]], [region[2], region[3]], [region[0], region[3]]].map(p => p[0] * n[0] + p[1] * n[1]);
  const centre = (w / 2) * n[0] + (h / 2) * n[1], strokes = [];
  const first = centre + Math.ceil((Math.min(...across) - centre) / spacingMm) * spacingMm;
  for (let c = first; c <= Math.max(...across) + 1e-9; c += spacingMm) {
    const p0 = [c * n[0], c * n[1]], span = within(p0, d, region);
    if (!span) continue;
    const outer = within(p0, d, band.outer), inner = within(p0, d, band.inner);
    const cuts = outer && inner ? [[outer[0], inner[0]], [inner[1], outer[1]]] : outer ? [outer] : [];
    let start = span[0];
    const keep = [];
    for (const [c0, c1] of cuts.sort((x, y) => x[0] - y[0])) {
      if (c0 > start + 1e-6) keep.push([start, Math.min(c0, span[1])]);
      start = Math.max(start, c1);
    }
    if (span[1] > start + 1e-6) keep.push([start, span[1]]);
    for (const [t0, t1] of keep) strokes.push({closed: false, points: [[p0[0] + t0 * d[0], p0[1] + t0 * d[1]], [p0[0] + t1 * d[0], p0[1] + t1 * d[1]]]});
  }
  return strokes;
}

// The panel. `lines` are the lettering, top to bottom: {text, fontId, heightMm, weight, raiseMm}. The
// rectangle is sized to hold the lettering inside the inner ring unless widthMm and heightMm are given.
// `raiseMm` lifts one line; `trimBottomMm` then raises the panel's bottom edge, so a raised last line
// keeps its distance from the edge and the panel gets that much shorter.
export function buildPanel({lines, widthMm, heightMm, trimBottomMm = 0, background = {}, text = {}}) {
  const bg = {...PANEL_DEFAULTS.background, ...background}, tx = {...PANEL_DEFAULTS.text, ...text};
  const built = lines.map(line => {
    const result = lineText({font: loadFont(line.fontId), text: line.text, heightMm: line.heightMm, weight: line.weight ?? 'regular', beadRangeMm: tx.beadRangeMm, layers: tx.layers, id: 'text'});
    return {...line, result, extentMm: result.report.extentMm};
  });
  const ringOuter = bg.borderMm + bg.ringInsetMm, ringInner = ringOuter + bg.ringMm, keepClear = ringInner + tx.clearanceMm;
  const blockW = Math.max(...built.map(l => l.extentMm[0])), blockH = built.reduce((s, l) => s + l.extentMm[1], 0) + tx.lineGapMm * (built.length - 1);
  const w = widthMm ?? Math.ceil((blockW + 2 * keepClear) / 10) * 10, fullH = heightMm ?? Math.ceil((blockH + 2 * keepClear) / 10) * 10, h = fullH - trimBottomMm;
  requireThat(w >= blockW + 2 * keepClear - 1e-9 && fullH >= blockH + 2 * keepClear - 1e-9, `The ${w} x ${fullH} mm panel is too small for the lettering inside its inner ring.`);

  const borders = [bandLoop(w, h, 0, bg.borderMm), bandLoop(w, h, ringOuter, bg.ringMm)];
  const spacingMm = bg.beadMm / bg.density;
  // What an infill line meets differs by course. The first course carries only the thin outlines of the border and the
  // ring, on the centerline of each fat bead, so its lines stop at the outer edge of those thin beads. The later
  // courses meet the fat beads laid over them, so their lines stop at the fat beads' own edges.
  const ringMid = ringOuter + bg.ringMm / 2;
  const meets = course => course === 0
    ? {region: inset(w, h, bg.borderMm / 2 + bg.beadMm / 2), band: {outer: inset(w, h, ringMid - bg.beadMm / 2), inner: inset(w, h, ringMid + bg.beadMm / 2)}}
    : {region: inset(w, h, bg.borderMm), band: {outer: inset(w, h, ringOuter), inner: inset(w, h, ringInner)}};
  const infill = bg.anglesDeg.map((angleDeg, course) => hatch(w, h, {angleDeg, spacingMm, ...meets(course)}));

  let top = (fullH + blockH) / 2; // laid out at full height; the bottom trim is applied to every line below
  const lettering = built.map(line => {
    const [lw, lh] = line.extentMm, x = (w - lw) / 2, y = top - lh;
    top = y - tx.lineGapMm;
    const lift = (line.raiseMm ?? 0) - trimBottomMm;
    const strokes = line.result.network.strokes.map(s => ({closed: s.closed, points: s.points.map(([px, py]) => [px + x, py + y + lift])}));
    return {text: line.text, fontId: line.fontId, plan: line.result.plan, strokes, boxMm: [x, y + lift, x + lw, y + lh + lift]};
  });
  for (const line of lettering) requireThat(line.boxMm[0] >= keepClear - 1e-9 && line.boxMm[2] <= w - keepClear + 1e-9 && line.boxMm[1] >= keepClear - 1e-9 && line.boxMm[3] <= h - keepClear + 1e-9,
    `${line.text} would come within ${keepClear - bg.borderMm - bg.ringInsetMm - bg.ringMm} mm of the inner ring; the panel is too small for it.`);
  return {widthMm: w, heightMm: h, background: {options: bg, borders, infill, spacingMm}, text: {options: tx, lines: lettering}, insetRingMm: [ringOuter, ringInner]};
}

// The panel's two line-network jobs. The background builds from low to tall, thin before fat: the first course is
// the first infill angle and a thin outline of the border and of the ring (as thin as the infill, so nothing on
// it stands above its neighbours); the last course is the other infill angle, then the fat ring, then the fat
// border laid over those outlines, last in the course so the nozzle never works beside a fat bead that is not
// finished. The lettering, starting where the background ends: each line one bead wide as its font and size ask.
// Every width here is the width it should print at; the width commanded is that less the measured spread at the
// job's layer height, set per network so each prints at its own width.
function panelNetworks(panel) {
  const {background: bg, text: tx} = panel, b = bg.options, x = tx.options;
  const net = (id, printedMm, layerMm, strokes, first = layerMm) => ({
    id, process: {firstLayerMm: first, layerMm, lineWidthMm: commandedWidthMm(printedMm, layerMm)}, strokes});
  const pts = s => s.points.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]);
  const last = b.layers - 1, [border, ring] = bg.borders;
  // Network order is print order within a course: thin infill, then the thin outlines laid against its ends, then the
  // fat ring, then the fat border. The outlines come after the infill so that the nozzle, hopping between infill
  // pieces on either side of the ring outline, never drags across a bead it has already printed at its own height.
  const background = {layers: b.layers, networks: [
    net('infill', b.beadMm, b.layerMm, bg.infill.flatMap((layer, i) => layer.map(s => ({closed: false, points: s.points, layers: [i]})))),
    net('outline', b.beadMm, b.layerMm, [border, ring].map(loop => ({closed: true, points: loop.points, layers: [0]}))),
    net('ring', b.ringMm, b.layerMm, [{closed: true, points: ring.points, layers: [last]}]),
    net('border', b.borderMm, b.layerMm, [{closed: true, points: border.points, layers: [last]}])
  ]};
  const lettering = {layers: x.layers, networks: tx.lines.map((line, i) => ({
    id: `text-${i + 1}`, process: {lineWidthMm: commandedWidthMm(line.plan.beadWidthMm, x.layerMm)},
    strokes: line.strokes.map(s => ({closed: s.closed, points: pts(s)}))
  }))};
  return {background, lettering};
}

// A placeholder box for a region's assembly part: line-network's own strokes are the geometry that
// matters, so this only needs to cover the panel's footprint for the shared placement/bounds checks.
const panelPart = (id, panel) => ({id, xMm: 0, yMm: 0, zMm: 0, geometry: {shape: 'box', runMm: panel.widthMm, widthMm: panel.heightMm, heightMm: 4}});

// A plan patch for `core/print/cli.mjs adjust`: the panel as two composition regions on their own
// nozzles/filaments, background first and lettering starting where it ends, centered on a bed of the
// given size. `backgroundTool`/`textTool` (default the H2D's left/right) and `colors` pick the nozzles
// and their filament colours; `nozzleMm`/`core` name the text nozzle's actual installed diameter.
export function panelPatch(panel, {bedMm = [350, 320], backgroundTool = 0, textTool = 1, colors = PANEL_COLORS, textNozzleMm = null} = {}) {
  const skills = Object.fromEntries(PLAN_SKILLS.map(id => [id, {enabled: false}]));
  const {background: bg, text: tx} = panel, {background, lettering} = panelNetworks(panel);
  const startMm = bg.options.layers * bg.options.layerMm;
  const otherNozzleMm = backgroundTool === textTool ? null : (textNozzleMm ?? tx.options.nozzleMm);
  return {
    skills,
    setup: {tool: backgroundTool, filamentColor: colors.background,
      bambu: {otherNozzleMm, filaments: [
        {id: 'GFA00', colour: colors.background, tool: backgroundTool, source: {type: 'auto'}},
        {id: 'GFA00', colour: colors.text, tool: textTool, source: {type: 'auto'}, process: {firstLayerMm: tx.options.layerMm, layerMm: tx.options.layerMm}}
      ]}},
    process: {minimumLayerSeconds: 0, experimentalDeposition: true},
    placement: {xMm: Math.round(bedMm[0] / 2 - panel.widthMm / 2), yMm: Math.round(bedMm[1] / 2 - panel.heightMm / 2)},
    geometry: {shape: 'assembly', parts: [panelPart('background', panel), panelPart('lettering', panel)]},
    composition: {regions: [
      {id: 'background', part: 'background', filament: 0, zStartMm: 0, zEndMm: null, lowerSurfaceFrom: null, skills: {'line-network': background}},
      {id: 'lettering', part: 'lettering', filament: 1, zStartMm: startMm, zEndMm: null, lowerSurfaceFrom: 'background', skills: {'line-network': lettering}}
    ]}
  };
}
const PLAN_SKILLS = ['plastic-weld', 'wave-overhangs', 'pipe-cladding', 'supports', 'rimming-planar', 'rimming-normal', 'full-fill', 'planar-infill', 'vase-wall', 'thick-lip', 'draped-skin', 'line-network'];

const COLORS = {bed: [246, 246, 244], infillA: [158, 190, 214], infillB: [110, 152, 190], border: [52, 104, 158], text: [196, 84, 30], label: [80, 80, 80], edge: [190, 190, 186]};

// A true-scale PNG: background beads in blues (the two infill layers in different shades), lettering in
// orange. Widths are the beads' real widths at pxPerMm.
export function renderPanel(panel, {pxPerMm = 8, marginPx = 28} = {}) {
  const {widthMm: w, heightMm: h, background: bg, text: tx} = panel, s = pxPerMm;
  const legendPx = 64, widthPx = Math.ceil(w * s + 2 * marginPx), heightPx = Math.ceil(h * s + 2 * marginPx + legendPx);
  const toPx = ([x, y]) => [marginPx + x * s, marginPx + legendPx + (h - y) * s];
  const draw = (strokes, beadMm) => strokes.map(st => ({closed: st.closed, widthPx: beadMm * s, points: st.points.map(toPx)}));
  const groups = [
    {color: COLORS.edge, shapes: [{closed: true, widthPx: 1.5, points: [[0, 0], [w, 0], [w, h], [0, h]].map(toPx)}]},
    {color: COLORS.infillA, shapes: draw(bg.infill[0], bg.options.beadMm)},
    {color: COLORS.infillB, shapes: draw(bg.infill[1], bg.options.beadMm)},
    {color: COLORS.border, shapes: bg.borders.flatMap(loop => draw([loop], loop.widthMm))},
    ...tx.lines.map(line => ({color: COLORS.text, shapes: draw(line.strokes, line.plan.beadWidthMm)}))
  ];
  const label = (str, x, y, cap, color) => {
    const laid = layoutText(loadFont('relief-single-line'), str, {heightMm: cap});
    return {color, shapes: laid.strokes.map(st => ({closed: st.closed, widthPx: 1.5, points: st.points.map(([px, py]) => [x + px, y - py])}))};
  };
  const swatch = (color, x, y) => ({color, shapes: [{closed: false, widthPx: 8, points: [[x, y - 5], [x + 26, y - 5]]}]});
  const left = bg.options, right = tx.options;
  groups.push(
    swatch(COLORS.border, marginPx, 22), label(`Left nozzle ${left.nozzleMm} mm: ${left.layers} layers of ${left.layerMm} mm, ${Math.round(left.density * 100)}% infill at ${left.anglesDeg.join(' and ')} deg, a thin outline first, then one ${left.borderMm} mm border bead and one ${left.ringMm} mm ring bead (inset ${left.ringInsetMm} mm) over it`, marginPx + 34, 22, 11, COLORS.label),
    swatch(COLORS.text, marginPx, 46), label(`Right nozzle ${right.nozzleMm} mm: ${right.layers} layers of ${right.layerMm} mm on top, one bead per stroke`, marginPx + 34, 46, 11, COLORS.label));
  const rgb = rasterize({widthPx, heightPx, groups, background: COLORS.bed});
  return {png: encodePng(widthPx, heightPx, rgb), widthPx, heightPx, pxPerMm: s};
}

export const DEMO_LINES = Object.freeze([
  {text: 'Individual', fontId: 'ems-invite', heightMm: 22, weight: 'regular'},
  {text: 'Toolpath', fontId: 'ems-tech', heightMm: 18, weight: 'regular'},
  {text: 'Control', fontId: 'hershey-sans-1', heightMm: 22, weight: 'bold', raiseMm: 2}
]);
export const DEMO_TRIM_BOTTOM_MM = 2;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), at = args.indexOf('--patch'), patchOut = at < 0 ? null : args.splice(at, 2)[1];
  const out = args[0] ?? 'panel-preview.png';
  const panel = buildPanel({lines: DEMO_LINES, trimBottomMm: DEMO_TRIM_BOTTOM_MM}), image = renderPanel(panel);
  if (patchOut) writeFileSync(patchOut, JSON.stringify(panelPatch(panel), null, 2) + '\n');
  writeFileSync(out, image.png);
  console.log(JSON.stringify({png: out, panelMm: [panel.widthMm, panel.heightMm], image: {widthPx: image.widthPx, heightPx: image.heightPx},
    background: {borderLoops: panel.background.borders.length, widthsMm: panel.background.borders.map(l => l.widthMm), infillLinesPerLayer: panel.background.infill.map(l => l.length), infillSpacingMm: panel.background.spacingMm},
    lines: panel.text.lines.map(l => ({text: l.text, font: l.fontId, construction: `${l.plan.parallelCount} x ${l.plan.beadWidthMm.toFixed(2)} mm printed`, commandedMm: commandedWidthMm(l.plan.beadWidthMm, panel.text.options.layerMm), strokeMm: l.plan.strokeWidthMm, warnings: l.plan.warnings})), insetRingMm: panel.insetRingMm}, null, 2));
}
