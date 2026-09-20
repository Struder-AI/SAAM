import {inflatePaths} from '../../../core/region/clipper2.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {chainStrokes, layoutText, strokeBounds, translateStrokes} from './layout.mjs';
import {JOIN_FRACTION} from './measure.mjs';
import {planLineText} from './plan.mjs';

const UM = 1000; // Clipper integer units per millimetre
const round = v => Math.round(v * 1000) / 1000;
const segments = (pts, closed) => pts.slice(1).concat(closed ? [pts[0]] : []).map((b, i) => [pts[i], b]);
const glyphKey = s => `${s.glyph.line}:${s.glyph.index}`;

function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  const q = [a[0] + t * dx, a[1] + t * dy];
  return {point: q, distance: Math.hypot(p[0] - q[0], p[1] - q[1])};
}
function nearestOnStroke(p, stroke) {
  let best = {distance: Infinity, point: null};
  for (const [a, b] of segments(stroke.points, stroke.closed)) { const hit = nearestOnSegment(p, a, b); if (hit.distance < best.distance) best = hit; }
  return best;
}

// `line-network` does not infer junctions, so an endpoint the font leaves a hair
// short of another stroke of its own glyph is extended onto it. Only gaps up to
// toleranceMm are closed; the bundled fonts have no gaps between 0.03 and 0.04 of
// cap height, so this tolerance separates drawing imprecision from a real gap.
export function snapJunctions(strokes, toleranceMm) {
  const byGlyph = new Map();
  for (const s of strokes) { const k = glyphKey(s); if (!byGlyph.has(k)) byGlyph.set(k, []); byGlyph.get(k).push(s); }
  return strokes.map(s => {
    if (s.closed || s.dot || s.points.length < 2) return s;
    const others = byGlyph.get(glyphKey(s)).filter(o => o !== s && !o.dot);
    const points = [...s.points];
    const extend = (end, atStart) => {
      let best = {distance: Infinity};
      for (const o of others) { const hit = nearestOnStroke(end, o); if (hit.distance < best.distance) best = hit; }
      if (best.distance > 1e-6 && best.distance <= toleranceMm) atStart ? points.unshift(best.point) : points.push(best.point);
    };
    extend(s.points[0], true);
    extend(s.points.at(-1), false);
    return {...s, points};
  });
}

// A mark a bead would fully cover is a dot, not a loop: a closed stroke no wider
// than twice the bead collapses to its center, and a dot already inside a neighbor's
// bead is dropped (EMS Invite's M carries one such stray point).
export function collapseMarks(strokes, widthMm) {
  const collapsed = strokes.map(s => {
    if (!s.closed) return s;
    const b = strokeBounds([s]);
    return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) <= 2 * widthMm
      ? {...s, closed: false, dot: true, points: [[(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]]} : s;
  });
  return collapsed.filter(s => {
    if (!s.dot) return true;
    return !collapsed.some(o => o !== s && !o.dot && glyphKey(o) === glyphKey(s) && nearestOnStroke(s.points[0], o).distance <= widthMm / 2);
  });
}

const encode = strokes => strokes.map(s => {
  const pts = s.dot ? [s.points[0], [s.points[0][0] + 1 / UM, s.points[0][1]]] : s.closed ? [...s.points, s.points[0]] : s.points;
  return pts.map(([x, y]) => ({X: Math.round(x * UM), Y: Math.round(y * UM)}));
});

// The wanted stroke as n beads side by side: bead k is the centerline widened by
// (n-1)/2 pitches down to zero, so each pair of beads is the two sides of the
// stroke and an odd count keeps the centerline itself. Round joins and ends close
// each side into one loop, so a junction is one continuous bead, not a crossing.
export function concentricLoops(strokes, {beadWidthMm, pitchMm, parallelCount}) {
  const out = [], arcTolerance = Math.max(5, Math.min(50, beadWidthMm * UM / 16));
  for (let k = 0; k < Math.ceil(parallelCount / 2); k++) {
    const r = (parallelCount - 1) * pitchMm / 2 - k * pitchMm;
    if (r > 1e-9) {
      for (const loop of inflatePaths(encode(strokes), r * UM, {join: 'round', miterLimit: 2, arcTolerance, end: 'Round'}))
        if (loop.length >= 3) out.push({closed: true, points: loop.map(p => [p.X / UM, p.Y / UM])});
    } else out.push(...strokes.filter(s => !s.dot).map(s => ({closed: s.closed, points: s.points})));
  }
  return out;
}

const lengthOf = s => segments(s.points, s.closed).reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);

// Word to `line-network` settings. `beadRangeMm` is the thinnest and widest bead
// the process allows; the plan decides between one bead and several.
export function lineText({font, text, heightMm, weight, stemRatio, beadRangeMm, layers = 2, id = 'text', spacingFactor = 1, letterSpacingMm = 0, align = 'left', chain = true, onInfeasible = 'reduce'}) {
  requireThat(Number.isInteger(layers) && layers >= 1, 'layers must be a positive integer.');
  const plan = planLineText({font, text, heightMm, weight, stemRatio, beadRangeMm, spacingFactor, onInfeasible});
  requireThat(plan.feasible, plan.warnings.at(-1));
  const laid = layoutText(font, text, {heightMm, letterSpacingMm, align});
  const joinMm = JOIN_FRACTION * heightMm, w = plan.beadWidthMm, W = plan.strokeWidthMm;
  let strokes = collapseMarks(snapJunctions(laid.strokes, joinMm), W);
  if (chain) strokes = chainStrokes(strokes, joinMm);
  // Bring the outer edge of the ink to the origin so placement sets where the text sits.
  const b = strokeBounds(strokes);
  strokes = translateStrokes(strokes, W / 2 - b.min[0], W / 2 - b.min[1]);

  let network;
  if (plan.parallelCount === 1) {
    network = strokes.map(s => s.dot
      ? {closed: false, points: [[s.points[0][0] - w / 2, s.points[0][1]], [s.points[0][0] + w / 2, s.points[0][1]]]}
      : {closed: s.closed, points: s.points});
  } else {
    // Group per glyph (chained strokes travel with their first glyph) so travel stays letter to letter.
    const groups = new Map();
    for (const s of strokes) { const k = glyphKey(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    network = [...groups.values()].flatMap(g => concentricLoops(g, plan));
  }
  network = network.filter(s => s.points.length >= (s.closed ? 3 : 2)).map(s => ({closed: s.closed, points: s.points.map(p => [round(p[0]), round(p[1])])}));
  const ink = strokeBounds(network);
  return {
    plan, network: {id, strokes: network}, layers,
    lineNetwork: {enabled: true, layers, networks: [{id, strokes: network}]},
    process: {lineWidthMm: w},
    report: {
      strokes: network.length, beadLengthMm: round(network.reduce((sum, s) => sum + lengthOf(s), 0)),
      extentMm: [round(ink.max[0] - ink.min[0] + w), round(ink.max[1] - ink.min[1] + w)], lines: laid.lines.length
    }
  };
}
