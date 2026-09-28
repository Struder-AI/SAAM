// Context layers: which manuals an agent starts with, the index of gated sections, the hint a
// machine change carries, and the size of each layer per client and machine.
// The markers and their assembly are owned by manuals.mjs.
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gatedSections, readManual, machineOpens } from './manuals.mjs';
import { SKILL_IDS } from '../../skills/catalog.mjs';
import { MACHINE_IDS } from '../machine/profile.mjs';

// The maker's starting context, for both clients: the index (the digest) and the maker flow and
// print tools, plus their script sections for a script client. GEOMETRY.md, like a skill manual,
// is read by section when a form is written; MAKERS.md indexes its forms.
export const MAKER_MANUALS = ['MAKERS.md', 'GEOMETRY.md', 'core/print/USAGE.md'];
const STARTING = ['MAKERS.md', 'core/print/USAGE.md'];
export const ONBOARDING = ['MAKERS.md', 'skills/DIGEST.md', 'core/print/USAGE.md'];
const skillManual = id => `skills/${id}/SKILL.md`;

export async function onboardingSources(root, context) {
  return Promise.all(ONBOARDING.map(async id => {
    const { guidanceId, path, text } = await readManual(root, id, context);
    return { guidanceId, path, text };
  }));
}

// A skill section is named `ID#heading` (read_skill takes it); any other `PATH#heading`.
export const sectionName = guidanceId => guidanceId.replace(/^skills\/([^/]+)\/SKILL\.md#/, '$1#');

// Every gated section of the maker manuals and skill manuals, in catalog order.
export async function gatedIndex(root, ids = [...MAKER_MANUALS, ...SKILL_IDS.map(skillManual)]) {
  const lists = await Promise.all(ids.map(async path => gatedSections(await readFile(resolve(root, path), 'utf8'), path)));
  return lists.flat();
}
export const indexLine = section => `- ${section.title}: ${section.gate}; ${sectionName(section.guidanceId)}`;

// One line naming the sections a machine opens that the previous one (none for a new print) did
// not, among the maker manuals and the print's skills; null when there are none.
export async function machineHint(root, { from, to, skills = [] }) {
  const opensNow = machineOpens(to), opensBefore = machineOpens(from);
  const sections = (await gatedIndex(root, [...MAKER_MANUALS, ...skills.filter(id => SKILL_IDS.includes(id)).map(skillManual)]))
    .filter(section => section.requires.some(opensNow) && !section.requires.some(opensBefore));
  return sections.length ? `This printer opens ${sections.map(section => `"${section.title}" (${sectionName(section.guidanceId)})`)
    .join(', ')}: read ${sections.length > 1 ? 'them' : 'it'} by name when the print uses ${sections.length > 1 ? 'them' : 'it'}.` : null;
}

// The hint for a print state: its toolpath skills and the geometry skill that made its shape.
const geometrySkills = { text: 'text', gridfinity: 'gridfinity', 'heat-set': 'heat-set-inserts' };
export const printHint = (root, state, from) => machineHint(root, { from, to: state.machine.id,
  skills: [...state.skills ?? [], geometrySkills[state.plan?.geometry?.shape]].filter(Boolean) });

// Bytes of each layer per client and machine. Layers are cumulative reads, so each is the
// difference between the read that opens it and the one before.
export async function contextBudget(root, { machineIds = MACHINE_IDS } = {}) {
  const size = text => Buffer.byteLength(text, 'utf8');
  const read = async (id, context) => size((await readManual(root, id, context)).text);
  const manuals = async context => {
    let total = 0;
    for (const id of STARTING) total += await read(id, context);
    return total;
  };
  const index = await read('skills/DIGEST.md', {});
  const { instructions, createLocalRuntime } = await import('../../adapters/mcp/src/runtime.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
  const printsRoot = await mkdtemp(resolve(tmpdir(), 'saam-context-budget-'));
  let tools = 0;
  try {
    const runtime = createLocalRuntime({ printsRoot, autoOpen: false });
    for (const operation of runtime.operations) tools += size(operation.description);
    await runtime.close();
  } finally { await rm(printsRoot, { recursive: true, force: true }); }
  const operate = await manuals({ client: 'web' }), script = await manuals({ client: 'script' }) - operate;
  const web = { index, operate, onboardingJson: size(JSON.stringify(await onboardingSources(root, { client: 'web' }))) };
  const scriptClient = { index, operate, script, onboardingJson: size(JSON.stringify(await onboardingSources(root, { client: 'script' }))) };
  const advanced = {};
  for (const machineId of machineIds) {
    const extra = await manuals({ client: 'script', machineId }) - operate - script;
    if (extra) advanced[machineId] = extra;
  }
  const skills = {};
  for (const [id, path] of [['GEOMETRY.md', 'GEOMETRY.md'], ...SKILL_IDS.map(id => [id, skillManual(id)])]) {
    const operateSkill = await read(path, { client: 'web' });
    const row = { operate: operateSkill, script: await read(path, { client: 'script' }) - operateSkill,
      all: await read(path, { all: true, client: 'script' }) };
    for (const file of ['BUILDER.md', 'DEVELOPER.md']) {
      try { await access(resolve(root, 'skills', id, file)); row.builder = (row.builder ?? 0) + await read(`skills/${id}/${file}`, { all: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const machineId of machineIds) {
      const extra = await read(path, { client: 'script', machineId }) - operateSkill - row.script;
      if (extra) (row.advanced ??= {})[machineId] = extra;
    }
    skills[id] = row;
  }
  return {
    unit: 'bytes of assembled UTF-8 text; onboardingJson is the serialized onboarding sources',
    clients: { web: { ...web, indexPlusOperate: index + operate, mcpInstructions: size(instructions), toolDescriptions: tools },
      script: { ...scriptClient, indexPlusOperatePlusScript: index + operate + script } },
    advancedByMachine: advanced, manualsOnDemand: skills,
    onDemandTotals: Object.values(skills).reduce((sum, row) => ({ operate: sum.operate + row.operate, script: sum.script + row.script,
      all: sum.all + row.all, builder: sum.builder + (row.builder ?? 0) }), { operate: 0, script: 0, all: 0, builder: 0 })
  };
}
