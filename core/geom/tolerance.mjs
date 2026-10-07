// Shared numeric helpers and the construction tolerances of the geometry kernel.
// Classes and their reasoning: core/README.md#dimensions-and-tolerances. Shape
// judgements (coincident, joined, on a plane, overlapping) import
// PRINT_RESOLUTION_MM; constructed points converge to PROGRAM_STEP_MM, below what
// a program can write and far below the judgements made on them.

import { BUILD_SCALE_MM, PRINT_RESOLUTION_MM, PROGRAM_STEP_MM, ROUNDING_MM } from '../dimensions.mjs';

export const TOLERANCE = {
  chord: PRINT_RESOLUTION_MM, // maximum sagitta of a constructed polyline: no coarser than print resolution
  parameter: PROGRAM_STEP_MM / BUILD_SCALE_MM, // root-finding convergence: program resolution on a build-scale domain
  domainFraction: PRINT_RESOLUTION_MM / BUILD_SCALE_MM // a share of a parameter domain worth print resolution on a build-scale patch
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
  requireThat(l > ROUNDING_MM, 'Cannot normalize a zero-length vector.');
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
    if (!(mid > lo + span / 1000 && mid < hi - span / 1000)) mid = (lo + hi) / 2; // a thousandth of the bracket: secant safeguard, not a tolerance
    const fm = f(mid);
    if (fm === 0) return mid;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  return (lo + hi) / 2;
}
