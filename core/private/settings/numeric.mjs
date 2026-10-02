// Private settings utility; no cross-bucket helper access.
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
