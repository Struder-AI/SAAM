// studio owns its assertion; coordinate mathematics uses the shared CAD contract.
export {normalize,cross,dot,scale,add,subtract,length} from '../../geom/tolerance.mjs';
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
