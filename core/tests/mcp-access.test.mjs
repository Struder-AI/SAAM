// Public CLI/shared import parity, isolated from real setup and print records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { importSTLBundle } from '../print/import-stl.mjs';
import { loadBundle, proposedPlan } from '../print/bundle.mjs';
import * as wedge from '../../skills/wedge-demo/scripts/bundle.mjs';
import { defaults } from '../../skills/wedge-demo/scripts/model.mjs';
import { boxMesh } from './fixtures/mesh.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), run = promisify(execFile);
test('shared STL importer and both recipe adapters resolve the same remembered setup without recording approvals', async t => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-access-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const setupFile = resolve(scratch, 'setup.json');
  await writeFile(setupFile, JSON.stringify({ schema: 'saam-machine-setup/1', machineId: 'ultimaker-s5',
    setup: { ...defaults().setup, bedC: 67 }, source: 'SYNTHETIC TEST ONLY' }));
  assert.equal((await proposedPlan('ultimaker-s5', { setupFile })).setup.bedC, 67);
  assert.equal((await wedge.proposedPlan('ultimaker-s5', { setupFile })).setup.bedC, 67);
  const mesh = boxMesh(8, 6, 1);
  const bytes = Buffer.from('solid test\n' + mesh.triangles.map(triangle => 'facet normal 0 0 0\nouter loop\n'
    + triangle.map(i => 'vertex ' + mesh.vertices[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid test');
  const dir = resolve(scratch, 'Imported');
  await importSTLBundle(dir, bytes, { units: 'mm', machineId: 'ultimaker-s5', setupFile });
  const state = await loadBundle(dir);
  assert.equal(state.plan.setup.bedC, 67);
  assert.deepEqual(state.review.approvals, {});
  assert.deepEqual(await readFile(resolve(dir, 'geometry/source.stl')), bytes);
  await assert.rejects(importSTLBundle(resolve(scratch, 'No units'), bytes, { machineId: 'ultimaker-s5', setupFile }), /explicit mm\/inch units/);
});

test('public wedge CLI checks ungenerated geometry and rejects stale chat revisions', async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-cli-access-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const plan = defaults();
  plan.process.minimumLayerSeconds = 0;
  await wedge.initBundle(dir, plan);
  const script = resolve(root, 'skills/wedge-demo/scripts/cli.mjs');
  const checked = JSON.parse((await run(process.execPath, [script, 'check', dir])).stdout);
  assert.equal(checked.summary, null);
  const patch = resolve(dir, 'patch.json');
  await writeFile(patch, JSON.stringify({ process: { planarSpeedMmS: 23 } }));
  await assert.rejects(run(process.execPath, [script, 'adjust', dir, patch, '--revision', 'stale']), error => /stale/.test(error.stderr));
  await run(process.execPath, [script, 'adjust', dir, patch, '--revision', checked.revision]);
  const after = await wedge.loadBundle(dir);
  assert.equal(after.plan.process.planarSpeedMmS, 23);
  assert.deepEqual(after.review.approvals, {});
});
