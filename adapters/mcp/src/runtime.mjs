// The local SAAM runtime: every agent operation over the same bundle lifecycle
// and Studio used by the CLI, and the Studio/request state they share. It knows
// no transport; stdio MCP (server.mjs) and the relay register these operations.
import { z } from 'zod';
import { mkdir, readdir, readFile, lstat, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {openBrowser} from '../../../studio/browser.mjs';
import {randomUUID} from 'node:crypto';
import { MACHINE_IDS, loadMachine } from '../../../core/machine/profile.mjs';
import { createStudio, listPrints } from '../../../studio/server.mjs';
import { bundleFor } from '../../../studio/adapter-resolution.mjs';
import {createTour} from '../../../studio/tour.mjs';
import {createAgentRequests} from '../../../studio/agent-requests.mjs';
import {createStudioEvents} from '../../../studio/studio-events.mjs';
import { importSTLBundle,setSTLUnits } from '../../../core/print/import-stl.mjs';
import {createThingi10KClient} from '../../../skills/thingi10k/scripts/library.mjs';
import {importThingi10KBundle} from '../../../skills/thingi10k/scripts/import.mjs';
import {createGridfinityBundle,updateGridfinityBundle} from '../../../skills/gridfinity/scripts/bundle.mjs';
import {createBlobFieldBundle,updateBlobFieldBundle} from '../../../core/print/blob-field.mjs';
import { applyText } from '../../../core/print/text.mjs';
import {applySlice} from '../../../core/print/slice-edit.mjs';
import {applyModulation} from '../../../core/print/modulation.mjs';
import { applyHeatSet } from '../../../core/print/heat-set.mjs';
import {intersectRequest,combineGeometry} from '../../../core/print/geometry-tools.mjs';
import {loadLocalExtension} from '../../../core/local-extension.mjs';
import {lifecycleReview} from '../../../core/print/review-state.mjs';
import { readGuidance, readManual } from './manuals.mjs';
import { onboardingSources, printHint } from '../../../core/agent/layers.mjs';
import { SKILL_IDS, TECHNIQUE_IDS, skillMetadata } from '../../../skills/catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const installedExtension=await loadLocalExtension(root);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).refine(id => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id), 'Reserved filename.');
// Human file/folder names and Studio's three-level library are supported.
// Separators are canonical forward slashes; every ancestor is checked below.
const bundleIdSchema = z.string().min(1).max(384).refine(id => {
  const parts = id.split('/');
  return parts.length <= 3 && parts.every(part => part.length > 0 && part.length <= 128
    && !/^[.]|[. ]$|[\\:*?"<>|\x00-\x1f]/.test(part)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}, 'Invalid print name: use up to three relative folder names, without traversal, reserved names or Windows path characters.');
// Shell/mesh is the only bundle kind; the parameter is retained (and defaults)
// so the tool surface stays stable.
const kindSchema = z.enum(['shell']).default('shell');
const objectSchema = z.record(z.string(), z.unknown());
const bundles = {
  shell: () => import('../../../core/print/bundle.mjs')
};
const recipes = {
  shell: () => import('../../../core/print/plan.mjs')
};

function noApprovalFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/approval|approved|^review$|^actor$|^generation$|^history$|^__proto__$|^constructor$|^prototype$/i.test(key))
      throw new Error(`Field ${key} is not an agent-editable recipe setting. Final settings/toolpath approval belongs to the person in Studio.`);
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

// Studio persists printId internally; every agent transport exposes bundleId.
function publicBundleIdentity(value) {
  if (Array.isArray(value)) return value.map(publicBundleIdentity);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key === 'printId' ? 'bundleId' : key, publicBundleIdentity(child)]));
}

export function summary(bundleId, state) {
  const programChecked=state.programChecked!==false;
  const lifecycle=lifecycleReview(state,{programChecked});
  return {
    bundleId, kind: state.kind, revision: state.revision, geometryHash:state.geometryHash,
    machineId: state.machine.id, output: state.plan.output, skills: state.skills,
    toolpathApproved: lifecycle.toolpathApproved,
    programChecked,
    generation: state.review.generation ? { mode: state.review.generation.mode, current: lifecycle.current } : null,
    programError: state.programError ?? null, exportHash: state.exportHash ?? null,
    shortTravel: state.program?.summary?.shortTravel ?? null,
    outputAvailability: state.outputAvailability, limitations: state.limitations,
    nextStep: lifecycle.action==='check'?'Open Studio or check_bundle to check the current export.'
      : lifecycle.action==='generate'?'Generate the toolpath from the complete settings.'
      : lifecycle.action==='review'?'Review settings and the exact toolpath together in Studio.':'Deliver the reviewed export.'
  };
}

// Local clients keep the short bounded wait; a relay session raises it to its
// client's per-call deadline (see relay-device.mjs).
export const LOCAL_LISTEN=Object.freeze({defaultMs:25000,maxMs:25000}),LISTEN_LIMIT_MS=450000;

// A remote session (a web chat through the relay) reaches only files the person
// chose in Studio, and fonts in the system font folders.
function systemFontFolders(){
  const home=homedir();
  if(process.platform==='win32')return [resolve(process.env.WINDIR??'C:/Windows','Fonts'),resolve(process.env.LOCALAPPDATA??resolve(home,'AppData/Local'),'Microsoft/Windows/Fonts')];
  if(process.platform==='darwin')return ['/System/Library/Fonts','/Library/Fonts',resolve(home,'Library/Fonts')];
  return ['/usr/share/fonts','/usr/local/share/fonts',resolve(home,'.local/share/fonts'),resolve(home,'.fonts')];
}
async function requireSystemFont(path){
  const fold=value=>process.platform==='win32'?value.toLowerCase():value;
  const inside=async folder=>{try{const base=await realpath(folder);return fold(await realpath(path)).startsWith(fold(base+sep));}catch{return false;}};
  for(const folder of systemFontFolders())if(await inside(folder))return;
  throw Error('From a web chat, fontPath must be a font installed in the system font folders.');
}

export const instructions = 'For a maker edit, your FIRST operation is begin_studio_work, before any acknowledgement, analysis, status check or other tool; bundleId may be omitted for the active tour. For a tour request with command access, first run node studio/server.mjs --toolkit start-tour --no-open and open the returned Studio URL; then use its returned participation context and listener. Do not read guidance or run onboarding before launching the tour. For ordinary new-part work with missing maker context, run node scripts/agent-toolkit.mjs maker-onboarding once with command access, or otherwise call maker_onboarding once; either supplies the maker flow, the index of skills and advanced sections, and print-tools. Reuse current context and choose individual skill manuals for the task; do not reread sources already returned by onboarding. Follow relevant documentation links through read_guidance using their repository-relative path and optional #heading. Shared print-tool usage is available as "print-tools". Create a print and request_review for its geometry. Revisions happen through chat using adjust_recipe and expectedRevision. Geometry review is advisory: generation may proceed whenever it helps review. The person confirms the exact settings and toolpath together in Studio before export. Establish the printer and material before relying on the toolpath. For an edit to an existing print call begin_studio_work immediately, publish its saved geometry or toolpath target, then resolve its request ID after the requested result is displayed. Geometry-only work needs no slicing. Questions and guidance stay visually quiet. Normal use supports capabilities from any view; only the tour narrows requests to its current lesson under the tour manual. Send edit acknowledgements and lesson guidance immediately in chat commentary BEFORE calling a listener. Never hold an edit reply in a final answer while waiting through later lessons. During tours let Studio lead the early lessons. Keep wait_for_studio_request active, perform start-layer preparation silently, and initiate chat teaching only at the designated infill lesson and completion. Respond normally to participant-requested edits. Use get_tour for the selected print and set_tour_start_at for an explicit infill layer. deliver_toolpath copies the reviewed bytes. No tool grants final settings/toolpath approval or runs hardware. Studio reports what the person does — lesson changes, opened prints, imports, exports, displayed results, failed or cancelled calculations — as studioEvents on tool results, in wait_for_studio_request returns and in notifications; read the queue any time with get_studio_events, which also reports toolpath calculation progress. Events are ordered observations, not simultaneous state: act on the latest.';

// relay: on a computer paired with the SAAM relay, the provider every Studio
// instance shows in its Connect panel ({status(), linkCode()}).
export function createLocalRuntime({ printsRoot = resolve(root, 'Prints'), autoOpen = process.env.SAAM_NO_AUTO_OPEN !== '1',localExtension=installedExtension,thingi10kClient,relay } = {}) {
  const libraryRoot = resolve(printsRoot);
  const meshLibrary=thingi10kClient??createThingi10KClient({cacheDirectory:resolve(libraryRoot,'.thingi10k')});
  const ownerId=randomUUID();
  const studioEvents=createStudioEvents(),agentRequests=createAgentRequests(libraryRoot,{ownerId,events:studioEvents});
  const tour=createTour(libraryRoot,{ownerId,agentRequests});
  const studioSessions = new Map(),preferredStudioByPrint=new Map();
  const generationStatus=()=>[...studioSessions.values()].map(({server:studio})=>studio.generationStatus()).filter(Boolean);
  // Every runtime-owned Studio instance starts here, showing dir (or no print
  // when dir is null) and the relay panel when this computer has a relay.
  async function startStudio(dir){
    const studio = createStudio(dir, { libraryRoot,localExtension,agentOwnerId:ownerId,agentRequests,studioEvents,relay });
    await new Promise((resolveListen, reject) => { studio.once('error', reject); studio.listen(0, '127.0.0.1', resolveListen); });
    const session = { server: studio, url: `http://127.0.0.1:${studio.address().port}` },studioInstanceId=studio.agentSession().instanceId;
    studioSessions.set(studioInstanceId, session);
    studio.agentWorking(chat.working);
    studio.once('close',()=>{
      if(studioSessions.get(studioInstanceId)===session)studioSessions.delete(studioInstanceId);
      for(const [id,instance] of preferredStudioByPrint)if(instance===studioInstanceId)preferredStudioByPrint.delete(id);
    });
    return session;
  }
  // One print-work queue per runtime: mutations run in order; immediate tools bypass it.
  const work={tail:Promise.resolve()},operations=new Map();

  async function directory(bundleId, { create = false } = {}) {
    bundleIdSchema.parse(bundleId);
    if (create) await mkdir(libraryRoot, { recursive: true });
    const base = await realpath(libraryRoot), dir = resolve(base, bundleId);
    const rel = relative(base, dir);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Print must remain inside the configured Prints root.');
    let ancestor = base;
    for (const segment of bundleId.split('/')) {
      ancestor = resolve(ancestor, segment);
      try {
        const info = await lstat(ancestor);
        if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not supported in MCP print paths.');
        if (!info.isDirectory()) throw new Error('Every print path component must be a directory.');
      } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
    }
    try {
      await rejectLinks(dir);
      if (create) throw new Error('Print already exists. Choose a new bundleId or reopen it.');
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
  async function locate(bundleId) {
    const dir = await directory(bundleId), bundle = await bundleFor(dir);
    return { dir, bundle };
  }
  async function read(bundleId, {program='source'}={}) {
    const {dir,bundle}=await locate(bundleId);
    return {dir,bundle,state:await bundle.loadBundle(dir,{program})};
  }
  // A print's summary with one line naming the gated guidance its printer opens
  // that `from` did not (layers.mjs#machineHint).
  async function withMachineHint(bundleId,state,from){
    const result=summary(bundleId,state),hint=await printHint(root,state,from);
    return hint?{...result,gatedGuidance:hint}:result;
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
  const immediateTools=new Set(['begin_studio_work','respond_to_studio_request','wait_for_studio_request','get_studio_requests','get_studio_events','get_studio_sessions','get_tour']);
  // Operations that read a path the agent names on this computer.
  const localOnlyTools=new Set(['import_stl_bundle']);
  function tool(name, description, shape, action, readOnly = true, openWorld = false) {
    const tracked=Boolean(shape.bundleId)&&!immediateTools.has(name);
    // The full strict schema makes unexpected top-level approval data an error
    // instead of letting Zod silently discard it.
    const schema=z.object({...shape,...(tracked?{requestIds:z.array(z.string()).max(32).optional()}: {})}).strict();
    operations.set(name,{name,description,schema,readOnly,openWorld,tracked,immediate:immediateTools.has(name),localOnly:localOnlyTools.has(name),action});
  }
  // Runs one operation to its result and throws its failure; the transport
  // decides how either reaches the agent.
  // `session` carries per-session limits, such as how long this client may listen.
  function invoke(name,args={},session){
    const operation=operations.get(name);
    if(!operation||operation.localOnly&&session?.remote)return Promise.reject(Error(`Unknown SAAM operation ${name}.`));
    const execute=async()=>{
      const {requestIds,...input}=operation.schema.parse(args);
      const touch=async()=>{for(const id of requestIds??[])await agentRequests.activity(id,{directory:await directory(input.bundleId)});};
      if(operation.tracked)await touch();
      let result;
      try{result=await operation.action(input,session);}finally{if(operation.tracked)await touch();}
      if(result&&typeof result==='object'&&!Array.isArray(result)&&!['get_studio_events','wait_for_studio_request'].includes(name)){
        if(!operation.immediate){const pending=await agentRequests.query({status:'queued'});if(pending.length)result={...result,studioRequests:pending};}
        // Delivered events push at once; every tool result also carries whatever is still queued.
        const events=studioEvents.drain();if(events.length)result={...result,studioEvents:events};
      }
      return publicBundleIdentity(result);
    };
    if(operation.immediate)return execute();
    const run=work.tail.then(execute);
    work.tail=run.then(()=>undefined,()=>undefined);
    return run;
  }

  // The maker's starting context for a client without command access, as the
  // toolkit's maker-onboarding gives it to one with, less its script sections. A web
  // chat also gets how its connection works, which its client may not show from the
  // server instructions.
  const machineIdSchema=z.string().optional().describe('The print’s printer: adds the sections its capabilities open.');
  tool('maker_onboarding','Start here: call this once per conversation, before any other SAAM tool. Returns how to work with SAAM: maker guidance, the index of every skill and advanced section, the shared print tools and, from a web chat, how this connection works. Reuse it for the whole conversation.',
    {machineId:machineIdSchema}, async ({machineId}, session) => ({ role:'maker', ...(session?.guidance?{connection:session.guidance}:{}),
      sources: await onboardingSources(root,{client:'web',machineId}),
      nextStep: 'Follow connection first when present. Reuse these sources for the whole conversation; do not reread them or call maker_onboarding again. Read skill manuals (read_skill) and linked references (read_guidance) when a task needs them, and a gated section by name when its gate applies or the person asks.' }));
  tool('list_machines', 'List installed machine profiles and declared outputs. Catalog presence is not proof that a particular recipe is supported.', {}, async () => MACHINE_IDS.map(id => {
    const m = loadMachine(id);
    return { id, name: m.name, capabilities: m.capabilities, tools: m.tools, materials: m.materials,
      outputs: m.outputs.map(({ id, extension, flavor, implemented, experimental, constraints, reason }) => ({ id, extension, flavor, implemented: implemented !== false, experimental, constraints, reason })),
      defaultSetup: m.defaultSetup };
  }));
  tool('list_skills', 'List the known local toolpath, geometry and hybrid skill manuals. This fixed list does not establish recipe compatibility; geometry skills are not deposition operations, and hybrid skills change geometry and deposit their own toolpath. Select the manual relevant to the requested task.', {}, skills);
  tool('read_skill', 'Read a skill or construction technique manual by ID, or one section as ID#heading whatever its gate. Sections gated to command access or to machine capabilities are listed in omitted; machineId opens the ones that printer meets. Links are repository paths for read_guidance.',
    { skillId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}(#[^\s#]{1,200})?$/), machineId: machineIdSchema }, async ({ skillId: name, machineId }) => {
    const [skillId, anchor] = name.split('#');
    if (!SKILL_IDS.includes(skillId)&&!TECHNIQUE_IDS.includes(skillId)) {
      const local=await localExtension.readSkill?.(skillId);if(local)return local;
      throw new Error('Unknown skill or technique ID. Use list_skills and its manual links.');
    }
    const { text: manual, ...reference } = await readManual(root, `skills/${skillId}/SKILL.md${anchor ? '#' + anchor : ''}`, { client: 'web', machineId });
    return { skillId, manual, ...reference };
  });
  tool('read_guidance', 'Read published repository Markdown by relative path, optionally with #heading for one section whatever its gate. Results list the headings with their gates and the gated sections omitted; machineId opens the ones that printer meets. Short IDs: makers, geometry, development, glossary, mcp, print-tools. This reader does not expose private files, source code or register capabilities.',
    { guidanceId: z.string().min(1).max(1024), machineId: machineIdSchema }, async ({ guidanceId, machineId }) => readManual(root, guidanceId, { client: 'web', machineId, headings: true }));
  tool('get_recipe_defaults', 'Get process, setup and common assignment defaults, including remembered setup. Contains no geometry; author/import geometry before create_bundle. Defaults and remembered setup never confer job approval.',
    { kind: kindSchema, machineId: z.string() }, async ({ kind, machineId }) => ({ kind, machineId,
      plan: await (await bundles[kind]()).proposedPlan(machineId, { setupFile: await setupFile(machineId) }) }));
  tool('list_bundles', 'Discover saved print names, machines and modification times. Export and approval status are unchecked; use get_bundle or check_bundle for validated status.', {}, async () => {
    const result = [];
    let base;
    try { base = await realpath(libraryRoot); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    for (const entry of await listPrints(base)) {
      const bundleId = relative(base, entry.path).replaceAll('\\', '/');
      if (!bundleIdSchema.safeParse(bundleId).success) continue;
      try { await directory(bundleId);result.push({bundleId,name:entry.name,machine:entry.machine,modified:entry.modified,programChecked:false}); }
      catch (error) { result.push({ bundleId, error: error.message }); }
    }
    return result;
  });
  tool('get_bundle', 'Read fresh validated status and recipe settings. Geometry is omitted by default and planComplete is false; set includeGeometry to obtain the complete editable recipe. SAAMpath and program arrays are always omitted.', { bundleId: bundleIdSchema, includeGeometry: z.boolean().optional() }, async ({ bundleId, includeGeometry = false }) => {
    const { state } = await read(bundleId);
    const plan = structuredClone(state.plan);
    if (!includeGeometry) delete plan.geometry;
    return { ...summary(bundleId, state), plan, planComplete: includeGeometry,
      ...(!includeGeometry ? { geometry: { omitted: true, shape: state.plan.geometry.shape ?? 'unknown',
        nativeFile: state.geometry.nativeFile, boundsMm: state.geometry.boundsMm } } : {}) };
  });
  tool('create_bundle', 'Create an unapproved persistent bundle. Supply a complete plan with authored/imported geometry; defaults alone are incomplete. Then request_review.',
    { bundleId: bundleIdSchema, kind: kindSchema, machineId: z.string(), plan: objectSchema }, async ({ bundleId, kind, machineId, plan }) => {
      noApprovalFields(plan);
      const machine = loadMachine(machineId), recipe = await recipes[kind]();
      if (!plan.geometry) throw Error('create_bundle requires authored/imported geometry in plan.geometry; recipe defaults contain none.');
      recipe.validatePlan(plan, machine);
      const dir = await directory(bundleId, { create: true }), bundle = await bundles[kind]();
      await bundle.initBundle(dir, plan, { machineId, setupFile: await setupFile(machineId) });
      return withMachineHint(bundleId, await bundle.loadBundle(dir), null);
    }, false);
  tool('import_stl_bundle', 'Import a local STL into a new named bundle. Default units auto chooses a reasonable mm/inch assumption from model size and printer bounds, without interrupting the person; honor explicit units when supplied. Preserves source bytes and hash and reuses remembered setup. Show geometry dimensions; units can be corrected with set_stl_units.',
    { bundleId: bundleIdSchema, sourcePath: z.string().min(1).max(4096), units: z.enum(['auto','mm', 'inch']).default('auto'), machineId: z.string() },
    async ({ bundleId, sourcePath, units, machineId }) => {
      loadMachine(machineId);
      if (!isAbsolute(sourcePath) || !/\.stl$/i.test(sourcePath)) throw new Error('Choose an absolute path to a local .stl source file.');
      const source = await stat(sourcePath);
      if (!source.isFile() || source.size > 64 * 1024 * 1024) throw new Error('STL source must be a regular file no larger than 64 MiB.');
      const dir = await directory(bundleId, { create: true });
      await importSTLBundle(dir, sourcePath, { units, machineId, setupFile: await setupFile(machineId) });
      return summary(bundleId, await (await bundles.shell()).loadBundle(dir));
    }, false);
  tool('search_thingi10k', 'Find meshes by descriptive keywords (such as bunny), numeric file ID or a Thingiverse thing URL. Reads the Thingi10K mirror index; returns per-file source and license links. Prefer making tailored geometry when attractive. Read the thingi10k skill manual.',
    {query:z.string().min(1).max(500),limit:z.number().int().min(1).max(50).default(10),offset:z.number().int().min(0).max(10000).default(0)},
    async args=>meshLibrary.search(args),true,true);
  tool('import_thingi10k_bundle', 'Download a selected Thingi10K STL file ID on the SAAM host and import an unapproved print. ALWAYS give its license link in chat and briefly identify the source unless obvious. Returns attribution and a retained download even if strict mesh import fails. Review geometry with request_review after successful import.',
    {bundleId:bundleIdSchema,fileId:z.string().regex(/^[1-9][0-9]{0,11}$/),machineId:z.string(),units:z.enum(['auto','mm','inch']).default('auto')},
    async({bundleId,fileId,machineId,units})=>{
      const dir=await directory(bundleId,{create:true});
      const result=await importThingi10KBundle(meshLibrary,dir,fileId,{machineId,units,setupFile:await setupFile(machineId)});
      return {...result,...(result.imported?summary(bundleId,await (await bundles.shell()).loadBundle(dir)):{bundleId})};
    },false,true);
  localExtension.registerMcp?.({tool,z,bundleIdSchema,objectSchema,idSchema,read,noApprovalFields});
  tool('set_stl_units','Correct an imported mesh to mm or inch units, rescaling its current geometry and preserving the original STL bytes and printing settings. Invalidates geometry/toolpath confirmations; show the corrected size for geometry review.',
    {bundleId:bundleIdSchema,units:z.enum(['mm','inch']),expectedRevision:z.string()},async({bundleId,units,expectedRevision})=>{
      const dir=await directory(bundleId);return summary(bundleId,await setSTLUnits(dir,units,{expectedRevision}));
    },false);
  tool('blob_field', 'Create or rebuild a blob-field part: freely placed points, each with positionMm, reachMm and strength, whose smooth falloffs add up; material is where the sum exceeds the threshold (default 0.25, where a lone strength-1 point is a ball of radius reach/2), cut flat at Z = 0. Negative strength carves. Request {points, threshold?, edgeMm?}; GEOMETRY.md#blob-field describes it. Extracted to a mesh for shared slicing and Studio review.',
    {bundleId:bundleIdSchema,action:z.enum(['create','update']),request:objectSchema,machineId:z.string().optional(),expectedRevision:z.string().optional(),part:idSchema.optional()},
    async({bundleId,action,request,machineId,expectedRevision,part})=>{
      noApprovalFields(request);
      if(action==='create'){
        if(!machineId||expectedRevision!==undefined||part!==undefined)throw new Error('Creation requires machineId; revision and part apply to updates.');
        loadMachine(machineId);
        const dir=await directory(bundleId,{create:true});
        return summary(bundleId,await createBlobFieldBundle(dir,request,{machineId,setupFile:await setupFile(machineId)}));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      return summary(bundleId,await updateBlobFieldBundle(dir,request,{expectedRevision,part}));
    },false);
  tool('gridfinity', 'gridfinity',
    {bundleId:bundleIdSchema,action:z.enum(['create','update']),parameters:objectSchema,machineId:z.string().optional(),expectedRevision:z.string().optional(),part:idSchema.optional()},
    async({bundleId,action,parameters,machineId,expectedRevision,part})=>{
      noApprovalFields(parameters);
      if(action==='create'){
        if(!machineId||expectedRevision!==undefined||part!==undefined)throw new Error('Creation requires machineId; revision and part apply to updates.');
        loadMachine(machineId);
        const dir=await directory(bundleId,{create:true});
        return summary(bundleId,await createGridfinityBundle(dir,parameters,{machineId,setupFile:await setupFile(machineId)}));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      return summary(bundleId,await updateGridfinityBundle(dir,parameters,{expectedRevision,part}));
    },false);
  tool('apply_text', 'Add, edit or remove raised/recessed text using a local font and a part or independent spline reference. Read text for request fields; assignments can replace the common plan.slices list atomically with geometry. Rebuilds actual geometry and invalidates approvals; use request_review afterward.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({bundleId,expectedRevision,request},session)=>{
      noApprovalFields(request);
      if(session?.remote&&request.feature?.fontPath!==undefined)await requireSystemFont(String(request.feature.fontPath));
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Text modifies shared shell/mesh prints.');
      return summary(bundleId,await applyText(dir,request,{expectedRevision}));
    },false);
  tool('apply_heat_set', 'Add, edit or remove a heat-set insert hole; its reinforcement (a six-loop annulus and connecting fins) is written as slice assignments ahead of the others. Select the exact insertId from the heat-set-inserts manual size/profile table; read its request and geometry limits. Rebuilds geometry and invalidates affected approvals; use request_review afterward.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({bundleId,expectedRevision,request})=>{
      noApprovalFields(request);
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Heat-set inserts modify shared shell/mesh prints.');
      return summary(bundleId,await applyHeatSet(dir,request,{expectedRevision}));
    },false);
  tool('intersect_geometry', 'Intersect geometry with horizontal planes (sectionsAtZ: section area, islands, holes and loop bounds; includeLoops adds the loop points), vertical lines (topsAtXY: the highest surface crossing, its normal, slope and surface name) and spline surfaces (surfaces: control-net specs with optional offsetMm; the region of each surface inside the part, in its own (u,v)), for curved slices. Query a print, one part, or a geometry you are about to write, in its own coordinates before placement. Spline patches are sectioned exactly, not tessellated. Read-only; GEOMETRY.md#checking-geometry.',
    {bundleId:bundleIdSchema.optional(),request:objectSchema},async({bundleId,request})=>
      intersectRequest(bundleId===undefined?null:(await read(bundleId,{program:false})).dir,request));
  tool('combine_geometry', 'Combine a print’s geometry (or one part) with a new operand: request {operation: union|difference|intersection, operand, part?}. The result is a boolean solid; repeating an operation appends to it, and a difference subtracts every later operand. Operands are spline, mesh, blob-field or boolean geometry in the same coordinates. Spline operands stay native: each layer combines their exact sections. Invalidates approvals; use request_review afterward. GEOMETRY.md#booleans.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({bundleId,expectedRevision,request})=>{
      noApprovalFields(request);
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Booleans combine shared shell/mesh prints.');
      return summary(bundleId,await combineGeometry(dir,request,{expectedRevision}));
    },false);
  tool('slice', 'Add, edit or remove one general deposition assignment in plan.slices. Uses the same recipe validation as adjust_recipe; add fills shared defaults, edit merges objects and replaces arrays. Order controls ownership: before names an existing assignment or null appends. Returns saved settings and deferred generation checks, not feasibility claims. Read slice for surface/stack/curve fields.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),assignment:objectSchema.describe('Add overrides or edit patch. Volume: part, preset, filament, process, loops, fillDensity, fillPattern, fillAnglesDeg, rotateFill, solidTop, solidBottom, fillOverlap, spacingFactor, sampleStepMm, within, surface, stack. Common construction records include skin, fronts, sleeve, rim, cladding, curves and bridges; read slice and its technique manuals.').optional(),before:z.string().nullable().describe('Existing assignment id to insert before; null appends; omitted retains edit position or appends an add.').optional()},
    async({bundleId,expectedRevision,...request})=>{
      noApprovalFields(request.assignment);
      const {dir}=await locate(bundleId),result=await applySlice(dir,request,{expectedRevision});
      return {...summary(bundleId,result.state),edit:result.edit};
    },false);
  tool('modulate', 'Add, edit or remove a world-space field modifier in plan.modulations. Applied to selected assignment/role deposition before final support publication; changes invalidate dependent output and confirmation. Read slice#modulation for field records, channel units and unsupported cases.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),modifier:objectSchema.describe('Add requires channel displacement|flow|width, amplitude and field; displacement also needs direction XYZ or lateral. Optional assignments/roles (null means all), sampleStepMm (0.2), tolerance (0.01). Edit patches a saved modifier; remove omits it.').optional()},
    async({bundleId,expectedRevision,...request})=>{
      noApprovalFields(request.modifier);
      const {dir}=await locate(bundleId),result=await applyModulation(dir,request,{expectedRevision});
      return {...summary(bundleId,result.state),edit:result.edit};
    },false);
  tool('adjust_recipe', 'Apply a validated chat recipe patch at expectedRevision. Geometry or process edits invalidate the final settings/toolpath confirmation. Read fresh state if stale.',
    { bundleId: bundleIdSchema, expectedRevision: z.string().min(1), patch: objectSchema }, async ({ bundleId, expectedRevision, patch }) => {
      noApprovalFields(patch);
      const { dir, bundle, state } = await read(bundleId,{program:false});
      const next = await bundle.adjustBundle(dir, patch, { expectedRevision, setupFile: await setupFile(state.machine.id) });
      return summary(bundleId, next);
    }, false);
  tool('check_bundle', 'Validate saved native geometry, recipe and any exact generated export using the shared bundle checks. Does not generate or approve.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { state } = await read(bundleId);
    if (state.programError) throw new Error(state.programError);
    return { ...summary(bundleId, state), checked: state.program ? ['geometry', 'plan', 'exact-export'] : ['geometry', 'plan'], physicalValidation: 'not performed' };
  });
  tool('check_path', 'Check path feasibility using the same generator, without approvals or persisted SAAMpath/export artifacts. Reports software checks only; production generation and exact-export review remain required.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle } = await locate(bundleId);
    return { bundleId, ...await bundle.checkPathBundle(dir), physicalValidation: 'not performed' };
  });
  tool('remember_setup', 'Remember this saved print setup for later prints on the same machine, shared with CLI initialization. This saves setup defaults, never job approvals.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle, state } = await read(bundleId,{program:false});
    await bundle.rememberSetup(dir, { setupFile: await setupFile(state.machine.id) });
    return { bundleId, machineId: state.machine.id, remembered: true, approvalsChanged: false };
  }, false);
  tool('get_approval_status', 'Read the fresh hash-bound final settings/toolpath approval from the saved bundle. Caller-provided approvals are never accepted.', { bundleId: bundleIdSchema }, async ({ bundleId }) => summary(bundleId, (await read(bundleId)).state));
  tool('begin_studio_work','Start Studio work as early as practical for an edit to an existing print — you may acknowledge the person first; the claim it records is what later mutations and result reports check, so make it before either. Identify the Studio instance when more than one is open. Edits start Updating preview; guidance stays visually quiet. For a Studio-originated request, pass its requestId to claim that request. Resolve every started request with respond_to_studio_request.',
    {bundleId:bundleIdSchema.optional(),studioInstanceId:z.string().optional(),instruction:z.string().min(1).max(8000),requestId:z.string().optional(),kind:z.enum(['edit','guidance']).default('edit')},async({bundleId,studioInstanceId,instruction,requestId,kind})=>{
      const record=requestId?await agentRequests.get(requestId):null;
      if(!studioInstanceId&&record?.studioInstanceId)studioInstanceId=record.studioInstanceId;
      const session=studioInstanceId?studioSessions.get(studioInstanceId):null;
      if(studioInstanceId&&!session)throw Error('That Studio instance is not owned by this agent.');
      if(!bundleId&&record)bundleId=record.printId;
      if(!bundleId){const guide=await tour.info(),selected=guide.active?guide.directory:session?.server.currentPrint()??(studioSessions.size===1?[...studioSessions.values()][0].server.currentPrint():null);if(!selected)throw Error('Specify bundleId or studioInstanceId when no single active Studio instance is available.');bundleId=agentRequests.printId(selected);}
      const dir=await directory(bundleId);
      if(!studioInstanceId){
        const matches=[...studioSessions.values()].filter(candidate=>candidate.server.currentPrint()===dir);
        if(matches.length>1)throw Error('Specify studioInstanceId because multiple owned Studio instances display this print.');
        if(matches.length===1)studioInstanceId=matches[0].server.agentSession().instanceId;
      }
      if(session&&session.server.currentPrint()!==dir)throw Error('That Studio instance is displaying another print.');
      if(requestId){if(record?.printId!==bundleId)throw Error('That request belongs to another print.');if(record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');return agentRequests.update(requestId,{status:'working'});}
      return agentRequests.begin({directory:dir,instruction,kind,studioInstanceId});
    },false);
  tool('respond_to_studio_request','After saving the intended inputs, publish status working with resultStage geometry or toolpath for every edit. Intermediate saves cannot finish a request; automatic tour generation waits for this target. Bind every included request when combining edits. Use waiting when paused for a choice or confirmation; resume the same requestId without losing its target. Complete after sending guidance or presenting the requested result; geometry-only work needs no generation. Mark failures explicitly. Studio clears Updating preview when the bound result is displayed, independently of this acknowledgement.',
    {requestId:z.string(),status:z.enum(['working','waiting','completed','failed','cancelled']).default('completed'),resultStage:z.enum(['geometry','toolpath']).optional(),message:z.string().max(8000).default('')},async({requestId,...response})=>agentRequests.update(requestId,response),false);
  tool('wait_for_studio_request','Wait for Studio to request maker-agent input. Send any completed edit acknowledgement in chat commentary BEFORE this call. Do not defer it to the final response. While guiding a tour, call this between lessons instead of ending the turn and requiring the participant to ask for guidance. Claim a returned request and resolve it after doing its work. Prepare imported-model start layers silently; Studio leads the early lessons. Give proactive chat guidance only at the designated infill lesson and completion. Repeat after a timeout while the participant is navigating, without waiting for a chat message. Omit waitMs: the session uses the longest wait its client allows.',
    {after:z.array(z.string()).optional(),waitMs:z.number().int().min(0).max(LISTEN_LIMIT_MS).optional(),claim:z.boolean().optional(),studioInstanceId:z.string().optional()},async(args,session)=>{
      if(args.studioInstanceId&&!studioSessions.has(args.studioInstanceId))throw Error('That Studio instance is not owned by this agent.');
      const {defaultMs,maxMs}=session.listen,waitMs=Math.min(maxMs,args.waitMs??defaultMs);
      const result=await agentRequests.wait({...args,waitMs}),generation=generationStatus();
      return generation.length?{...result,generation}:result;
    });
  tool('get_studio_events','Read and clear the Studio event queue: what the person did in your owned Studio instances since your last read (lesson changes, opened prints, imports, exports, approvals, displayed results, calculation start/finish/failure/cancellation, viewer connections) plus live toolpath calculation progress. Delivered events also arrive on tool results and listener waits; sequence numbers identify repeats. Set history to include recently read events.',
    {history:z.boolean().default(false)},async({history})=>({events:studioEvents.drain(),generation:generationStatus(),...(history?{recent:studioEvents.history()}:{})}));
  tool('get_studio_requests','Read outstanding work and the latest edit outcome per print. Set history for all resolved records; optionally restrict to one print.',{bundleId:bundleIdSchema.optional(),history:z.boolean().default(false)},async({bundleId,...options})=>({requests:await agentRequests.query({...options,printId:bundleId})}));
  tool('get_studio_sessions','List live Studio instances owned exclusively by this agent. One agent may own several instances; print bundles remain shareable across agents.',{},async()=>({sessions:[...studioSessions.values()].map(({server:studio,url})=>({...studio.agentSession(),url}))}));
  tool('get_tour','Read the active tour print, lesson gates and maker-agent instruction. After reaching the chat lesson, offer infill options in chat. After completion, immediately congratulate the participant, offer help with any difficulties printing the downloaded file, and ask what she wants to make next. Optional bounded wait follows user progress.',
    {after:z.string().optional(),waitMs:z.number().int().min(0).max(25000).optional()},async({after,waitMs=0})=>{
      const deadline=Date.now()+waitMs;
      for(;;){const status=await tour.info(),cursor=JSON.stringify([status.active,status.completed,status.step,status.canNext,status.selected]);
        if(cursor!==after||Date.now()>=deadline)return {...status,cursor};
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    });
  tool('set_tour_start_at','Choose an infill layer after the first layer for the identified tour lesson. Use the runId and lessonId from the guidance request scope or get_tour; discard work when that lesson has ended.',
    {startAt:z.object({layer:z.number().int().min(1)}).strict(),runId:z.string(),lessonId:z.string()},async({startAt,...scope})=>tour.setStartAt(startAt,scope),false);
  tool('change_machine','Change a print to a supported printer using its remembered or default setup. Invalidates final settings/toolpath confirmation and validates compatibility before saving.',
    {bundleId:bundleIdSchema,machineId:z.string(),expectedRevision:z.string()},async({bundleId,machineId,expectedRevision})=>{
      const {dir,bundle,state:before}=await read(bundleId,{program:false});if(!bundle.changeMachine)throw Error('This adapter cannot change its printer.');
      return withMachineHint(bundleId,await bundle.changeMachine(dir,machineId,{expectedRevision,setupFile:await setupFile(machineId)}),before.machine.id);
    },false);
  tool('request_review', 'Serve this bundle through an exclusively owned SAAM Studio instance. Reuse is the default: the instance already showing this print, else the sole live instance, is rebound to it in the same browser tab. With several live instances supply studioInstanceId to choose the one to rebind; otherwise an unshown print opens another. Use newInstance only when the person asks for another Studio, or for a compelling reason you tell them. Optional startAt selects the tour infill layer. No approval or generation is performed.', { bundleId: bundleIdSchema,studioInstanceId:z.string().optional(),newInstance:z.boolean().default(false),startAt:z.object({layer:z.number().int().min(1)}).strict().optional(),...localExtension.reviewSchema?.(z) }, async ({ bundleId,studioInstanceId,newInstance,startAt,...viewOptions }) => {
    if(studioInstanceId&&newInstance)throw Error('Choose an existing studioInstanceId or request a new instance, not both.');
    const { dir, state } = await read(bundleId);
    const viewPath=await localExtension.reviewPath?.({dir,...viewOptions})??'';
    let session=studioInstanceId?studioSessions.get(studioInstanceId):newInstance?null:studioSessions.get(preferredStudioByPrint.get(bundleId))
      ??[...studioSessions.values()].find(({server:studio})=>studio.currentPrint()===dir)
      // Switching prints reuses the sole live instance; several leave the choice to studioInstanceId.
      ??(studioSessions.size===1?[...studioSessions.values()][0]:undefined);
    if(studioInstanceId&&!session)throw Error('That Studio instance is not owned by this agent.');
    if (!session?.server.listening) session=await startStudio(dir);
    await session.server.openPrint(dir);
    preferredStudioByPrint.set(bundleId,session.server.agentSession().instanceId);
    if(startAt)await session.server.setStartAt(startAt);
    const url=session.url+viewPath;
    // An open viewer is rebound in place; only a Studio nobody is viewing opens a tab.
    const browserOpenRequested = autoOpen && !session.server.viewerCount() ? await openBrowser(url) : false;
    return { ...summary(bundleId, state),studioInstanceId:session.server.agentSession().instanceId, url, browserOpenRequested };
  }, false);
  tool('close_studio_session','Close one Studio instance owned by this agent without affecting other instances or the shared print bundle.',{studioInstanceId:z.string()},async({studioInstanceId})=>{
    const session=studioSessions.get(studioInstanceId);if(!session)throw Error('That Studio instance is not owned by this agent.');
    const result=session.server.agentSession();await session.server.shutdown();return {...result,connected:false};
  },false);
  tool('generate_toolpath', 'Generate and check the declared export from the current geometry and complete settings, including during the tour. This is reviewable output, not approval.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle } = await locate(bundleId);
    const checks = await bundle.generateBundle(dir,{development:false});
    return { ...summary(bundleId, await bundle.loadBundle(dir)), checks };
  }, false);
  tool('deliver_toolpath', 'Copy the exact current human-reviewed export bytes into the bundle delivery folder. Fails without current toolpath approval. Does not run hardware.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle } = await locate(bundleId);
    const file = await bundle.deliver(dir), state = await bundle.loadBundle(dir);
    return { ...summary(bundleId, state), file, exportHash: state.exportHash };
  }, false);
  // The runtime outlives its sessions: Studio instances, jobs and bundles stay
  // while chats come and go. One session is active at a time; an ended
  // session's late calls are rejected rather than run for its successor.
  const runtime={closing:null,session:null};
  // listen: how long this session's client may hold a wait (default and ceiling).
  // remote: a web chat through the relay; it neither sees nor runs local-only operations.
  // The chat is working from any call other than the listener, and from a
  // listener that returned something to act on, until it listens again or
  // WORKING_MS pass without a call. Studio shows it as its waiting indicators.
  const WORKING_MS=5*60_000;
  const chat={working:false,timer:null};
  function chatWorking(session){
    const activity=session?.activity;
    return Boolean(activity&&!session.ending&&!activity.listening&&activity.lastCall&&Date.now()-activity.lastCall<WORKING_MS);
  }
  function publishWorking(){
    const working=chatWorking(runtime.session);
    clearTimeout(chat.timer);
    if(working){chat.timer=setTimeout(publishWorking,runtime.session.activity.lastCall+WORKING_MS-Date.now()+50);chat.timer.unref?.();}
    if(working===chat.working)return;
    chat.working=working;
    for(const {server:studio} of studioSessions.values())studio.agentWorking?.(working);
    for(const listener of statusListeners)listener();
  }
  // What the chat's SAAM panel shows: one light, done, working or error, a line
  // saying why and the Studio address. It only shows: Studio requests and
  // events reach the model through the listener. The relay reports an offline
  // computer and the panel its own lost connection.
  const statusListeners=new Set();
  async function chatStatus(){
    const requests=await agentRequests.query(),clip=text=>String(text??'').replace(/\s+/g,' ').trim().slice(0,120);
    const queued=requests.filter(r=>r.status==='queued'),working=requests.find(r=>r.status==='working');
    const calculating=generationStatus().some(g=>['preparing','generating'].includes(g.status));
    // Only this session's failures: an earlier chat's are not this one's error.
    const since=runtime.session?.started??Infinity;
    const latest=requests.filter(r=>!r.connectionClosed&&r.updatedAt>=since).reduce((a,b)=>!a||b.updatedAt>a.updatedAt?b:a,null);
    // studio: the loopback address of the newest live Studio, carrying no secret.
    const shown={studio:[...studioSessions.values()].filter(({server:studio})=>studio.listening).at(-1)?.url??null};
    const light=(state,text)=>({state,text,...shown});
    if(working)return light('working','Working on: '+clip(working.instruction));
    if(queued.length)return light('working',queued.length>1?`${queued.length} Studio requests waiting for the chat`:'Studio request waiting for the chat');
    if(calculating)return light('working','Calculating the toolpath');
    if(chat.working)return light('working','Working');
    if(latest?.status==='failed')return light('error','Failed: '+clip(latest.message||latest.instruction));
    if(requests.some(r=>r.status==='waiting'))return light('done','Waiting for you in Studio');
    return light('done','Done');
  }
  // listener() runs on anything that may change the status; read chatStatus().
  function subscribeStatus(listener){
    const stops=[agentRequests.subscribe(()=>listener()),studioEvents.observe(()=>listener())];
    statusListeners.add(listener);
    return ()=>{statusListeners.delete(listener);for(const stop of stops)stop();};
  }
  // A web chat's client may show neither the server instructions nor a tool
  // description's "start here", so until it onboards the adapter adds this to
  // every result (see onboardingReminder).
  const ONBOARDING_REMINDER='You have not called maker_onboarding in this SAAM session. Unless you already have its context in this conversation, call it now, before continuing: it explains how SAAM works and how this connection to the person’s computer works.';
  function noteOnboarding(session,name,args){
    if(name==='maker_onboarding'||name==='read_guidance'&&['makers','MAKERS.md'].includes(args?.guidanceId))session.onboarded=true;
  }
  function observed(session,name,pending){
    const activity=session.activity,listener=name==='wait_for_studio_request';
    if(listener)activity.listening++;else activity.lastCall=Date.now();
    publishWorking();
    return pending.then(result=>{
      if(!listener||result?.requests?.length)activity.lastCall=Date.now();
      return result;
    }).finally(()=>{if(listener)activity.listening--;publishWorking();});
  }
  // guidance: how this session's client reaches SAAM, returned by maker_onboarding.
  function beginSession({listen=LOCAL_LISTEN,remote=false,guidance=null}={}){
    if(runtime.closing)throw Error('The SAAM runtime is closing.');
    if(runtime.session)throw Error('A SAAM session is already active. End it before starting another.');
    if(!(listen.defaultMs<=listen.maxMs&&listen.maxMs<=LISTEN_LIMIT_MS))throw Error('Invalid listener limits.');
    const session={id:randomUUID(),started:Date.now(),ending:null,listen,remote,guidance,onboarded:false,activity:{listening:0,lastCall:0}};runtime.session=session;
    return {id:session.id,
      operations:[...operations.values()].filter(operation=>!(remote&&operation.localOnly)).map(({action,...definition})=>definition),
      invoke:(name,args)=>session.ending?Promise.reject(Error('This SAAM session has ended. Start a new session; saved prints remain available.')):(noteOnboarding(session,name,args),observed(session,name,invoke(name,args,session))),
      onboardingReminder:()=>session.remote&&!session.onboarded?ONBOARDING_REMINDER:null,
      end:()=>endSession(session)};
  }
  function endSession(session){return session.ending??=Promise.resolve().then(async()=>{
    await work.tail;
    await agentRequests.endSession();
    for(const {server:studio} of studioSessions.values())await studio.agentDisconnected(ownerId);
    studioEvents.drain();
    if(runtime.session===session)runtime.session=null;
    publishWorking();
  });}
  function close(){return runtime.closing??=Promise.resolve().then(async()=>{
    if(runtime.session)await endSession(runtime.session);
    await work.tail;
    await agentRequests.disconnect();
    await Promise.all([...studioSessions.values()].map(({server:studio})=>studio.shutdown()));
    studioEvents.close();
    studioSessions.clear();preferredStudioByPrint.clear();
  });}
  // A Studio instance with no print, opened when a relay computer starts so the
  // person can connect a chat. As the sole live instance, request_review reuses it.
  // Shows SAAM Studio: the newest live instance, else a new one with no print.
  // A tab opens only when nobody is viewing it.
  async function openStudio(){
    if(runtime.closing)throw Error('The SAAM runtime is closing.');
    const session=[...studioSessions.values()].filter(({server:studio})=>studio.listening).at(-1)??await startStudio(null);
    const browserOpenRequested=autoOpen&&!session.server.viewerCount()?await openBrowser(session.url):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  return {
    operations:[...operations.values()].map(({action,...definition})=>definition),
    beginSession,
    queuedRequests:async()=>publicBundleIdentity(await agentRequests.query({status:'queued'})),
    chatStatus,
    subscribeStatus,
    subscribeRequests:listener=>agentRequests.subscribe(listener),
    subscribeEvents:listener=>studioEvents.subscribe(events=>listener(publicBundleIdentity(events))),
    // Every Studio event as it is recorded, without draining the agent's queue.
    observeEvents:observer=>studioEvents.observe(events=>observer(publicBundleIdentity(events))),
    openStudio,
    close
  };
}
