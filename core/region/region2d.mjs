// Planar regions: the layer-level geometry every pattern skill works in.
//
// A region is a list of closed loops, outer loops counter-clockwise and holes
// clockwise, as produced by sectioning. Everything below is numerical polygon work
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
    this.rows = new Map();
    this.segments = [];
    for (const loop of loops)
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) this.add([loop[j], loop[i]]);
  }
  add(segment) {
    const index = this.segments.push(segment) - 1;
    const [a, b] = segment;
    const x0 = Math.floor(Math.min(a[0], b[0]) / this.cell), x1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / this.cell), y1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
    for (let y = y0; y <= y1; y++) {
      const row = this.rows.get(y);
      if (row) row.push(index); else this.rows.set(y, [index]);
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = x + '|' + y;
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(index); else this.buckets.set(key, [index]);
      }
  }
  near(point, radius) {
    return this.inBox([point[0]-radius,point[1]-radius],[point[0]+radius,point[1]+radius]);
  }
  inBox(min,max) {
    const x0 = Math.floor(min[0] / this.cell), x1 = Math.floor(max[0] / this.cell);
    const y0 = Math.floor(min[1] / this.cell), y1 = Math.floor(max[1] / this.cell);
    const seen = new Set();
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (const index of this.buckets.get(x + '|' + y) ?? []) seen.add(index);
    return [...seen].map(index => this.segments[index]);
  }
  contains(point) {
    let winding=0;
    for(const index of this.rows.get(Math.floor(point[1]/this.cell))??[]) {
      const [[xj,yj],[xi,yi]]=this.segments[index];
      if(yj<=point[1]) {
        if(yi>point[1]&&(xi-xj)*(point[1]-yj)-(point[0]-xj)*(yi-yj)>0)winding++;
      } else if(yi<=point[1]&&(xi-xj)*(point[1]-yj)-(point[0]-xj)*(yi-yj)<0)winding--;
    }
    return winding!==0;
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

// Compatibility export: all callers share the same Clipper-backed implementation.
export { offsetRegion } from './offset.mjs';

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
// region by the nonzero winding rule. Complete disconnected components, then
// sweep cells within each component. A hole or concavity splits/merges the
// scanline intervals: finish each uninterrupted run of rows before changing
// sides. This changes only ordering, never deposition endpoints or coverage.
export function scanlineFill(loops, spacingMm, angleDeg, options = {}) {
  return regionComponents(loops)
    .flatMap(component => scanlineFillComponent(component, spacingMm, angleDeg, options))
    .flatMap((cell, cellId) => cell.map(row => ({...row, cellId})));
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
  const cells = [];
  let previous = [];
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
    const current = [];
    for (let i = 0; i < crossings.length - 1; i++) {
      winding += crossings[i].winding;
      if (winding === 0) continue;
      const length = crossings[i + 1].x - crossings[i].x;
      if (length <= TOLERANCE.point) continue;
      current.push({left:crossings[i].x,right:crossings[i+1].x,parents:[],children:[],
        row:{scanY:y,from:toWorld([crossings[i].x,y]),to:toWorld([crossings[i+1].x,y]),lengthMm:length}});
    }
    // Interval adjacency is linear in the number of crossings. End a cell at
    // every split/merge rather than picking one branch and shuttling across
    // the other on each row. Empty rows also end cells. Actual connecting
    // travel still goes through the shared combing/clearance checks.
    let first = 0;
    for (const span of current) {
      while(first<previous.length&&previous[first].right<=span.left+TOLERANCE.point)first++;
      for(let j=first;j<previous.length&&previous[j].left<span.right-TOLERANCE.point;j++) {
        const before=previous[j];
        if(Math.min(before.right,span.right)-Math.max(before.left,span.left)>TOLERANCE.point) {
          span.parents.push(before);before.children.push(span);
        }
      }
    }
    for(const span of current) {
      const parent=span.parents.length===1?span.parents[0]:null;
      if(parent&&parent.children.length===1)span.cell=parent.cell;
      else {span.cell=[];cells.push(span.cell);}
      span.cell.push(span.row);
    }
    // Do not retain the adjacency graph; only the previous row is needed.
    previous=current.map(({left,right,cell})=>({left,right,cell,children:[]}));
  }
  return cells;
}
