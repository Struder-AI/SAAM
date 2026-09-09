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
function splineTopSurface(rhino, { xMin = 0, xMax, yMin = 0, yMax, xyAt = null, heights, cpU = 5, cpV = 5 } = {}) {
  requireThat(typeof heights === 'function', 'splineTopShell needs a heights(i, j) function.');
  const surface = rhino.NurbsSurface.create(3, false, 4, 4, cpU, cpV);
  surface.knotsU().createUniformKnots(1);
  surface.knotsV().createUniformKnots(1);
  const gu = greville(surface.knotsU().toList(), cpU, 4), gv = greville(surface.knotsV().toList(), cpV, 4);
  const span = [gu[cpU - 1] - gu[0], gv[cpV - 1] - gv[0]];
  const points = surface.points();
  for (let i = 0; i < cpU; i++)
    for (let j = 0; j < cpV; j++)
      {
        const u = (gu[i] - gu[0]) / span[0], v = (gv[j] - gv[0]) / span[1];
        const [x, y] = xyAt ? xyAt(i, j, u, v) : [xMin + (xMax - xMin) * u, yMin + (yMax - yMin) * v];
        points.set(i, j, [x, y, heights(i, j), 1]);
      }
  return surface;
}

function splineShellFromSurfaces(rhino, { top, bottom, bottomEdges = null, name }) {
  const [u0, u1] = top.domain(0), [v0, v1] = top.domain(1);
  // isoCurve(0, v) runs along U; isoCurve(1, u) runs along V.
  const topEdges = [top.isoCurve(0, v0), top.isoCurve(1, u1), top.isoCurve(0, v1), top.isoCurve(1, u0)];
  bottomEdges ??= [bottom.isoCurve(0, v0), bottom.isoCurve(1, u1), bottom.isoCurve(0, v1), bottom.isoCurve(1, u0)];
  const entries = [
    { name: 'top', surface: top }, { name: 'bottom', surface: bottom },
    { name: 'front', surface: ruled(rhino, bottomEdges[0], topEdges[0]) },
    { name: 'right', surface: ruled(rhino, bottomEdges[1], topEdges[1]) },
    { name: 'back', surface: ruled(rhino, bottomEdges[2], topEdges[2]) },
    { name: 'left', surface: ruled(rhino, bottomEdges[3], topEdges[3]) }
  ];
  return assertClosed(shellFromSurfaces(rhino, entries, name));
}

function splineShellFromTop(rhino, { runMm, widthMm, xMin = 0, xMax = runMm, yMin = 0, yMax = widthMm, heights, cpU, cpV, name }) {
  const top = splineTopSurface(rhino, { xMin, xMax, yMin, yMax, heights, cpU, cpV });
  const corners = [[0, 0], [runMm, 0], [runMm, widthMm], [0, widthMm]].map(([x, y]) => [x, y, 0]);
  const bottom = quad(rhino, corners[0], corners[3], corners[2], corners[1]);
  const bottomEdges = [line(rhino, corners[0], corners[1]), line(rhino, corners[1], corners[2]),
    line(rhino, corners[3], corners[2]), line(rhino, corners[0], corners[3])];
  return splineShellFromSurfaces(rhino, { top, bottom, bottomEdges, name });
}

export function splineTopShell(rhino, { runMm = 40, widthMm = 30, heights, cpU = 5, cpV = 5, name = 'spline-top' } = {}) {
  return splineShellFromTop(rhino, { runMm, widthMm, heights, cpU, cpV, name });
}

// A spline-roofed shell whose side faces are also untrimmed NURBS patches.
// The roof overhangs the short ends while drawing in from the long sides. Each
// side is ruled from the rectangular base to the roof's own spline boundary,
// which gives the core an exact shared edge to verify rather than an
// independently approximated seam.
export function splineSideShell(rhino, {
  runMm = 40, widthMm = 30, longSideInsetMm = 1, shortSideOutsetMm = 1,
  heights, cpU = 5, cpV = 5, name = 'spline-shell'
} = {}) {
  requireThat(longSideInsetMm >= 0 && longSideInsetMm * 2 < widthMm,
    'Long-side inset must leave a positive roof width.');
  requireThat(shortSideOutsetMm >= 0, 'Short-side outset cannot be negative.');
  return splineShellFromTop(rhino, {
    runMm, widthMm,
    xMin: -shortSideOutsetMm, xMax: runMm + shortSideOutsetMm,
    yMin: longSideInsetMm, yMax: widthMm - longSideInsetMm,
    heights, cpU, cpV, name
  });
}

// A vertically walled spline shell. The same curved footprint is used at the
// base and roof, so every ruled side travels straight up. X bulge pushes the
// left/right ends outward; Y inset draws the front/back long sides inward.
export function verticalSplineSideShell(rhino, {
  runMm = 40, widthMm = 30, xBulgeMm = 4, yInsetMm = 3,
  heights, cpU = 4, cpV = 4, name = 'vertical-spline-shell'
} = {}) {
  requireThat(xBulgeMm >= 0 && yInsetMm >= 0 && yInsetMm * 2 < widthMm,
    'Spline-side bulges must leave a positive footprint width.');
  const bump = value => 4 * value * (1 - value);
  const footprint = (i, j, u, v) => {
    const x = runMm * u + (i === 0 ? -xBulgeMm : i === cpU - 1 ? xBulgeMm : 0) * bump(v);
    const y = widthMm * v + (j === 0 ? yInsetMm : j === cpV - 1 ? -yInsetMm : 0) * bump(u);
    return [x, y];
  };
  const top = splineTopSurface(rhino, { xyAt: footprint, heights, cpU, cpV });
  const bottom = splineTopSurface(rhino, { xyAt: footprint, heights: () => 0, cpU, cpV });
  return splineShellFromSurfaces(rhino, { top, bottom, name });
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
