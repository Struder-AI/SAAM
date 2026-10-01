import {evaluateSurface} from '../geom/surface-evaluation.mjs';
// Volumes and solid masks of slice layers. An owner of a part (core/print/
// slices.mjs) owns the part's material inside its within volumes, less what
// the owners it yields to claim; every term is a 2D region in the layer's
// chart, so no 3D boolean is built.
// Volume:
//  {kind: 'geometry', geometry}     any solid section() accepts;
//  {kind: 'slab', fromMm, toMm, axis?}  the band fromMm < axis·p <= toMm
//                                   (axis defaults to +Z): a Z band;
//  {kind: 'layer-regions', regions: [{index, loops}]}  given per layer in
//                                   the family's charts: derived volumes
//                                   computed from neighbouring layers.
import {sliceChartStep} from '../geom/slice.mjs';
import {section} from '../region/section.mjs';
import { sampledChartRegion, referenceHeight } from '../geom/height-slice.mjs';
import { union, intersect, difference } from './intersection.mjs';
import {dot} from '../geom/frame.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';

// A volume's section in layer's chart: loops, or null where it covers the
// whole plane. extent bounds the region it will be combined with.
export function volumeSection(volume, layer, extent) {
  if (volume.kind === 'geometry') return section(volume.geometry, layer.slice).loops;
  if (volume.kind === 'layer-regions') return volume.regions.find(r => r.index === layer.index)?.loops ?? [];
  if(volume.kind!=='slab')throw Error(`Unknown volume kind ${volume.kind}.`);
  return slabSection(volume, layer.slice, extent);
}

// A band fromMm < axis·p <= toMm on a plane slice. Across the chart,
// axis·p = axis·origin + a·(axis·x) + b·(axis·y); a plane square to the axis is
// wholly in the band or wholly out of it, half open as layer heights are.
function slabSection({ fromMm, toMm, axis = [0, 0, 1] }, slice, extent) {
  if(!(Number.isFinite(fromMm)&&Number.isFinite(toMm)&&toMm>fromMm))throw Error('A slab volume needs fromMm below toMm.');
  if(slice.kind==='height-field')return sampledChartRegion(extent,slice.sampleStepMm,point=>{
    if(!referenceHeight(slice.reference,...point))return false;
    const h=dot(axis,evaluateSurface(slice,point).point);return h>fromMm+1e-9&&h<=toMm+1e-9;
  });
  if(slice.kind==='patch')return sampledChartRegion(extent,sliceChartStep(slice,slice.sampleStepMm??.2),point=>{
    if(point.some((v,k)=>v<extent.min[k]||v>extent.max[k]))return false;
    const h=dot(axis,evaluateSurface(slice,point).point);return h>fromMm+1e-9&&h<=toMm+1e-9;
  });
  if(slice.kind!=='plane')throw Error('Unknown slice chart.');
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

const extentLoop = ({ min, max }) => [[[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]]];

// Solid masks of layer k from its neighbours in the same family (so the same
// chart): bottom is what fewer than bottomLayers layers below cover, top what
// fewer than topLayers layers above cover. layers: [{index, region}], each
// layer's sliced material.
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
