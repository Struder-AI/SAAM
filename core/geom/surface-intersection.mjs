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
// Initial seeds do not decide completeness: control hulls and interval root
// bounds audit the remaining cells to chord/solve accuracy. Unresolved connected
// contacts larger than that accuracy fail, allowing Geometry recovery to retry.
// Tangencies and incomplete traces fail early; a collapsed pole is not a curve.
import { evaluate,requireSplineDegree } from './nurbs.mjs';
import {intersect} from '../region/intersection.mjs';
import { cross, dot, subtract, distance, length, TOLERANCE } from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,PROGRAM_STEP_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import { DIRECTION_TOLERANCE } from './frame.mjs';
import {faceTrimRegion} from './surface-trim.mjs';
import {splitBezierNet,restrictBezierNet,bernsteinProductWeights} from './bezier-net.mjs';

// Tolerances (core/README.md#dimensions-and-tolerances). A stalled solve still lands on
// both surfaces within print resolution. Domain membership is in parameter units.
// Tangential contact is a shape judgement on the sine between the normals. A solve has
// stalled when its step no longer changes the parameters in floating point.
// Surface distance and the predictor constraint are millimetre residuals.
// They converge within one program step, below functional print resolution.
const PARAMETER_EPSILON = TOLERANCE.parameter, POINT_TOLERANCE = PROGRAM_STEP_MM, TANGENT_LIMIT = DIRECTION_TOLERANCE;
const stalled = (x, step) => step.every((d, k) => x[k] + d === x[k]);
// An edge-coincidence probe steps this fraction of the edge's domain (a probe offset, not a tolerance).
const PROBE_FRACTION = (100*TOLERANCE.domainFraction);

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
  requireSplineDegree(patch.orderU-1);requireSplineDegree(patch.orderV-1);
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

function splitNet(piece,direction){
  const range=direction==='u'?piece.u:piece.v,mid=(range[0]+range[1])/2;
  const [left,right]=splitBezierNet(piece.net,direction==='u'?0:1);
  return [{...piece,[direction]:[range[0],mid],net:left},{...piece,[direction]:[mid,range[1]],net:right}];
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
  return { ...piece, hullPoints:points,sourceNet:piece.sourceNet??piece.net,sourceU:piece.sourceU??piece.u,sourceV:piece.sourceV??piece.v,min, max, size: distance(min, max), extentU, extentV, normal, offset, flatness };
}

// ------------------------------------------------------------------ linear algebra

function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]), scale = Math.max(...A.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (!(Math.abs(M[pivot][c]) > ROUNDING_RELATIVE * scale)) return null;
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
    if (next.every((v, k) => v === x[k])) return length(s.F) <= PRINT_RESOLUTION_MM ? s : null;
    x = next;
  }
  const s = state(A, B, x);return length(s.F) <= PRINT_RESOLUTION_MM ? s : null;
}

// Newton with a fourth equation: extra(x) = [value, gradient over x].
function solveConstrained(A, B, x0, extra) {
  let x = [...x0];
  for (let step = 0; step < 40; step++) {
    const s = state(A, B, x), [g, dg] = extra(s);
    if (length(s.F) <= POINT_TOLERANCE && Math.abs(g) <= POINT_TOLERANCE) return s;
    const dx = solveLinear([...s.J, dg], [...s.F.map(v => -v), -g]);
    if (!dx || !dx.every(Number.isFinite)) return null;
    const done = stalled(x, dx);
    x = x.map((v, k) => v + dx[k]);
    if (done) break;
  }
  const s = state(A, B, x);
  return length(s.F) <= PRINT_RESOLUTION_MM ? s : null;
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
export function edgeSurfacePoint(E, edge, S, x0) {
  let x = [...x0];
  const range = EDGES[edge].along ? E.domainV : E.domainU;
  for (let step = 0; step < 50; step++) {
    const c = evaluate(E, ...EDGES[edge].at(E, x[0])), b = evaluate(S, x[1], x[2]);
    const F = subtract(c.point, b.point), dC = EDGES[edge].along ? c.dv : c.du;
    if (length(F) <= POINT_TOLERANCE) return { t: x[0], s: [x[1], x[2]], point: c.point, dC, normal: b.normal };
    const dx = solveLinear([0, 1, 2].map(k => [dC[k], -b.du[k], -b.dv[k]]), F.map(v => -v));
    if (!dx) return null;
    const done = stalled(x, dx);
    x = [clampTo(x[0] + dx[0], range), clampTo(x[1] + dx[1], S.domainU), clampTo(x[2] + dx[2], S.domainV)];
    if (done) break;
  }
  return null;
}

// Closest point of S to p, from a starting guess (Gauss-Newton).
export function projectToSurface(S, p, guess) {
  let x = [...guess];
  for (let step = 0; step < 50; step++) {
    const b = evaluate(S, x[0], x[1]), r = subtract(p, b.point);
    const a = dot(b.du, b.du), c = dot(b.du, b.dv), d = dot(b.dv, b.dv), det = a * d - c * c;
    if (!det) break; // a tiny determinant sends the step to a domain bound
    const r0 = dot(b.du, r), r1 = dot(b.dv, r), du = (d * r0 - c * r1) / det, dv = (a * r1 - c * r0) / det;
    const next = [clampTo(x[0] + du, S.domainU), clampTo(x[1] + dv, S.domainV)];
    if (next[0] === x[0] && next[1] === x[1]) break;
    x = next;
  }
  const b = evaluate(S, x[0], x[1]);
  return { uv: x, distance: distance(p, b.point) };
}

// A bounded global projection tries each rational knot cell. Seeded Newton
// alone can stop at a polar singularity or the wrong side of a periodic chart.
export function projectSurfacePoint(patch,point,{guess=null,toleranceMm=ROUNDING_MM}={}){
  const middle=[patch.domainU,patch.domainV].map(([low,high])=>(low+high)/2);
  const state={best:projectToSurface(patch,point,guess??middle)};
  if(state.best.distance<=toleranceMm)return state.best;
  for(const piece of bezierPieces(patch))for(const fractions of [[.5,.5],[0,.5],[1,.5],[.5,0],[.5,1]]){
    const seed=[piece.u,piece.v].map(([low,high],k)=>low+fractions[k]*(high-low));
    const candidate=projectToSurface(patch,point,seed);
    if(candidate.distance<state.best.distance)state.best=candidate;
    if(candidate.distance<=toleranceMm)return candidate;
  }
  return state.best;
}

// An edge of E lying in S along an interval: the intersection curve there is
// the edge itself. Walk the edge while it stays on S.
function coincidentRun(E, edge, S, hit, { chordMm }) {
  const range = EDGES[edge].along ? E.domainV : E.domainU, span = range[1] - range[0];
  const onS = (t, guess) => { const point = evaluate(E, ...EDGES[edge].at(E, t), false).point, pr = projectToSurface(S, point, guess);
    return pr.distance <= POINT_TOLERANCE ? { t, point, uv: pr.uv } : null; };
  // A shape-contact tolerance extends a coincident run beyond the bounded
  // face, especially at a shallow crossing. Membership here is a root solve;
  // constrain it to program resolution before searching either endpoint.
  if(!onS(hit.t,hit.s))return null;
  const probe = onS(clampTo(hit.t + PROBE_FRACTION * span, range), hit.s) ?? onS(clampTo(hit.t - PROBE_FRACTION * span, range), hit.s);
  if (!probe || Math.abs(probe.t - hit.t) < ROUNDING_RELATIVE * span) return null;
  const walk = direction => {
    const out = [];let last = { t: hit.t, point: hit.point, uv: hit.s }, dt = span / 64;
    while (Math.abs(dt) > span * ROUNDING_RELATIVE) {
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
    // An edge lying in S makes the point system singular; there the edge
    // itself is the intersection curve.
    const tMid = (c.range[0] + c.range[1]) / 2, onEdge = evaluate(E, ...EDGES[c.edge].at(E, tMid));
    const projected = projectToSurface(S, onEdge.point, [(s.u[0] + s.u[1]) / 2, (s.v[0] + s.v[1]) / 2]);
    if (projected.distance <= toleranceMm) {
      if(runs.some(run=>run.edge===c.edge&&runContains(S,run,tMid,onEdge.point,projected.uv)))continue;
      const dC = EDGES[c.edge].along ? onEdge.dv : onEdge.du, normal = evaluate(S, ...projected.uv).normal;
      if (normal && Math.abs(dot(dC, normal)) <= DIRECTION_TOLERANCE * length(dC)) {
        const run = coincidentRun(E, c.edge, S, { t: tMid, s: projected.uv, point: onEdge.point }, { chordMm });
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

// A run is a native edge interval, independent of which subdivision leaf
// proposed its seed. Only its partner chart distinguishes periodic images.
function runContains(surface,record,t,point,uv){
  if(t<record.from||t>record.to)return false;
  const index=record.run.findIndex(sample=>sample.t>=t),end=index<0?record.run.length-1:index,start=Math.max(0,end-1);
  const first=record.run[start],last=record.run[end],fraction=last.t===first.t?0:(t-first.t)/(last.t-first.t);
  const guess=first.uv.map((value,k)=>value+fraction*(last.uv[k]-value)),projected=projectToSurface(surface,point,guess);
  return projected.distance<=POINT_TOLERANCE&&chartParametersNear(surface,uv,projected.uv,POINT_TOLERANCE);
}

function tangent(s) {
  if (!s.a.normal || !s.b.normal) return null;
  const t = cross(s.a.normal, s.b.normal), n = length(t);
  return n < TANGENT_LIMIT ? null : t.map(v => v / n);
}

// Parameter increments that move each surface by h T (least squares on its tangent plane).
function increments(s, T, h) {
  const move = (d0, d1) => {
    const a = dot(d0, d0), b = dot(d0, d1), c = dot(d1, d1), r0 = h * dot(d0, T), r1 = h * dot(d1, T), det = a * c - b * b;
    return !det ? [0, 0] : [(c * r0 - b * r1) / det, (a * r1 - b * r0) / det];
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
    const inc = increments(s, T, d), scaleA = Math.hypot(inc[0], inc[1]) + TOLERANCE.parameter, scaleB = Math.hypot(inc[2], inc[3]) + TOLERANCE.parameter;
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
      if (h < PROGRAM_STEP_MM) return { states, end: step.leaving ? 'missed-boundary' : 'stalled' };
    }
    states.push(next);
    if (reached) { reached.used = true; return { states, end: 'boundary' }; }
    // Back at the start in both patches' parameters: a closed loop.
    const reach = next.x.map((v, k) => Math.abs(v - s.x[k]));
    if (states.length > 3 && distance(next.a.point, start.a.point) <= h && start.x.every((v, k) => Math.abs(v - next.x[k]) <= 2 * reach[k] + TOLERANCE.parameter)) {
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
  // Increments are linear in the step: per millimetre, outward beyond relative rounding.
  const bounds = [A.domainU, A.domainV, B.domainU, B.domainV], probe = 1;
  for (const sign of [1, -1]) {
    const d = T.map(v => sign * v), inc = increments(s, d, probe);
    const inward = bounds.every(([lo, hi], k) => !(Math.abs(s.x[k] - lo) <= PARAMETER_EPSILON && inc[k] < -ROUNDING_RELATIVE) && !(Math.abs(s.x[k] - hi) <= PARAMETER_EPSILON && inc[k] > ROUNDING_RELATIVE));
    if (inward) return d;
  }
  return null;
}

// ------------------------------------------------------------------ public

// Every intersection curve of patches A and B, as polylines with the matching
// parameters on both patches. Coplanar flat regions are reported separately.
// Curve ends: 'boundary' (exactly on a patch boundary), 'closed', 'edge' (a
// boundary edge lying in the other surface), 'tangent', or a failure to report.
// Defaults: chord and on-surface tolerance at print resolution; seed and step are process scale.
export function intersectPatches(A, B, { chordMm = TOLERANCE.chord, seedMm = 0.4, stepMm = 2, toleranceMm = PRINT_RESOLUTION_MM,onDiscovery=ignoreDiscovery,initialCurves=null } = {}) {
  const options = { chordMm, seedMm, stepMm, toleranceMm,onDiscovery };
  const fromA=initialCurves?{runs:[],hits:[]}:boundaryHits(A,B,true,options),fromB=initialCurves?{runs:[],hits:[]}:boundaryHits(B,A,false,options);
  const curves=(initialCurves??[]).map(curve=>refineIntersectionCurve(A,B,curve,chordMm)),points=[];
  const pointEvent=sample=>points.push({point:sample.a.point,uvA:sample.x.slice(0,2),uvB:sample.x.slice(2),kind:tangent(sample)?'bounded-point':'singular-contact'});
  for(const run of [...fromA.runs,...fromB.runs]){
    const curve=refineIntersectionCurve(A,B,{points:run.points,uvA:run.eIsA?run.uvE:run.uvS,uvB:run.eIsA?run.uvS:run.uvE,closed:false,ends:['edge','edge']},chordMm);
    if(!curves.some(prior=>sameParameterTrace(A,B,prior,curve)))curves.push(curve);
  }
  const traceToleranceMm=chordMm+toleranceMm;
  const onRun=hit=>curves.some(curve=>traceContains(A,B,curve,hit.x,hit.point,traceToleranceMm));
  // One endpoint: the same point within print resolution, and parameters within print
  // resolution read in parameter units (unit or mm-length domains), which keeps a seam
  // point apart from its twin a whole period away.
  const endpoints = [];
  for (const raw of [...fromA.hits, ...fromB.hits]) {
    const bounded=snapBoundaryState(A,B,state(A,B,raw.x)),h={x:bounded.x,point:bounded.a.point};
    if (onRun(h) || endpoints.some(e => distance(e.point, h.point) <= PRINT_RESOLUTION_MM && e.x.every((v, k) => Math.abs(v - h.x[k]) <= PRINT_RESOLUTION_MM))) continue;
    endpoints.push({ ...h, used: false });
  }
  const record = (states, closed, ends) => curves.push(refineIntersectionCurve(A,B,{ points: states.map(s => s.a.point), uvA: states.map(s => [s.x[0], s.x[1]]),
    uvB: states.map(s => [s.x[2], s.x[3]]), closed, ends },chordMm));
  for (const e of endpoints) {
    if (e.used) continue;
    const start = snapBoundaryState(A,B,state(A,B,e.x)), T = inwardTangent(A, B, start);
    e.used = true;
    if (!T) {pointEvent(start);continue;} // no common inward branch in these bounded charts
    const run = march(A, B, start, T, endpoints, options);
    record(run.states, false, ['boundary', run.end]);
  }
  const failed=curves.find(curve=>curve.ends?.some(end=>['tangent','stalled','missed-boundary'].includes(end)));
  if(failed){
    const error=new Error('Surface intersection '+A.name+'/'+B.name+' has an incomplete trace ('+failed.ends.join(', ')+').');
    error.code='SURFACE_TRACE_FAILED';throw error;
  }
  // Closed loops inside both patches touch no boundary: seed them by subdivision.
  const { pairs, coplanar } = subdivide(A, B, options);
  const near=seed=>curves.some(curve=>traceContains(A,B,curve,seed.x,seed.a.point,traceToleranceMm));
  const pending=[...pairs],uncertain=[],discovery={method:'adaptive-control-hull',resolutionMm:Math.max(chordMm,toleranceMm),subdivisions:0,contractions:0,visited:0,collapsedContacts:0};
  while(pending.length){
    discovery.visited++;
    if(discovery.visited%128===0)onDiscovery({pending:pending.length,curves:curves.length,visited:discovery.visited});
    const [a,b]=pending.pop(),box=intersectionBox(a,b);
    if(!box||!cellMeetsFace(A,a)||!cellMeetsFace(B,b)||controlHullsSeparated(a,b))continue;
    const segments=localTraceSegments(a,b,curves,discovery.resolutionMm);
    if(intersectionBoxCovered(box,segments,discovery.resolutionMm)||certifiesKnownCurveGraph(a,b,segments))continue;
    const contraction=contractRootCell(a,b);
    if(contraction===false)continue;
    if(contraction){pending.push(contraction);discovery.contractions++;continue;}
    const projected=projectToCurve(A,B,[(a.u[0]+a.u[1])/2,(a.v[0]+a.v[1])/2,(b.u[0]+b.u[1])/2,(b.v[0]+b.v[1])/2]);
    const seed=projected?snapBoundaryState(A,B,projected):null;
    if(seed&&inside(A,seed.x[0],seed.x[1])&&inside(B,seed.x[2],seed.x[3])&&!near(seed)){
      const T=inwardTangent(A,B,seed);
      if(!T)pointEvent(seed);
      else{
        const forward=march(A,B,seed,T,endpoints,options);
        if(forward.end==='closed')record(forward.states,true,['closed','closed']);
        else{
          const reverse=march(A,B,seed,T.map(value=>-value),endpoints,options);
          record([...reverse.states].reverse().concat(forward.states.slice(1)),false,[reverse.end,forward.end]);
        }
        const last=curves.at(-1);
        if(last.ends.some(end=>['stalled','missed-boundary','tangent'].includes(end)))break;
        pending.push([a,b]);continue;
      }
    }
    if(Math.max(a.size,b.size)<=discovery.resolutionMm){uncertain.push(box);continue;}
    const {target,axis}=discoverySplit(a,b);
    const range=axis==='u'?target.u:target.v,mid=(range[0]+range[1])/2;
    if(!(mid>range[0]&&mid<range[1]))throw Error('Surface intersection discovery cannot progress at floating-point precision.');
    for(const half of splitNet(target,axis).map(describe))pending.push(target===a?[half,b]:[a,half]);
    discovery.subdivisions++;
  }
  discovery.collapsedContacts=collapseUncertainContacts(uncertain,discovery.resolutionMm);

  return { curves, coplanar, points, discovery };
}

// A parametric interval-Newton certificate proves one continuous root graph
// through a cell. This avoids resolving a known transverse curve down to the
// accuracy grid, while still subdividing cells that may contain another loop.
function ignoreDiscovery(){}
const trimmedCellCache=new WeakMap();
function cellMeetsFace(patch,piece){
  if(!patch.trimLoops)return true;
  if(!trimmedCellCache.has(patch))trimmedCellCache.set(patch,new WeakMap());
  const cache=trimmedCellCache.get(patch);if(cache.has(piece))return cache.get(piece);
  const [[u0,u1],[v0,v1]]=[piece.u,piece.v].map(([low,high])=>[low-ROUNDING_RELATIVE,high+ROUNDING_RELATIVE]);
  const meets=intersect([[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]],faceTrimRegion(patch)).length>0;
  cache.set(piece,meets);return meets;
}

const traceSegmentCache=new WeakMap();
function localTraceSegments(a,b,curves,toleranceMm){
  const box=intersectionBox(a,b),segments=[];
  if(!box)return segments;
  // Traces have a physical chord error. Contracted parameter cells can be much
  // narrower than that error, so UV overlap can discard an already traced root.
  // These bounds select candidates; coverage and root proofs still certify them.
  for(const curve of curves){
    if(!traceSegmentCache.has(curve))traceSegmentCache.set(curve,curve.points.slice(1).map((point,i)=>{
      const first=[...curve.uvA[i],...curve.uvB[i]],last=[...curve.uvA[i+1],...curve.uvB[i+1]];
      const firstPoint=curve.points[i];
      return {first,last,min:point.map((value,k)=>Math.min(value,firstPoint[k])),max:point.map((value,k)=>Math.max(value,firstPoint[k])),firstPoint,lastPoint:point};
    }));
    for(const segment of traceSegmentCache.get(curve)){
      if(box.min.every((low,k)=>segment.min[k]<=box.max[k]+toleranceMm&&segment.max[k]>=low-toleranceMm))segments.push(segment);
    }
  }
  return segments;
}
function certifiesKnownCurveGraph(a,b,segments){
  const ranges=[a.u,a.v,b.u,b.v];
  for(let free=0;free<4;free++){
    const points=[],spans=[];
    for(const {first,last} of segments){
      if(first[free]===last[free])continue;
      const low=Math.max(ranges[free][0],Math.min(first[free],last[free])),high=Math.min(ranges[free][1],Math.max(first[free],last[free]));
      if(!(high>low))continue;
      spans.push([low,high]);
      for(const value of [low,high])points.push(first.map((coordinate,k)=>coordinate+(value-first[free])/(last[free]-first[free])*(last[k]-coordinate)));
    }
    const coverage={high:ranges[free][0]};
    for(const [low,high] of spans.sort((x,y)=>x[0]-y[0])){if(low>coverage.high)break;coverage.high=Math.max(coverage.high,high);}
    if(coverage.high<ranges[free][1])continue;
    const expanded=ranges.map(([lo,hi],k)=>{
      const left=Math.min(lo,...points.map(point=>point[k])),right=Math.max(hi,...points.map(point=>point[k])),margin=k===free?0:(right-left)/8;
      return [left-margin,right+margin];
    });
    if(parametricRootBounds(expandedPiece(a,expanded.slice(0,2)),expandedPiece(b,expanded.slice(2)),free).graph)return true;
  }
  return false;
}
function expandedPiece(piece,ranges){
  const source=[piece.sourceU,piece.sourceV];
  const relative=ranges.map(([low,high],k)=>[(low-source[k][0])/(source[k][1]-source[k][0]),(high-source[k][0])/(source[k][1]-source[k][0])]);
  // The certificate may extend the underlying polynomial beyond a trimmed
  // knot cell. This gives boundary roots an interior neighbourhood; the actual
  // trace and retained face stay in their original domains.
  const state={net:piece.sourceNet};
  for(const [axis,[low,high]] of relative.entries()){
    const right=low===0?state.net:splitBezierNet(state.net,axis,low)[1];
    state.net=high===1?right:splitBezierNet(right,axis,(high-low)/(1-low))[0];
  }
  return {net:state.net,u:ranges[0],v:ranges[1]};
}
function projectedControlBounds(net,direction,origin){
  const values=net.flat().map(point=>dot(direction,point.slice(0,3).map((value,k)=>value/point[3]-origin[k]))),guard=ROUNDING_MM*direction.reduce((sum,value)=>sum+Math.abs(value),0);
  return [Math.min(...values)-guard,Math.max(...values)+guard];
}
const derivativeBoundsCache=new WeakMap();
function derivativeControlBounds(piece,axis){return derivativeControlData(piece,axis).bounds;}
function derivativeControlData(piece,axis){
  if(!derivativeBoundsCache.has(piece))derivativeBoundsCache.set(piece,new Map());
  const cache=derivativeBoundsCache.get(piece);if(cache.has(axis))return cache.get(axis);
  const net=piece.net,origin=net[0][0].slice(0,3).map(value=>value/net[0][0][3]);
  const scaled=net.map(row=>row.map(point=>[...point.slice(0,3).map((value,k)=>value-origin[k]*point[3]),point[3]]));
  const p=scaled.length-1,q=scaled[0].length-1,degree=axis===0?p:q,range=axis===0?piece.u:piece.v;
  const differentiated=axis===0?scaled.slice(1).map((row,i)=>row.map((point,j)=>point.map((value,k)=>(value-scaled[i][j][k])*degree/(range[1]-range[0])))):
    scaled.map(row=>row.slice(1).map((point,j)=>point.map((value,k)=>(value-row[j][k])*degree/(range[1]-range[0]))));
  const r=differentiated.length-1,s=differentiated[0].length-1,wu=bernsteinProductWeights(p,r),wv=bernsteinProductWeights(q,s);
  const coefficients=Array.from({length:p+r+1},()=>Array.from({length:q+s+1},()=>[0,0,0]));
  for(let i=0;i<=p;i++)for(let j=0;j<=q;j++)for(let k=0;k<=r;k++)for(let l=0;l<=s;l++)for(let coord=0;coord<3;coord++)
    coefficients[i+k][j+l][coord]+=wu[i][k]*wv[j][l]*(differentiated[k][l][coord]*scaled[i][j][3]-scaled[i][j][coord]*differentiated[k][l][3]);
  const weights=scaled.flat().map(point=>point[3]),denominators=[Math.min(...weights)**2,Math.max(...weights)**2];
  const bounds=[0,1,2].map(k=>{
    const values=coefficients.flat().flatMap(point=>denominators.map(weight=>point[k]/weight)),guard=ROUNDING_MM/(range[1]-range[0]);
    return [Math.min(...values)-guard,Math.max(...values)+guard];
  });
  const result={bounds,coefficients:coefficients.flat(),denominators,span:range[1]-range[0]};
  cache.set(axis,result);return result;
}
function projectedDerivativeBounds(piece,axis,direction){
  const data=derivativeControlData(piece,axis),values=data.coefficients.flatMap(point=>data.denominators.map(weight=>dot(direction,point)/weight));
  const guard=ROUNDING_MM/data.span*direction.reduce((sum,value)=>sum+Math.abs(value),0);
  return [Math.min(...values)-guard,Math.max(...values)+guard];
}
function scaledInterval(interval,scale){return scale>=0?interval.map(value=>value*scale):[interval[1]*scale,interval[0]*scale];}
function parametricRootBounds(a,b,free){
  if([...a.net.flat(),...b.net.flat()].some(point=>!(point[3]>0)))return {};
  const ranges=[a.u,a.v,b.u,b.v],dependent=[0,1,2,3].filter(k=>k!==free),radii=dependent.map(k=>(ranges[k][1]-ranges[k][0])/2);
  if(radii.some(value=>!(value>0)))return {};
  const duA=derivativeControlBounds(a,0),dvA=derivativeControlBounds(a,1),duB=derivativeControlBounds(b,0),dvB=derivativeControlBounds(b,1);
  const columns=[duA,dvA,duB.map(interval=>scaledInterval(interval,-1)),dvB.map(interval=>scaledInterval(interval,-1))];
  const midpoint=columns.map(column=>column.map(([lo,hi])=>(lo+hi)/2));
  const jacobian=[0,1,2].map(row=>dependent.map(k=>midpoint[k][row]));
  const inverseColumns=[0,1,2].map(k=>solveLinear(jacobian,[0,1,2].map(j=>j===k?1:0)));
  if(inverseColumns.some(column=>!column))return {};
  const inverse=[0,1,2].map(row=>inverseColumns.map(column=>column[row]));
  const fixedA=restrictBezierNet(a.net,[0,1].map(k=>free===k?[0,1]:[.5,.5])),fixedB=restrictBezierNet(b.net,[0,1].map(k=>free===k+2?[0,1]:[.5,.5]));
  const origin=fixedA[0][0].slice(0,3).map(value=>value/fixedA[0][0][3]);
  const result={graph:true,excluded:false,ranges:ranges.map(range=>[...range])};
  for(let row=0;row<3;row++){
    // Precondition the coefficients before taking interval hulls. Bounding
    // XYZ independently first loses the correlation along a curved free axis.
    const left=projectedControlBounds(fixedA,inverse[row],origin),right=projectedControlBounds(fixedB,inverse[row],origin);
    const offset=[right[0]-left[1],right[1]-left[0]],bound={radius:0};
    for(let col=0;col<3;col++){
      const variable=dependent[col],direction=inverse[row].map(value=>value*(variable<2?1:-1));
      const derivative=projectedDerivativeBounds(variable<2?a:b,variable%2,direction),diagonal=row===col?1:0;
      const entry=[diagonal-derivative[1],diagonal-derivative[0]];
      bound.radius+=Math.max(Math.abs(entry[0]),Math.abs(entry[1]))*radii[col];
    }
    const axis=dependent[row],middle=(ranges[axis][0]+ranges[axis][1])/2;
    result.ranges[axis]=[Math.max(ranges[axis][0],middle+offset[0]-bound.radius),Math.min(ranges[axis][1],middle+offset[1]+bound.radius)];
    if(offset[0]-bound.radius>radii[row]||offset[1]+bound.radius<-radii[row])result.excluded=true;
    if(!(Math.max(Math.abs(offset[0]),Math.abs(offset[1]))+bound.radius<radii[row]))result.graph=false;
  }
  return result;
}

// Every root remains inside its interval-Newton image. Contracting that image
// removes empty parameter space without repeatedly bisecting the curve's free
// direction (especially important for almost tangent or doubly curved faces).
function contractRootCell(a,b){
  const ranges=[a.u,a.v,b.u,b.v];
  for(let free=0;free<4;free++){
    const bounds=parametricRootBounds(a,b,free);
    if(bounds.excluded)return false;
    if(!bounds.ranges||!bounds.ranges.some(([low,high],k)=>high-low<(ranges[k][1]-ranges[k][0])*.75))continue;
    const restrict=(piece,domains)=>{
      const prior=[piece.u,piece.v],relative=domains.map(([low,high],k)=>[(low-prior[k][0])/(prior[k][1]-prior[k][0]),(high-prior[k][0])/(prior[k][1]-prior[k][0])]);
      return describe({...piece,net:restrictBezierNet(piece.net,relative),u:domains[0],v:domains[1]});
    };
    return [restrict(a,bounds.ranges.slice(0,2)),restrict(b,bounds.ranges.slice(2))];
  }
  return null;
}

function pieceBending(piece,axis){
  const net=piece.net,points=net.map(row=>row.map(point=>point.slice(0,3).map(value=>value/point[3])));
  const lines=axis===0?points[0].map((_,j)=>points.map(row=>row[j])):points;
  const bend=lines.reduce((largest,line)=>line.reduce((prior,point,i)=>{
    const f=i/(line.length-1),chord=line[0].map((value,k)=>value+f*(line.at(-1)[k]-value));
    return Math.max(prior,distance(point,chord));
  },largest),0);
  const twist=length(points[0][0].map((value,k)=>value-points.at(-1)[0][k]-points[0].at(-1)[k]+points.at(-1).at(-1)[k]))/4;
  return Math.max(bend,twist);
}
function discoverySplit(a,b){
  const choices=[a,b].flatMap(target=>['u','v'].map((axis,k)=>({target,axis,bend:pieceBending(target,k),extent:k?target.extentV:target.extentU})));
  const curved=choices.some(choice=>choice.bend>ROUNDING_MM);
  return choices.reduce((best,choice)=>!best||(curved?choice.bend>best.bend:choice.extent>best.extent)?choice:best,null);
}

function controlHullsSeparated(a,b){
  const origin=a.hullPoints[0];
  const directions=[a.normal,b.normal,cross(a.normal,b.normal),a.normal.map((value,k)=>value+b.normal[k]),a.normal.map((value,k)=>value-b.normal[k])];
  for(const direction of directions){
    const magnitude=length(direction);if(magnitude<=ROUNDING_RELATIVE)continue;
    const project=piece=>piece.hullPoints.map(point=>dot(direction,point.map((value,k)=>value-origin[k])));
    const left=project(a),right=project(b),guard=ROUNDING_MM*magnitude;
    if(Math.max(...left)<Math.min(...right)-guard||Math.max(...right)<Math.min(...left)-guard)return true;
  }
  return false;
}

function intersectionBox(a,b){
  const min=a.min.map((value,k)=>Math.max(value,b.min[k])),max=a.max.map((value,k)=>Math.min(value,b.max[k]));
  if(min.some((value,k)=>value>max[k]+ROUNDING_MM))return null;
  return {min,max:max.map((value,k)=>Math.max(value,min[k]))};
}
function intersectionBoxCovered(box,segments,toleranceMm){
  const corners=[0,1].flatMap(x=>[0,1].flatMap(y=>[0,1].map(z=>[x,y,z].map((side,k)=>side?box.max[k]:box.min[k]))));
  for(const {firstPoint:first,lastPoint:last} of segments){
    const direction=last.map((value,k)=>value-first[k]),squared=dot(direction,direction);
    if(corners.every(point=>{
      const t=squared?Math.max(0,Math.min(1,dot(point.map((value,k)=>value-first[k]),direction)/squared)):0;
      return distance(point,first.map((value,k)=>value+t*direction[k]))<=toleranceMm;
    }))return true;
  }
  return false;
}
function collapseUncertainContacts(cells,toleranceMm){
  const pending=[...cells],groups=[];
  while(pending.length){
    const first=pending.pop(),box={min:[...first.min],max:[...first.max]};
    const state={changed:true};
    while(state.changed){
      state.changed=false;
      for(let i=pending.length-1;i>=0;i--){
        if(!intersectionBox(box,pending[i]))continue;
        const cell=pending.splice(i,1)[0];
        for(let k=0;k<3;k++){box.min[k]=Math.min(box.min[k],cell.min[k]);box.max[k]=Math.max(box.max[k],cell.max[k]);}
        state.changed=true;
      }
    }
    if(distance(box.min,box.max)>2*toleranceMm){
      const error=new Error('Surface intersection has a connected unresolved contact larger than its construction accuracy.');
      error.code='UNRESOLVED_SURFACE_CONTACT';throw error;
    }
    groups.push(box);
  }
  return groups.length;
}

function subdivide(A, B, { seedMm, toleranceMm }) {
  const pairs = [], coplanar = [], stack = [];
  for (const a of bezierPieces(A).map(describe)) for (const b of bezierPieces(B).map(describe)) stack.push([a, b]);
  const overlap = (a, b) => a.min.every((v, k) => v <= b.max[k] + toleranceMm && b.min[k] <= a.max[k] + toleranceMm);
  while (stack.length) {
    const [a, b] = stack.pop();
    if (!overlap(a, b)) continue;
    const flat = a.flatness <= toleranceMm && b.flatness <= toleranceMm;
    // Parallel to rounding is only a prefilter; the coplanar judgement is the offset at toleranceMm.
    if (flat && Math.abs(Math.abs(dot(a.normal, b.normal)) - 1) < ROUNDING_RELATIVE && Math.abs(dot(a.normal, b.net[0][0].slice(0, 3).map(v => v / b.net[0][0][3])) - a.offset) <= toleranceMm) {
      coplanar.push({ a: { u: a.u, v: a.v }, b: { u: b.u, v: b.v } });continue;
    }
    if (a.size <= seedMm && b.size <= seedMm) { pairs.push([a, b]); continue; }
    const target = a.size >= b.size ? a : b, halves = splitNet(target, target.extentU >= target.extentV ? 'u' : 'v').map(describe);
    for (const half of halves) stack.push(target === a ? [half, b] : [a, half]);
  }
  return { pairs, coplanar };
}

// A root can stop a few microns from a chart edge. Preserve its chart
// identity while bringing that bounded contact onto the edge before deciding
// whether a common inward curve branch exists.
function snapBoundaryState(A,B,sample){
  const x=[...sample.x];
  for(const [offset,patch] of [[0,A],[2,B]]){
    for(const [axis,domain] of [patch.domainU,patch.domainV].entries()){
      const value=Math.abs(x[offset+axis]-domain[0])<=Math.abs(x[offset+axis]-domain[1])?domain[0]:domain[1];
      const uv=x.slice(offset,offset+2),snapped=[...uv];snapped[axis]=value;
      if(distance(evaluate(patch,...uv,false).point,evaluate(patch,...snapped,false).point)<=POINT_TOLERANCE)x[offset+axis]=value;
    }
  }
  return state(A,B,x);
}

// One curve has three approximations: its world chord and its two UV
// polylines evaluated on their surfaces. Refine all three to the same budget.
// World-only chord checks do not bound a nonlinear chart's trim image.
export function refineIntersectionCurve(A,B,curve,chordMm){
  if(curve.points.length<2)return curve;
  const input=curve.points.map((point,i)=>curveRootState(A,B,{point,x:[...curve.uvA[i],...curve.uvB[i]]})),output=[];
  for(let i=1;i<input.length;i++){
    const pending=[[input[i-1],input[i]]];
    while(pending.length){
      const [rawFirst,rawLast]=pending.pop();
      const first=alignPoleChart(A,B,rawFirst,rawLast),last=alignPoleChart(A,B,rawLast,rawFirst);
      if(!output.length||output.at(-1).x.some((value,k)=>value!==first.x[k]))output.push(first);
      const guess=first.x.map((value,k)=>(value+last.x[k])/2),left=evaluate(A,...guess.slice(0,2)),right=evaluate(B,...guess.slice(2)),projected=projectToCurve(A,B,guess);
      if(!projected)throw Error('Surface intersection cannot refine its shared face charts.');
      const middle=curveRootState(A,B,{point:projected.a.point,x:projected.x}),chord=first.point.map((value,k)=>(value+last.point[k])/2);
      const error=Math.max(distance(left.point,chord),distance(right.point,chord),distance(middle.point,chord));
      if(error<=chordMm){output.push(last);continue;}
      if(middle.x.every((value,k)=>value===first.x[k])||middle.x.every((value,k)=>value===last.x[k]))
        throw Error('Surface intersection chart refinement cannot progress at floating-point precision.');
      pending.push([middle,last],[first,middle]);
    }
  }
  return {...curve,points:output.map(sample=>sample.point),uvA:output.map(sample=>sample.x.slice(0,2)),uvB:output.map(sample=>sample.x.slice(2)),chartChordMm:chordMm};
}

const collapsedEdgeCache=new WeakMap();
function collapsedSurfaceEdges(patch){
  if(collapsedEdgeCache.has(patch))return collapsedEdgeCache.get(patch);
  const pieces=bezierPieces(patch),edges=[];
  for(const [axis,domain] of [patch.domainU,patch.domainV].entries())for(const [side,value] of domain.entries()){
    const controls=pieces.filter(piece=>(axis?piece.v:piece.u)[side]===value).flatMap(piece=>
      axis?piece.net.map(row=>row[side?row.length-1:0]):piece.net[side?piece.net.length-1:0]);
    if(!controls.length)continue;
    const point=controls[0].slice(0,3).map(coordinate=>coordinate/controls[0][3]);
    if(controls.every(h=>distance(point,h.slice(0,3).map(coordinate=>coordinate/h[3]))<=ROUNDING_MM))edges.push({axis,value,point});
  }
  collapsedEdgeCache.set(patch,edges);return edges;
}

function curveRootState(A,B,sample){
  for(const [offset,patch,other,otherOffset] of [[0,A,B,2],[2,B,A,0]]){
    for(const edge of collapsedSurfaceEdges(patch)){
      if(distance(sample.point,edge.point)>POINT_TOLERANCE)continue;
      const projected=projectToSurface(other,edge.point,sample.x.slice(otherOffset,otherOffset+2));
      if(projected.distance>POINT_TOLERANCE)continue;
      const x=[...sample.x];x[offset+edge.axis]=edge.value;
      x[otherOffset]=projected.uv[0];x[otherOffset+1]=projected.uv[1];
      return {point:evaluate(A,...x.slice(0,2),false).point,x};
    }
  }
  return sample;
}

// At a proved collapsed edge, its free parameter belongs to the incident ray.
// Consecutive rays keep separate UV aliases joined by a zero-length world edge.
function alignPoleChart(A,B,endpoint,neighbor){
  const x=[...endpoint.x];
  for(const [offset,patch] of [[0,A],[2,B]])for(const edge of collapsedSurfaceEdges(patch))
    if(x[offset+edge.axis]===edge.value)x[offset+1-edge.axis]=neighbor.x[offset+1-edge.axis];
  return {point:endpoint.point,x};
}

// The same boundary probe can be reached from several overlapping Bezier
// leaves. Matching polylines at root accuracy are one trace, including reversal.
// Preserve different UV charts at periodic seams even at equal world points.
function sameParameterTrace(A,B,a,b){
  if(a.points.length!==b.points.length)return false;
  for(const direction of [1,-1]){
    const same=a.uvA.every((uv,i)=>{
      const j=direction>0?i:b.uvA.length-1-i;
      return distance(a.points[i],b.points[j])<=POINT_TOLERANCE&&
        uv.every((value,k)=>Math.abs(value-b.uvA[j][k])<=TOLERANCE.parameter*((k?A.domainV:A.domainU)[1]-(k?A.domainV:A.domainU)[0]))&&
        a.uvB[i].every((value,k)=>Math.abs(value-b.uvB[j][k])<=TOLERANCE.parameter*((k?B.domainV:B.domainU)[1]-(k?B.domainV:B.domainU)[0]));
    });
    if(same)return true;
  }
  return false;
}

// A root already belongs to a sampled trace within chord plus solve error.
// Compare both charts as well as world distance so periodic twins and nearby
// independent branches retain their identities.
function chartParametersNear(patch,uv,expected,toleranceMm){
  const e=evaluate(patch,...uv),delta=expected.map((value,k)=>value-uv[k]);
  if(!e.normal)return delta.every((value,k)=>Math.abs(value)<=TOLERANCE.domainFraction*((k?patch.domainV:patch.domainU)[1]-(k?patch.domainV:patch.domainU)[0]));
  return Math.hypot(...e.du.map((value,k)=>value*delta[0]+e.dv[k]*delta[1]))<=toleranceMm;
}

function traceContains(A,B,curve,x,point,toleranceMm){
  for(let i=1;i<curve.points.length;i++){
    const first=curve.points[i-1],last=curve.points[i],direction=subtract(last,first),square=dot(direction,direction);
    const fraction=square?Math.max(0,Math.min(1,dot(subtract(point,first),direction)/square)):0;
    if(distance(point,first.map((value,k)=>value+fraction*direction[k]))>toleranceMm)continue;
    const uvA=curve.uvA[i-1].map((value,k)=>value+fraction*(curve.uvA[i][k]-value));
    const uvB=curve.uvB[i-1].map((value,k)=>value+fraction*(curve.uvB[i][k]-value));
    if(chartParametersNear(A,x.slice(0,2),uvA,toleranceMm)&&chartParametersNear(B,x.slice(2),uvB,toleranceMm))return true;
  }
  return false;
}
