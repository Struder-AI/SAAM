// A closed shell of untrimmed bivariate spline patches.
//
// This is the geometry contract the pattern skills accept. Every face is a full
// rectangular (u,v) patch, so a face's section is the zero contour of g over the
// whole domain: no trim classification is needed, which matters because
// rhino3dm exposes no parameter-space trim curves (BrepTrim carries topology
// indices only, and BrepFace.loops is unbound in this build).
//
// Closure is therefore verified numerically: every non-degenerate patch boundary
// must be matched, point for point, by a boundary of some patch. A trimmed face
// fails that test rather than silently producing an open section.

import { evaluate } from './nurbs.mjs';
import { sectionPatch } from './section.mjs';
import { TOLERANCE, requireThat, distance, distance2 } from './tolerance.mjs';

const BOUNDARY_SAMPLES = 16;
const JOIN_TOLERANCE = 1e-5;

export function makeShell(patches, { name = 'shell' } = {}) {
  requireThat(patches.length >= 4, `${name} needs at least four patches to close.`);
  const shell = { name, patches, bounds: shellBounds(patches) };
  shell.closure = verifyClosure(patches);
  return shell;
}

export function assertClosed(shell) {
  const open = shell.closure.unmatched;
  requireThat(open.length === 0,
    `${shell.name} is not closed: ${open.length} unmatched patch boundary/boundaries (${open.slice(0, 3).map(o => `${o.patch}:${o.edge}`).join(', ')}). ` +
    'This core accepts closed shells of untrimmed patches; a trimmed face reports here.');
  return shell;
}

// Conservative bounds from the control net: the surface lies inside its hull.
function shellBounds(patches) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const patch of patches)
    for (let i = 0; i < patch.nu * patch.nv; i++) {
      const b = i * 4, w = patch.cp[b + 3];
      for (let k = 0; k < 3; k++) {
        const value = patch.cp[b + k] / w;
        if (value < min[k]) min[k] = value;
        if (value > max[k]) max[k] = value;
      }
    }
  return { min, max };
}

export const boundaryCurve = (patch, edge) => {
  const [u0, u1] = patch.domainU, [v0, v1] = patch.domainV;
  const at = t => edge === 0 ? [u0 + (u1 - u0) * t, v0]
    : edge === 1 ? [u1, v0 + (v1 - v0) * t]
    : edge === 2 ? [u0 + (u1 - u0) * t, v1]
    : [u0, v0 + (v1 - v0) * t];
  const pointAt = t => evaluate(patch, ...at(t), false).point;
  return pointAt;
};

// Two patches can share an edge with different parameterizations - a ruled
// surface built from an iso-curve reparameterizes it - so boundaries are
// compared geometrically: each sample of one boundary must lie on the other
// curve, found by closest point rather than by matching parameters.
function verifyClosure(patches) {
  const edges = [];
  for (const patch of patches)
    for (let edge = 0; edge < 4; edge++) {
      const curve = boundaryCurve(patch, edge);
      const samples = [];
      for (let i = 0; i <= BOUNDARY_SAMPLES; i++) samples.push(curve(i / BOUNDARY_SAMPLES));
      const degenerate = samples.every(p => distance(p, samples[0]) <= TOLERANCE.point);
      edges.push({ patch: patch.name, edge, curve, samples, degenerate, matched: degenerate });
    }
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].matched) continue;
    for (let j = 0; j < edges.length; j++) {
      if (i === j || edges[j].matched || edges[j].degenerate) continue;
      if (!endpointsMatch(edges[i], edges[j])) continue;
      if (sameCurve(edges[i], edges[j])) { edges[i].matched = edges[j].matched = true; break; }
    }
  }
  return { edges, unmatched: edges.filter(e => !e.matched).map(e => ({ patch: e.patch, edge: e.edge })) };
}

// Cheap prefilter so the closest-point test runs only on plausible partners.
function endpointsMatch(a, b) {
  const [a0, a1] = [a.samples[0], a.samples[a.samples.length - 1]];
  const [b0, b1] = [b.samples[0], b.samples[b.samples.length - 1]];
  return (distance(a0, b0) <= JOIN_TOLERANCE && distance(a1, b1) <= JOIN_TOLERANCE)
    || (distance(a0, b1) <= JOIN_TOLERANCE && distance(a1, b0) <= JOIN_TOLERANCE);
}

const sameCurve = (a, b) => a.samples.every(point => distanceToCurve(point, b.curve) <= JOIN_TOLERANCE);

// Coarse scan for the bracket, then golden-section refinement.
function distanceToCurve(point, curve, scan = 32) {
  let best = Infinity, bestT = 0;
  for (let i = 0; i <= scan; i++) {
    const t = i / scan, d = distance(point, curve(t));
    if (d < best) { best = d; bestT = t; }
  }
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = Math.max(0, bestT - 1 / scan), hi = Math.min(1, bestT + 1 / scan);
  let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
  let fc = distance(point, curve(c)), fd = distance(point, curve(d));
  for (let i = 0; i < 60 && hi - lo > 1e-12; i++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = distance(point, curve(c)); }
    else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = distance(point, curve(d)); }
  }
  return Math.min(best, fc, fd);
}

// Section the shell at height z.
//
// A plane through a critical point of the surface (a saddle, where the contour
// self-touches) or flush with a whole face is genuinely ambiguous: the contour
// there is not a set of disjoint curves. Both cases are resolved the way
// slicers resolve them, by displacing the plane far below process resolution
// and re-cutting. The displacement is reported, and a section that still will
// not close raises rather than returning a part with a gap in it.
const NUDGES = [0, 1e-6, -1e-6, 1e-5, -1e-5, 1e-4, -1e-4];

export function sectionShell(shell, z, options = {}) {
  let first = null;
  for (const nudge of NUDGES) {
    const result = sectionAt(shell, z + nudge, options);
    first ??= result;
    const clean = result.openChains.length === 0 && result.coincidentPatches.length === 0;
    // A displacement must not be accepted just because it produced a tidy empty
    // answer: nudging past the top of the part would silently drop the layer.
    if (clean && result.loops.length > 0) return { ...result, requestedZ: z, nudgedByMm: nudge };
  }
  // Genuinely nothing there: the plane misses the part.
  if (first.openChains.length === 0 && first.loops.length === 0) return { ...first, requestedZ: z, nudgedByMm: 0 };
  requireThat(first.openChains.length === 0,
    `Section at z=${z.toFixed(4)} did not close: ${first.openChains.length} open chain(s) after nudging. ` +
    'This is a degenerate cut (a critical point or a coincident face); move the layer rather than printing an open contour.');
  return { ...first, requestedZ: z, nudgedByMm: 0 };
}

// Returns closed 2D loops, oriented so outer loops run counter-clockwise and
// enclosed holes run clockwise.
export function sectionAt(shell, z, { minFeatureMm = 0.4 } = {}) {
  const plane = { normal: [0, 0, 1], offset: z };
  const chains = [], coincident = [];
  for (const patch of shell.patches) {
    const result = sectionPatch(patch, plane, { minFeatureMm });
    if (result.coincident) { coincident.push(patch.name); continue; }
    for (const chain of result.chains) if (chain.length > 1) chains.push(chain.map(p => p.point));
  }
  const { loops, open } = joinChains(chains);
  return { z, loops: orientLoops(loops), openChains: open, coincidentPatches: coincident };
}

// Join per-patch chains into closed loops using 3D endpoint proximity. Adjacent
// patches share the boundary geometrically, so their chain ends coincide.
function joinChains(chains) {
  const pool = chains.map(points => [...points]);
  const loops = [], open = [];
  while (pool.length) {
    let chain = pool.pop();
    for (;;) {
      if (chain.length > 2 && distance(chain[0], chain[chain.length - 1]) <= JOIN_TOLERANCE) { loops.push(chain); chain = null; break; }
      const tip = chain[chain.length - 1];
      let best = -1, reverse = false, bestDistance = JOIN_TOLERANCE;
      for (let i = 0; i < pool.length; i++) {
        const head = distance(tip, pool[i][0]), tail = distance(tip, pool[i][pool[i].length - 1]);
        if (head <= bestDistance) { best = i; reverse = false; bestDistance = head; }
        if (tail <= bestDistance) { best = i; reverse = true; bestDistance = tail; }
      }
      if (best < 0) break;
      const next = pool.splice(best, 1)[0];
      chain.push(...(reverse ? next.reverse() : next).slice(1));
    }
    if (chain) open.push(chain);
  }
  return { loops: loops.map(toPlanar), open };
}

const toPlanar = points => {
  const loop = points.map(p => [p[0], p[1]]);
  // Drop the duplicated closing point and any repeats introduced by joining.
  const out = [];
  for (const point of loop) if (!out.length || distance2(out[out.length - 1], point) > TOLERANCE.point) out.push(point);
  if (out.length > 1 && distance2(out[0], out[out.length - 1]) <= TOLERANCE.point) out.pop();
  return out;
};

export const signedArea = loop => {
  let sum = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) sum += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]);
  return sum / 2;
};

export function pointInLoop(point, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i], [xj, yj] = loop[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Nesting depth decides orientation: even depth is solid (counter-clockwise),
// odd depth is a hole (clockwise).
export function orientLoops(loops) {
  return loops.map(loop => {
    const depth = loops.reduce((count, other) => count + (other !== loop && pointInLoop(loop[0], other) ? 1 : 0), 0);
    const area = signedArea(loop);
    const wantPositive = depth % 2 === 0;
    return (area > 0) === wantPositive ? loop : [...loop].reverse();
  });
}
