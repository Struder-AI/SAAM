// Private agent utilities. Arithmetic/IO behavior is local to this bucket.
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
