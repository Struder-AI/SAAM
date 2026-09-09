// Closed shells built from untrimmed patches, for development and tests.
//
// These are the shapes the core is exercised against. Real parts come from a
// 3DM; these builders exist so the geometry contract has fixtures that satisfy
// it exactly, including a curved top surface for the draped-skin skill.
//
// Sides are ruled from a bottom edge to the top patch's own iso-curve, so the
// shared boundary is the same curve on both patches and closure holds exactly.

import { patchFromSurface } from './nurbs.mjs';
import { makeShell, assertClosed } from './shell.mjs';
import { requireThat } from './tolerance.mjs';

export function shellFromSurfaces(rhino, entries, name) {
  const patches = entries.map(entry => patchFromSurface(entry.surface, entry.name));
  const shell = makeShell(patches, { name });
  shell.surfaces = entries;
  return shell;
}

const ruled = (rhino, a, b) => {
  const surface = rhino.NurbsSurface.createRuledSurface(a, b);
  requireThat(surface, 'Rhino could not build a ruled patch.');
  return surface;
};
const line = (rhino, a, b) => new rhino.LineCurve(a, b);

// Quad patch through four corners, ruled from edge (a->b) to edge (d->c).
const quad = (rhino, a, b, c, d) => ruled(rhino, line(rhino, a, b), line(rhino, d, c));

export function boxShell(rhino, { xMm = 30, yMm = 20, zMm = 10 } = {}) {
  return prismShell(rhino, [[0, 0], [xMm, 0], [xMm, yMm], [0, yMm]], () => zMm, 'box');
}

// The wedge the existing demo prints, as a general shell: a flat top surface
// tilted by angleDeg about the Y axis.
export function wedgeShell(rhino, { runMm = 30, widthMm = 20, baseMm = 2, angleDeg = 15 } = {}) {
  const slope = Math.tan(angleDeg * Math.PI / 180);
  return prismShell(rhino, [[0, 0], [runMm, 0], [runMm, widthMm], [0, widthMm]], x => baseMm + x * slope, 'wedge');
}

// A rectangular prism whose top is a planar or ruled surface given by height(x, y).
function prismShell(rhino, outline, height, name) {
  const bottom = outline.map(([x, y]) => [x, y, 0]);
  const top = outline.map(([x, y]) => [x, y, height(x, y)]);
  const entries = [{ name: 'bottom', surface: quad(rhino, bottom[0], bottom[3], bottom[2], bottom[1]) },
    { name: 'top', surface: quad(rhino, top[0], top[1], top[2], top[3]) }];
  const sides = ['front', 'right', 'back', 'left'];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    entries.push({ name: sides[i], surface: quad(rhino, bottom[i], bottom[j], top[j], top[i]) });
  }
  return assertClosed(shellFromSurfaces(rhino, entries, name));
}

// A prism with a bicubic spline top: the shape the draped-skin skill exists for.
// heights(i, j) supplies the control height of each grid node; because control
// points sit on the Greville abscissae in X and Y, the patch's footprint is
// exactly the rectangle, so the four sides meet it exactly.
export function splineTopShell(rhino, { runMm = 40, widthMm = 30, heights, cpU = 5, cpV = 5, name = 'spline-top' } = {}) {
  requireThat(typeof heights === 'function', 'splineTopShell needs a heights(i, j) function.');
  const surface = rhino.NurbsSurface.create(3, false, 4, 4, cpU, cpV);
  surface.knotsU().createUniformKnots(1);
  surface.knotsV().createUniformKnots(1);
  const gu = greville(surface.knotsU().toList(), cpU, 4), gv = greville(surface.knotsV().toList(), cpV, 4);
  const span = [gu[cpU - 1] - gu[0], gv[cpV - 1] - gv[0]];
  const points = surface.points();
  for (let i = 0; i < cpU; i++)
    for (let j = 0; j < cpV; j++)
      points.set(i, j, [runMm * (gu[i] - gu[0]) / span[0], widthMm * (gv[j] - gv[0]) / span[1], heights(i, j), 1]);

  const [u0, u1] = surface.domain(0), [v0, v1] = surface.domain(1);
  // isoCurve(0, v) runs along U; isoCurve(1, u) runs along V.
  const edges = [surface.isoCurve(0, v0), surface.isoCurve(1, u1), surface.isoCurve(0, v1), surface.isoCurve(1, u0)];
  const corners = [[0, 0], [runMm, 0], [runMm, widthMm], [0, widthMm]].map(([x, y]) => [x, y, 0]);
  const entries = [
    { name: 'top', surface },
    { name: 'bottom', surface: quad(rhino, corners[0], corners[3], corners[2], corners[1]) },
    { name: 'front', surface: ruled(rhino, line(rhino, corners[0], corners[1]), edges[0]) },
    { name: 'right', surface: ruled(rhino, line(rhino, corners[1], corners[2]), edges[1]) },
    { name: 'back', surface: ruled(rhino, line(rhino, corners[3], corners[2]), edges[2]) },
    { name: 'left', surface: ruled(rhino, line(rhino, corners[0], corners[3]), edges[3]) }
  ];
  return assertClosed(shellFromSurfaces(rhino, entries, name));
}

// Greville abscissae: control values placed here reproduce a linear function,
// which is what keeps the spline top's XY footprint an exact rectangle.
function greville(knots, count, order) {
  const full = [knots[0], ...knots, knots[knots.length - 1]], degree = order - 1, out = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 1; k <= degree; k++) sum += full[i + k];
    out.push(sum / degree);
  }
  return out;
}
