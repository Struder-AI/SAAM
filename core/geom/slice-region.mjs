// The part of a surface that lies inside a solid, as closed loops in the
// surface's own (u,v): the region a curved slice owns, or the part of a patch a
// boolean keeps. Its boundary is where the surface meets the solid's patches
// (surface-surface intersection). The curves are chained in (u,v), oriented
// so the solid's inside is on their left using each partner patch's outward
// normal, and closed along the surface's domain boundary, walked
// counterclockwise from each curve's end to the next curve's start.
import { evaluate } from './nurbs.mjs';
import { intersectPatches } from './surface-intersection.mjs';
import { containsPoint } from './query.mjs';
import { union, intersect, difference } from '../region/intersection.mjs';
import { requireThat, dot } from './tolerance.mjs';

const OFF_SURFACE_MM = 1e-4;

// +1 where a patch's normal (du x dv) points out of its solid, -1 where it
// points in: a point just along the normal is tested for containment.
export function outwardSigns(shell) {
  const signs = new Map();
  for (const patch of shell.patches) {
    let sign = null;
    for (const [fu, fv] of [[0.5123, 0.4871], [0.3137, 0.6911], [0.7219, 0.2683]]) {
      const e = evaluate(patch, patch.domainU[0] + fu * (patch.domainU[1] - patch.domainU[0]), patch.domainV[0] + fv * (patch.domainV[1] - patch.domainV[0]));
      if (!e.normal) continue;
      sign = containsPoint(shell, e.point.map((v, k) => v + OFF_SURFACE_MM * e.normal[k])) ? -1 : 1;break;
    }
    requireThat(sign !== null, `Patch ${patch.name} has no normal at its sample points.`);
    signs.set(patch, sign);
  }
  return signs;
}

// Curve pieces joined end to end in P's (u,v); every vertex keeps the partner
// patch and its parameters there, for exact refinement later.
function chainPieces(pieces, P) {
  const tolerance = 1e-7 * Math.hypot(P.domainU[1] - P.domainU[0], P.domainV[1] - P.domainV[0]);
  const close = (a, b) => Math.hypot(a.uv[0] - b.uv[0], a.uv[1] - b.uv[1]) <= tolerance;
  const pool = pieces.filter(p => !p.closed), chains = pieces.filter(p => p.closed).map(p => ({ vertices: p.vertices, closed: true }));
  while (pool.length) {
    let vertices = pool.pop().vertices;
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const v = pool[i].vertices;
        if (close(vertices.at(-1), v[0])) vertices = [...vertices, ...v.slice(1)];
        else if (close(vertices.at(-1), v.at(-1))) vertices = [...vertices, ...[...v].reverse().slice(1)];
        else if (close(vertices[0], v.at(-1))) vertices = [...v, ...vertices.slice(1)];
        else if (close(vertices[0], v[0])) vertices = [...[...v].reverse(), ...vertices.slice(1)];
        else continue;
        pool.splice(i, 1);grown = true;break;
      }
    }
    const closed = vertices.length > 3 && close(vertices[0], vertices.at(-1));
    chains.push({ vertices: closed ? vertices.slice(0, -1) : vertices, closed });
  }
  return chains;
}

// Orient a chain so the solid's inside lies on its left in (u,v).
function orient(chain, P, shell) {
  const v = chain.vertices, i = Math.min(Math.max(1, Math.floor(v.length / 2)), v.length - 1), a = v[i - 1], b = v[i];
  const d = [b.uv[0] - a.uv[0], b.uv[1] - a.uv[1]], left = [-d[1], d[0]];
  const mid = [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2], e = evaluate(P, ...mid);
  const across = [0, 1, 2].map(k => e.du[k] * left[0] + e.dv[k] * left[1]);
  const partner = evaluate(b.partner, ...b.partnerUv), outward = partner.normal?.map(n => n * b.sign);
  let insideLeft = outward ? dot(across, outward) < 0 : null;
  if (insideLeft === null || Math.abs(dot(across, outward)) < 1e-12) {
    // Tangential crossing: test a point just to the left instead.
    const scale = OFF_SURFACE_MM / Math.max(1e-300, Math.hypot(...across));
    insideLeft = containsPoint(shell, evaluate(P, mid[0] + left[0] * scale, mid[1] + left[1] * scale, false).point);
  }
  return insideLeft ? chain : { ...chain, vertices: [...v].reverse() };
}

// Position on the domain boundary, counterclockwise from (u0, v0), in [0, 4).
function perimeterAt(P, [u, v]) {
  const [u0, u1] = P.domainU, [v0, v1] = P.domainV, du = u1 - u0, dv = v1 - v0, eps = 1e-7;
  const sides = [[Math.abs(v - v0) / dv, (u - u0) / du], [Math.abs(u - u1) / du, 1 + (v - v0) / dv],
    [Math.abs(v - v1) / dv, 2 + (u1 - u) / du], [Math.abs(u - u0) / du, 3 + (v1 - v) / dv]];
  const [gap, s] = sides.reduce((best, side) => side[0] < best[0] ? side : best);
  return gap <= eps ? ((s % 4) + 4) % 4 : null;
}
const corner = (P, k) => [[P.domainU[0], P.domainV[0]], [P.domainU[1], P.domainV[0]], [P.domainU[1], P.domainV[1]], [P.domainU[0], P.domainV[1]]][k % 4];

function closeOnBoundary(P, chains, domainInside) {
  const loops = chains.filter(c => c.closed).map(c => c.vertices.map(x => x.uv)), open = chains.filter(c => !c.closed);
  for (const c of open) {
    const at = [c.vertices[0], c.vertices.at(-1)].map(x => x.uv);
    requireThat(at.every(p => perimeterAt(P, p) !== null),
      `A surface intersection curve on ${P.name} ends inside the surface near ${JSON.stringify(c.vertices.at(-1).point?.map(v => +v.toFixed(4)))}; the surfaces may touch tangentially there.`);
  }
  const starts = open.map(chain => ({ chain, s: perimeterAt(P, chain.vertices[0].uv) })), used = new Set();
  for (const first of starts) {
    if (used.has(first.chain)) continue;
    const loop = [];let current = first;
    while (!used.has(current.chain)) {
      used.add(current.chain);loop.push(...current.chain.vertices.map(x => x.uv));
      const end = perimeterAt(P, current.chain.vertices.at(-1).uv);
      const next = starts.reduce((best, candidate) => {
        const gap = ((candidate.s - end) % 4 + 4) % 4;
        return !best || gap < best.gap ? { ...candidate, gap } : best;
      }, null);
      for (let k = Math.floor(end) + 1; k < end + next.gap; k++) if (k - end > 1e-12) loop.push(corner(P, k));
      current = next;
    }
    loops.push(loop);
  }
  if (!open.length && domainInside()) loops.push([0, 1, 2, 3].map(k => corner(P, k)));
  return loops;
}

// A mesh triangle as a flat bilinear patch whose u = 1 edge collapses to its
// third vertex, with the sign that makes its normal the mesh's outward one.
function trianglePatch(mesh, i) {
  const [a, b, c] = mesh.triangles[i].map(k => mesh.vertices[k]);
  const patch = { name: `triangle:${i}`, nu: 2, nv: 2, orderU: 2, orderV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1],
    cp: Float64Array.from([...a, 1, ...b, 1, ...c, 1, ...c, 1]), domainU: [0, 1], domainV: [0, 1] };
  const e = evaluate(patch, 0, 0.5);
  return { patch, sign: dot(e.normal, mesh.normals[i]) > 0 ? 1 : -1 };
}

// The solid's boundary as patches with outward signs: a spline shell's own
// patches, or a triangle mesh's faces near the surface.
function boundaryPatches(solid, P) {
  if (solid.kind !== 'triangle-mesh') { const signs = outwardSigns(solid); return solid.patches.map(patch => ({ patch, sign: signs.get(patch) })); }
  const hull = bezierHull(P);
  return solid.triangles.map((t, i) => i).filter(i => {
    const corners = solid.triangles[i].map(k => solid.vertices[k]);
    return [0, 1, 2].every(a => Math.min(...corners.map(p => p[a])) <= hull.max[a] && Math.max(...corners.map(p => p[a])) >= hull.min[a]);
  }).map(i => trianglePatch(solid, i));
}
function bezierHull(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.cp.length; i += 4) for (let a = 0; a < 3; a++) { const v = P.cp[i + a] / P.cp[i + 3]; min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v); }
  return { min, max };
}

// Inside region of surface P with respect to a closed solid (a spline shell or
// a triangle mesh): loops in P's (u,v) (counterclockwise outer loops,
// clockwise holes) and the oriented boundary curves, each vertex carrying its
// partner patch and parameters there.
export function surfaceInside(P, solid, { chordMm = 1e-3, seedMm = 0.4 } = {}) {
  const shell = solid, pieces = [];
  for (const { patch: y, sign } of boundaryPatches(solid, P)) {
    const { curves } = intersectPatches(P, y, { chordMm, seedMm });
    for (const c of curves)
      pieces.push({ closed: c.closed, vertices: c.points.map((point, i) => ({ uv: c.uvA[i], point, partner: y, partnerUv: c.uvB[i], sign })) });
  }
  const chains = chainPieces(pieces, P).map(chain => orient(chain, P, shell));
  const sample = () => {
    const u = P.domainU[0] + 1.37e-3 * (P.domainU[1] - P.domainU[0]), v = P.domainV[0] + 1.11e-3 * (P.domainV[1] - P.domainV[0]);
    return containsPoint(shell, evaluate(P, u, v, false).point);
  };
  const raw = closeOnBoundary(P, chains, sample);
  return { loops: raw.length ? union(raw, []) : [], curves: chains };
}


// Region of P inside any queried geometry: a layered boolean (or an assembly
// queried as a union) combines its operands' regions in P's (u,v).
export function surfaceRegion(P, geometry, options) {
  if (geometry.kind !== 'boolean') return surfaceInside(P, geometry, options).loops;
  const [first, ...rest] = geometry.operands.map(operand => surfaceRegion(P, operand, options));
  if (geometry.operation === 'union') return rest.reduce((a, b) => union(a, b), first);
  if (geometry.operation === 'intersection') return rest.reduce((a, b) => intersect(a, b), first);
  return difference(first, rest.reduce((a, b) => union(a, b), []));
}

// A solid's boundary as patches: a spline shell's own, or each mesh triangle
// as a flat patch.
export function solidPatches(solid) {
  return solid.kind === 'triangle-mesh' ? solid.triangles.map((_, i) => trianglePatch(solid, i).patch) : solid.patches;
}

function patchBox(patch) { return bezierHull(patch); }

// Where two solids' boundaries meet (spline shells, meshes, or one of each):
// every pair of patches whose control hulls overlap is intersected, and the
// pieces are joined end to end into 3D polylines.
export function boundaryCurves(a, b, { chordMm = 1e-3, seedMm = 0.4 } = {}) {
  const A = solidPatches(a), B = solidPatches(b), boxesB = B.map(patchBox), pieces = [];
  // Uniform grid over B's boxes, one cell per typical patch size.
  const sizes = boxesB.map(x => Math.max(...[0, 1, 2].map(k => x.max[k] - x.min[k]))).sort((p, q) => p - q);
  const cell = Math.max(sizes[Math.floor(sizes.length / 2)] ?? 1, 1e-3), grid = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
  const cells = x => { const lo = x.min.map(v => Math.floor(v / cell)), hi = x.max.map(v => Math.floor(v / cell)), out = [];
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) out.push(key(i, j, k));
    return out; };
  boxesB.forEach((x, n) => { for (const c of cells(x)) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(n); } });
  let pairs = 0;
  for (const p of A) {
    const box = patchBox(p), candidates = new Set(cells(box).flatMap(c => grid.get(c) ?? []));
    for (const n of candidates) {
      const q = boxesB[n];
      if (![0, 1, 2].every(k => box.min[k] <= q.max[k] + 1e-9 && q.min[k] <= box.max[k] + 1e-9)) continue;
      pairs++;
      for (const c of intersectPatches(p, B[n], { chordMm, seedMm }).curves) pieces.push(c.points);
    }
  }
  return { polylines: joinPolylines(pieces), pairs, patches: [A.length, B.length] };
}

function joinPolylines(pieces, tolerance = 1e-6) {
  const pool = pieces.map(p => [...p]), out = [], near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tolerance;
  while (pool.length) {
    let line = pool.pop();
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const q = pool[i];
        if (near(line.at(-1), q[0])) line = [...line, ...q.slice(1)];
        else if (near(line.at(-1), q.at(-1))) line = [...line, ...[...q].reverse().slice(1)];
        else if (near(line[0], q.at(-1))) line = [...q, ...line.slice(1)];
        else if (near(line[0], q[0])) line = [...[...q].reverse(), ...line.slice(1)];
        else continue;
        pool.splice(i, 1);grown = true;break;
      }
    }
    out.push(line);
  }
  return out;
}
