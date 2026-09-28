// Slices: surfaces that cut a solid and give its toolpath a reference. A slice
// is a plain record with a 2D chart. section(geometry, slice) returns the
// solid's region on it as loops in that chart (outer loops counterclockwise,
// holes clockwise, seen from the slice normal), and slicePoint maps chart
// points back to XYZ.
//
//  plane  {origin, normal, xAxis, yAxis}: the orthonormal chart
//         p = origin + a·xAxis + b·yAxis. It is isometric, so planar region
//         code, the XY-plane curve offset included, runs on it unchanged. The
//         horizontal plane is the identity chart at height z: chart = XY.
//  patch  {patch}: a NURBS patch; the chart is its (u,v), the curve offset's
//         surface mode. Its region is where it lies inside the solid
//         (surface-surface intersection, slice-region.mjs).
// A height field (a part's top over the XY chart, for draped skins on meshes
// and booleans) is the planned third kind; section does not cut it yet.
//
// A family stacks one base slice: layer k is the base translated along a
// direction, so every layer keeps the same chart and a chart point names the
// same column of material in every layer. Neighbouring layers therefore
// compare by 2D booleans alone.
import { sectionShell } from './shell.mjs';
import { meshSectionIndex, sectionMeshIndex } from './mesh.mjs';
import { surfaceRegion } from './slice-region.mjs';
import { evaluate } from './nurbs.mjs';
import { union, intersect, difference } from '../region/intersection.mjs';
import { requireThat, add, scale, dot, cross, normalize } from './tolerance.mjs';

const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

export const horizontalSlice = z => {
  requireThat(Number.isFinite(z), 'A horizontal slice needs a finite height.');
  return { kind: 'plane', origin: [0, 0, z], normal: [0, 0, 1], xAxis: [1, 0, 0], yAxis: [0, 1, 0] };
};

// Any plane. The chart's x axis is the given one, or world X (world Y when the
// normal is near X) projected into the plane; y completes a right-handed
// chart, so counterclockwise is seen from the normal.
export function planeSlice({ origin, normal, xAxis = null }) {
  requireThat(vector(origin) && vector(normal), 'A plane slice needs an origin and a normal.');
  const n = normalize(normal);
  const seed = xAxis ?? (Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  requireThat(vector(seed), 'A plane slice x axis is a 3D vector.');
  const x = normalize(add(seed, scale(n, -dot(seed, n))));
  return { kind: 'plane', origin: [...origin], normal: n, xAxis: x, yAxis: cross(n, x) };
}

export function patchSlice(patch) {
  requireThat(patch?.cp && patch.domainU && patch.domainV, 'A patch slice needs a NURBS patch.');
  return { kind: 'patch', patch };
}

export function translateSlice(slice, v) {
  requireThat(vector(v), 'A slice translation is a 3D vector.');
  if (slice.kind === 'plane') return { ...slice, origin: add(slice.origin, v) };
  requireThat(slice.kind === 'patch', `Unsupported slice kind ${slice.kind}.`);
  const cp = Float64Array.from(slice.patch.cp);
  for (let i = 0; i < cp.length; i += 4) for (let k = 0; k < 3; k++) cp[i + k] += v[k] * cp[i + 3];
  return { ...slice, patch: { ...slice.patch, cp } };
}

export function slicePoint(slice, [a, b]) {
  if (slice.kind === 'plane') return add(slice.origin, add(scale(slice.xAxis, a), scale(slice.yAxis, b)));
  requireThat(slice.kind === 'patch', `Unsupported slice kind ${slice.kind}.`);
  return evaluate(slice.patch, a, b, false).point;
}

export function sliceNormal(slice, [a, b]) {
  if (slice.kind === 'plane') return [...slice.normal];
  requireThat(slice.kind === 'patch', `Unsupported slice kind ${slice.kind}.`);
  const { normal } = evaluate(slice.patch, a, b);
  requireThat(normal, 'The patch slice has no normal at this chart point.');
  return normal;
}

// Search data for many sections of one geometry by slices sharing a chart
// orientation (a plane family): every mesh leaf is indexed in the slice's
// frame. The result is sectioned exactly like the geometry it came from.
export function prepareSection(geometry, slice) {
  if (slice.kind !== 'plane') return geometry;
  if (geometry.kind === 'boolean') return { ...geometry, operands: geometry.operands.map(o => prepareSection(o, slice)) };
  if (geometry.kind === 'assembly') return { ...geometry, components: geometry.components.map(c => prepareSection(c, slice)) };
  if (geometry.kind === 'prepared-mesh') return prepareSection(geometry.mesh, slice);
  if (geometry.kind !== 'triangle-mesh') return geometry;
  return { kind: 'prepared-mesh', mesh: geometry, bounds: geometry.bounds, index: meshSectionIndex(geometry, frameAxes(slice)) };
}

// The region of a solid on a slice: {slice, loops, nudgedByMm, touchesEdge}.
// Geometry is a spline shell, a triangle mesh, a boolean of solids or an
// assembly (the union of its components), each possibly prepared. nudgedByMm
// is the largest displacement a degenerate plane cut needed; touchesEdge says
// the region reaches a patch slice's edge, where the slice stops inside the
// solid instead of crossing it.
export function section(geometry, slice, options = {}) {
  requireThat(geometry?.bounds, 'Section needs a solid with bounds.');
  const { loops, nudgedByMm } = sectionLoops(geometry, slice, options);
  return { slice, loops, nudgedByMm, touchesEdge: touchesSliceEdge(slice, loops) };
}

function sectionLoops(geometry, slice, options) {
  if (geometry.kind === 'boolean') return combine(geometry.operation, geometry.operands.map(o => sectionLoops(o, slice, options)));
  if (geometry.kind === 'assembly') return combine('union', geometry.components.map(c => sectionLoops(c, slice, options)));
  if (slice.kind === 'patch') {
    const solid = geometry.kind === 'prepared-mesh' ? geometry.mesh : geometry;
    return { loops: surfaceRegion(slice.patch, solid, options), nudgedByMm: 0 };
  }
  requireThat(slice.kind === 'plane', `Unsupported slice kind ${slice.kind}.`);
  if (geometry.kind === 'prepared-mesh') return sectionPreparedMesh(geometry, slice);
  if (geometry.kind === 'triangle-mesh') return sectionPreparedMesh({ mesh: geometry, index: meshSectionIndex(geometry, frameAxes(slice), { search: false }) }, slice);
  requireThat(Array.isArray(geometry.patches), 'Unsupported geometry backend.');
  return sectionShell(geometry, slice, options);
}

// A mesh index cuts at frame height n·origin; its loops sit in the frame's
// (x, y) and shift to the slice's chart origin.
function sectionPreparedMesh({ mesh, index }, slice) {
  const axes = frameAxes(slice);
  if (!axes.every((axis, i) => axis.every((v, k) => v === index.axes[i][k])))
    return sectionPreparedMesh({ mesh, index: meshSectionIndex(mesh, axes, { search: false }) }, slice);
  const [x, y, n] = axes, o = slice.origin;
  const cut = sectionMeshIndex(index, dot(n, o));
  const ox = dot(x, o), oy = dot(y, o);
  return { loops: ox === 0 && oy === 0 ? cut.loops : cut.loops.map(loop => loop.map(([a, b]) => [a - ox, b - oy])), nudgedByMm: cut.nudgedByMm };
}

const frameAxes = slice => [slice.xAxis, slice.yAxis, slice.normal];

// Operands share the slice's chart, so a boolean of solids is the same boolean
// of their regions. Difference subtracts every later operand from the first.
function combine(operation, sections) {
  const loops = sections.map(s => s.loops);
  const result = operation === 'union' ? loops.reduce((a, b) => union(a, b), [])
    : operation === 'difference' ? difference(loops[0], loops.slice(1).reduce((a, b) => union(a, b), []))
    : loops.slice(1).reduce((a, b) => intersect(a, b), loops[0]);
  const nudgedByMm = sections.reduce((n, s) => Math.abs(s.nudgedByMm ?? 0) > Math.abs(n) ? s.nudgedByMm : n, 0);
  return { loops: result, nudgedByMm };
}

// Whether region loops reach the slice's own edge. A plane has none; a patch's
// is its (u,v) domain boundary.
export function touchesSliceEdge(slice, loops) {
  if (slice.kind !== 'patch') return false;
  const { domainU: [u0, u1], domainV: [v0, v1] } = slice.patch;
  const eu = 1e-7 * (u1 - u0) + 1e-9, ev = 1e-7 * (v1 - v0) + 1e-9;
  return loops.some(loop => loop.some(([u, v]) => u - u0 <= eu || u1 - u <= eu || v - v0 <= ev || v1 - v <= ev));
}

// A stack of one base slice: layer k is the base translated along the unit
// direction by firstLayerMm + k·pitchMm, so each layer sits one pitch above the
// last and the first one first-layer height above the base. Direction defaults
// to a plane's normal and must advance a plane (d·n > 0). Only layers that
// reach into bounds (the owned volume's box) past its low side are listed,
// numbered from the base, so a family confined to a band keeps the layer
// numbers of the whole stack. heightMm is the layer's thickness: along the
// normal for a plane, along the direction for a patch.
//
// {base, direction?, pitchMm, firstLayerMm}, {min, max} ->
// {base, direction, pitchMm, firstLayerMm, layers: [{index, offsetMm, heightMm, slice}]}
export function sliceFamily({ base, direction = null, pitchMm, firstLayerMm }, bounds) {
  requireThat(['plane', 'patch'].includes(base?.kind), 'A slice family needs a plane or patch base slice.');
  requireThat(Number.isFinite(pitchMm) && pitchMm > 0 && Number.isFinite(firstLayerMm) && firstLayerMm > 0,
    'A slice family needs a positive pitch and first-layer height; it would never advance.');
  requireThat(vector(bounds?.min) && vector(bounds?.max), 'A slice family needs the owned volume bounds.');
  requireThat(base.kind === 'plane' || direction, 'A patch slice family needs a stacking direction.');
  const d = normalize(direction ?? base.normal);
  const advance = base.kind === 'plane' ? dot(d, base.normal) : 1;
  requireThat(advance > 1e-9, 'The stacking direction must advance the plane along its normal.');
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [0, 1, 2].map(k => (i >> k) & 1 ? bounds.max[k] : bounds.min[k]));
  const along = base.kind === 'plane' ? base.normal : d;
  const lo = Math.min(...corners.map(c => dot(along, c))), hi = Math.max(...corners.map(c => dot(along, c)));
  // A patch's own extent along the direction, before translation.
  const [low, high] = base.kind === 'patch' ? patchExtent(base.patch, d) : [0, 0];
  // Translating by the first layer, then by whole pitches, keeps a horizontal
  // family's heights bit-identical to base + first + k·pitch.
  const start = translateSlice(base, scale(d, firstLayerMm)), layers = [];
  for (let index = 0; ; index++) {
    const slice = index ? translateSlice(start, scale(d, index * pitchMm)) : start;
    const t = firstLayerMm + index * pitchMm;
    const [bottom, top] = base.kind === 'plane' ? [dot(base.normal, slice.origin), dot(base.normal, slice.origin)] : [low + t, high + t];
    if (bottom > hi + 1e-9) break;
    if (top <= lo + 1e-9) continue;
    const stepMm = index ? pitchMm : firstLayerMm;
    layers.push({ index, offsetMm: firstLayerMm + index * pitchMm, heightMm: stepMm * advance, slice });
  }
  return { base, direction: d, pitchMm, firstLayerMm, layers };
}

// Range of a patch along a unit direction, from its control hull.
function patchExtent(patch, d) {
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < patch.cp.length; i += 4) {
    const w = patch.cp[i + 3], h = (patch.cp[i] * d[0] + patch.cp[i + 1] * d[1] + patch.cp[i + 2] * d[2]) / w;
    low = Math.min(low, h); high = Math.max(high, h);
  }
  return [low, high];
}
