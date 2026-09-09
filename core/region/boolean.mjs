// Boolean operations on planar regions.
//
// This is where several solids meet: rather than building a boolean B-rep, each
// solid is sectioned on its own and the layers are combined here. A slicer only
// ever needs the result one layer at a time, so the hard 3D problem - surface
// intersection curves and tolerance-consistent shell stitching - never has to
// be posed. The same operation reserves material under a top surface, by
// intersecting a section with the level set of the reserve height.
//
// Method: split every loop of A where it crosses a loop of B (and the reverse),
// classify each resulting piece by whether its midpoint lies inside the other
// region, keep the pieces the operation calls for, and chain them back into
// closed loops.
//
// Limitation: coincident collinear boundaries are not a supported input. Two
// solids sharing exactly a face plane in a layer should be nudged apart, the
// same way a degenerate section plane is.

import { TOLERANCE, requireThat, distance2 } from '../geom/tolerance.mjs';
import { SegmentIndex, segmentIntersection, pointInRegion, loopArea, dedupe } from './region2d.mjs';

const CHAIN_TOLERANCE = 1e-7;

export const union = (a, b) => combine(a, b, 'union');
export const intersect = (a, b) => combine(a, b, 'intersect');
export const difference = (a, b) => combine(a, b, 'difference');

function combine(a, b, operation) {
  const left = a.map(dedupe).filter(loop => loop.length >= 3);
  const right = b.map(dedupe).filter(loop => loop.length >= 3);
  if (!left.length) return operation === 'union' ? right.map(loop => [...loop]) : [];
  if (!right.length) return operation === 'intersect' ? [] : left.map(loop => [...loop]);

  const keepLeftInside = operation === 'intersect';
  const keepRightInside = operation === 'intersect' || operation === 'difference';
  const pieces = [
    ...splitAgainst(left, right).filter(piece => pointInRegion(midpoint(piece), right) === keepLeftInside),
    ...splitAgainst(right, left).filter(piece => pointInRegion(midpoint(piece), left) === keepRightInside)
      .map(piece => operation === 'difference' ? [...piece].reverse() : piece)
  ];
  return chain(pieces);
}

// Cut each loop of `loops` wherever it crosses `others`, returning open pieces.
// A loop with no crossing survives whole, as a closed piece.
function splitAgainst(loops, others) {
  const index = new SegmentIndex(others, 1);
  const pieces = [];
  for (const loop of loops) {
    const walk = [];
    const cuts = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      walk.push(a);
      const hits = [];
      for (const [c, d] of index.near(a, distance2(a, b) + 1)) {
        const hit = segmentIntersection(a, b, c, d);
        if (hit && !hits.some(other => distance2(other, hit) <= TOLERANCE.point)) hits.push(hit);
      }
      hits.sort((p, q) => distance2(a, p) - distance2(a, q));
      for (const hit of hits) { cuts.push(walk.length); walk.push(hit); }
    }
    if (!cuts.length) { pieces.push(walk); continue; }
    // Re-open the loop at the first cut, then split at each subsequent one.
    const rotated = [...walk.slice(cuts[0]), ...walk.slice(0, cuts[0])];
    const marks = cuts.map(cut => (cut - cuts[0] + walk.length) % walk.length).sort((x, y) => x - y);
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i], to = i + 1 < marks.length ? marks[i + 1] : rotated.length;
      const piece = rotated.slice(from, to + 1);
      if (i + 1 === marks.length) piece.push(rotated[0]);
      if (piece.length >= 2) pieces.push(piece);
    }
  }
  return pieces;
}

const midpoint = piece => {
  // Midpoint of the piece's longest segment: far from any crossing, so the
  // inside test is not decided on a boundary.
  let best = 0, bestLength = -1;
  for (let i = 0; i + 1 < piece.length; i++) {
    const length = distance2(piece[i], piece[i + 1]);
    if (length > bestLength) { bestLength = length; best = i; }
  }
  return [(piece[best][0] + piece[best + 1][0]) / 2, (piece[best][1] + piece[best + 1][1]) / 2];
};

// Reassemble kept pieces into closed loops end to end.
function chain(pieces) {
  const pool = pieces.map(piece => [...piece]).filter(piece => piece.length >= 2);
  const loops = [];
  // One bound for the whole walk: a shrinking pool must not cut a long contour
  // short half way round.
  const limit = pool.length + 2;
  while (pool.length) {
    let current = pool.pop();
    let guard = 0;
    while (distance2(current[0], current[current.length - 1]) > CHAIN_TOLERANCE && guard++ < limit) {
      const tip = current[current.length - 1];
      let best = -1, bestDistance = CHAIN_TOLERANCE;
      for (let i = 0; i < pool.length; i++) {
        const d = distance2(tip, pool[i][0]);
        if (d <= bestDistance) { bestDistance = d; best = i; }
      }
      if (best < 0) break;
      current.push(...pool.splice(best, 1)[0].slice(1));
    }
    const closed = dedupe(current);
    if (closed.length >= 3 && Math.abs(loopArea(closed)) > TOLERANCE.chord) loops.push(closed);
  }
  return loops;
}

// Region where a sampled height field is at or above `level`, as closed loops.
// Used to reserve material under a top surface: the body may fill only where
// the surface is still far enough above this layer, and to mark the area the
// non-planar angle limit allows.
//
// Grid points outside the sampled object carry a sentinel value. Interpolating
// linearly against a sentinel would put the boundary essentially on the last
// inside sample, so a `refine` callback may be supplied to locate that crossing
// against the real surface instead of the sampled field.
export const SENTINEL = 1e6;

// A sampled field may lie wholly above or wholly below the level, in which case
// there is no contour at all and an empty loop list would be a lie: it means
// "everywhere", not "nowhere". Callers must ask which.
export function levelSetCoverage(field, level) {
  let min = Infinity, max = -Infinity;
  for (const column of field.values)
    for (const value of column) { if (value < min) min = value; if (value > max) max = value; }
  if (min >= level) return 'all';
  if (max < level) return 'none';
  return 'partial';
}

export function levelSetRegion(field, level, { refine = null } = {}) {
  const { xs, ys, values } = field;
  requireThat(xs.length > 1 && ys.length > 1, 'A level set needs a sampled grid.');
  const segments = [];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const corners = [
        { x: xs[i], y: ys[j], value: values[i][j] },
        { x: xs[i + 1], y: ys[j], value: values[i + 1][j] },
        { x: xs[i + 1], y: ys[j + 1], value: values[i + 1][j + 1] },
        { x: xs[i], y: ys[j + 1], value: values[i][j + 1] }
      ];
      // Walking the cell counter-clockwise, a crossing that leaves the high
      // side starts a contour segment and one that enters it ends the segment.
      // Emitting them in that order keeps the region at or above the level on
      // the left, so the pieces chain into correctly wound closed loops.
      const exits = [], entries = [];
      for (let e = 0; e < 4; e++) {
        const p = corners[e], q = corners[(e + 1) % 4];
        const above = p.value >= level, next = q.value >= level;
        if (above === next) continue;
        const sentinel = Math.abs(p.value) >= SENTINEL || Math.abs(q.value) >= SENTINEL;
        let point;
        if (sentinel && refine) point = above ? refine([p.x, p.y], [q.x, q.y]) : refine([q.x, q.y], [p.x, p.y]);
        if (!point) {
          const t = (level - p.value) / (q.value - p.value);
          point = [p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t];
        }
        (above ? exits : entries).push(point);
      }
      for (let k = 0; k < Math.min(exits.length, entries.length); k++) segments.push([exits[k], entries[k]]);
    }
  return chain(segments.map(segment => [...segment]));
}
