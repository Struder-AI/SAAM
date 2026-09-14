// Closed planar regions and open polyline clipping; no meshes or CAD.
// clipper2-wasm@0.4.0 packages the upstream C++ kernel. Keep its intersection,
// winding and topology construction intact; SAAM owns conversion and lifetime.
import {booleanPaths} from './clipper2.mjs';
import { clipperContext, CLIPPER_PRECISION } from './clipper.mjs';
import { requireThat } from '../geom/tolerance.mjs';

export const intersect = (a, b, options) => combine(a, b, 'Intersection', options);
export const union = (a, b, options) => combine(a, b, 'Union', options);
export const difference = (a, b, options) => combine(a, b, 'Difference', options);
export const clipOpenPaths = (paths, region, options) => combine(paths, region, 'Intersection', options, true);

function combine(a, b, operation, { precisionMm = CLIPPER_PRECISION } = {}, open = false) {
  requireThat([a, b].every(region => Array.isArray(region) && region.every(Array.isArray)),
    'Region operations need arrays of closed 2D loops.');
  // One origin/grid for BOTH operands, shared with the offset conversion.
  const context = clipperContext([a, b], precisionMm);
  try {
    const paths=booleanPaths(context.encode(a),context.encode(b),operation,{open});
    return open?context.decodeOpen(paths):context.decode(paths);
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    throw new Error(`Clipper2 region operation failed: ${cause}`);
  }
}
