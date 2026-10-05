// Context layers: which manuals an agent starts with, the index of gated sections, the hint a
// machine change carries, and the size of each layer per client and machine.
// The markers and their assembly are owned by manuals.mjs.
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gatedSections, readManual, machineOpens } from './manuals.mjs';
import { SKILL_IDS, GUIDANCE_IDS, EXTENSION_IDS } from '../../skills/catalog.mjs';
import { MACHINE_IDS } from '../machine/profile.mjs';
import {listExtensions} from '../extensions/library.mjs';
import {z} from 'zod';

// The maker's starting context, for both clients: the index (the digest) and the maker flow and
// print tools, plus their script sections for a script client. GEOMETRY.md, like a skill manual,
// is read by section when a form is written; MAKERS.md indexes its forms.
export const MAKER_MANUALS = ['MAKERS.md', 'GEOMETRY.md', 'core/print/USAGE.md'];
const STARTING = ['MAKERS.md', 'core/print/USAGE.md'];
export const ONBOARDING = ['MAKERS.md', 'skills/DIGEST.md', 'core/print/USAGE.md'];
const skillManual = id => `skills/${id}/SKILL.md`;

// Selected workspaces are discoverable whether bundled or imported; skill
// extensions already in the digest only need a note for local overrides.
export async function extensionDiscovery(root,{readTool,openTool}){
  const selected=(await listExtensions({appRoot:root})).filter(item=>item.origin==='local'||item.manifest.kind==='workspace');
  if(!selected.length)return null;
  return {guidanceId:'extensions',path:'extensions',
    text:'Selected extensions: '+selected.map(item=>item.id+' ('+(item.manifest.kind==='workspace'?'workspace':'skill')+', '+item.origin+')').join(', ')+'. Read each manual by ID with '+readTool+'. Open a workspace by extension ID with '+openTool+'; its new bundles return to Studio for review.'};
}

export async function onboardingSources(root, context) {
  const documents=await Promise.all(ONBOARDING.map(async id => {
    const { guidanceId, path, text } = await readManual(root, id, context);
    return { guidanceId, path, text };
  }));
  const discovery=await extensionDiscovery(root,{readTool:'read_skill',openTool:'open_workspace'});
  if(discovery)documents.push(discovery);
  return documents;
}

// A skill section is named `ID#heading` (read_skill takes it); any other `PATH#heading`.
export const sectionName = guidanceId => guidanceId.replace(/^skills\/([^/]+)\/SKILL\.md#/, '$1#');

// Every gated section of the maker manuals and skill manuals, in catalog order.
export async function gatedIndex(root, ids = [...MAKER_MANUALS, ...[...SKILL_IDS,...GUIDANCE_IDS,...EXTENSION_IDS].map(skillManual)]) {
  const lists = await Promise.all(ids.map(async path => gatedSections(await readFile(resolve(root, path), 'utf8'), path)));
  return lists.flat();
}
export const indexLine = section => `- ${section.title}: ${section.gate}; ${sectionName(section.guidanceId)}`;

// Capabilities select available guidance independently of any print recipe.
export async function machineHint(root, { from = null, to }) {
  if(!to)return null;
  const opensNow = machineOpens(to), opensBefore = machineOpens(from);
  const sections = (await gatedIndex(root))
    .filter(section => section.requires.some(opensNow) && !section.requires.some(opensBefore));
  return sections.length ? `This printer opens ${sections.map(section => `"${section.title}" (${sectionName(section.guidanceId)})`)
    .join(', ')}: read ${sections.length > 1 ? 'them' : 'it'} by name when the print uses ${sections.length > 1 ? 'them' : 'it'}.` : null;
}

// Bytes of each layer per machine. Layers are cumulative reads, so each is the
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
  const { instructions, createLocalRuntime } = await import('../application/runtime.mjs'), { homePaths } = await import('../application/home.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
  const home = await mkdtemp(resolve(tmpdir(), 'saam-context-budget-'));
  let tools = 0,toolSchemas=0;const operations={},toolDefinitions=[];
  try {
    const runtime = createLocalRuntime({ paths: homePaths(home), autoOpen: false });
    for (const operation of runtime.beginSession().operations){
      // Measure the complete application operation catalog, including its schemas.
      const inputSchema=z.toJSONSchema(operation.schema,{target:'draft-7',io:'input'});
      const definition={name:operation.name,description:operation.description,inputSchema,
        readOnly:operation.readOnly,openWorld:operation.openWorld};
      const description=size(operation.description),schema=size(JSON.stringify(inputSchema));
      operations[operation.name]={description,schema,total:size(JSON.stringify(definition))};
      toolDefinitions.push(definition);tools+=description;toolSchemas+=schema;
    }
    await runtime.close();
  } finally { await rm(home, { recursive: true, force: true }); }
  const operate = await manuals({});
  const onboardingJson = size(JSON.stringify(await onboardingSources(root, {})));
  const advanced = {};
  for (const machineId of machineIds) {
    const extra = await manuals({ machineId }) - operate;
    if (extra) advanced[machineId] = extra;
  }
  const skills = {};
  for (const [id, path] of [['GEOMETRY.md', 'GEOMETRY.md'], ...[...SKILL_IDS,...GUIDANCE_IDS,...EXTENSION_IDS].map(id => [id, skillManual(id)])]) {
    const operateSkill = await read(path, {});
    const row = { operate: operateSkill, all: await read(path, { all: true }) };
    for (const file of ['BUILDER.md', 'DEVELOPER.md']) {
      try { await access(resolve(root, 'skills', id, file)); row.builder = (row.builder ?? 0) + await read(`skills/${id}/${file}`, { all: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const machineId of machineIds) {
      const extra = await read(path, { machineId }) - operateSkill;
      if (extra) (row.advanced ??= {})[machineId] = extra;
    }
    skills[id] = row;
  }
  const serializedToolsBytes=size(JSON.stringify({tools:toolDefinitions}));
  const firstUseBytes=onboardingJson+size(instructions)+serializedToolsBytes;
  return {
    unit: 'bytes of assembled UTF-8 text; onboardingJson is the serialized onboarding sources',
    reader: { index, operate, indexPlusOperate: index + operate, onboardingJson, applicationInstructions: size(instructions), toolDescriptions: tools,toolSchemas,
      serializedToolsBytes,firstUseBytes,firstSliceUseBytes:firstUseBytes+skills.slice.operate,
      measurement:'Application operation catalog (draft-7 input schemas), instructions and onboarding; excludes chat-specific guidance.',
      sliceAndModulateBytes:operations.slice.total+operations.modulate.total,
      target:{bytes:15000,mode:'soft; no capability omission'},operations },
    advancedByMachine: advanced, manualsOnDemand: skills,
    onDemandTotals: Object.values(skills).reduce((sum, row) => ({ operate: sum.operate + row.operate,
      all: sum.all + row.all, builder: sum.builder + (row.builder ?? 0) }), { operate: 0, all: 0, builder: 0 })
  };
}
