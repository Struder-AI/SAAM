// Developer measurement of assembled guidance and actual registered schemas.
// This tooling may construct an isolated Runtime; ordinary Context does not.
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {readManual} from '../core/agent/manuals.mjs';
import {onboardingSources} from '../core/agent/layers.mjs';
import {SKILL_IDS,GUIDANCE_IDS,EXTENSION_IDS} from '../skills/catalog.mjs';
const STARTING=['MAKERS.md','core/print/USAGE.md'];
const skillManual=id=>`skills/${id}/SKILL.md`;

// Bytes of each layer per machine. Layers are cumulative reads, so each is the
// difference between the read that opens it and the one before.
export async function contextBudget(root, { machines = {} } = {}) {
  const machineIds=Object.keys(machines);
  const size = text => Buffer.byteLength(text, 'utf8');
  const read = async (id, context) => size((await readManual(root, id, context)).text);
  const manuals = async context => {
    let total = 0;
    for (const id of STARTING) total += await read(id, context);
    return total;
  };
  const index = await read('skills/DIGEST.md', {});
  const { instructions, createLocalRuntime } = await import('../core/application/runtime.mjs'), { homePaths } = await import('../core/application/home.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
  const home = await mkdtemp(resolve(tmpdir(), 'saam-context-budget-'));
  let tools = 0,toolSchemas=0,runtime;const operations={},toolDefinitions=[];
  try {
    const paths = homePaths(home); runtime = createLocalRuntime({ paths, stateRoot: paths.state, autoOpen: false });
    for (const operation of runtime.beginSession().operations){
      // Measure the complete application operation catalog, including its schemas.
      const inputSchema=z.toJSONSchema(operation.schema,{target:'draft-7',io:'input'});
      const definition={name:operation.name,description:operation.description,inputSchema,
        readOnly:operation.readOnly,openWorld:operation.openWorld};
      const description=size(operation.description),schema=size(JSON.stringify(inputSchema));
      operations[operation.name]={description,schema,total:size(JSON.stringify(definition))};
      toolDefinitions.push(definition);tools+=description;toolSchemas+=schema;
    }
  } finally { await runtime?.close(); await rm(home, { recursive: true, force: true }); }
  const operate = await manuals({});
  const onboardingJson = size(JSON.stringify(await onboardingSources(root, {})));
  const advanced = {};
  for (const machineId of machineIds) {
    const extra = await manuals({ machine:machines[machineId] }) - operate;
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
      const extra = await read(path, { machine:machines[machineId] }) - operateSkill;
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
