// Private export utilities. Arithmetic/IO behavior is local to this bucket.
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0));
