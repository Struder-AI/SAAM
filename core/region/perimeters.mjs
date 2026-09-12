// Deposition contours are not material regions: two opposed wall fronts can
// meet in a printable closed line even though their remaining area is zero.
import { offsetRegion } from './offset.mjs';
import { difference, intersect } from './intersection.mjs';
import { loopArea, pointInRegion } from './region2d.mjs';
import { TOLERANCE } from '../geom/tolerance.mjs';

export function perimeterLoops(region, insetMm) {
  let loops = offsetRegion(region, -insetMm);
  const holes = region.filter(loop => loopArea(loop) < 0);
  if (!holes.length) return loops;
  const remainingHoles = loops.filter(loop => loopArea(loop) < 0);
  // Quantized fronts can leave tiny rings at collapse. A matching hole count
  // alone does not mean the original holes survived: each must still be inside
  // a remaining hole before skipping central-track recovery.
  if (remainingHoles.length === holes.length && holes.every(hole =>
    remainingHoles.some(remaining => pointInRegion(hole[0], [remaining])))) return loops;
  // Each front is constructed to the shared chord target; their comparison
  // allows the sum of those two approximation errors.
  // This is a contour coincidence bound, not a thin-feature fill policy.
  const tolerance = 2 * TOLERANCE.chord;
  const options = { arcToleranceMm: TOLERANCE.chord };
  const grownHoles = holes.map(hole => offsetRegion([[...hole].reverse()], insetMm, options));
  const centers = [];
  for (const outer of region.filter(loop => loopArea(loop) > 0)) {
    for (const candidate of offsetRegion([outer], -insetMm, options)) {
      const outside = offsetRegion([candidate], tolerance, options);
      for (const hole of grownHoles) {
        if (hole.length !== 1 ||
            difference([candidate], offsetRegion(hole, tolerance, options)).length ||
            difference(hole, outside).length) continue;
        // A nested island is a separate owner. Remove only the coincident
        // boundary band, never everything inside the recovered central loop.
        const band = difference(outside, offsetRegion([candidate], -tolerance, options));
        if (difference(band, region).length || grownHoles.some(other =>
          other !== hole && intersect(band, other).length)) continue;
        loops = difference(loops, band);
        centers.push(candidate);
        break;
      }
    }
  }
  // Keep centerlines separate from region normalization: union would erase a
  // recovered line or reinterpret its enclosed (unprinted) hole as material.
  return [...loops, ...centers];
}
