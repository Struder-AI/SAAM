import test from 'node:test';
import assert from 'node:assert/strict';
import rhino3dm from 'rhino3dm';
import { fixtureShell, disposeShell, meshAtTolerance, binarySTL, rhino6Bytes } from '../../scripts/bench/fixtures.mjs';
import { sectionGeometry, topAt } from '../geom/query.mjs';
import { signedArea } from '../geom/shell.mjs';
import { makeMesh, parseSTL } from '../geom/mesh.mjs';

const r = await rhino3dm();
test('twisted speed fixture matches analytic waist, roof and Rhino 6 exchange geometry', () => {
  const shell = fixtureShell(r, 'twisted-box');
  try {
    for (const t of [0.13, 0.5, 0.87]) {
      const loops = sectionGeometry(shell, 24 * t).loops;
      const area = loops.reduce((sum, loop) => sum + signedArea(loop), 0);
      const expected = 24 ** 2 * ((1 - t) ** 2 + t ** 2 + 2 * t * (1 - t) * Math.cos(Math.PI / 4));
      assert.equal(loops.length, 1);
      assert.ok(Math.abs(area - expected) < 1e-5);
    }
    assert.ok(Math.abs(topAt(shell, 12, 12).zMm - 24.9) < 1e-6);
    const bytes = rhino6Bytes(r, shell), doc = r.File3dm.fromByteArray(bytes);
    assert.equal(doc.objects().count, 6);
    for (const e of shell.surfaces) {
      const saved = Array.from({ length: 6 }, (_, i) => doc.objects().get(i)).find(o => o.attributes().name === e.name).geometry();
      for (const u of [0.17, 0.51, 0.83]) for (const v of [0.23, 0.67]) {
        const du = e.surface.domain(0), dv = e.surface.domain(1), a = du[0] + u * (du[1] - du[0]), b = dv[0] + v * (dv[1] - dv[0]);
        assert.deepEqual(saved.pointAt(a, b), e.surface.pointAt(a, b));
      }
    }
    doc.destroy();
  } finally { disposeShell(shell); }
});

test('matched benchmark meshes converge and exact STL imports retain closed topology', () => {
  const shell = fixtureShell(r, 'twisted-box');
  try {
    let last = Infinity;
    for (const target of [0.1, 0.025, 0.005]) {
      const m = meshAtTolerance(shell, target);
      assert.ok(m.sampledMaxErrorMm <= target && m.sampledMaxErrorMm < last); last = m.sampledMaxErrorMm;
      const parsed = parseSTL(binarySTL(m), { units: 'mm' }), mesh = makeMesh(parsed.vertices, parsed.triangles);
      for (const z of [0.137, 12.031, 23.89, 24.31]) assert.equal(sectionGeometry(mesh, z).loops.length, 1);
      assert.ok(Math.abs(topAt(mesh, 12, 12).zMm - 24.9) < target);
    }
  } finally { disposeShell(shell); }
});
