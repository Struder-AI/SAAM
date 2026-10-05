// Shared import, checks and manual reading, isolated from real setup and print records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { importSTLBundle } from '../print/import-stl.mjs';
import { initBundle, loadBundle, proposedPlan, adjustBundle } from '../print/bundle.mjs';
import { defaults as shellDefaults } from '../print/plan.mjs';
import { boxMesh } from './fixtures/mesh.mjs';
import { readGuidance } from '../agent/manuals.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

test('manual sections preserve duplicate heading identities and reject private or redirected paths', async t => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-manuals-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await mkdir(resolve(scratch, 'core/ref'), { recursive: true });
  await mkdir(resolve(scratch, 'outside'));
  const markdown = '# Manual\n## Contract\nFirst.\n```md\n## Contract\n```\n## Contract\nSecond.\n### Detail\nKept.\n## Next\nExcluded.\n';
  await writeFile(resolve(scratch, 'core/ref/README.md'), markdown);
  const second = await readGuidance(scratch, 'core/ref/README.md#contract-1');
  assert.equal(second.text, '## Contract\nSecond.\n### Detail\nKept.\n');
  assert.equal(second.headings.filter(heading => heading.title === 'Contract').length, 2);
  await writeFile(resolve(scratch, 'core/ref/links.md'),
    '# Links\n[Local](README.md#contract-1) [Parent](../ref/README.md#next)\n'
    + '[Private](../../.local/private.md) [Remote](https://example.com/manual.md)\n');
  const linked = await readGuidance(scratch, 'core/ref/links.md');
  assert.deepEqual(linked.links.map(link => link.guidanceId),
    ['core/ref/README.md#contract-1', 'core/ref/README.md#next']);
  assert.equal((await readGuidance(scratch, linked.links[0].guidanceId)).text, second.text);
  await assert.rejects(readGuidance(scratch, 'core/ref/README.md#absent'), /Unknown heading/);
  for (const path of ['../MAKERS.md', 'core/../MAKERS.md', 'core/%2e%2e/MAKERS.md', '/MAKERS.md',
    'C:/MAKERS.md', '.local/private.md', 'Prints/private.md', 'core/.private/secret.md',
    'core/Prints/secret.md', 'core/node_modules/README.md', 'core/ref/source.mjs', 'private.md',
    'core/CON.md', 'core/LPT1/README.md', 'core/ref./README.md', 'core/ref /README.md',
    'core/r?f/README.md', 'core/r*f/README.md', 'core/r<f/README.md', 'core/r|f/README.md'])
    await assert.rejects(readGuidance(scratch, path), /Invalid documentation path/);
  await writeFile(resolve(scratch, 'outside/README.md'), 'Private fixture');
  await symlink(resolve(scratch, 'outside'), resolve(scratch, 'core/redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readGuidance(scratch, 'core/redirect/README.md'), /symbolic links|junctions/);
  await link(resolve(scratch, 'outside/README.md'), resolve(scratch, 'core/ref/hardlink.md'));
  await assert.rejects(readGuidance(scratch, 'core/ref/hardlink.md'), /hard-linked/);
});

test('shared STL importer and both recipe adapters resolve the same remembered setup without recording approvals', async t => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-access-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const setupFile = resolve(scratch, 'setup.json');
  await writeFile(setupFile, JSON.stringify({ schema: 'saam-machine-setup/1', machineId: 'ultimaker-s5',
    setup: { ...shellDefaults().setup, bedC: 67 }, source: 'SYNTHETIC TEST ONLY' }));
  assert.equal((await proposedPlan('ultimaker-s5', { setupFile })).setup.bedC, 67);
  const mesh = boxMesh(8, 6, 1);
  const bytes = Buffer.from('solid test\n' + mesh.triangles.map(triangle => 'facet normal 0 0 0\nouter loop\n'
    + triangle.map(i => 'vertex ' + mesh.vertices[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid test');
  const dir = resolve(scratch, 'Imported');
  await importSTLBundle(dir, bytes, { units: 'mm', machineId: 'ultimaker-s5', setupFile });
  const state = await loadBundle(dir);
  assert.equal(state.plan.setup.bedC, 67);
  assert.deepEqual(state.review.approvals, {});
  assert.deepEqual(await readFile(resolve(dir, 'geometry/source.stl')), bytes);
  const inferred = resolve(scratch, 'Automatic units');
  await importSTLBundle(inferred, bytes, { machineId: 'ultimaker-s5', setupFile });
  assert.equal((await loadBundle(inferred)).plan.geometry.source.unitsInferred, true);
});

test('checks report ungenerated geometry and edits reject stale chat revisions', async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-cli-access-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const plan = shellDefaults();
  plan.geometry = splineBox({runMm:12,widthMm:10,heightMm:1});
  plan.process.minimumLayerSeconds = 0;
  await initBundle(dir, plan);
  const checked = await loadBundle(dir);
  assert.equal(checked.program ?? null, null);
  const patch = { process: { planarSpeedMmS: 23 } };
  await assert.rejects(adjustBundle(dir, patch, { expectedRevision: 'stale' }), /stale/);
  await adjustBundle(dir, patch, { expectedRevision: checked.revision });
  const after = await loadBundle(dir);
  assert.equal(after.plan.process.planarSpeedMmS, 23);
  assert.deepEqual(after.review.approvals, {});
});
