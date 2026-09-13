#!/usr/bin/env node
// MCP is a transport over the same bundle lifecycle and Studio used by the CLI.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mkdir, readdir, readFile, lstat, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MACHINE_IDS, loadMachine } from '../../../core/machine/profile.mjs';
import {MATERIAL_PROFILES} from '../../../core/material/profile.mjs';
import { bundleFor, createStudio, listPrints } from '../../../studio/server.mjs';
import { importSTLBundle } from '../../../core/print/import-stl.mjs';
import {createGridfinityBundle,updateGridfinityBundle} from '../../../skills/gridfinity/scripts/bundle.mjs';
import { applyText } from '../../../core/print/text.mjs';
import {createVoxelBundle,updateVoxelBundle} from '../../../core/print/voxel.mjs';
import {loadLocalExtension} from '../../../core/local-extension.mjs';
import { readGuidance } from './manuals.mjs';
import { SKILL_IDS, skillMetadata } from '../../../skills/catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const installedExtension=await loadLocalExtension(root);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).refine(id => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id), 'Reserved filename.');
// Human file/folder names and Studio's three-level library are supported.
// Separators are canonical forward slashes; every ancestor is checked below.
const printIdSchema = z.string().min(1).max(384).refine(id => {
  const parts = id.split('/');
  return parts.length <= 3 && parts.every(part => part.length > 0 && part.length <= 128
    && !/^[.]|[. ]$|[\\:*?"<>|\x00-\x1f]/.test(part)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}, 'Invalid print name: use up to three relative folder names, without traversal, reserved names or Windows path characters.');
const kindSchema = z.enum(['shell', 'wedge']);
const objectSchema = z.record(z.string(), z.unknown());
const bundles = {
  shell: () => import('../../../core/print/bundle.mjs'),
  wedge: () => import('../../../skills/wedge-demo/scripts/bundle.mjs')
};
const recipes = {
  shell: () => import('../../../core/print/plan.mjs'),
  wedge: () => import('../../../skills/wedge-demo/scripts/model.mjs')
};

function noApprovalFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/approval|approved|^review$|^actor$|^generation$|^history$|^__proto__$|^constructor$|^prototype$/i.test(key))
      throw new Error(`Field ${key} is not an agent-editable recipe setting. Human approvals belong in Studio.`);
    noApprovalFields(child);
  }
}

// Reject links throughout a bundle, including output folders and atomic-write
// temporary files. A lexical ID alone would not constrain symlink/junction writes.
async function rejectLinks(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not supported in MCP print bundles.');
  if (info.isFile() && info.nlink > 1) throw new Error('Hard-linked files are not supported in MCP print bundles.');
  if (info.isDirectory()) for (const entry of await readdir(path)) await rejectLinks(resolve(path, entry));
}

function summary(printId, state) {
  return {
    printId, kind: state.kind, revision: state.revision,
    machineId: state.machine.id, output: state.plan.output, skills: state.skills,
    approvals: { geometry: state.geometryApproved, plan: state.planApproved, toolpath: state.toolpathApproved },
    generation: state.review.generation ? { mode: state.review.generation.mode, current: !!state.program && !state.programError } : null,
    programError: state.programError ?? null, exportHash: state.exportHash ?? null,
    outputAvailability: state.outputAvailability, limitations: state.limitations,
    nextStep: !state.geometryApproved ? 'Review geometry in Studio.' : !state.planApproved ? 'Review the locked settings in Studio.'
      : !state.program || state.programError ? 'Generate the approved plan.' : !state.toolpathApproved ? 'Review the exact exported toolpath in Studio.' : 'Deliver the reviewed export.'
  };
}

export async function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise(resolveOpen => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolveOpen(false));
      child.once('spawn', () => { child.unref(); resolveOpen(true); });
    } catch { resolveOpen(false); }
  });
}

export function createMcpAdapter({ printsRoot = resolve(root, 'Prints'), autoOpen = process.env.SAAM_NO_AUTO_OPEN !== '1',localExtension=installedExtension } = {}) {
  const libraryRoot = resolve(printsRoot);
  const studioSessions = new Map();
  let queue = Promise.resolve();
  const server = new McpServer({ name: 'saam', version: '0.2.0' }, {
    instructions: 'Start with read_guidance using guidanceId "makers", then the skill for the requested task. Follow relevant documentation links through read_guidance using their repository-relative path and optional #heading. Shared print-tool usage is available as "print-tools". Create an unapproved print and request_review for the first geometry. Revisions happen through chat using adjust_print and expectedRevision. Only the human approves geometry, locked settings and the exact toolpath in Studio. generate_print uses the approved plan; deliver_print copies the reviewed bytes. No tool approves or runs hardware.'
  });

  async function directory(printId, { create = false } = {}) {
    printIdSchema.parse(printId);
    if (create) await mkdir(libraryRoot, { recursive: true });
    const base = await realpath(libraryRoot), dir = resolve(base, printId);
    const rel = relative(base, dir);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Print must remain inside the configured Prints root.');
    let ancestor = base;
    for (const segment of printId.split('/')) {
      ancestor = resolve(ancestor, segment);
      try {
        const info = await lstat(ancestor);
        if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not supported in MCP print paths.');
        if (!info.isDirectory()) throw new Error('Every print path component must be a directory.');
      } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
    }
    try {
      await rejectLinks(dir);
      if (create) throw new Error('Print already exists. Choose a new printId or reopen it.');
    } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
    return dir;
  }
  async function setupFile(machineId) {
    loadMachine(machineId);
    const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const folder = samePath(libraryRoot, resolve(root, 'Prints'))
      ? resolve(root, '.local', 'machine-setups') : resolve(libraryRoot, '.machine-setups');
    // The default uses the same known setup store as the CLI. Check its parent
    // too, so a redirected .local directory cannot redirect these writes.
    const parent = dirname(folder);
    try {
      if ((await lstat(parent)).isSymbolicLink()) throw new Error('The machine setup parent cannot be a symbolic link or junction.');
      await rejectLinks(folder);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return resolve(folder, machineId + '.json');
  }
  async function read(printId) {
    const dir = await directory(printId), bundle = await bundleFor(dir);
    return { dir, bundle, state: await bundle.loadBundle(dir) };
  }
  async function skills() {
    const found = [];
    for (const id of SKILL_IDS) {
      try {
        const { text: manual } = await readGuidance(root, `skills/${id}/SKILL.md`);
        found.push({ ...skillMetadata(id, manual), manualTool: 'read_skill' });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    found.push(...await localExtension.skills?.()??[]);
    return found.sort((a, b) => a.id.localeCompare(b.id));
  }
  function tool(name, description, shape, action, readOnly = true) {
    // Passing the full strict schema makes unexpected top-level approval data an
    // error instead of letting Zod silently discard it.
    server.registerTool(name, { description, inputSchema: z.object(shape).strict(),
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } }, async args => {
      const run = queue.then(async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await action(args)) }] }; }
        catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    });
  }

  tool('list_machines', 'List installed machine profiles and declared outputs. Catalog presence is not proof that a particular recipe is supported.', {}, async () => MACHINE_IDS.map(id => {
    const m = loadMachine(id);
    return { id, name: m.name, capabilities: m.capabilities, tools: m.tools, materials: MATERIAL_PROFILES,
      outputs: m.outputs.map(({ id, extension, flavor, implemented, experimental, constraints, reason }) => ({ id, extension, flavor, implemented: implemented !== false, experimental, constraints, reason })),
      defaultSetup: m.defaultSetup };
  }));
  tool('list_skills', 'List the known local printing and task skill manuals. This fixed list does not establish recipe compatibility; task skills are not deposition operations. Select the manual relevant to the requested task.', {}, skills);
  tool('read_skill', 'Read a known skill manual by ID. Follow its relevant documentation links with read_guidance.', { skillId: idSchema }, async ({ skillId }) => {
    if (!(await skills()).some(skill => skill.id === skillId)) throw new Error('Unknown skill ID. Use list_skills.');
    const local=await localExtension.readSkill?.(skillId);if(local)return local;
    const { text: manual, ...reference } = await readGuidance(root, `skills/${skillId}/SKILL.md`);
    return { skillId, manual, ...reference };
  });
  tool('read_guidance', 'Read published repository Markdown by relative path, optionally with #heading for one section. Results include resolved documentation links and headings. Short IDs: makers, development, glossary, mcp, print-tools. This reader does not expose private files, source code or register capabilities.',
    { guidanceId: z.string().min(1).max(1024) }, async ({ guidanceId }) => readGuidance(root, guidanceId));
  tool('get_plan_template', 'Get the current complete proposed recipe for a bundle kind and machine, including remembered setup when available. Defaults and remembered setup never confer job approval.',
    { kind: kindSchema, machineId: z.string() }, async ({ kind, machineId }) => ({ kind, machineId,
      plan: await (await bundles[kind]()).proposedPlan(machineId, { setupFile: await setupFile(machineId) }) }));
  tool('list_prints', 'List persisted named bundles in this configured Prints root. No session or single current plan is assumed.', {}, async () => {
    const result = [];
    let base;
    try { base = await realpath(libraryRoot); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    for (const entry of await listPrints(base)) {
      const printId = relative(base, entry.path).replaceAll('\\', '/');
      if (!printIdSchema.safeParse(printId).success) continue;
      try { const { state } = await read(printId); result.push(summary(printId, state)); }
      catch (error) { result.push({ printId, error: error.message }); }
    }
    return result;
  });
  tool('get_print', 'Read fresh validated status and recipe settings. Geometry is omitted by default and planComplete is false; set includeGeometry to obtain the complete editable recipe. SAAMpath and program arrays are always omitted.', { printId: printIdSchema, includeGeometry: z.boolean().optional() }, async ({ printId, includeGeometry = false }) => {
    const { state } = await read(printId);
    const plan = structuredClone(state.plan);
    if (!includeGeometry) delete plan.geometry;
    return { ...summary(printId, state), plan, planComplete: includeGeometry,
      ...(!includeGeometry ? { geometry: { omitted: true, shape: state.plan.geometry.shape ?? 'eight-point-wedge',
        nativeFile: state.geometry.nativeFile, boundsMm: state.geometry.boundsMm } } : {}) };
  });
  tool('create_print', 'Create an unapproved persistent bundle. Use the wedge kind for the bounded eight-point wedge. Optional plan is a complete recipe, never an approval. Then request_review.',
    { printId: printIdSchema, kind: kindSchema, machineId: z.string(), plan: objectSchema.optional() }, async ({ printId, kind, machineId, plan }) => {
      noApprovalFields(plan);
      const machine = loadMachine(machineId), recipe = await recipes[kind]();
      if (plan) recipe.validatePlan(plan, machine);
      const dir = await directory(printId, { create: true }), bundle = await bundles[kind]();
      await bundle.initBundle(dir, plan, { machineId, setupFile: await setupFile(machineId) });
      return summary(printId, await bundle.loadBundle(dir));
    }, false);
  tool('import_stl_print', 'Import a local STL into a new named bundle with explicit mm or inch units. Reads the specified source file, preserves its exact bytes and hash, translates geometry onto the bed, and reuses remembered machine setup. Then request Studio geometry review.',
    { printId: printIdSchema, sourcePath: z.string().min(1).max(4096), units: z.enum(['mm', 'inch']), machineId: z.string() },
    async ({ printId, sourcePath, units, machineId }) => {
      loadMachine(machineId);
      if (!isAbsolute(sourcePath) || !/\.stl$/i.test(sourcePath)) throw new Error('Choose an absolute path to a local .stl source file.');
      const source = await stat(sourcePath);
      if (!source.isFile() || source.size > 64 * 1024 * 1024) throw new Error('STL source must be a regular file no larger than 64 MiB.');
      const dir = await directory(printId, { create: true });
      await importSTLBundle(dir, await readFile(sourcePath), { units, machineId, setupFile: await setupFile(machineId) });
      return summary(printId, await (await bundles.shell()).loadBundle(dir));
    }, false);
  localExtension.registerMcp?.({tool,z,printIdSchema,objectSchema,idSchema,read,noApprovalFields});
  tool('voxel', 'Create or update a volumetric scalar-field part. Read the voxel-tools skill for control lattices, threshold and explicit mesh resolution. Uses shared slicing and Studio review.',
    {printId:printIdSchema,action:z.enum(['create','update']),request:objectSchema,machineId:z.string().optional(),expectedRevision:z.string().optional(),part:idSchema.optional()},
    async({printId,action,request,machineId,expectedRevision,part})=>{
      noApprovalFields(request);
      if(action==='create'){
        if(!machineId||expectedRevision!==undefined||part!==undefined)throw new Error('Creation requires machineId; revision and part apply to updates.');
        loadMachine(machineId);
        return summary(printId,await createVoxelBundle(await directory(printId,{create:true}),request,{machineId,setupFile:await setupFile(machineId)}));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      const {dir,state}=await read(printId);
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      return summary(printId,await updateVoxelBundle(dir,request,{expectedRevision,part}));
    },false);
  tool('gridfinity', 'gridfinity',
    {printId:printIdSchema,action:z.enum(['create','update']),parameters:objectSchema,machineId:z.string().optional(),expectedRevision:z.string().optional(),part:idSchema.optional()},
    async({printId,action,parameters,machineId,expectedRevision,part})=>{
      noApprovalFields(parameters);
      if(action==='create'){
        if(!machineId||expectedRevision!==undefined||part!==undefined)throw new Error('Creation requires machineId; revision and part apply to updates.');
        loadMachine(machineId);
        const dir=await directory(printId,{create:true});
        return summary(printId,await createGridfinityBundle(dir,parameters,{machineId,setupFile:await setupFile(machineId)}));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      const {dir,state}=await read(printId);
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      return summary(printId,await updateGridfinityBundle(dir,parameters,{expectedRevision,part}));
    },false);
  tool('apply_text', 'Add, edit or remove raised/recessed text using a local font and a part or independent spline reference. Read the text skill for request fields. Rebuilds actual geometry and invalidates approvals; use request_review afterward.',
    {printId:printIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({printId,expectedRevision,request})=>{
      noApprovalFields(request);
      const {dir,state}=await read(printId);
      if(state.kind!=='shell')throw new Error('Text modifies shared shell/mesh prints; the bounded wedge demo uses its own geometry workflow.');
      return summary(printId,await applyText(dir,request,{expectedRevision}));
    },false);
  tool('adjust_print', 'Apply a validated chat recipe patch at expectedRevision. Geometry edits invalidate all approvals; process edits retain geometry approval. Read fresh state if stale.',
    { printId: printIdSchema, expectedRevision: z.string().min(1), patch: objectSchema }, async ({ printId, expectedRevision, patch }) => {
      noApprovalFields(patch);
      const { dir, bundle, state } = await read(printId);
      const next = await bundle.adjustBundle(dir, patch, { expectedRevision, setupFile: await setupFile(state.machine.id) });
      return summary(printId, next);
    }, false);
  tool('check_print', 'Validate saved native geometry, recipe and any exact generated export using the shared bundle checks. Does not generate or approve.', { printId: printIdSchema }, async ({ printId }) => {
    const { state } = await read(printId);
    if (state.programError) throw new Error(state.programError);
    return { ...summary(printId, state), checked: state.program ? ['geometry', 'plan', 'exact-export'] : ['geometry', 'plan'], physicalValidation: 'not performed' };
  });
  tool('check_path', 'Check path feasibility using the same generator, without approvals or persisted SAAMpath/export artifacts. Reports software checks only; production generation and exact-export review remain required.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle } = await read(printId);
    return { printId, ...await bundle.checkPathBundle(dir), physicalValidation: 'not performed' };
  });
  tool('remember_setup', 'Remember this saved print setup for later prints on the same machine, shared with CLI initialization. This saves setup defaults, never job approvals.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle, state } = await read(printId);
    await bundle.rememberSetup(dir, { setupFile: await setupFile(state.machine.id) });
    return { printId, machineId: state.machine.id, remembered: true, approvalsChanged: false };
  }, false);
  tool('upgrade_print', 'Explicitly migrate an existing bundle through its shared adapter to the current machine/recipe version. Preserves prior delivered bytes and invalidates affected approvals. Use for a bundle that cannot pass current version validation.', { printId: printIdSchema }, async ({ printId }) => {
    const dir = await directory(printId), bundle = await bundleFor(dir);
    await bundle.upgradeBundle(dir);
    return summary(printId, await bundle.loadBundle(dir));
  }, false);
  tool('get_approval_status', 'Read fresh hash-bound geometry, plan and exact-export approvals from the saved bundle. Caller-provided approvals are never accepted.', { printId: printIdSchema }, async ({ printId }) => summary(printId, (await read(printId)).state));
  tool('request_review', 'Serve this bundle through SAAM Studio. No approval or generation is performed.', { printId: printIdSchema,...localExtension.reviewSchema?.(z) }, async ({ printId,...viewOptions }) => {
    const { dir, state } = await read(printId);
    const viewPath=await localExtension.reviewPath?.({dir,...viewOptions})??'';
    let session = studioSessions.get(printId);
    if (!session?.server.listening) {
      const studio = createStudio(dir, { libraryRoot,localExtension });
      await new Promise((resolveListen, reject) => { studio.once('error', reject); studio.listen(0, '127.0.0.1', resolveListen); });
      session = { server: studio, url: `http://127.0.0.1:${studio.address().port}` };
      studioSessions.set(printId, session);
      studio.once('close',()=>{
        if(studioSessions.get(printId)===session)studioSessions.delete(printId);
      });
    }
    await session.server.openPrint(dir);
    const url=session.url+viewPath;
    const browserOpenRequested = autoOpen ? await openBrowser(url) : false;
    return { ...summary(printId, state), url, browserOpenRequested };
  }, false);
  tool('generate_print', 'Generate SAAMpath and the declared export directly from the human-approved geometry and locked plan, completing shared checks. No new settings or development bypass are accepted.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle } = await read(printId);
    const checks = await bundle.generateBundle(dir);
    return { ...summary(printId, await bundle.loadBundle(dir)), checks };
  }, false);
  tool('deliver_print', 'Copy the exact current human-reviewed export bytes into the bundle delivery folder. Fails without current toolpath approval. Does not run hardware.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle } = await read(printId);
    const file = await bundle.deliver(dir), state = await bundle.loadBundle(dir);
    return { ...summary(printId, state), file, exportHash: state.exportHash };
  }, false);
  return { server, async close() {
    await queue;
    await Promise.all([...studioSessions.values()].map(({ server: studio }) => studio.shutdown()));
    studioSessions.clear();
    await server.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const adapter = createMcpAdapter({ printsRoot: process.env.SAAM_PRINTS_ROOT ?? resolve(root, 'Prints') });
  const transport = new StdioServerTransport();
  await adapter.server.connect(transport);
  let closing = false;
  async function close() { if (closing) return; closing = true; await adapter.close(); }
  process.stdin.on('end', close);
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
