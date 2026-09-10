// Authoritative planar material-region offset. Units: mm; positive expands
// material, negative erodes it. Input uses nonzero winding (CCW solids, CW holes).
// All loops are processed together: independently offsetting each loop loses
// hole/island merges and collapse. No heuristic standoff pruning or area cutoff.
import { requireThat } from '../geom/tolerance.mjs';
import { clipperContext, clipPaths, offsetPaths, CLIPPER_PRECISION } from './clipper.mjs';

export function offsetRegion(loops, delta, {
  arcToleranceMm = 0.02, precisionMm = CLIPPER_PRECISION, join = 'round', miterLimit = 2
} = {}) {
  requireThat(Number.isFinite(delta), 'Offset distance must be finite.');
  requireThat(Number.isFinite(arcToleranceMm) && arcToleranceMm > 0, 'Offset arc tolerance must be positive and finite.');
  requireThat(['round', 'square', 'miter'].includes(join), 'Offset join must be round, square or miter.');
  requireThat(Number.isFinite(miterLimit) && miterLimit >= 2, 'Offset miter limit must be finite and at least 2.');
  const context = clipperContext([loops], precisionMm, Math.abs(delta) * (miterLimit + 2));
  const paths = clipPaths(context.encode(loops));
  if (!paths.length || delta === 0) return context.decode(paths);
  return context.decode(clipPaths(offsetPaths(paths, delta / precisionMm, {
    join, miterLimit, arcTolerance: arcToleranceMm / precisionMm
  })));
}
