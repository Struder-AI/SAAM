// A shell of untrimmed bivariate spline patches.
//
// This is the geometry contract the pattern skills accept. Every face is a full
// rectangular (u,v) patch, so a face's section is the zero contour of g over the
// whole domain: no trim classification is needed, which matters because
// rhino3dm exposes no parameter-space trim curves (BrepTrim carries topology
// indices only, and BrepFace.loops is unbound in this build).
//
// Closure is therefore measured numerically: a non-degenerate patch boundary
// matched by no other boundary is open. An open shell builds, shows and slices
// what closes on each layer; solid operations name its open edges (tessellate.mjs).

import { evaluate } from './nurbs.mjs';
import {surfaceIsoCurve,curvePoint} from './surface-curves.mjs';
import { sectionPatch } from './section.mjs';
import { TOLERANCE, requireThat, distance, distance2, dot, subtract } from './tolerance.mjs';
import { PRINT_RESOLUTION_MM } from '../dimensions.mjs';
import {trimSectionChains} from './surface-trim.mjs';

const BOUNDARY_SAMPLES = 16;
// Section pieces whose ends lie within print resolution join.
const JOIN_TOLERANCE = PRINT_RESOLUTION_MM;

export function makeShell(patches, { name = 'shell' } = {}) {
  // Closure, not a patch count, decides whether a shell is solid: one
  // revolved patch closing on its own seam and poles is a whole sphere.
  const shell = { name, patches, empty:patches.length===0, bounds: shellBounds(patches) };
  shell.closure = verifyClosure(patches);
  return shell;
}

// Conservative bounds from the control net: the surface lies inside its hull.
function shellBounds(patches) {
  if(!patches.length)return {min:[0,0,0],max:[0,0,0]};
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

// Two patches can share an edge with different parameterizations - a ruled
// surface built from an iso-curve reparameterizes it - so boundaries are
// compared geometrically: each sample of one boundary must lie on the other
// curve, found by closest point rather than by matching parameters.
function verifyClosure(patches) {
  const edges = [];
  for (const patch of patches)
    for (let edge = 0; edge < 4; edge++) {
      const axis=edge%2===0?1:0,value=edge===0?patch.domainV[0]:edge===1?patch.domainU[1]:edge===2?patch.domainV[1]:patch.domainU[0];
      const curve = surfaceIsoCurve(patch,axis,value);
      const samples = [];
      for (let i = 0; i <= BOUNDARY_SAMPLES; i++) samples.push(curvePoint(curve,i / BOUNDARY_SAMPLES));
      const degenerate = samples.every(p => distance(p, samples[0]) <= PRINT_RESOLUTION_MM);
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
    const t = i / scan, d = distance(point, curvePoint(curve,t));
    if (d < best) { best = d; bestT = t; }
  }
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = Math.max(0, bestT - 1 / scan), hi = Math.min(1, bestT + 1 / scan);
  let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
  let fc = distance(point, curvePoint(curve,c)), fd = distance(point, curvePoint(curve,d));
  for (let i = 0; i < 60 && hi - lo > TOLERANCE.parameter; i++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = distance(point, curvePoint(curve,c)); }
    else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = distance(point, curvePoint(curve,d)); }
  }
  return Math.min(best, fc, fd);
}

// Section the shell by a plane slice (core/geom/slice.mjs): loops in the
// slice's chart.
//
// A plane through a critical point of the surface (a saddle, where the contour
// self-touches) or flush with a whole face is genuinely ambiguous: the contour
// there is not a set of disjoint curves. Both cases are resolved the way
// slicers resolve them, by displacing the plane along its normal and
// re-cutting: twice print resolution clears a face judged flush at print
// resolution, ten times a saddle that still pinches; both stay far below a layer. The displacement is reported.
// A section that still does not close keeps the nudge leaving the fewest open
// pieces and closes them as closeOpenChains does, reporting each gap.
const NUDGES = [0, 2, -2, 10, -10].map(k => k * PRINT_RESOLUTION_MM);

// -> {loops, nudgedByMm, open}: open lists the gaps joined and pieces dropped.
// gapMm is the widest gap joined, the print's line width (Code shape 6).
export function sectionShell(shell, slice, options = {}) {
  const side=options.side??null;
  requireThat(side===null||side==='negative'||side==='positive','Section side is negative or positive.');
  const nudges=side===null?NUDGES:NUDGES.filter(nudge=>side==='negative'?nudge<0:nudge>0);
  const tried = [];
  for (const nudge of nudges) {
    const result = sectionShellAt(shell, slice, nudge, options);
    // A displacement must not be accepted just because it produced a tidy empty
    // answer: nudging past the top of the part would silently drop the layer.
    if (!result.open.length && !result.coincident && result.loops.length > 0) return { loops: result.loops, nudgedByMm: nudge, open: [] };
    if(side!==null&&!result.open.length&&!result.coincident)return {loops:[],nudgedByMm:nudge,open:[]};
    tried.push({ ...result, nudge });
  }
  const found = tried.filter(result => result.loops.length || result.open.length);
  // Genuinely nothing there: the plane misses the part.
  if (!found.length) return { loops: [], nudgedByMm: 0, open: [] };
  const dropped = result => result.open.filter(item => item.kind === 'dropped').length;
  const best = found.reduce((a, b) => dropped(b) < dropped(a) || dropped(b) === dropped(a) && b.coincident < a.coincident ? b : a);
  return { loops: best.loops, nudgedByMm: best.nudge, open: best.open };
}

// Closed loops of the plane displaced by nudge along its normal, in the slice's
// chart, oriented so outer loops run counter-clockwise and enclosed holes
// clockwise (seen from the normal).
function sectionShellAt(shell, slice, nudge, { minFeatureMm = 0.4, gapMm = 0 } = {}) {
  const plane = { normal: slice.normal, offset: dot(slice.normal, slice.origin) + nudge };
  const cuts = shell.patches.map(patch => {
    const cut=sectionPatch(patch,plane,{minFeatureMm});
    return {...cut,chains:trimSectionChains(patch,cut.chains)};
  });
  const coincident = cuts.filter(cut => cut.coincident).length;
  const chains = cuts.flatMap(cut => cut.coincident ? [] : cut.chains.filter(chain => chain.length > 1).map(chain => chain.map(p => p.point)));
  const { loops, open } = joinChains(chains,shell.construction?.toleranceMm??JOIN_TOLERANCE);
  const closed = closeOpenChains(open.map(chain => toChart(chain, slice)), gapMm);
  return { loops: orientLoops([...loops.map(loop => toChart(loop, slice)), ...closed.loops]), open: closed.open, coincident };
}

// Open section pieces (chart polylines) whose ends lie within gapMm join,
// nearest ends first, into closed loops; what still does not close is dropped.
// A join below print resolution is ordinary closure and is not reported.
// -> {loops, open: [{kind: 'joined', point, sizeMm: gap} | {kind: 'dropped', point, sizeMm: length}]}.
export function closeOpenChains(chains, gapMm) {
  const pool = chains.filter(chain => chain.length > 1).map(chain => [...chain]), loops = [], open = [];
  for (;;) {
    let best = null;
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i];
      const self = a.length > 2 ? distance2(a[0], a[a.length - 1]) : Infinity;
      if (self <= gapMm && (!best || self < best.gap)) best = { gap: self, i, j: i };
      for (let j = i + 1; j < pool.length; j++)
        for (const [ai, bj] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
          const gap = distance2(ai ? a[a.length - 1] : a[0], bj ? pool[j][pool[j].length - 1] : pool[j][0]);
          if (gap <= gapMm && (!best || gap < best.gap)) best = { gap, i, j, ai, bj };
        }
    }
    if (!best) break;
    const a = pool[best.i];
    if (best.i === best.j) {
      pool.splice(best.i, 1); loops.push(a);
      if (best.gap >= PRINT_RESOLUTION_MM) open.push({ kind: 'joined', point: midpoint(a[a.length - 1], a[0]), sizeMm: best.gap });
      continue;
    }
    // Orient a to end, and b to start, at the joined ends (j > i keeps i's place).
    const b = pool[best.j], head = best.ai ? a : [...a].reverse(), tail = best.bj ? [...b].reverse() : b;
    pool.splice(best.j, 1); pool[best.i] = [...head, ...tail];
    if (best.gap >= PRINT_RESOLUTION_MM) open.push({ kind: 'joined', point: midpoint(head[head.length - 1], tail[0]), sizeMm: best.gap });
  }
  for (const chain of pool) open.push({ kind: 'dropped', point: chain[chain.length >> 1], sizeMm: chain.slice(1).reduce((sum, p, i) => sum + distance2(chain[i], p), 0) });
  return { loops, open };
}

const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Join per-patch chains into closed loops using 3D endpoint proximity. Adjacent
// patches share the boundary geometrically, so their chain ends coincide.
function joinChains(chains,toleranceMm=JOIN_TOLERANCE) {
  const pool = chains.map(points => [...points]);
  const loops = [], open = [];
  while (pool.length) {
    let chain = pool.pop();
    for (;;) {
      if (chain.length > 2 && distance(chain[0], chain[chain.length - 1]) <= toleranceMm) { loops.push(chain); chain = null; break; }
      const tip = chain[chain.length - 1];
      let best = -1, reverse = false, bestDistance = toleranceMm;
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
  return { loops, open };
}

// A closed 3D loop on a plane slice as chart points [x·(p - o), y·(p - o)].
const toChart = (points, { origin: o, xAxis: x, yAxis: y }) => {
  const horizontal = x[0] === 1 && x[1] === 0 && x[2] === 0 && y[0] === 0 && y[1] === 1 && y[2] === 0;
  const loop = points.map(p => horizontal ? [p[0] - o[0], p[1] - o[1]] : [dot(subtract(p, o), x), dot(subtract(p, o), y)]);
  // Drop the duplicated closing point and any repeats introduced by joining.
  const out = [];
  for (const point of loop) if (!out.length || distance2(out[out.length - 1], point) > PRINT_RESOLUTION_MM) out.push(point);
  if (out.length > 1 && distance2(out[0], out[out.length - 1]) <= PRINT_RESOLUTION_MM) out.pop();
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
