import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_IDS, skillMetadata } from '../skills/catalog.mjs';

const start = '<!-- BEGIN GENERATED SKILL DIGEST -->';
const end = '<!-- END GENERATED SKILL DIGEST -->';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function updatedSkillIndex(repoRoot) {
  const skillsRoot = resolve(repoRoot, 'skills');
  const available = [];
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(resolve(skillsRoot, entry.name, 'SKILL.md'), 'utf8');
      available.push(entry.name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const missing = SKILL_IDS.filter(id => !available.includes(id));
  const unlisted = available.filter(id => !SKILL_IDS.includes(id));
  if (missing.length || unlisted.length || new Set(SKILL_IDS).size !== SKILL_IDS.length) {
    throw new Error(`Skill catalog differs from manuals (missing: ${missing.join(', ') || 'none'}; unlisted: ${unlisted.join(', ') || 'none'}). Update skills/catalog.mjs alongside the manuals.`);
  }
  const skills = await Promise.all(SKILL_IDS.map(async id => {
    const skill = skillMetadata(id, await readFile(resolve(skillsRoot, id, 'SKILL.md'), 'utf8'));
    if (!skill.description || /^[>|]/.test(skill.description)) {
      throw new Error(`${id}: the shared catalog reader needs a single-line frontmatter description.`);
    }
    return skill;
  }));
  const table = kind => [
    '| Skill | Use |', '|---|---|',
    ...skills.filter(skill => skill.kind === kind).map(skill =>
      `| [${skill.id}](${skill.id}/SKILL.md) | ${skill.description.replaceAll('|', '&#124;')} |`)
  ].join('\n');
  const block = `${start}\n\n## Toolpath skills\n\n${table('toolpath')}\n\n## Geometry skills\n\n${table('geometry')}\n\n${end}`;
  const current = await readFile(resolve(skillsRoot, 'DIGEST.md'), 'utf8');
  if (current.split(start).length !== 2 || current.split(end).length !== 2 || current.indexOf(end) < current.indexOf(start)) {
    throw new Error('skills/DIGEST.md needs exactly one ordered pair of generated skill digest markers.');
  }
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  return current.slice(0, current.indexOf(start)) + block.replaceAll('\n', eol) + current.slice(current.indexOf(end) + end.length);
}

export async function checkSkillDigest(repoRoot) {
  const expected = await updatedSkillIndex(repoRoot);
  if (expected !== await readFile(resolve(repoRoot, 'skills/DIGEST.md'), 'utf8')) {
    throw new Error('skills/DIGEST.md capability digest is stale. Run node scripts/skill-digest.mjs to refresh it from the skill descriptions.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(resolve(root, 'skills/DIGEST.md'), await updatedSkillIndex(root));
  console.log('Updated the capability digest in skills/DIGEST.md.');
}
