// Planar regions: the layer-level geometry every pattern skill works in.
//
// A region is a list of closed loops, outer loops counter-clockwise and holes
// clockwise, as produced by sectioning. Everything below is exact polygon work
// on those loops - offsetting for perimeters, scanline fill, and the boolean
// ops that let several solids be combined at slice time rather than as breps.

import { TOLERANCE, requireThat, distance2 } from '../geom/tolerance.mjs';

export const loopArea = loop => {
  let sum = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) sum += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return sum / 2;
};
export const regionArea = loops => loops.reduce((total, loop) => total + loopArea(loop), 0);

export function pointInRegion(point, loops) {
  let winding = 0;
  for (const loop of loops)
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i], [xj, yj] = loop[j];
      if (yj <= point[1]) {
        if (yi > point[1] && (xi - xj) * (point[1] - yj) - (point[0] - xj) * (yi - yj) > 0) winding++;
      } else if (yi <= point[1] && (xi - xj) * (point[1] - yj) - (point[0] - xj) * (yi - yj) < 0) winding--;
    }
  return winding !== 0;
}

// Uniform grid over the region's segments. Offsetting needs "how far is this
// point from the boundary" and "where does this polyline cross itself" many
// times per layer; both become local queries instead of full scans.
export class SegmentIndex {
  constructor(loops, cellSize = 1) {
    this.cell = Math.max(cellSize, 1e-3);
    this.buckets = new Map();
    this.segments = [];
    for (const loop of loops)
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) this.add([loop[j], loop[i]]);
  }
  add(segment) {
    const index = this.segments.push(segment) - 1;
    const [a, b] = segment;
    const x0 = Math.floor(Math.min(a[0], b[0]) / this.cell), x1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / this.cell), y1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = x + '|' + y;
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(index); else this.buckets.set(key, [index]);
      }
  }
  near(point, radius) {
    const x0 = Math.floor((point[0] - radius) / this.cell), x1 = Math.floor((point[0] + radius) / this.cell);
    const y0 = Math.floor((point[1] - radius) / this.cell), y1 = Math.floor((point[1] + radius) / this.cell);
    const seen = new Set();
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (const index of this.buckets.get(x + '|' + y) ?? []) seen.add(index);
    return [...seen].map(index => this.segments[index]);
  }
  distanceTo(point, radius) {
    let best = Infinity;
    for (const [a, b] of this.near(point, radius)) best = Math.min(best, pointSegmentDistance(point, a, b));
    return best;
  }
}

export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18) return distance2(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const dedupe = loop => {
  const out = [];
  for (const point of loop) if (!out.length || distance2(out[out.length - 1], point) > TOLERANCE.point) out.push(point);
  while (out.length > 1 && distance2(out[0], out[out.length - 1]) <= TOLERANCE.point) out.pop();
  return out;
};

// Inward offset by |delta| (delta < 0 shrinks a counter-clockwise outer loop).
//
// Raw offset first: each edge moves along its normal and neighbouring edges are
// mitred, with an arc inserted where the corner would otherwise spike. The raw
// result self-intersects wherever the offset exceeds the local half-width, so
// it is then pruned against the true distance field and split into simple
// loops. Every emitted point is verified to stand off the original boundary by
// |delta|, so a bad offset reports instead of printing into a wall.
export function offsetRegion(loops, delta, { arcToleranceMm = 0.02 } = {}) {
  const shrink = Math.abs(delta);
  if (shrink < 1e-9) return loops.map(loop => [...loop]);
  const index = new SegmentIndex(loops, Math.max(shrink, 0.5));
  const out = [];
  const bounds=region=>{
    const box={min:[Infinity,Infinity],max:[-Infinity,-Infinity]};
    for(const loop of region)for(const p of loop)for(let i=0;i<2;i++){box.min[i]=Math.min(box.min[i],p[i]);box.max[i]=Math.max(box.max[i],p[i]);}
    return box;
  };
  const sourceBounds=delta<0?bounds(loops):null;
  for (const loop of loops) {
    const clean = dedupe(loop);
    if (clean.length < 3) continue;
    const sign = Math.sign(loopArea(clean));
    // An inward offset cannot contain a radius-r disk when even its outer
    // loop has less area than that disk. Narrow reservation remnants collapse
    // instead of turning an acute miter into a new, much larger polygon.
    if(delta<0&&sign>0&&Math.abs(loopArea(clean))<Math.PI*shrink*shrink)continue;
    let raw=rawOffset(clean, delta, arcToleranceMm);
    // Inward material stays inside its original outer-loop bounds. Clip the
    // raw construction before spatial indexing: nearly reversing edges can
    // otherwise create arbitrarily distant line intersections. Box edges are
    // construction-only and the containment/standoff filter below removes
    // them; this does not clamp a delivered toolpath into machine bounds.
    if(delta<0)raw=clipToBounds(raw,sign>0?bounds([clean]):sourceBounds);
    for (const piece of splitSelfIntersections(raw)) {
      const kept = dedupe(piece).filter(point => (delta>=0||pointInRegion(point,loops))&&index.distanceTo(point, shrink * 3) >= shrink - TOLERANCE.chord);
      if (kept.length < 3) continue;
      const area = loopArea(kept);
      // Keep only pieces whose winding still matches the parent loop: the
      // spurious loops an offset creates come back with the opposite sign.
      if (Math.sign(area) !== sign || Math.abs(area) < shrink * shrink * 0.25) continue;
      out.push(kept);
    }
  }
  return out;
}

function clipToBounds(points,bounds){
  let result=points;
  for(const axis of [0,1])for(const side of ['min','max']){
    const limit=bounds[side][axis],inside=p=>side==='min'?p[axis]>=limit:p[axis]<=limit;
    const next=[];
    for(let i=0;i<result.length;i++){
      const a=result[i],b=result[(i+1)%result.length],aInside=inside(a),bInside=inside(b);
      if(aInside)next.push(a);
      if(aInside!==bInside){
        const t=(limit-a[axis])/(b[axis]-a[axis]);
        const point=a.map((value,k)=>t<=0.5?value+(b[k]-value)*t:b[k]+(value-b[k])*(1-t));point[axis]=limit;next.push(point);
      }
    }
    result=dedupe(next);
  }
  return result;
}

function rawOffset(loop, delta, arcToleranceMm) {
  const out = [];
  const count = loop.length;
  for (let i = 0; i < count; i++) {
    const previous = loop[(i - 1 + count) % count], current = loop[i], next = loop[(i + 1) % count];
    const n1 = normalOf(previous, current), n2 = normalOf(current, next);
    if (!n1 || !n2) continue;
    const a = [current[0] + n1[0] * delta, current[1] + n1[1] * delta];
    const b = [current[0] + n2[0] * delta, current[1] + n2[1] * delta];
    const cross = n1[0] * n2[1] - n1[1] * n2[0];
    if (Math.abs(cross) < 1e-12) { out.push(a); continue; }
    // The corner opens a gap when the turn runs the same way as the offset:
    // a left turn offset outwards, or a right turn offset inwards. Those get an
    // arc at the offset radius; the other case closes on a mitre.
    if (Math.sign(cross) * Math.sign(delta) > 0) {
      const v1 = [n1[0] * delta, n1[1] * delta], v2 = [n2[0] * delta, n2[1] * delta];
      const sweep = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]);
      const ratio = Math.max(-1, Math.min(1, 1 - arcToleranceMm / Math.abs(delta)));
      const step = Math.max(2 * Math.acos(ratio), 0.05);
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / step));
      const start = Math.atan2(v1[1], v1[0]), radius = Math.abs(delta);
      for (let k = 0; k <= steps; k++) {
        const t = start + sweep * k / steps;
        out.push([current[0] + Math.cos(t) * radius, current[1] + Math.sin(t) * radius]);
      }
    } else {
      const point = lineIntersection(a, [a[0] + (current[0] - previous[0]), a[1] + (current[1] - previous[1])],
        b, [b[0] + (next[0] - current[0]), b[1] + (next[1] - current[1])]);
      if (point) out.push(point); else out.push(a, b);
    }
  }
  return out;
}

const normalOf = (a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  return length < 1e-12 ? null : [dy / length, -dx / length];
};

function lineIntersection(p1, p2, p3, p4) {
  const d1 = [p2[0] - p1[0], p2[1] - p1[1]], d2 = [p4[0] - p3[0], p4[1] - p3[1]];
  const denominator = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / denominator;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

// Split a self-intersecting closed polyline into simple loops: walk it, insert
// each crossing point, and close a loop every time the walk returns to a point
// it has already stood on.
export function splitSelfIntersections(loop) {
  const points = dedupe(loop);
  if (points.length < 3) return [];
  const index = new SegmentIndex([points], 1);
  const crossings = new Map();
  const locate = new Map();
  points.forEach((point, i) => locate.set(point, i));
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (const [c, d] of index.near(a, distance2(a, b) + 1)) {
      const j = locate.get(c);
      if (j === undefined || j === i || (j + 1) % points.length === i || (i + 1) % points.length === j) continue;
      const hit = segmentIntersection(a, b, c, d);
      if (!hit) continue;
      pushCrossing(crossings, i, hit);
      pushCrossing(crossings, j, hit);
    }
  }
  if (!crossings.size) return [points];
  const walk = [];
  for (let i = 0; i < points.length; i++) {
    walk.push(points[i]);
    const list = (crossings.get(i) ?? []).sort((p, q) => distance2(points[i], p) - distance2(points[i], q));
    for (const point of list) walk.push(point);
  }
  return partition(walk);
}

const pushCrossing = (map, i, point) => {
  const list = map.get(i) ?? [];
  if (!list.some(other => distance2(other, point) <= TOLERANCE.point)) list.push(point);
  map.set(i, list);
};

function partition(walk) {
  const loops = [], stack = [];
  for (const point of walk) {
    const seen = stack.findIndex(other => distance2(other, point) <= TOLERANCE.point);
    if (seen >= 0) { loops.push(stack.splice(seen)); continue; }
    stack.push(point);
  }
  if (stack.length >= 3) loops.push(stack);
  return loops.filter(loop => loop.length >= 3);
}

export function segmentIntersection(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-15) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denominator;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denominator;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

// Split a region into printable connected components. Positive loops are solid
// boundaries and negative loops are holes. A positive island inside a hole is
// a new component; a hole stays with the solid boundary that contains it.
// Keeping this grouping here gives every scanline-based skill the same
// no-cross-gap ordering instead of making each skill rediscover it.
export function regionComponents(loops) {
  const nodes = loops.map(loop => ({ loop, area: loopArea(loop), parent: null, children: [] }));
  for (const node of nodes) {
    const containing = nodes.filter(other => other !== node && Math.abs(other.area) > Math.abs(node.area)
      && pointInRegion(node.loop[0], [other.loop]));
    node.parent = containing.sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0] ?? null;
    node.parent?.children.push(node);
  }
  const roots = nodes.filter(node => node.area > 0 && (!node.parent || node.parent.area < 0));
  if (!roots.length) return loops.length ? [loops] : [];
  const components = roots.map(root => {
    const component = [];
    const collect = node => {
      component.push(node.loop);
      // A positive child of a positive boundary is part of the same material
      // component. A positive child of a hole is a separate island/root.
      for (const child of node.children)
        if (child.area < 0 || node.area > 0) collect(child);
    };
    collect(root);
    return component;
  });
  return components.sort((a, b) => {
    const [ax, ay] = componentKey(a), [bx, by] = componentKey(b);
    return ax - bx || ay - by;
  });
}

function componentKey(component) {
  let minX = Infinity, minY = Infinity;
  for (const loop of component) for (const point of loop) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
  }
  return [minX, minY];
}

// Scanline fill: parallel lines at the given spacing and angle, clipped to the
// region by the nonzero winding rule. Disconnected components are filled in a
// stable order, with each component's rows completed before the next starts.
// This prevents a gap between sides/islands from becoming a repeated
// left-right-left-right travel pattern.
export function scanlineFill(loops, spacingMm, angleDeg, options = {}) {
  return regionComponents(loops).flatMap(component => scanlineFillComponent(component, spacingMm, angleDeg, options));
}

function scanlineFillComponent(loops, spacingMm, angleDeg, { originMm = [0, 0] } = {}) {
  requireThat(spacingMm > 0, 'Fill spacing must be positive.');
  const angle = angleDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const toScan = p => {
    const x = p[0] - originMm[0], y = p[1] - originMm[1];
    return [x * cos + y * sin, -x * sin + y * cos];
  };
  const toWorld = p => [originMm[0] + p[0] * cos - p[1] * sin, originMm[1] + p[0] * sin + p[1] * cos];
  const rotated = loops.map(loop => loop.map(toScan));
  let min = Infinity, max = -Infinity;
  for (const loop of rotated) for (const point of loop) { min = Math.min(min, point[1]); max = Math.max(max, point[1]); }
  if (!Number.isFinite(min)) return [];
  const rows = [];
  for (let y = Math.ceil(min / spacingMm) * spacingMm; y <= max; y += spacingMm) {
    const crossings = [];
    for (const loop of rotated)
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const [x0, y0] = loop[j], [x1, y1] = loop[i];
        if ((y0 > y) === (y1 > y)) continue;
        crossings.push({ x: x0 + (x1 - x0) * (y - y0) / (y1 - y0), winding: y1 > y0 ? 1 : -1 });
      }
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < crossings.length - 1; i++) {
      winding += crossings[i].winding;
      if (winding === 0) continue;
      const length = crossings[i + 1].x - crossings[i].x;
      if (length <= TOLERANCE.point) continue;
      rows.push({ scanY: y, from: toWorld([crossings[i].x, y]), to: toWorld([crossings[i + 1].x, y]), lengthMm: length });
    }
  }
  return rows;
}
