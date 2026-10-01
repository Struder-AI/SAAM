// Private toolpath utilities. Arithmetic/IO behavior is local to this bucket.
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export function normalize(a) {
  const l = length(a);
  requireThat(l > 1e-15, 'Cannot normalize a zero-length vector.');
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
