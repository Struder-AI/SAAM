// Ownership of slice layers by volume. An owner slices one part with one slice
// family and owns the part's material inside its `within` volumes; layer k is
//   R_k = sec(part, S_k) ∩ ⋂ sec(within, S_k) − ⋃ claims of the others at S_k
// where another owner claims ⋂ sec(its within, S_k) and an owner with no
// `within` (the default) owns what no other claims and claims nothing. Every
// term is a 2D region in S_k's chart, so no 3D boolean is built. For many
// layers, give an owner a part prepared with prepareSection(part, family.base).
//
// Owner: {id, part, within: [volume], family}. A later `interfaces` field (two
// owners sharing a zone that one family slices, alternating between them) adds
// to this record without reshaping it.
// Volume:
//  {kind: 'geometry', geometry}     any solid section() accepts;
//  {kind: 'slab', fromMm, toMm, axis?}  the band fromMm < axis·p <= toMm
//                                   (axis defaults to +Z): a Z band;
//  {kind: 'layer-regions', regions: [{index, loops}]}  given per layer in
//                                   this family's charts: derived volumes
//                                   (a top shell, a support column, a cavity
//                                   shaft) computed from neighbouring layers.
import { section, touchesSliceEdge } from '../geom/slice.mjs';
import { union, intersect, difference } from './intersection.mjs';
import { requireThat, dot } from '../geom/tolerance.mjs';

const OWNER_FIELDS = ['family', 'id', 'part', 'within'];

export function validateOwner(owner) {
  requireThat(owner && Object.keys(owner).every(key => OWNER_FIELDS.includes(key)) && typeof owner.id === 'string' && owner.id.length > 0,
    `A layer owner has ${OWNER_FIELDS.join(', ')}.`);
  requireThat(owner.part?.bounds && Array.isArray(owner.family?.layers) && Array.isArray(owner.within),
    `Owner ${owner.id} needs a part, a slice family and a within list.`);
  for (const volume of owner.within) requireThat(['geometry', 'slab', 'layer-regions'].includes(volume?.kind), `Owner ${owner.id} has an unknown volume kind ${volume?.kind}.`);
  return owner;
}

// Layer k of an owner: {owner, index, slice, heightMm, section, region,
// nudgedByMm}. `section` is the part's own cut, loops in the order and from the
// start points the cut produced; `region` is what this owner deposits.
export function layerRegion(owner, k, others = []) {
  validateOwner(owner);
  const layer = owner.family.layers.find(l => l.index === k);
  requireThat(layer, `Layer ${k} is not in the slice family of owner ${owner.id}.`);
  const cut = section(owner.part, layer.slice);
  let region = cut.loops;
  if (region.length) {
    const extent = regionExtent(region);
    for (const volume of owner.within) {
      const owned = volumeSection(volume, layer, extent);
      if (owned !== null) region = intersect(region, owned);
    }
    for (const other of others) {
      if (other === owner || !other.within.length) continue;
      // A claim covering the whole plane takes everything within the extent.
      const claims = other.within.map(volume => volumeSection(volume, layer, extent)).filter(c => c !== null);
      region = difference(region, claims.length ? claims.reduce((a, b) => intersect(a, b)) : extentLoop(extent));
    }
  }
  requireThat(!touchesSliceEdge(layer.slice, region),
    `Layer ${k} of owner ${owner.id}: its slice ends inside the owned volume. Extend the slice past the part so every layer crosses it fully.`);
  return { owner: owner.id, index: k, slice: layer.slice, heightMm: layer.heightMm, section: cut.loops, region, nudgedByMm: cut.nudgedByMm };
}

// A volume's section in layer's chart: loops, or null where it covers the
// whole plane. extent bounds the region it will be combined with.
export function volumeSection(volume, layer, extent) {
  if (volume.kind === 'geometry') return section(volume.geometry, layer.slice).loops;
  if (volume.kind === 'layer-regions') return volume.regions.find(r => r.index === layer.index)?.loops ?? [];
  requireThat(volume.kind === 'slab', `Unknown volume kind ${volume.kind}.`);
  return slabSection(volume, layer.slice, extent);
}

// A band fromMm < axis·p <= toMm on a plane slice. Across the chart,
// axis·p = axis·origin + a·(axis·x) + b·(axis·y); a plane square to the axis is
// wholly in the band or wholly out of it, half open as layer heights are.
function slabSection({ fromMm, toMm, axis = [0, 0, 1] }, slice, extent) {
  requireThat(Number.isFinite(fromMm) && Number.isFinite(toMm) && toMm > fromMm, 'A slab volume needs fromMm below toMm.');
  requireThat(slice.kind === 'plane', 'A slab volume on a spline-patch slice is not supported yet; give the owner a geometry volume.');
  const h0 = dot(axis, slice.origin), ha = dot(axis, slice.xAxis), hb = dot(axis, slice.yAxis);
  if (Math.hypot(ha, hb) <= 1e-12) return h0 > fromMm + 1e-9 && h0 <= toMm + 1e-9 ? null : [];
  let loop = extentLoop(extent)[0];
  loop = clipHalfPlane(loop, ([a, b]) => h0 + a * ha + b * hb - fromMm);
  loop = clipHalfPlane(loop, ([a, b]) => toMm - (h0 + a * ha + b * hb));
  return loop.length >= 3 ? [loop] : [];
}

// One convex loop cut by the half plane f >= 0 (f linear), keeping order.
function clipHalfPlane(loop, f) {
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
  }
  return out;
}

const regionExtent = loops => {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const loop of loops) for (const [a, b] of loop) { min[0] = Math.min(min[0], a); min[1] = Math.min(min[1], b); max[0] = Math.max(max[0], a); max[1] = Math.max(max[1], b); }
  const margin = 1 + 1e-3 * Math.max(max[0] - min[0], max[1] - min[1]);
  return { min: [min[0] - margin, min[1] - margin], max: [max[0] + margin, max[1] + margin] };
};
const extentLoop = ({ min, max }) => [[[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]]];

// Solid masks of layer k from its neighbours in the same family (so the same
// chart): bottom is what fewer than bottomLayers layers below cover, top what
// fewer than topLayers layers above cover. layers are layerRegion results.
export function solidMasks(layers, k, { bottomLayers, topLayers }) {
  requireThat(Number.isInteger(bottomLayers) && bottomLayers >= 0 && Number.isInteger(topLayers) && topLayers >= 0, 'Solid masks need whole bottom and top layer counts.');
  const regions = new Map(layers.map(layer => [layer.index, layer.region]));
  const region = regions.get(k);
  requireThat(region, `Layer ${k} has no region to mask.`);
  let supported = region, covered = region;
  for (let n = 1; n <= bottomLayers && supported.length; n++) supported = intersect(supported, regions.get(k - n) ?? []);
  for (let n = 1; n <= topLayers && covered.length; n++) covered = intersect(covered, regions.get(k + n) ?? []);
  const bottom = difference(region, supported), top = difference(region, covered);
  return { bottom, top, solid: union(bottom, top) };
}
