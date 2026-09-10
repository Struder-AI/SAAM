// Closed planar regions and open polyline clipping; no meshes or CAD.
// clipper2-wasm@0.4.0 packages the upstream C++ kernel. Keep its intersection,
// winding and topology construction intact; SAAM owns conversion and lifetime.
import createClipper from 'clipper2-wasm';
import { clipperContext, CLIPPER_PRECISION } from './clipper.mjs';
import { requireThat } from '../geom/tolerance.mjs';

// Initialize once at module load; all region calls remain synchronous.
const clipper = await createClipper();

export const intersect = (a, b, options) => combine(a, b, 'Intersection', options);
export const union = (a, b, options) => combine(a, b, 'Union', options);
export const difference = (a, b, options) => combine(a, b, 'Difference', options);
export const clipOpenPaths = (paths, region, options) => combine(paths, region, 'Intersection', options, true);

function combine(a, b, operation, { precisionMm = CLIPPER_PRECISION } = {}, open = false) {
  requireThat([a, b].every(region => Array.isArray(region) && region.every(Array.isArray)),
    'Region operations need arrays of closed 2D loops.');
  // One origin/grid for BOTH operands, shared with the offset conversion.
  const context = clipperContext([a, b], precisionMm);
  const owned = [];
  const own = object => { owned.push(object); return object; };
  try {
    const encode = loops => {
      const paths = own(new clipper.Paths64());
      for (const loop of context.encode(loops)) {
        const path = clipper.MakePath64(loop.flatMap(p => [BigInt(p.X), BigInt(p.Y)]));
        try { paths.push_back(path); } finally { path.delete(); }
      }
      return paths;
    };
    const subject = encode(a), clip = encode(b);
    const engine = own(new clipper.Clipper64()), result = own(new clipper.Paths64());
    engine.SetPreserveCollinear(false);
    if(open)engine.AddOpenSubject(subject);else engine.AddSubject(subject);
    engine.AddClip(clip);
    const closedResult=open?own(new clipper.Paths64()):null;
    requireThat(open?engine.ExecutePath(clipper.ClipType[operation], clipper.FillRule.NonZero, closedResult, result):engine.ExecutePath(clipper.ClipType[operation], clipper.FillRule.NonZero, result),
      'Clipper2 region operation failed.');
    const paths = [];
    for (let i = 0; i < result.size(); i++) {
      const path = result.get(i);
      try {
        // The packaged Z build uses triples; Z is unused by this 2D interface.
        const coordinates = path.view(), loop = [];
        for (let j = 0; j < coordinates.length; j += 3)
          loop.push({ X: Number(coordinates[j]), Y: Number(coordinates[j + 1]) });
        paths.push(loop);
      } finally { path.delete(); }
    }
    return open?context.decodeOpen(paths):context.decode(paths);
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    throw new Error(`Clipper2 region operation failed: ${cause}`);
  } finally {
    for (const object of owned.reverse()) object.delete();
  }
}
