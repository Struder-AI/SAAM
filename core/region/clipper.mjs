// Shared coordinate conversion and Clipper2 operations for planar offsets,
// booleans and surface-offset swept-region cleanup.
import {nativeBooleanPaths,inflatePaths,nativeSimplifyPaths,normalizeAndInflatePaths} from './clipper2.mjs';
import { requireThat } from '../geom/tolerance.mjs';

export const CLIPPER_PRECISION = 1e-9;
const LIMIT = 2 ** 50; // headroom within exactly representable JS integer coordinates
const round=value=>value<0?-Math.round(-value):Math.round(value);

export function clipperContext(regions, precision = CLIPPER_PRECISION, margin = 0, originOverride = null) {
  requireThat(Number.isFinite(precision) && precision > 0, 'Region precision must be positive and finite.');
  const points = regions.flat(2);
  requireThat(points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)), 'Region coordinates must be finite 2D points.');
  requireThat(originOverride===null||(Array.isArray(originOverride)&&originOverride.length===2&&originOverride.every(Number.isFinite)),'Region origin must be a finite 2D point.');
  const origin = originOverride??(points.length ? points.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1])],[Infinity,Infinity]) : [0,0]);
  requireThat(points.every(p => p.every((v, k) => (Math.abs(v - origin[k]) + margin) / precision < LIMIT)),
    'Region coordinate range exceeds Clipper precision; increase precisionMm or use a smaller coordinate span.');
  const encode = loops => loops.map(loop => loop.map(p => ({
    X: round((p[0] - origin[0]) / precision),
    Y: round((p[1] - origin[1]) / precision)
  })));
  const decode = paths => canonicalLoops(paths.map(loop => loop.map(p => [origin[0] + p.X * precision, origin[1] + p.Y * precision])));
  const decodeOpen = paths => paths.map(path => path.map(p => [origin[0] + p.X * precision, origin[1] + p.Y * precision]));
  return { encode, decode, decodeOpen, precision };
}

// Stable seams and component order make output independent of Clipper's scan
// order without changing winding, topology, or deleting small material regions.
export function canonicalLoops(loops) {
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
  return loops.filter(loop => loop.length >= 3).map(loop => {
    let first = 0;
    for (let i = 1; i < loop.length; i++) if (compare(loop[i], loop[first]) < 0) first = i;
    return [...loop.slice(first), ...loop.slice(0, first)];
  }).sort((a, b) => compare(a[0], b[0]) || a.length - b.length);
}

export function clipPaths(subject, clip = [], operation = 'union', {open=false} = {}) {
  requireThat(['union','difference','intersection'].includes(operation), 'Unsupported offset cleanup operation.');
  requireThat(typeof open==='boolean','Clipper open option must be boolean.');
  return nativeBooleanPaths(subject,clip,operation,{open});
}

export function offsetPaths(paths, delta, { join, miterLimit, arcTolerance, end='Polygon' }) {
  return inflatePaths(paths,delta,{join,miterLimit,arcTolerance,end});
}

export function normalizedOffsetPaths(paths,delta,{join,miterLimit,arcTolerance}){
  return normalizeAndInflatePaths(paths,delta,{join,miterLimit,arcTolerance});
}

export function simplifyPaths(paths,epsilon,closed=true){
  return nativeSimplifyPaths(paths,epsilon,closed);
}
