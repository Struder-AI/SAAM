import {evaluateSurface} from '../geom/surface-evaluation.mjs';
// Volumes of slice layers; neighboring skin masks belong to solid-masks.mjs.
// An owner of a part (core/print/
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
import {sampledChartRegion} from '../geom/chart-region.mjs';
import {dot} from '../geom/frame.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

// A volume's section in layer's chart: loops, or null where it covers the
// whole plane. extent bounds the region it will be combined with.
export function volumeSection(volume, layer, extent) {
  if (volume.kind === 'geometry') return section(volume.geometry, layer.slice,layer.slice.kind==='plane'?{side:'negative'}:{}).loops;
  if (volume.kind === 'layer-regions') return volume.regions.find(r => r.index === layer.index)?.loops ?? [];
  if(volume.kind!=='slab')throw Error(`Unknown volume kind ${volume.kind}.`);
  return slabSection(volume, layer.slice, extent);
}

// A band fromMm < axis·p <= toMm on a plane slice. Across the chart,
// axis·p = axis·origin + a·(axis·x) + b·(axis·y); a plane square to the axis is
// wholly in the band or wholly out of it, half open as layer heights are.
function slabSection({ fromMm, toMm, axis = [0, 0, 1] }, slice, extent) {
  if(!(Number.isFinite(fromMm)&&Number.isFinite(toMm)&&toMm>fromMm))throw Error('A slab volume needs fromMm below toMm.');
  if(slice.kind==='patch')return sampledChartRegion(extent,sliceChartStep(slice,slice.sampleStepMm??.2),point=>{
    if(point.some((v,k)=>v<extent.min[k]||v>extent.max[k]))return false;
    const h=dot(axis,evaluateSurface(slice,point).point);return h>fromMm+PRINT_RESOLUTION_MM&&h<=toMm+PRINT_RESOLUTION_MM;
  });
  if(slice.kind!=='plane')throw Error('Unknown slice chart.');
  const h0 = dot(axis, slice.origin), ha = dot(axis, slice.xAxis), hb = dot(axis, slice.yAxis);
  if (Math.hypot(ha, hb) <= ROUNDING_RELATIVE) return h0 > fromMm + PRINT_RESOLUTION_MM && h0 <= toMm + PRINT_RESOLUTION_MM ? null : [];
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
