// Public CLI/shared import parity, isolated from real setup and print records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { importSTLBundle } from '../print/import-stl.mjs';
import { loadBundle, proposedPlan } from '../print/bundle.mjs';
import * as wedge from '../../skills/wedge-demo/scripts/bundle.mjs';
import { defaults } from '../../skills/wedge-demo/scripts/model.mjs';
import { boxMesh } from './fixtures/mesh.mjs';
import { readGuidance } from '../../adapters/mcp/src/manuals.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), run = promisify(execFile);

test('published documentation links remain readable through the connector as owners split their references', async () => {
  const pending = ['AGENTS.md'], visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const document = await readGuidance(root, id);
    for (const match of document.text.matchAll(/\]\(([^)]+)\)/g)) {
      const [target, anchor] = match[1].split('#');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || (target && !target.endsWith('.md'))) continue;
      const path = target ? relative(root, resolve(root, dirname(document.path), decodeURIComponent(target))).replaceAll('\\', '/') : document.path;
      const expected = path + (anchor ? `#${anchor}` : '');
      assert.ok(document.links.some(link => link.guidanceId === expected), `${document.path}: unreadable documentation link ${match[1]}`);
    }
    for (const target of document.links) if (!visited.has(target.guidanceId)) pending.push(target.guidanceId);
  }
  assert.ok(visited.has('core/print/USAGE.md'));
  assert.ok(visited.has('skills/mesh-tools/SKILL.md'));
});

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
