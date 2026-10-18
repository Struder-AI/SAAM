// Authoritative planar material-region offset. Units: mm; positive expands
// material, negative erodes it. Input uses nonzero winding (CCW solids, CW holes).
// All loops are processed together: independently offsetting each loop loses
// hole/island merges and collapse. No heuristic standoff pruning or area cutoff.
import { requireThat } from '../geom/tolerance.mjs';
import { clipperContext, normalizedOffsetPaths } from './clipper.mjs';
import {PROGRAM_STEP_MM,CHORD_TOLERANCE_MM} from '../dimensions.mjs';

// Offset coordinates need guard digits, not picometres. A grid of one program
// step stays below print resolution. Boolean precision and shape
// approximation remain separate quantities from this coordinate grid.
export const OFFSET_PRECISION_MM=PROGRAM_STEP_MM;

// Process scale: arcToleranceMm defaults to a twentieth of a 0.4 mm line.
export function offsetRegion(loops, delta, {
  arcToleranceMm = CHORD_TOLERANCE_MM, precisionMm = OFFSET_PRECISION_MM, join = 'round', miterLimit = 2
} = {}) {
  requireThat(Number.isFinite(delta), 'Offset distance must be finite.');
  requireThat(Number.isFinite(arcToleranceMm) && arcToleranceMm > 0, 'Offset arc tolerance must be positive and finite.');
  requireThat(['round', 'square', 'miter'].includes(join), 'Offset join must be round, square or miter.');
  requireThat(Number.isFinite(miterLimit) && miterLimit >= 2, 'Offset miter limit must be finite and at least 2.');
  const context = clipperContext([loops], precisionMm, Math.abs(delta) * (miterLimit + 2));
  // Normalize and inflate in native memory. The completed offset already
  // unions its constructed contours, so only its final result crosses back.
  return context.decode(normalizedOffsetPaths(context.encode(loops), delta / precisionMm, {
    join, miterLimit, arcTolerance: arcToleranceMm / precisionMm
  }));
}
