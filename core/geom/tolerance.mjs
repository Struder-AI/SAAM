// Shared numeric helpers and the construction tolerances of the geometry kernel.
// Classes and their reasoning: core/README.md#dimensions-and-tolerances. Shape
// judgements (coincident, joined, on a plane, overlapping) import
// PRINT_RESOLUTION_MM; constructed points converge to PROGRAM_STEP_MM, below what
// a program can write and far below the judgements made on them.

import {TOLERANCE,ROUNDING_MM} from '../dimensions.mjs';

export {TOLERANCE};

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
  requireThat([a,b,fa,fb,tolerance].every(Number.isFinite)&&a<=b&&tolerance>0,'Root finding needs finite ordered bounds, values and positive tolerance.');
  requireThat(fa === 0 || fb === 0 || (fa < 0)!==(fb < 0), 'Root finding needs a bracketed sign change.');
  if (fa === 0) return a;
  if (fb === 0) return b;
  const bracket={lo:a,hi:b,flo:fa,fhi:fb};
  while (bracket.hi - bracket.lo > tolerance) {
    const span=bracket.hi-bracket.lo,secant=bracket.lo+span*(bracket.flo/(bracket.flo-bracket.fhi));
    // A central secant step or bisection shrinks the bracket by at least 1/4.
    // Work follows requested precision; exhaustion never returns an unmet root.
    const mid=secant>bracket.lo+span/4&&secant<bracket.hi-span/4?secant:bracket.lo+span/2;
    requireThat(mid>bracket.lo&&mid<bracket.hi,'Root bracket cannot reach requested tolerance at coordinate precision.');
    const fm = f(mid);
    requireThat(Number.isFinite(fm),'Root function returned a non-finite value inside its bracket.');
    if (fm === 0) return mid;
    if ((fm < 0) === (bracket.flo < 0)) { bracket.lo = mid; bracket.flo = fm; } else { bracket.hi = mid; bracket.fhi = fm; }
  }
  return bracket.lo+(bracket.hi-bracket.lo)/2;
}
