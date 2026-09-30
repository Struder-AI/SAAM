// The part's top surface as a height field.
//
// The draped-skin skill needs, for a point on the bed, the height of the part
// above it and the surface normal there. That is a vertical ray against the
// shell, which for an untrimmed patch is the 2x2 system
//   Sx(u,v) = x,  Sy(u,v) = y
// solved by Newton from seeds inside the spans whose control points can reach
// (x, y). The convex hull property culls the rest exactly, so a seeded solve
// only runs where a solution can exist.

import { evaluate, clamp } from './nurbs.mjs';
import { TOLERANCE } from './tolerance.mjs';

const SEEDS = 3;
const NEWTON_STEPS = 40;

// Spans whose control net can contain (x, y), by XY bounding box of the
// contributing control points.
function candidateSpansAt(patch, x, y) {
  const { nu, nv, orderU, orderV, knotsU, knotsV, cp } = patch, spans = [];
  for (let su = orderU - 1; su < nu; su++) {
    if (knotsU[su + 1] - knotsU[su] < 1e-12) continue;
    for (let sv = orderV - 1; sv < nv; sv++) {
      if (knotsV[sv + 1] - knotsV[sv] < 1e-12) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = su - orderU + 1; i <= su; i++)
        for (let j = sv - orderV + 1; j <= sv; j++) {
          const b = (i * nv + j) * 4, w = cp[b + 3];
          const px = cp[b] / w, py = cp[b + 1] / w;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      if (x >= minX - TOLERANCE.point && x <= maxX + TOLERANCE.point && y >= minY - TOLERANCE.point && y <= maxY + TOLERANCE.point)
        spans.push({ u: [knotsU[su], knotsU[su + 1]], v: [knotsV[sv], knotsV[sv + 1]] });
    }
  }
  return spans;
}

// Every point of the patch directly above or below (x, y).
export function projectToPatch(patch, x, y) {
  const hits = [];
  for (const span of candidateSpansAt(patch, x, y))
    for (let i = 1; i <= SEEDS; i++)
      for (let j = 1; j <= SEEDS; j++) {
        const solution = newton(patch, x, y,
          span.u[0] + (span.u[1] - span.u[0]) * i / (SEEDS + 1),
          span.v[0] + (span.v[1] - span.v[0]) * j / (SEEDS + 1));
        if (!solution) continue;
        if (hits.some(hit => Math.abs(hit.u - solution.u) < 1e-7 && Math.abs(hit.v - solution.v) < 1e-7)) continue;
        hits.push(solution);
      }
  return hits;
}

function newton(patch, x, y, u0, v0) {
  let u = u0, v = v0;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    const { point, du, dv, normal } = evaluate(patch, u, v);
    const fx = point[0] - x, fy = point[1] - y;
    if (Math.hypot(fx, fy) <= TOLERANCE.point) return { u, v, point, normal };
    const determinant = du[0] * dv[1] - du[1] * dv[0];
    // A singular Jacobian is a fold or a pole in XY; another seed may reach it.
    if (Math.abs(determinant) < 1e-14) return null;
    const stepU = (fx * dv[1] - fy * dv[0]) / determinant;
    const stepV = (du[0] * fy - du[1] * fx) / determinant;
    const nextU = clamp(u - stepU, patch.domainU), nextV = clamp(v - stepV, patch.domainV);
    if (Math.abs(nextU - u) < TOLERANCE.parameter && Math.abs(nextV - v) < TOLERANCE.parameter) {
      const check = evaluate(patch, nextU, nextV);
      return Math.hypot(check.point[0] - x, check.point[1] - y) <= 1e-6 ? { u: nextU, v: nextV, point: check.point, normal: check.normal } : null;
    }
    u = nextU;
    v = nextV;
  }
  return null;
}

// Height of the part's top surface above (x, y), with the surface normal and
// the local slope from horizontal. Returns null outside the footprint.
export function topAt(shell, x, y) {
  let best = null;
  for (const patch of shell.patches)
    for (const hit of projectToPatch(patch, x, y)) {
      if (best && hit.point[2] <= best.zMm + TOLERANCE.point) continue;
      // Only an upward-facing surface is a top surface; a vertical wall or a
      // downward face at the same column is not what the skin follows.
      if (!hit.normal || Math.abs(hit.normal[2]) < 1e-9) continue;
      const upward = hit.normal[2] > 0 ? hit.normal : hit.normal.map(component => -component);
      best = {
        zMm: hit.point[2],
        normal: upward,
        slopeDeg: Math.acos(Math.min(1, Math.abs(upward[2]))) * 180 / Math.PI,
        patch: patch.name,
        u: hit.u,
        v: hit.v
      };
    }
  return best;
}
