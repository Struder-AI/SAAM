import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const imported = [
  'dobot-dog-ears',
  'dobot-layer-filling',
  'dobot-non-planar-cladding',
  'dobot-patterned-wall',
  'dobot-prime-lead-in',
  'dobot-programmer',
  'dobot-reference-to-print',
  'dobot-spiral-lip',
  'multiaxis-cross-layer-cylinder-cladding',
  'multiaxis-diagonal-rib-growth'
];

test('all recovered StruderBot manuals remain present and explicitly imported', async () => {
  for (const name of imported) {
    const manual = await readFile(join('skills', name, 'SKILL.md'), 'utf8');
    assert.match(manual, /^---\r?\nname: /);
    assert.match(manual, /> \*\*Imported (?:legacy|preview-only)/);
  }
});

test('migration manifest names every recovered manual', async () => {
  const manifest = await readFile('skills/STRUDERBOT_SKILL_MIGRATION.md', 'utf8');
  for (const name of imported) assert.match(manifest, new RegExp(`\\b${name}\\b`));
});
