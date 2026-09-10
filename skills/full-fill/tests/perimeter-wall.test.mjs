import test from 'node:test';
import assert from 'node:assert/strict';
import { pipeMesh } from '../../../core/geom/cylinder.mjs';
import { makeMesh } from '../../../core/geom/mesh.mjs';
import { defaults } from '../../../core/print/plan.mjs';
import { loadMachine } from '../../../core/machine/profile.mjs';
import { fullFillResult } from '../scripts/fill.mjs';
import { planarInfillResults } from '../../planar-infill/scripts/infill.mjs';
import { generatePath } from '../../../core/print/generate.mjs';
import { exportProgram, interpretProgram } from '../../../core/export/registry.mjs';

test('2 mm closed walls emit five loops and no interior in full and ordinary planar fill', () => {
  const mesh = pipeMesh({ innerRadiusMm: 10, outerRadiusMm: 12, heightMm: 0.8, toleranceMm: 0.01 });
  const shell = makeMesh(mesh.vertices.map(([x, y, z]) => [x + 100, y + 100, z]), mesh.triangles);
  for (const mode of ['full', 'sparse', 'solid-surfaces']) for (const perimeters of [2, 3, 8]) {
    const plan = defaults();
    plan.process.lineWidthMm = 0.4;
    plan.skills['full-fill'].perimeters = perimeters;
    plan.skills['planar-infill'].perimeters = perimeters;
    const results = mode === 'full' ? [fullFillResult({ shell, plan })] :
      planarInfillResults({ shell, plan, solid: mode === 'solid-surfaces' });
    const operations = results.flatMap(result => result.operations);
    for (let layer = 0; layer < 4; layer++) {
      const strokes = operations.filter(op => op.layer === layer).flatMap(op => op.strokes);
      const walls = strokes.filter(stroke => stroke.role.startsWith('perimeter'));
      assert.equal(walls.length, perimeters === 2 ? 4 : 5, `${mode}, ${perimeters} requested, layer ${layer}`);
      assert.ok(walls.every(stroke => stroke.closed));
      const fill = strokes.filter(stroke => ['fill', 'infill'].includes(stroke.role));
      if (perimeters >= 3) assert.equal(fill.length, 0);
      else assert.ok(fill.length > 0, 'a lower wall count retains interior fill');
    }
    if (perimeters === 3) for (const machineId of ['ultimaker-s5', 'bambu-h2d']) {
      const machine = loadMachine(machineId), machinePlan = defaults(machine);
      machinePlan.process.minimumLayerSeconds = 0;
      machinePlan.geometry = { shape: 'mesh', vertices: mesh.vertices, triangles: mesh.triangles, source: null };
      machinePlan.skills['draped-skin'].enabled = false;
      machinePlan.skills['full-fill'].enabled = mode !== 'sparse';
      machinePlan.skills['full-fill'].mode = mode === 'solid-surfaces' ? mode : 'body';
      machinePlan.skills['full-fill'].perimeters = perimeters;
      machinePlan.skills['planar-infill'].enabled = mode !== 'full';
      machinePlan.skills['planar-infill'].perimeters = perimeters;
      const path = generatePath(machinePlan, machine, null);
      const program = interpretProgram(exportProgram(path, machinePlan, machine,
        { generatorVersion: 'test', buildDate: '2026-09-10' }), machinePlan, machine);
      const expected = path.actions.filter(action => action.kind === 'move');
      assert.equal(program.moves.length, expected.length);
      for (let i = 0; i < expected.length; i++) {
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(program.moves[i].to[k] - expected[i].to[k]) < 6e-6);
        assert.ok(Math.abs(program.moves[i].volumeMm3 - expected[i].volumeMm3) < 1e-4);
      }
      const volume = path.actions.filter(action => action.layer === 1 && action.volumeMm3 > 0)
        .reduce((sum, action) => sum + action.volumeMm3, 0);
      assert.ok(Math.abs(volume / (Math.PI * (12 ** 2 - 10 ** 2) * 0.2) - 1) < 0.002,
        'five distinct tracks deposit the nominal wall volume once');
    }
  }
});
