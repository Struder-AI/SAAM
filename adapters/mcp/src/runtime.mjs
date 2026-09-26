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
import { applyText } from '../../../core/print/text.mjs';
import { applyHeatSet } from '../../../core/print/heat-set.mjs';
import { INSERT_CATALOG } from '../../../skills/heat-set-inserts/scripts/catalog.mjs';
import {loadLocalExtension} from '../../../core/local-extension.mjs';
import {lifecycleReview} from '../../../core/print/review-state.mjs';
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

export function summary(printId, state) {
  const programChecked=state.programChecked!==false;
  const lifecycle=lifecycleReview(state,{programChecked});
  return {
    printId, kind: state.kind, revision: state.revision, geometryHash:state.geometryHash,
    machineId: state.machine.id, output: state.plan.output, skills: state.skills,
    toolpathApproved: lifecycle.toolpathApproved,
    programChecked,
    generation: state.review.generation ? { mode: state.review.generation.mode, current: lifecycle.current } : null,
    programError: state.programError ?? null, exportHash: state.exportHash ?? null,
    shortTravel: state.program?.summary?.shortTravel ?? null,
    outputAvailability: state.outputAvailability, limitations: state.limitations,
    nextStep: lifecycle.action==='check'?'Open Studio or check_print to check the current export.'
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

export const instructions = 'For a maker edit, your FIRST operation is begin_studio_work, before any acknowledgement, analysis, status check or other tool; printId may be omitted for the active tour. For a tour request with command access, first run node studio/server.mjs --toolkit start-tour --no-open and open the returned Studio URL; then use its returned participation context and listener. Do not read guidance or run onboarding before launching the tour. For ordinary new-part work with missing maker context and command access, run node scripts/agent-toolkit.mjs maker-onboarding once; it supplies makers, the skill digest and print-tools. Otherwise read those missing sources through read_guidance. Reuse current context and choose individual skill manuals for the task; do not reread sources already returned by onboarding. Follow relevant documentation links through read_guidance using their repository-relative path and optional #heading. Shared print-tool usage is available as "print-tools". Create a print and request_review for its geometry. Revisions happen through chat using adjust_print and expectedRevision. Geometry review is advisory: generation may proceed whenever it helps review. The person confirms the exact settings and toolpath together in Studio before export. Establish the printer and material before relying on the toolpath. For an edit to an existing print call begin_studio_work immediately, publish its saved geometry or toolpath target, then resolve its request ID after the requested result is displayed. Geometry-only work needs no slicing. Questions and guidance stay visually quiet. Normal use supports capabilities from any view; only the tour narrows requests to its current lesson under the tour manual. Send edit acknowledgements and lesson guidance immediately in chat commentary BEFORE calling a listener. Never hold an edit reply in a final answer while waiting through later lessons. During tours let Studio lead the early lessons. Keep wait_for_studio_request active, perform start-layer preparation silently, and initiate chat teaching only at the designated infill lesson and completion. Respond normally to participant-requested edits. Use get_tour for the selected print and set_tour_start_at for an explicit infill layer. deliver_print copies the reviewed bytes. No tool grants final settings/toolpath approval or runs hardware. Studio reports what the person does — lesson changes, opened prints, imports, exports, displayed results, failed or cancelled calculations — as studioEvents on tool results, in wait_for_studio_request returns and in notifications; read the queue any time with get_studio_events, which also reports toolpath calculation progress. Events are ordered observations, not simultaneous state: act on the latest.';

// relay: on a computer paired with the SAAM relay, the provider every Studio
// instance shows in its Connect chat panel ({status(), linkCode()}).
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
    studio.once('close',()=>{
      if(studioSessions.get(studioInstanceId)===session)studioSessions.delete(studioInstanceId);
      for(const [id,instance] of preferredStudioByPrint)if(instance===studioInstanceId)preferredStudioByPrint.delete(id);
    });
    return session;
  }
  // One print-work queue per runtime: mutations run in order; immediate tools bypass it.
  const work={tail:Promise.resolve()},operations=new Map();

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
  async function locate(printId) {
    const dir = await directory(printId), bundle = await bundleFor(dir);
    return { dir, bundle };
  }
  async function read(printId, {program='source'}={}) {
    const {dir,bundle}=await locate(printId);
    return {dir,bundle,state:await bundle.loadBundle(dir,{program})};
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
  const localOnlyTools=new Set(['import_stl_print']);
  function tool(name, description, shape, action, readOnly = true, openWorld = false) {
    const tracked=Boolean(shape.printId)&&!immediateTools.has(name);
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
      const touch=async()=>{for(const id of requestIds??[])await agentRequests.activity(id,{directory:await directory(input.printId)});};
      if(operation.tracked)await touch();
      let result;
      try{result=await operation.action(input,session);}finally{if(operation.tracked)await touch();}
      if(result&&typeof result==='object'&&!Array.isArray(result)&&!['get_studio_events','wait_for_studio_request'].includes(name)){
        if(!operation.immediate){const pending=await agentRequests.query({status:'queued'});if(pending.length)result={...result,studioRequests:pending};}
        // Delivered events push at once; every tool result also carries whatever is still queued.
        const events=studioEvents.drain();if(events.length)result={...result,studioEvents:events};
      }
      return result;
    };
    if(operation.immediate)return execute();
    const run=work.tail.then(execute);
    work.tail=run.then(()=>undefined,()=>undefined);
    return run;
  }

  tool('list_machines', 'List installed machine profiles and declared outputs. Catalog presence is not proof that a particular recipe is supported.', {}, async () => MACHINE_IDS.map(id => {
    const m = loadMachine(id);
    return { id, name: m.name, capabilities: m.capabilities, tools: m.tools, materials: m.materials,
      outputs: m.outputs.map(({ id, extension, flavor, implemented, experimental, constraints, reason }) => ({ id, extension, flavor, implemented: implemented !== false, experimental, constraints, reason })),
      defaultSetup: m.defaultSetup };
  }));
  tool('list_skills', 'List the known local toolpath and geometry skill manuals. This fixed list does not establish recipe compatibility; geometry skills are not deposition operations. Select the manual relevant to the requested task.', {}, skills);
  tool('read_skill', 'Read a known skill manual by ID. Follow its relevant documentation links with read_guidance.', { skillId: idSchema }, async ({ skillId }) => {
    if (!SKILL_IDS.includes(skillId)) {
      const local=await localExtension.readSkill?.(skillId);if(local)return local;
      throw new Error('Unknown skill ID. Use list_skills.');
    }
    const { text: manual, ...reference } = await readGuidance(root, `skills/${skillId}/SKILL.md`);
    return { skillId, manual, ...reference };
  });
  tool('read_guidance', 'Read published repository Markdown by relative path, optionally with #heading for one section. Results include resolved documentation links and headings. Short IDs: makers, development, glossary, mcp, print-tools. This reader does not expose private files, source code or register capabilities.',
    { guidanceId: z.string().min(1).max(1024) }, async ({ guidanceId }) => readGuidance(root, guidanceId));
  tool('get_plan_template', 'Get the current complete proposed recipe for a bundle kind and machine, including remembered setup when available. Defaults and remembered setup never confer job approval.',
    { kind: kindSchema, machineId: z.string() }, async ({ kind, machineId }) => ({ kind, machineId,
      plan: await (await bundles[kind]()).proposedPlan(machineId, { setupFile: await setupFile(machineId) }) }));
  tool('list_prints', 'Discover saved print names, machines and modification times. Export and approval status are unchecked; use get_print or check_print for validated status.', {}, async () => {
    const result = [];
    let base;
    try { base = await realpath(libraryRoot); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    for (const entry of await listPrints(base)) {
      const printId = relative(base, entry.path).replaceAll('\\', '/');
      if (!printIdSchema.safeParse(printId).success) continue;
      try { await directory(printId);result.push({printId,name:entry.name,machine:entry.machine,modified:entry.modified,programChecked:false}); }
      catch (error) { result.push({ printId, error: error.message }); }
    }
    return result;
  });
  tool('get_print', 'Read fresh validated status and recipe settings. Geometry is omitted by default and planComplete is false; set includeGeometry to obtain the complete editable recipe. SAAMpath and program arrays are always omitted.', { printId: printIdSchema, includeGeometry: z.boolean().optional() }, async ({ printId, includeGeometry = false }) => {
    const { state } = await read(printId);
    const plan = structuredClone(state.plan);
    if (!includeGeometry) delete plan.geometry;
    return { ...summary(printId, state), plan, planComplete: includeGeometry,
      ...(!includeGeometry ? { geometry: { omitted: true, shape: state.plan.geometry.shape ?? 'unknown',
        nativeFile: state.geometry.nativeFile, boundsMm: state.geometry.boundsMm } } : {}) };
  });
  tool('create_print', 'Create an unapproved persistent bundle. Optional plan is a complete recipe, never an approval. Then request_review.',
    { printId: printIdSchema, kind: kindSchema, machineId: z.string(), plan: objectSchema.optional() }, async ({ printId, kind, machineId, plan }) => {
      noApprovalFields(plan);
      const machine = loadMachine(machineId), recipe = await recipes[kind]();
      if (plan) recipe.validatePlan(plan, machine);
      const dir = await directory(printId, { create: true }), bundle = await bundles[kind]();
      await bundle.initBundle(dir, plan, { machineId, setupFile: await setupFile(machineId) });
      return summary(printId, await bundle.loadBundle(dir));
    }, false);
  tool('import_stl_print', 'Import a local STL into a new named bundle. Default units auto chooses a reasonable mm/inch assumption from model size and printer bounds, without interrupting the person; honor explicit units when supplied. Preserves source bytes and hash and reuses remembered setup. Show geometry dimensions; units can be corrected with set_stl_units.',
    { printId: printIdSchema, sourcePath: z.string().min(1).max(4096), units: z.enum(['auto','mm', 'inch']).default('auto'), machineId: z.string() },
    async ({ printId, sourcePath, units, machineId }) => {
      loadMachine(machineId);
      if (!isAbsolute(sourcePath) || !/\.stl$/i.test(sourcePath)) throw new Error('Choose an absolute path to a local .stl source file.');
      const source = await stat(sourcePath);
      if (!source.isFile() || source.size > 64 * 1024 * 1024) throw new Error('STL source must be a regular file no larger than 64 MiB.');
      const dir = await directory(printId, { create: true });
      await importSTLBundle(dir, sourcePath, { units, machineId, setupFile: await setupFile(machineId) });
      return summary(printId, await (await bundles.shell()).loadBundle(dir));
    }, false);
  tool('search_thingi10k', 'Find meshes by descriptive keywords (such as bunny), numeric file ID or a Thingiverse thing URL. Reads the Thingi10K mirror index; returns per-file source and license links. Prefer making tailored geometry when attractive. Read the thingi10k skill manual.',
    {query:z.string().min(1).max(500),limit:z.number().int().min(1).max(50).default(10),offset:z.number().int().min(0).max(10000).default(0)},
    async args=>meshLibrary.search(args),true,true);
  tool('import_thingi10k_print', 'Download a selected Thingi10K STL file ID on the SAAM host and import an unapproved print. ALWAYS give its license link in chat and briefly identify the source unless obvious. Returns attribution and a retained download even if strict mesh import fails. Review geometry with request_review after successful import.',
    {printId:printIdSchema,fileId:z.string().regex(/^[1-9][0-9]{0,11}$/),machineId:z.string(),units:z.enum(['auto','mm','inch']).default('auto')},
    async({printId,fileId,machineId,units})=>{
      const dir=await directory(printId,{create:true});
      const result=await importThingi10KBundle(meshLibrary,dir,fileId,{machineId,units,setupFile:await setupFile(machineId)});
      return {...result,...(result.imported?summary(printId,await (await bundles.shell()).loadBundle(dir)):{printId})};
    },false,true);
  localExtension.registerMcp?.({tool,z,printIdSchema,objectSchema,idSchema,read,noApprovalFields});
  tool('set_stl_units','Correct an imported mesh to mm or inch units, rescaling its current geometry and preserving the original STL bytes and printing settings. Invalidates geometry/toolpath confirmations; show the corrected size for geometry review.',
    {printId:printIdSchema,units:z.enum(['mm','inch']),expectedRevision:z.string()},async({printId,units,expectedRevision})=>{
      const dir=await directory(printId);return summary(printId,await setSTLUnits(dir,units,{expectedRevision}));
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
      const {dir,state}=await read(printId,{program:false});
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      return summary(printId,await updateGridfinityBundle(dir,parameters,{expectedRevision,part}));
    },false);
  tool('apply_text', 'Add, edit or remove raised/recessed text using a local font and a part or independent spline reference. Read the text skill for request fields. Rebuilds actual geometry and invalidates approvals; use request_review afterward.',
    {printId:printIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({printId,expectedRevision,request},session)=>{
      noApprovalFields(request);
      if(session?.remote&&request.feature?.fontPath!==undefined)await requireSystemFont(String(request.feature.fontPath));
      const {dir,state}=await read(printId,{program:false});
      if(state.kind!=='shell')throw new Error('Text modifies shared shell/mesh prints.');
      return summary(printId,await applyText(dir,request,{expectedRevision}));
    },false);
  tool('heat_set_catalog', 'Read the packaged heat-set insert profiles and their dimensions. Use an exact insert ID with apply_heat_set and read the heat-set-inserts skill for geometry and reinforcement limits.',
    {},async()=>({inserts:INSERT_CATALOG}));
  tool('apply_heat_set', 'Add, edit or remove a heat-set insert hole and its six-loop reinforcement with connecting fins. Read the heat-set-inserts skill for request fields and supported geometry. Rebuilds geometry and invalidates affected approvals; use request_review afterward.',
    {printId:printIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({printId,expectedRevision,request})=>{
      noApprovalFields(request);
      const {dir,state}=await read(printId,{program:false});
      if(state.kind!=='shell')throw new Error('Heat-set inserts modify shared shell/mesh prints.');
      return summary(printId,await applyHeatSet(dir,request,{expectedRevision}));
    },false);
  tool('adjust_print', 'Apply a validated chat recipe patch at expectedRevision. Geometry or process edits invalidate the final settings/toolpath confirmation. Read fresh state if stale.',
    { printId: printIdSchema, expectedRevision: z.string().min(1), patch: objectSchema }, async ({ printId, expectedRevision, patch }) => {
      noApprovalFields(patch);
      const { dir, bundle, state } = await read(printId,{program:false});
      const next = await bundle.adjustBundle(dir, patch, { expectedRevision, setupFile: await setupFile(state.machine.id) });
      return summary(printId, next);
    }, false);
  tool('check_print', 'Validate saved native geometry, recipe and any exact generated export using the shared bundle checks. Does not generate or approve.', { printId: printIdSchema }, async ({ printId }) => {
    const { state } = await read(printId);
    if (state.programError) throw new Error(state.programError);
    return { ...summary(printId, state), checked: state.program ? ['geometry', 'plan', 'exact-export'] : ['geometry', 'plan'], physicalValidation: 'not performed' };
  });
  tool('check_path', 'Check path feasibility using the same generator, without approvals or persisted SAAMpath/export artifacts. Reports software checks only; production generation and exact-export review remain required.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle } = await locate(printId);
    return { printId, ...await bundle.checkPathBundle(dir), physicalValidation: 'not performed' };
  });
  tool('remember_setup', 'Remember this saved print setup for later prints on the same machine, shared with CLI initialization. This saves setup defaults, never job approvals.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle, state } = await read(printId,{program:false});
    await bundle.rememberSetup(dir, { setupFile: await setupFile(state.machine.id) });
    return { printId, machineId: state.machine.id, remembered: true, approvalsChanged: false };
  }, false);
  tool('get_approval_status', 'Read the fresh hash-bound final settings/toolpath approval from the saved bundle. Caller-provided approvals are never accepted.', { printId: printIdSchema }, async ({ printId }) => summary(printId, (await read(printId)).state));
  tool('begin_studio_work','Start Studio work as early as practical for an edit to an existing print — you may acknowledge the person first; the claim it records is what later mutations and result reports check, so make it before either. Identify the Studio instance when more than one is open. Edits start Updating preview; guidance stays visually quiet. For a Studio-originated request, pass its requestId to claim that request. Resolve every started request with respond_to_studio_request.',
    {printId:printIdSchema.optional(),studioInstanceId:z.string().optional(),instruction:z.string().min(1).max(8000),requestId:z.string().optional(),kind:z.enum(['edit','guidance']).default('edit')},async({printId,studioInstanceId,instruction,requestId,kind})=>{
      const record=requestId?await agentRequests.get(requestId):null;
      if(!studioInstanceId&&record?.studioInstanceId)studioInstanceId=record.studioInstanceId;
      const session=studioInstanceId?studioSessions.get(studioInstanceId):null;
      if(studioInstanceId&&!session)throw Error('That Studio instance is not owned by this agent.');
      if(!printId&&record)printId=record.printId;
      if(!printId){const guide=await tour.info(),selected=guide.active?guide.directory:session?.server.currentPrint()??(studioSessions.size===1?[...studioSessions.values()][0].server.currentPrint():null);if(!selected)throw Error('Specify printId or studioInstanceId when no single active Studio instance is available.');printId=agentRequests.printId(selected);}
      const dir=await directory(printId);
      if(!studioInstanceId){
        const matches=[...studioSessions.values()].filter(candidate=>candidate.server.currentPrint()===dir);
        if(matches.length>1)throw Error('Specify studioInstanceId because multiple owned Studio instances display this print.');
        if(matches.length===1)studioInstanceId=matches[0].server.agentSession().instanceId;
      }
      if(session&&session.server.currentPrint()!==dir)throw Error('That Studio instance is displaying another print.');
      if(requestId){if(record?.printId!==printId)throw Error('That request belongs to another print.');if(record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');return agentRequests.update(requestId,{status:'working'});}
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
  tool('get_studio_requests','Read outstanding work and the latest edit outcome per print. Set history for all resolved records; optionally restrict to one print.',{printId:printIdSchema.optional(),history:z.boolean().default(false)},async options=>({requests:await agentRequests.query(options)}));
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
    {printId:printIdSchema,machineId:z.string(),expectedRevision:z.string()},async({printId,machineId,expectedRevision})=>{
      const {dir,bundle}=await locate(printId);if(!bundle.changeMachine)throw Error('This adapter cannot change its printer.');
      return summary(printId,await bundle.changeMachine(dir,machineId,{expectedRevision,setupFile:await setupFile(machineId)}));
    },false);
  tool('request_review', 'Serve this bundle through an exclusively owned SAAM Studio instance. Reuse is the default: the instance already showing this print, else the sole live instance, is rebound to it in the same browser tab. With several live instances supply studioInstanceId to choose the one to rebind; otherwise an unshown print opens another. Use newInstance only when the person asks for another Studio, or for a compelling reason you tell them. Optional startAt selects the tour infill layer. No approval or generation is performed.', { printId: printIdSchema,studioInstanceId:z.string().optional(),newInstance:z.boolean().default(false),startAt:z.object({layer:z.number().int().min(1)}).strict().optional(),...localExtension.reviewSchema?.(z) }, async ({ printId,studioInstanceId,newInstance,startAt,...viewOptions }) => {
    if(studioInstanceId&&newInstance)throw Error('Choose an existing studioInstanceId or request a new instance, not both.');
    const { dir, state } = await read(printId);
    const viewPath=await localExtension.reviewPath?.({dir,...viewOptions})??'';
    let session=studioInstanceId?studioSessions.get(studioInstanceId):newInstance?null:studioSessions.get(preferredStudioByPrint.get(printId))
      ??[...studioSessions.values()].find(({server:studio})=>studio.currentPrint()===dir)
      // Switching prints reuses the sole live instance; several leave the choice to studioInstanceId.
      ??(studioSessions.size===1?[...studioSessions.values()][0]:undefined);
    if(studioInstanceId&&!session)throw Error('That Studio instance is not owned by this agent.');
    if (!session?.server.listening) session=await startStudio(dir);
    await session.server.openPrint(dir);
    preferredStudioByPrint.set(printId,session.server.agentSession().instanceId);
    if(startAt)await session.server.setStartAt(startAt);
    const url=session.url+viewPath;
    // An open viewer is rebound in place; only a Studio nobody is viewing opens a tab.
    const browserOpenRequested = autoOpen && !session.server.viewerCount() ? await openBrowser(url) : false;
    return { ...summary(printId, state),studioInstanceId:session.server.agentSession().instanceId, url, browserOpenRequested };
  }, false);
  tool('close_studio_session','Close one Studio instance owned by this agent without affecting other instances or the shared print bundle.',{studioInstanceId:z.string()},async({studioInstanceId})=>{
    const session=studioSessions.get(studioInstanceId);if(!session)throw Error('That Studio instance is not owned by this agent.');
    const result=session.server.agentSession();await session.server.shutdown();return {...result,connected:false};
  },false);
  tool('generate_print', 'Generate and check the declared export from the current geometry and complete settings, including during the tour. This is reviewable output, not approval.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle } = await locate(printId);
    const checks = await bundle.generateBundle(dir,{development:false});
    return { ...summary(printId, await bundle.loadBundle(dir)), checks };
  }, false);
  tool('deliver_print', 'Copy the exact current human-reviewed export bytes into the bundle delivery folder. Fails without current toolpath approval. Does not run hardware.', { printId: printIdSchema }, async ({ printId }) => {
    const { dir, bundle } = await locate(printId);
    const file = await bundle.deliver(dir), state = await bundle.loadBundle(dir);
    return { ...summary(printId, state), file, exportHash: state.exportHash };
  }, false);
  // The runtime outlives its sessions: Studio instances, jobs and bundles stay
  // while chats come and go. One session is active at a time; an ended
  // session's late calls are rejected rather than run for its successor.
  const runtime={closing:null,session:null};
  // listen: how long this session's client may hold a wait (default and ceiling).
  // remote: a web chat through the relay; it neither sees nor runs local-only operations.
  function beginSession({listen=LOCAL_LISTEN,remote=false}={}){
    if(runtime.closing)throw Error('The SAAM runtime is closing.');
    if(runtime.session)throw Error('A SAAM session is already active. End it before starting another.');
    if(!(listen.defaultMs<=listen.maxMs&&listen.maxMs<=LISTEN_LIMIT_MS))throw Error('Invalid listener limits.');
    const session={id:randomUUID(),ending:null,listen,remote};runtime.session=session;
    return {id:session.id,
      operations:[...operations.values()].filter(operation=>!(remote&&operation.localOnly)).map(({action,...definition})=>definition),
      invoke:(name,args)=>session.ending?Promise.reject(Error('This SAAM session has ended. Start a new session; saved prints remain available.')):invoke(name,args,session),
      end:()=>endSession(session)};
  }
  function endSession(session){return session.ending??=Promise.resolve().then(async()=>{
    await work.tail;
    await agentRequests.endSession();
    for(const {server:studio} of studioSessions.values())await studio.agentDisconnected(ownerId);
    studioEvents.drain();
    if(runtime.session===session)runtime.session=null;
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
    queuedRequests:()=>agentRequests.query({status:'queued'}),
    subscribeRequests:listener=>agentRequests.subscribe(listener),
    subscribeEvents:listener=>studioEvents.subscribe(listener),
    openStudio,
    close
  };
}
