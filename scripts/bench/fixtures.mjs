// Development fixtures only. These feed the existing geometry/skill interfaces;
// they are not a CAD importer or a second production generation route.
import { shellFromSurfaces, boxShell, splineTopShell } from '../../core/geom/shapes.mjs';
import { assertClosed } from '../../core/geom/shell.mjs';
import { evaluate } from '../../core/geom/nurbs.mjs';
import { makeMesh } from '../../core/geom/mesh.mjs';

export const fixtures = {
  box: { width: 24, depth: 24, height: 24, twistDeg: 0, roofControlRise: 0 },
  'twisted-box': { width: 24, depth: 24, height: 24, twistDeg: 45, roofControlRise: 1.6 },
  'twisted-box-large': { width: 48, depth: 48, height: 48, twistDeg: 45, roofControlRise: 3.2 }
};

export function fixtureShell(r, name) {
  const f = fixtures[name];
  if (!f) throw new Error('Unknown benchmark fixture: ' + name);
  if (name === 'box') return boxShell(r, { xMm: f.width, yMm: f.depth, zMm: f.height });
  // A bicubic roof with a planar boundary, rotated about the footprint centre.
  // Each side is an exact ruled NURBS patch between the base and roof edge.
  // Linear interpolation of rotated corners creates a waist, not a helical extrusion.
  const source = splineTopShell(r, { runMm: f.width, widthMm: f.depth, cpU: 4, cpV: 4,
    heights: (i, j) => f.height + (i > 0 && i < 3 && j > 0 && j < 3 ? f.roofControlRise : 0) });
  const top = source.surfaces.find(s => s.name === 'top').surface.duplicate();
  const angle = f.twistDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const p = top.points().get(i, j), x = p[0] - f.width / 2, y = p[1] - f.depth / 2;
    top.points().set(i, j, [f.width / 2 + c * x - s * y, f.depth / 2 + s * x + c * y, p[2], p[3]]);
  }
  const bottom = source.surfaces.find(s => s.name === 'bottom').surface.duplicate();
  const corners = [[0, 0, 0], [f.width, 0, 0], [f.width, f.depth, 0], [0, f.depth, 0]];
  const [u0, u1] = top.domain(0), [v0, v1] = top.domain(1);
  const topEdges = [top.isoCurve(0, v0), top.isoCurve(1, u1), top.isoCurve(0, v1), top.isoCurve(1, u0)];
  const pairs = [[0, 1], [1, 2], [3, 2], [0, 3]], names = ['front', 'right', 'back', 'left'];
  const entries = [{ name: 'top', surface: top }, { name: 'bottom', surface: bottom },
    ...pairs.map(([a, b], i) => ({ name: names[i], surface: r.NurbsSurface.createRuledSurface(new r.LineCurve(corners[a], corners[b]), topEdges[i]) }))];
  const shell = assertClosed(shellFromSurfaces(r, entries, name));
  for (const e of source.surfaces) e.surface.delete();
  return shell;
}

export function disposeShell(shell) { for (const e of shell.surfaces ?? []) e.surface.delete(); }

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const blend = (p, weights) => [0, 1, 2].map(k => weights.reduce((v, w, i) => v + w * p[i][k], 0));

// Conforming uniform UV grids, doubled until a sampled correspondence error
// meets the target. This is deliberately not advertised as Rhino's mesher or
// a certified Hausdorff bound. Independent section/roof checks are also run.
export function tessellate(shell, n, divisions = 3) {
  const vertices = [], triangles = [], lookup = new Map();
  let maxErrorMm = 0;
  for (const patch of shell.patches) {
    const at = (u, v) => evaluate(patch,
      patch.domainU[0] + u * (patch.domainU[1] - patch.domainU[0]),
      patch.domainV[0] + v * (patch.domainV[1] - patch.domainV[0]), false).point;
    const grid = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
      const point = at(i / n, j / n), key = point.map(v => v.toFixed(9)).join(',');
      if (!lookup.has(key)) { lookup.set(key, vertices.length); vertices.push(point); }
      return lookup.get(key);
    }));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const ids = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      triangles.push([ids[0], ids[1], ids[2]], [ids[0], ids[2], ids[3]]);
      const p = ids.map(id => vertices[id]);
      for (let a = 0; a <= divisions; a++) for (let b = 0; b <= divisions; b++) {
        const u = a / divisions, v = b / divisions;
        const linear = u >= v ? blend([p[0], p[1], p[2]], [1 - u, u - v, v])
          : blend([p[0], p[2], p[3]], [1 - v, u, v - u]);
        maxErrorMm = Math.max(maxErrorMm, dist(at((i + u) / n, (j + v) / n), linear));
      }
    }
  }
  // Patch parameter directions need not be consistently oriented. Propagate
  // triangle orientation through shared edges, then choose positive volume.
  const edges = new Map(), adjacency = triangles.map(() => []);
  triangles.forEach((t, i) => t.forEach((a, k) => {
    const b = t[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const list = edges.get(key) ?? []; list.push({ i, d: a < b ? 1 : -1 }); edges.set(key, list);
  }));
  for (const list of edges.values()) {
    if (list.length !== 2) throw new Error('Benchmark mesh has an unmatched seam');
    const [a, b] = list; adjacency[a.i].push([b.i, -a.d * b.d]); adjacency[b.i].push([a.i, -a.d * b.d]);
  }
  const signs = Array(triangles.length).fill(0), pending = [0]; signs[0] = 1;
  while (pending.length) { const i = pending.pop(); for (const [j, sign] of adjacency[i]) {
    if (!signs[j]) { signs[j] = signs[i] * sign; pending.push(j); }
    else if (signs[j] !== signs[i] * sign) throw new Error('Nonorientable benchmark mesh');
  } }
  if (signs.some(s => !s)) throw new Error('Disconnected benchmark mesh');
  triangles.forEach((t, i) => { if (signs[i] < 0) [t[1], t[2]] = [t[2], t[1]]; });
  const volume = triangles.reduce((sum, t) => { const [a, b, c] = t.map(i => vertices[i]);
    return sum + a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]); }, 0) / 6;
  if (volume < 0) for (const t of triangles) [t[1], t[2]] = [t[2], t[1]];
  return { vertices, triangles, n, sampledMaxErrorMm: maxErrorMm, sampleDivisions: divisions };
}

export function meshAtTolerance(shell, targetMm) {
  for (let n = 1; n <= 64; n *= 2) {
    const mesh = tessellate(shell, n);
    if (mesh.sampledMaxErrorMm <= targetMm * 0.9) {
      const checked = tessellate(shell, n, 5);
      if (checked.sampledMaxErrorMm > targetMm) continue;
      makeMesh(checked.vertices, checked.triangles);
      return { ...checked, targetMm };
    }
  }
  throw new Error('Target exceeds benchmark grid/100000-triangle budget');
}

export function binarySTL(mesh) {
  const b = Buffer.alloc(84 + 50 * mesh.triangles.length);
  b.write('SAAM speed benchmark; millimeters; not a print approval'); b.writeUInt32LE(mesh.triangles.length, 80);
  mesh.triangles.forEach((t, i) => t.forEach((v, j) => mesh.vertices[v].forEach((x, k) => b.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))));
  return b;
}

export function rhino6Bytes(r, shell) {
  const doc = new r.File3dm(); doc.settings().modelUnitSystem = r.UnitSystem.Millimeters;
  for (const e of shell.surfaces) { const a = new r.ObjectAttributes(); a.name = e.name; doc.objects().add(e.surface, a); a.delete(); }
  const options = new r.File3dmWriteOptions(); options.version = 6;
  const bytes = doc.toByteArrayOptions(options); options.delete(); doc.destroy();
  if (!Buffer.from(bytes).subarray(0, 32).toString().includes('60')) throw new Error('Expected Rhino 6 archive header');
  const reopened = r.File3dm.fromByteArray(bytes);
  if (reopened.objects().count !== 6) throw new Error('Rhino 6 fixture round trip failed');
  reopened.destroy(); return bytes;
}
