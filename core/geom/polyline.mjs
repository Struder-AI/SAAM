import { TOLERANCE } from './tolerance.mjs';

// The ordinary bounded-coordinate case does not need Math.hypot's general
// rescaling/compensation loop. Retain it for overflow and underflow ranges.
const norm2=(x,y)=>{
  const square=x*x+y*y;
  return Number.isFinite(square)&&square>=Number.MIN_VALUE*2?Math.sqrt(square):Math.hypot(x,y);
};

// Remove numerical seams using distance to the whole replacement segment.
// An angle test becomes unstable beside very short mesh/triangle edges. Testing
// every original point also prevents small turns accumulating into a flattened
// curve. Iterative subdivision avoids recursion limits on imported contours.
// The default preserves even tiny reversals. A caller performing an explicitly
// tolerance-bounded detail approximation may opt out; all original vertices
// still participate in the replacement-segment distance check.
export function cleanPlanarLoop(loop, tolerance = TOLERANCE.plane, {preserveReversals=true}={}) {
  if (loop.length < 4) return loop;
  let opposite = 1, farthest = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = norm2(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > farthest) { farthest = d; opposite = i; }
  }
  function chain(points) {
    const keep = new Set([0, points.length - 1]), pending = [[0, points.length - 1]];
    while (pending.length) {
      const [first, last] = pending.pop();
      if (last <= first + 1) continue;
      const a = points[first], b = points[last], dx = b[0] - a[0], dy = b[1] - a[1], length = norm2(dx, dy);
      let split = -1, worst = tolerance, previous = 0;
      for (let i = first + 1; i < last; i++) {
        const p = points[i], along = length ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length : 0;
        const t = length ? Math.max(0, Math.min(1, along / length)) : 0;
        const error = norm2(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        if (error > worst) { worst = error; split = i; }
        // Retain reversals even when all points lie on the same straight line.
        if (preserveReversals && along < previous - 16 * Number.EPSILON * Math.max(1, length)) { split = i - 1 > first ? i - 1 : i; break; }
        previous = along;
      }
      if (split >= 0) { keep.add(split); pending.push([first, split], [split, last]); }
    }
    return [...keep].sort((a, b) => a - b).map(i => points[i]);
  }
  const result = [...chain(loop.slice(0, opposite + 1)).slice(0, -1), ...chain([...loop.slice(opposite), loop[0]]).slice(0, -1)];
  return result.length >= 3 ? result : loop;
}
