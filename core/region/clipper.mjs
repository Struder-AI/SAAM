// Single adapter to the pinned Clipper 6.4.2 JavaScript port. Keep the upstream
// construction, scanbeam/winding cleanup and PolyTree logic in the dependency.
// Surface offsets also use this adapter for their swept-region cleanup.
// General planar booleans use Clipper2 in intersection.mjs; both adapters reuse
// the conversion and canonical ordering below.
import Clipper from 'clipper-lib';
import { requireThat } from '../geom/tolerance.mjs';

export const CLIPPER_PRECISION = 1e-9;
const LIMIT = 2 ** 50; // headroom below the JS port's 2^52 coordinate limit

// The upstream browser error handler catches its own exception and calls alert.
// In Node an error must propagate, never become a partial or empty solution.
Clipper.Error = message => { throw new Error(`Clipper: ${message}`); };

export function clipperContext(regions, precision = CLIPPER_PRECISION, margin = 0) {
  requireThat(Number.isFinite(precision) && precision > 0, 'Region precision must be positive and finite.');
  const points = regions.flat(2);
  requireThat(points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)), 'Region coordinates must be finite 2D points.');
  const origin = points.length ? points.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1])],[Infinity,Infinity]) : [0,0];
  requireThat(points.every(p => p.every((v, k) => (Math.abs(v - origin[k]) + margin) / precision < LIMIT)),
    'Region coordinate range exceeds Clipper precision; increase precisionMm or use a smaller coordinate span.');
  const encode = loops => loops.map(loop => loop.map(p => ({
    X: Clipper.Clipper.Round((p[0] - origin[0]) / precision),
    Y: Clipper.Clipper.Round((p[1] - origin[1]) / precision)
  })));
  const decode = paths => canonicalLoops(paths.map(loop => loop.map(p => [origin[0] + p.X * precision, origin[1] + p.Y * precision])));
  return { encode, decode, precision };
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

export function clipPaths(subject, clip = [], operation = 'union', fill = 'pftNonZero') {
  const engine = new Clipper.Clipper(), tree = new Clipper.PolyTree();
  // Point-touching lobes must be separate simple loops for component-aware fill.
  // Both upstream languages expose this option; it changes representation, not
  // the filled region. Do not resolve such junctions in skill-local code.
  engine.StrictlySimple = true;
  const hasSubject = engine.AddPaths(subject, Clipper.PolyType.ptSubject, true);
  const hasClip = clip.length ? engine.AddPaths(clip, Clipper.PolyType.ptClip, true) : false;
  const kind = { union: 'ctUnion', difference: 'ctDifference', intersection: 'ctIntersection' }[operation];
  requireThat(kind, 'Unsupported offset cleanup operation.');
  if ((!hasSubject && !hasClip) || (!hasSubject && operation !== 'union')) return [];
  requireThat(engine.Execute(Clipper.ClipType[kind], tree, Clipper.PolyFillType[fill], Clipper.PolyFillType[fill]), 'Clipper offset cleanup failed.');
  return Clipper.Clipper.PolyTreeToPaths(tree);
}

export function offsetPaths(paths, delta, { join, miterLimit, arcTolerance }) {
  const engine = new Clipper.ClipperOffset(miterLimit, arcTolerance), tree = new Clipper.PolyTree();
  engine.AddPaths(paths, Clipper.JoinType[{ round: 'jtRound', miter: 'jtMiter', square: 'jtSquare' }[join]], Clipper.EndType.etClosedPolygon);
  engine.Execute(tree, delta);
  return Clipper.Clipper.PolyTreeToPaths(tree);
}
