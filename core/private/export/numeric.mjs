// export owns its assertion; coordinate mathematics uses the shared CAD contract.
export {distance} from '../../geom/tolerance.mjs';
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
