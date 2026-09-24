// Shared numeric helpers and the tolerance vocabulary used across the core.
//
// Spatial tolerances are in mm; parameter convergence is in the native UV
// parameter units, not mm. Keep predicate slack separate from geometric
// approximation and choose each for its consumer (BUILDERS.md precision policy).
// A fine chord target bounds that construction only, not accumulated downstream
// shape error, mesh repair error, or the machine's physical accuracy.

export const TOLERANCE = {
  point: 1e-6,       // coincident-point tolerance for joining section pieces
  chord: 1e-3,       // maximum sagitta between a section polyline and the surface
  parameter: 1e-9,   // convergence limit for root finding in parameter space
  plane: 1e-7        // distance from the slice plane accepted as "on plane"
};

export function requireThat(condition, message) { if (!condition) throw new Error(message); }

export const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));
export const distance2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function normalize(a) {
  const l = length(a);
  requireThat(l > 1e-15, 'Cannot normalize a zero-length vector.');
  return [a[0] / l, a[1] / l, a[2] / l];
}
// Bisection with a secant step. Used for 1D root finds along patch boundaries
// and along rays; f must bracket a sign change on [a, b].
export function findRoot(f, a, b, fa = f(a), fb = f(b), tolerance = TOLERANCE.parameter) {
  requireThat(fa === 0 || fb === 0 || fa * fb < 0, 'Root finding needs a bracketed sign change.');
  if (fa === 0) return a;
  if (fb === 0) return b;
  let lo = a, hi = b, flo = fa, fhi = fb;
  for (let i = 0; i < 200 && hi - lo > tolerance; i++) {
    const span = hi - lo;
    let mid = lo + span * (flo / (flo - fhi));
    // Keep the secant step inside the bracket, otherwise fall back to bisection.
    if (!(mid > lo + span * 1e-3 && mid < hi - span * 1e-3)) mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  return (lo + hi) / 2;
}
