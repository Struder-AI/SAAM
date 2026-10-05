// Surface-surface intersection of two NURBS patches.
//
// The intersection of S1(u,v) and S2(s,t) is the solution set of
//   S1(u,v) - S2(s,t) = 0,
// three equations in four unknowns: a set of curves. Boundary points come
// first: each patch's four boundary curves are intersected with the other
// surface (three equations, three unknowns), found by subdividing both into
// rational Bezier pieces, whose control hulls contain them, and solving by
// Newton where boxes overlap. Every curve that reaches a boundary starts at
// one of these points and is marched along n1 x n2 (a predictor of length h,
// a corrector holding that length, h halved until the chord stays within
// chordMm) until it lands exactly on the next one; no step leaves a patch.
// Closed loops touching no boundary are seeded by subdividing both patches.
// A boundary edge lying in the other surface is itself an intersection curve.
//
// Kept limits (sampling, as in planar sectioning): a closed interior loop, or
// a pair of boundary crossings, closer together than seedMm can be missed.
// Tangential contact (n1 parallel to n2) ends a branch; flat pieces lying in
// one plane are reported as coplanar, not traced; a pole edge is not a curve.
import { evaluate } from './nurbs.mjs';
import { cross, dot, subtract, distance, length } from './tolerance.mjs';

const PARAMETER_EPSILON = 1e-10, POINT_TOLERANCE = 1e-9, TANGENT_LIMIT = 1e-7;

// ---------------------------------------------------------------- Bezier pieces

// Knot insertion (Boehm) until every distinct knot inside the domain has
// multiplicity `degree`; each nonzero span's controls are then its Bezier net.
function refineRow(points, knots, degree) {
  let P = points.map(p => [...p]), U = [...knots];
  const lo = U[degree], hi = U[U.length - degree - 1];
  const values = [...new Set(U.filter(u => u >= lo && u <= hi))];
  for (const u of values)
    for (;;) {
      const multiplicity = U.filter(k => k === u).length;
      if (multiplicity >= degree) break;
      let k = -1;
      for (let i = 0; i < U.length - 1; i++) if (U[i] <= u && u < U[i + 1]) k = i;
      if (k < 0) break;
      const Q = [];
      for (let i = 0; i <= P.length; i++) {
        if (i <= k - degree) Q.push(P[i]);
        else if (i <= k - multiplicity) {
          const a = (u - U[i]) / (U[i + degree] - U[i]);
          Q.push(P[i].map((c, n) => a * c + (1 - a) * P[i - 1][n]));
        } else Q.push(P[i - 1]);
      }
      U.splice(k + 1, 0, u); P = Q;
    }
  const segments = [];
  for (let k = degree; k < U.length - degree - 1; k++)
    if (U[k + 1] > U[k]) segments.push({ range: [U[k], U[k + 1]], first: k - degree });
  return { points: P, segments };
}

// Rational Bezier pieces of a patch: nets of homogeneous points [xw, yw, zw, w],
// rows along U, with their parameter ranges.
const PIECES = new WeakMap();
export function bezierPieces(patch) {
  if (!PIECES.has(patch)) PIECES.set(patch, extractPieces(patch));
  return PIECES.get(patch);
}
function extractPieces(patch) {
  const { nu, nv, orderU, orderV, knotsU, knotsV, cp } = patch, p = orderU - 1, q = orderV - 1;
  const at = (i, j) => Array.from(cp.subarray((i * nv + j) * 4, (i * nv + j) * 4 + 4));
  // Refine along V for every row, then along U for every refined column.
  const rows = Array.from({ length: nu }, (_, i) => refineRow(Array.from({ length: nv }, (_, j) => at(i, j)), knotsV, q));
  const vSegments = rows[0].segments, columns = rows[0].points.length;
  const cols = Array.from({ length: columns }, (_, j) => refineRow(rows.map(r => r.points[j]), knotsU, p));
  const uSegments = cols[0].segments, pieces = [];
  for (const su of uSegments)
    for (const sv of vSegments)
      pieces.push({ u: su.range, v: sv.range, p, q,
        net: Array.from({ length: p + 1 }, (_, i) => Array.from({ length: q + 1 }, (_, j) => cols[sv.first + j].points[su.first + i])) });
  return pieces;
}

function splitNet(piece, direction) {
  const { net, p, q } = piece, half = (a, b) => a.map((c, n) => (c + b[n]) / 2);
  const casteljau = line => {
    const left = [], right = [];let level = line;
    while (level.length) { left.push(level[0]); right.unshift(level.at(-1)); level = level.slice(1).map((pt, i) => half(level[i], pt)); }
    return [left, right];
  };
  if (direction === 'u') {
    const mid = (piece.u[0] + piece.u[1]) / 2, left = [], right = [];
    const columns = Array.from({ length: q + 1 }, (_, j) => casteljau(net.map(row => row[j])));
    for (let i = 0; i <= p; i++) { left.push(columns.map(c => c[0][i])); right.push(columns.map(c => c[1][i])); }
    return [{ ...piece, u: [piece.u[0], mid], net: left }, { ...piece, u: [mid, piece.u[1]], net: right }];
  }
  const mid = (piece.v[0] + piece.v[1]) / 2, split = net.map(casteljau);
  return [{ ...piece, v: [piece.v[0], mid], net: split.map(s => s[0]) }, { ...piece, v: [mid, piece.v[1]], net: split.map(s => s[1]) }];
}

function describe(piece) {
  const points = piece.net.flat().map(h => [h[0] / h[3], h[1] / h[3], h[2] / h[3]]);
  const min = [0, 1, 2].map(a => Math.min(...points.map(p => p[a]))), max = [0, 1, 2].map(a => Math.max(...points.map(p => p[a])));
  const net = piece.net.map(row => row.map(h => [h[0] / h[3], h[1] / h[3], h[2] / h[3]]));
  const extentU = Math.max(...net[0].map((_, j) => distance(net[0][j], net.at(-1)[j])));
  const extentV = Math.max(...net.map(row => distance(row[0], row.at(-1))));
  // Plane of the corners; the piece is flat when every control lies on it.
  const c = [net[0][0], net.at(-1)[0], net.at(-1).at(-1), net[0].at(-1)];
  let normal = cross(subtract(c[2], c[0]), subtract(c[3], c[1]));
  const n = length(normal);normal = n > 0 ? normal.map(x => x / n) : null;
  const offset = normal ? dot(normal, points[0]) : 0;
  const flatness = normal ? Math.max(...points.map(p => Math.abs(dot(normal, p) - offset))) : Infinity;
  return { ...piece, min, max, size: distance(min, max), extentU, extentV, normal, offset, flatness };
}

// ------------------------------------------------------------------ linear algebra

function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]), scale = Math.max(...A.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (!(Math.abs(M[pivot][c]) > 1e-13 * scale)) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// ----------------------------------------------------------------- point solves

const inside = (patch, u, v, epsilon = PARAMETER_EPSILON) =>
  u >= patch.domainU[0] - epsilon && u <= patch.domainU[1] + epsilon && v >= patch.domainV[0] - epsilon && v <= patch.domainV[1] + epsilon;
const clampTo = (t, [a, b]) => Math.min(b, Math.max(a, t));
const clampParameters = (A, B, x) => [clampTo(x[0], A.domainU), clampTo(x[1], A.domainV), clampTo(x[2], B.domainU), clampTo(x[3], B.domainV)];

function state(A, B, x) {
  const a = evaluate(A, x[0], x[1]), b = evaluate(B, x[2], x[3]);
  return { x, a, b, F: subtract(a.point, b.point), J: [0, 1, 2].map(k => [a.du[k], a.dv[k], -b.du[k], -b.dv[k]]) };
}

// Minimum-norm Gauss-Newton onto the curve from x.
function projectToCurve(A, B, x0) {
  let x = clampParameters(A, B, x0);
  for (let step = 0; step < 60; step++) {
    const s = state(A, B, x);
    if (length(s.F) <= POINT_TOLERANCE) return s;
    const JJ = [0, 1, 2].map(i => [0, 1, 2].map(j => s.J[i].reduce((sum, v, k) => sum + v * s.J[j][k], 0)));
    const y = solveLinear(JJ, s.F.map(v => -v));
    if (!y) return null;
    const dx = [0, 1, 2, 3].map(k => y.reduce((sum, v, i) => sum + v * s.J[i][k], 0));
    const next = clampParameters(A, B, x.map((v, k) => v + dx[k]));
    if (next.every((v, k) => Math.abs(v - x[k]) < 1e-15)) return length(s.F) <= 1e-7 ? s : null;
    x = next;
  }
  const s = state(A, B, x);return length(s.F) <= 1e-7 ? s : null;
}

// Newton with a fourth equation: extra(x) = [value, gradient over x].
function solveConstrained(A, B, x0, extra) {
  let x = [...x0];
  for (let step = 0; step < 40; step++) {
    const s = state(A, B, x), [g, dg] = extra(s);
    if (length(s.F) <= POINT_TOLERANCE && Math.abs(g) <= POINT_TOLERANCE) return s;
    const dx = solveLinear([...s.J, dg], [...s.F.map(v => -v), -g]);
    if (!dx || !dx.every(Number.isFinite)) return null;
    x = x.map((v, k) => v + dx[k]);
    if (dx.every(d => Math.abs(d) < 1e-14)) break;
  }
  const s = state(A, B, x);
  return length(s.F) <= 1e-7 ? s : null;
}

// ------------------------------------------------------------------ boundary points

// A patch's four boundary curves: edge 0 is v = v0 (u runs), 1 is u = u1,
// 2 is v = v1, 3 is u = u0. `at(t)` gives the patch parameters on the edge.
const EDGES = [
  { along: 0, at: (P, t) => [t, P.domainV[0]] }, { along: 1, at: (P, t) => [P.domainU[1], t] },
  { along: 0, at: (P, t) => [t, P.domainV[1]] }, { along: 1, at: (P, t) => [P.domainU[0], t] }];

function edgePieces(patch, pieces) {
  const out = [];
  for (const p of pieces) {
    if (p.v[0] === patch.domainV[0]) out.push({ edge: 0, range: p.u, net: p.net.map(row => row[0]) });
    if (p.u[1] === patch.domainU[1]) out.push({ edge: 1, range: p.v, net: p.net.at(-1) });
    if (p.v[1] === patch.domainV[1]) out.push({ edge: 2, range: p.u, net: p.net.map(row => row.at(-1)) });
    if (p.u[0] === patch.domainU[0]) out.push({ edge: 3, range: p.v, net: p.net[0] });
  }
  return out.map(describeCurve).filter(c => c.size > 0);   // a pole edge is a point, not a curve
}

function describeCurve(piece) {
  const points = piece.net.map(h => [h[0] / h[3], h[1] / h[3], h[2] / h[3]]);
  const min = [0, 1, 2].map(a => Math.min(...points.map(p => p[a]))), max = [0, 1, 2].map(a => Math.max(...points.map(p => p[a])));
  return { ...piece, min, max, size: distance(min, max) };
}

function splitCurve(piece) {
  const half = (a, b) => a.map((c, n) => (c + b[n]) / 2), left = [], right = [];let level = piece.net;
  while (level.length) { left.push(level[0]); right.unshift(level.at(-1)); level = level.slice(1).map((pt, i) => half(level[i], pt)); }
  const mid = (piece.range[0] + piece.range[1]) / 2;
  return [{ ...piece, range: [piece.range[0], mid], net: left }, { ...piece, range: [mid, piece.range[1]], net: right }].map(describeCurve);
}

// Where one edge of E meets surface S: C(t) = S(s,t), three equations in three unknowns.
function edgeSurfacePoint(E, edge, S, x0) {
  let x = [...x0];
  const range = EDGES[edge].along ? E.domainV : E.domainU;
  for (let step = 0; step < 50; step++) {
    const c = evaluate(E, ...EDGES[edge].at(E, x[0])), b = evaluate(S, x[1], x[2]);
    const F = subtract(c.point, b.point), dC = EDGES[edge].along ? c.dv : c.du;
    if (length(F) <= POINT_TOLERANCE) return { t: x[0], s: [x[1], x[2]], point: c.point, dC, normal: b.normal };
    const dx = solveLinear([0, 1, 2].map(k => [dC[k], -b.du[k], -b.dv[k]]), F.map(v => -v));
    if (!dx) return null;
    x = [clampTo(x[0] + dx[0], range), clampTo(x[1] + dx[1], S.domainU), clampTo(x[2] + dx[2], S.domainV)];
    if (dx.every(d => Math.abs(d) < 1e-15)) break;
  }
  return null;
}

// Closest point of S to p, from a starting guess (Gauss-Newton).
function projectToSurface(S, p, guess) {
  let x = [...guess];
  for (let step = 0; step < 50; step++) {
    const b = evaluate(S, x[0], x[1]), r = subtract(p, b.point);
    const a = dot(b.du, b.du), c = dot(b.du, b.dv), d = dot(b.dv, b.dv), det = a * d - c * c;
    if (Math.abs(det) < 1e-300) break;
    const r0 = dot(b.du, r), r1 = dot(b.dv, r), du = (d * r0 - c * r1) / det, dv = (a * r1 - c * r0) / det;
    const next = [clampTo(x[0] + du, S.domainU), clampTo(x[1] + dv, S.domainV)];
    if (Math.abs(next[0] - x[0]) < 1e-15 && Math.abs(next[1] - x[1]) < 1e-15) { x = next; break; }
    x = next;
  }
  const b = evaluate(S, x[0], x[1]);
  return { uv: x, distance: distance(p, b.point) };
}

// An edge of E lying in S along an interval: the intersection curve there is
// the edge itself. Walk the edge while it stays on S.
function coincidentRun(E, edge, S, hit, { chordMm, toleranceMm }) {
  const range = EDGES[edge].along ? E.domainV : E.domainU, span = range[1] - range[0];
  const onS = (t, guess) => { const point = evaluate(E, ...EDGES[edge].at(E, t), false).point, pr = projectToSurface(S, point, guess);
    return pr.distance <= toleranceMm ? { t, point, uv: pr.uv } : null; };
  const probe = onS(clampTo(hit.t + 1e-4 * span, range), hit.s) ?? onS(clampTo(hit.t - 1e-4 * span, range), hit.s);
  if (!probe || Math.abs(probe.t - hit.t) < 1e-12) return null;
  const walk = direction => {
    const out = [];let last = { t: hit.t, point: hit.point, uv: hit.s }, dt = span / 64;
    while (Math.abs(dt) > span * 1e-12) {
      const t = clampTo(last.t + direction * dt, range);
      if (t === last.t) break;
      const next = onS(t, last.uv);
      // The chord must follow the edge curve, which is exact; the step only has to stay on S.
      const mid = next && evaluate(E, ...EDGES[edge].at(E, (last.t + t) / 2), false).point;
      if (next && distance(mid, last.point.map((v, k) => (v + next.point[k]) / 2)) <= chordMm) { out.push(next); last = next; dt = Math.min(dt * 1.5, span / 16); }
      else dt /= 2;
    }
    return out;
  };
  const run = [...walk(-1).reverse(), { t: hit.t, point: hit.point, uv: hit.s }, ...walk(1)];
  return run.length > 1 ? run : null;
}

function boundaryHits(E, S, eIsA, { seedMm, toleranceMm, chordMm }) {
  const hits = [], runs = [], stack = [];
  const sPieces = bezierPieces(S).map(describe);
  for (const c of edgePieces(E, bezierPieces(E))) for (const s of sPieces) stack.push([c, s]);
  const overlap = (a, b) => a.min.every((v, k) => v <= b.max[k] + toleranceMm && b.min[k] <= a.max[k] + toleranceMm);
  const leaves = [];
  while (stack.length) {
    const [c, s] = stack.pop();
    if (!overlap(c, s)) continue;
    if (c.size <= seedMm && s.size <= seedMm) { leaves.push([c, s]); continue; }
    if (c.size >= s.size) for (const half of splitCurve(c)) stack.push([half, s]);
    else for (const half of splitNet(s, s.extentU >= s.extentV ? 'u' : 'v').map(describe)) stack.push([c, half]);
  }
  const edgeRange = edge => EDGES[edge].along ? E.domainV : E.domainU;
  for (const [c, s] of leaves) {
    if (runs.some(r => r.edge === c.edge && c.range[0] >= r.from - 1e-12 && c.range[1] <= r.to + 1e-12)) continue;
    // An edge lying in S makes the point system singular; there the edge
    // itself is the intersection curve.
    const tMid = (c.range[0] + c.range[1]) / 2, onEdge = evaluate(E, ...EDGES[c.edge].at(E, tMid));
    const projected = projectToSurface(S, onEdge.point, [(s.u[0] + s.u[1]) / 2, (s.v[0] + s.v[1]) / 2]);
    if (projected.distance <= toleranceMm) {
      const dC = EDGES[c.edge].along ? onEdge.dv : onEdge.du, normal = evaluate(S, ...projected.uv).normal;
      if (normal && Math.abs(dot(dC, normal)) <= 1e-9 * length(dC)) {
        const run = coincidentRun(E, c.edge, S, { t: tMid, s: projected.uv, point: onEdge.point }, { chordMm, toleranceMm });
        if (run) { runs.push({ edge: c.edge, from: run[0].t, to: run.at(-1).t, run }); continue; }
      }
    }
    const hit = edgeSurfacePoint(E, c.edge, S, [tMid, (s.u[0] + s.u[1]) / 2, (s.v[0] + s.v[1]) / 2]);
    if (!hit || !inside(S, hit.s[0], hit.s[1])) continue;
    const t = clampTo(hit.t, edgeRange(c.edge));
    const uvE = EDGES[c.edge].at(E, t), x = eIsA ? [...uvE, ...hit.s] : [...hit.s, ...uvE];
    hits.push({ x, point: hit.point });
  }
  return { hits, runs: runs.map(r => ({ edge: r.edge, points: r.run.map(q => q.point),
    uvE: r.run.map(q => EDGES[r.edge].at(E, q.t)), uvS: r.run.map(q => q.uv), eIsA })) };
}

// ------------------------------------------------------------------ marching

function tangent(s) {
  if (!s.a.normal || !s.b.normal) return null;
  const t = cross(s.a.normal, s.b.normal), n = length(t);
  return n < TANGENT_LIMIT ? null : t.map(v => v / n);
}

// Parameter increments that move each surface by h T (least squares on its tangent plane).
function increments(s, T, h) {
  const move = (d0, d1) => {
    const a = dot(d0, d0), b = dot(d0, d1), c = dot(d1, d1), r0 = h * dot(d0, T), r1 = h * dot(d1, T), det = a * c - b * b;
    return Math.abs(det) < 1e-300 ? [0, 0] : [(c * r0 - b * r1) / det, (a * r1 - b * r0) / det];
  };
  return [...move(s.a.du, s.a.dv), ...move(s.b.du, s.b.dv)];
}

// Next curve point at chord length h: predictor along T, corrector holding
// the step length. Evaluation clamps to the domain, so a prediction outside it
// is reported rather than corrected.
function stepAlong(A, B, s, T, h) {
  const target = s.a.point.map((v, k) => v + h * T[k]), guess = s.x.map((v, k) => v + increments(s, T, h)[k]);
  if (!inside(A, guess[0], guess[1]) || !inside(B, guess[2], guess[3])) return { leaving: true };
  const next = solveConstrained(A, B, guess, n => [dot(subtract(n.a.point, target), T), [dot(n.a.du, T), dot(n.a.dv, T), 0, 0]]);
  return { next: next && inside(A, next.x[0], next.x[1]) && inside(B, next.x[2], next.x[3]) ? next : null };
}

// The curve point halfway along a step lies within chordMm of its chord.
function chordHolds(A, B, s, T, end, chordMm) {
  const d = dot(subtract(end.a.point, s.a.point), T), half = stepAlong(A, B, s, T, d / 2).next;
  return Boolean(half) && distance(half.a.point, s.a.point.map((v, k) => (v + end.a.point[k]) / 2)) <= chordMm;
}

// A known endpoint that this step reaches: ahead along T within h, and where
// the predictor says the curve would be in both patches' parameters, so a seam
// point is never mistaken for its twin on the other side of the seam.
function endpointWithin(s, T, h, endpoints) {
  let best = null;
  for (const e of endpoints) {
    if (e.used) continue;
    const d = dot(subtract(e.point, s.a.point), T);
    if (d <= 0 || d > h) continue;
    const inc = increments(s, T, d), scaleA = Math.hypot(inc[0], inc[1]) + 1e-12, scaleB = Math.hypot(inc[2], inc[3]) + 1e-12;
    const offA = Math.hypot(e.x[0] - s.x[0] - inc[0], e.x[1] - s.x[1] - inc[1]), offB = Math.hypot(e.x[2] - s.x[2] - inc[2], e.x[3] - s.x[3] - inc[3]);
    if (offA > 0.5 * scaleA || offB > 0.5 * scaleB) continue;
    if (!best || d < best.d) best = { e, d };
  }
  return best;
}

// March from a point along T until a known endpoint, a closed return to the
// start, or tangential contact. Steps never leave the patches: the curve's
// exits are all known endpoints, and a step that would pass one lands on it.
function march(A, B, start, T0, endpoints, { chordMm, stepMm }) {
  const states = [start];let s = start, h = stepMm, T = T0;
  for (;;) {
    let next = null, reached = null;
    while (!next) {
      const hit = endpointWithin(s, T, h, endpoints);
      if (hit && chordHolds(A, B, s, T, { a: { point: hit.e.point } }, chordMm)) { reached = hit.e; next = state(A, B, hit.e.x); break; }
      const step = stepAlong(A, B, s, T, h);
      if (step.next && chordHolds(A, B, s, T, step.next, chordMm)) { next = step.next; break; }
      h /= 2;
      if (h < 1e-9) return { states, end: step.leaving ? 'missed-boundary' : 'stalled' };
    }
    states.push(next);
    if (reached) { reached.used = true; return { states, end: 'boundary' }; }
    // Back at the start in both patches' parameters: a closed loop.
    const reach = next.x.map((v, k) => Math.abs(v - s.x[k]));
    if (states.length > 3 && distance(next.a.point, start.a.point) <= h && start.x.every((v, k) => Math.abs(v - next.x[k]) <= 2 * reach[k] + 1e-9)) {
      states[states.length - 1] = start;return { states, end: 'closed' };
    }
    const nextT = tangent(next);
    if (!nextT) return { states, end: 'tangent' };
    T = dot(nextT, T) >= 0 ? nextT : nextT.map(v => -v);
    s = next;h = Math.min(stepMm, h * 1.5);
  }
}

// From a boundary point the curve enters both patches in one direction only.
function inwardTangent(A, B, s) {
  const T = tangent(s);
  if (!T) return null;
  const bounds = [A.domainU, A.domainV, B.domainU, B.domainV], probe = 1e-6;
  for (const sign of [1, -1]) {
    const d = T.map(v => sign * v), inc = increments(s, d, probe);
    const inward = bounds.every(([lo, hi], k) => !(Math.abs(s.x[k] - lo) <= PARAMETER_EPSILON && inc[k] < -1e-15) && !(Math.abs(s.x[k] - hi) <= PARAMETER_EPSILON && inc[k] > 1e-15));
    if (inward) return d;
  }
  return null;
}

// ------------------------------------------------------------------ public

// Every intersection curve of patches A and B, as polylines with the matching
// parameters on both patches. Coplanar flat regions are reported separately.
// Curve ends: 'boundary' (exactly on a patch boundary), 'closed', 'edge' (a
// boundary edge lying in the other surface), 'tangent', or a failure to report.
export function intersectPatches(A, B, { chordMm = 1e-3, seedMm = 0.4, stepMm = 2, toleranceMm = 1e-6 } = {}) {
  const options = { chordMm, seedMm, stepMm, toleranceMm };
  const fromA = boundaryHits(A, B, true, options), fromB = boundaryHits(B, A, false, options);
  const curves = [...fromA.runs, ...fromB.runs].map(r => ({ points: r.points, uvA: r.eIsA ? r.uvE : r.uvS, uvB: r.eIsA ? r.uvS : r.uvE, closed: false, ends: ['edge', 'edge'] }));
  const onRun = p => curves.some(c => c.points.some((q, i) => i && segmentDistance(p, c.points[i - 1], q) <= toleranceMm));
  const endpoints = [];
  for (const h of [...fromA.hits, ...fromB.hits]) {
    if (onRun(h.point) || endpoints.some(e => distance(e.point, h.point) <= 1e-7 && e.x.every((v, k) => Math.abs(v - h.x[k]) <= 1e-7))) continue;
    endpoints.push({ ...h, used: false });
  }
  const record = (states, closed, ends) => curves.push({ points: states.map(s => s.a.point), uvA: states.map(s => [s.x[0], s.x[1]]),
    uvB: states.map(s => [s.x[2], s.x[3]]), closed, ends });
  for (const e of endpoints) {
    if (e.used) continue;
    const start = state(A, B, e.x), T = inwardTangent(A, B, start);
    e.used = true;
    if (!T) continue;          // the curve only touches the boundary here
    const run = march(A, B, start, T, endpoints, options);
    record(run.states, false, ['boundary', run.end]);
  }
  // Closed loops inside both patches touch no boundary: seed them by subdivision.
  const { pairs, coplanar } = subdivide(A, B, options);
  const near = p => curves.some(c => c.points.some((q, i) => i && segmentDistance(p, c.points[i - 1], q) <= seedMm));
  for (const [a, b] of pairs) {
    const seed = projectToCurve(A, B, [(a.u[0] + a.u[1]) / 2, (a.v[0] + a.v[1]) / 2, (b.u[0] + b.u[1]) / 2, (b.v[0] + b.v[1]) / 2]);
    if (!seed || !inside(A, seed.x[0], seed.x[1]) || !inside(B, seed.x[2], seed.x[3]) || near(seed.a.point)) continue;
    const T = tangent(seed);
    if (!T) continue;
    const run = march(A, B, seed, T, endpoints, options);
    record(run.states, run.end === 'closed', run.end === 'closed' ? ['closed', 'closed'] : ['interior', run.end]);
  }
  return { curves, coplanar };
}

function subdivide(A, B, { seedMm, toleranceMm }) {
  const pairs = [], coplanar = [], stack = [];
  for (const a of bezierPieces(A).map(describe)) for (const b of bezierPieces(B).map(describe)) stack.push([a, b]);
  const overlap = (a, b) => a.min.every((v, k) => v <= b.max[k] + toleranceMm && b.min[k] <= a.max[k] + toleranceMm);
  while (stack.length) {
    const [a, b] = stack.pop();
    if (!overlap(a, b)) continue;
    const flat = a.flatness <= toleranceMm && b.flatness <= toleranceMm;
    if (flat && Math.abs(Math.abs(dot(a.normal, b.normal)) - 1) < 1e-9 && Math.abs(dot(a.normal, b.net[0][0].slice(0, 3).map(v => v / b.net[0][0][3])) - a.offset) <= toleranceMm) {
      coplanar.push({ a: { u: a.u, v: a.v }, b: { u: b.u, v: b.v } });continue;
    }
    if (a.size <= seedMm && b.size <= seedMm) { pairs.push([a, b]); continue; }
    const target = a.size >= b.size ? a : b, halves = splitNet(target, target.extentU >= target.extentV ? 'u' : 'v').map(describe);
    for (const half of halves) stack.push(target === a ? [half, b] : [a, half]);
  }
  return { pairs, coplanar };
}

function segmentDistance(p, a, b) {
  const d = subtract(b, a), l = dot(d, d);
  const t = l > 0 ? Math.max(0, Math.min(1, dot(subtract(p, a), d) / l)) : 0;
  return distance(p, a.map((v, k) => v + t * d[k]));
}
