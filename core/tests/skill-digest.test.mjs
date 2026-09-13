import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SKILL_IDS } from '../../skills/catalog.mjs';
import { updatedSkillIndex, checkSkillDigest } from '../../scripts/skill-digest.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'saam-skill-digest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of SKILL_IDS) {
    await mkdir(resolve(root, 'skills', id), { recursive: true });
    await writeFile(resolve(root, 'skills', id, 'SKILL.md'), `---\nname: ${id}\ndescription: Capability of ${id}.\n---\n`);
  }
  await writeFile(resolve(root, 'skills/README.md'), 'Introduction\r\n<!-- BEGIN GENERATED SKILL DIGEST -->\r\n<!-- END GENERATED SKILL DIGEST -->\r\nClosing guidance\r\n');
  return root;
}

test('digest detects changed descriptions and refreshes without altering surrounding guidance', async t => {
  const root = await fixture(t);
  const index = resolve(root, 'skills/README.md');
  await assert.rejects(checkSkillDigest(root), /stale/);
  await writeFile(index, await updatedSkillIndex(root));
  await checkSkillDigest(root);
  const manual = resolve(root, 'skills', SKILL_IDS[0], 'SKILL.md');
  await writeFile(manual, (await readFile(manual, 'utf8')).replace(`Capability of ${SKILL_IDS[0]}.`, 'A new useful capability.'));
  await assert.rejects(checkSkillDigest(root), /stale/);
  const refreshed = await updatedSkillIndex(root);
  assert.match(refreshed, /A new useful capability\./);
  assert.ok(refreshed.startsWith('Introduction\r\n'));
  assert.ok(refreshed.endsWith('Closing guidance\r\n'));
  assert.ok(!/(?<!\r)\n/.test(refreshed));
  await writeFile(index, refreshed);
  await checkSkillDigest(root);
  assert.equal(await updatedSkillIndex(root), refreshed);
});

test('digest detects missing and unlisted manuals instead of silently hiding capabilities', async t => {
  const root = await fixture(t);
  const path = resolve(root, 'skills', SKILL_IDS[0], 'SKILL.md');
  const manual = await readFile(path, 'utf8');
  await rm(path);
  await assert.rejects(updatedSkillIndex(root), /missing: planar-infill/);
  await writeFile(path, manual);
  await mkdir(resolve(root, 'skills/new-capability'));
  await writeFile(resolve(root, 'skills/new-capability/SKILL.md'), manual);
  await assert.rejects(updatedSkillIndex(root), /unlisted: new-capability/);
});

test('manual classification selects the digest section and table separators remain text', async t => {
  const root = await fixture(t);
  await writeFile(resolve(root, 'skills', SKILL_IDS[0], 'SKILL.md'), '---\nname: planar-infill\ndescription: Diagnose A | B.\nmetadata:\n  saam-kind: task\n---\n');
  const updated = await updatedSkillIndex(root);
  const [printing, tasks] = updated.split('## Geometry processing');
  assert.ok(!printing.includes('[planar-infill]'));
  assert.ok(tasks.includes('[planar-infill]'));
  assert.ok(tasks.includes('Diagnose A &#124; B.'));
});
