import {applyExtensionEdit,createExtensionBundle} from '../../../core/print/extension-edits.mjs';
// The local SAAM runtime: every agent operation over the same bundle lifecycle
// and Studio used by the CLI, and the Studio/request state they share. It knows
// no transport; the local stdio MCP adapter registers these operations.
import { z } from 'zod';
import { mkdir, readdir, lstat, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {openBrowser} from '../../../studio/browser.mjs';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {PreparedGenerationJob} from '../../../studio/prepared-generation-job.mjs';
import {changeMachine,rememberSetup,adjustSettings,recordExtensionDependency} from '../../../core/machine/bundle-settings.mjs';
import {SETTINGS_FIELDS} from '../../../core/machine/settings.mjs';
import { MACHINE_IDS, loadMachine } from '../../../core/machine/profile.mjs';
import { createStudio, listPrints } from '../../../studio/server.mjs';
import { bundleFor } from '../../../studio/adapter-resolution.mjs';
import {createTour,tourExample} from '../../../studio/tour.mjs';
import {createAgentRequests} from '../../../studio/agent-requests.mjs';
import {createStudioEvents} from '../../../studio/studio-events.mjs';
import {listExtensions,loadExtensionEntry,readExtension} from '../../../core/extensions/library.mjs';
import {createBlobFieldBundle,updateBlobFieldBundle} from '../../../core/agent/blob-field.mjs';
import {applySlice} from '../../../core/print/slice-edit.mjs';
import {applyModulation} from '../../../core/print/modulation.mjs';
import {intersectRequest,combineGeometry} from '../../../core/print/geometry-tools.mjs';
import {loadLocalExtension} from '../../../core/local-extension.mjs';
import {lifecycleReview} from '../../../core/print/review-state.mjs';
import { readGuidance, readManual } from './manuals.mjs';
import { onboardingSources, machineHint } from '../../../core/agent/layers.mjs';
import { SKILL_IDS, GUIDANCE_IDS, EXTENSION_IDS, skillMetadata } from '../../../skills/catalog.mjs';
import {slicePatchSchema,modulationPatchSchema,geometrySchema,patchSchema,draftFamilySchema} from './deposition-schemas.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const installedExtension=await loadLocalExtension(root);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).refine(id => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id), 'Reserved filename.');
// Human file/folder names and Studio's library are supported.
// Separators are canonical forward slashes; every ancestor is checked below.
const bundleIdSchema = z.string().min(1).refine(id => {
  const parts = id.split('/');
  return parts.every(part => part.length > 0
    && !/^[.]|[. ]$|[\\:*?"<>|\x00-\x1f]/.test(part)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}, 'Invalid print name: use relative folder names, without traversal, reserved names or Windows path characters.');
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
    machineId: state.machine?.id??null, output: state.plan.output, skills: state.skills,
    toolpathApproved: lifecycle.toolpathApproved,
    programChecked,
    generation: state.review.generation ? { mode: state.review.generation.mode, current: lifecycle.current } : null,
    programError: state.programError ?? null, exportHash: state.exportHash ?? null,
    shortTravel: state.program?.summary?.shortTravel ?? null,
    outputAvailability: state.outputAvailability, limitations: state.limitations,
    nextStep: !state.machine?'Supply the machine, material and recipe components needed for the requested operation.':lifecycle.action==='check'?'Open Studio or check_bundle to check the current export.'
      : lifecycle.action==='generate'?'Generate the toolpath from the complete settings.'
      : lifecycle.action==='review'?'Review settings and the exact toolpath together in Studio.':'Deliver the reviewed export.'
  };
}

export const LOCAL_LISTEN=Object.freeze({defaultMs:25000,maxMs:25000}),LISTEN_LIMIT_MS=25000;

export const instructions = 'Desktop Claude Code and Codex use this local SAAM MCP server with command access. For a maker edit to an existing print, call begin_studio_work before changing the print; for a tour, use the installed toolkit to start Studio first and follow its returned participation context. For ordinary new-part work, call maker_onboarding once if its context is missing, then read individual skill manuals as needed. The maker role does not authorize guidance authoring or core development; use the corresponding local toolkit onboarding and required authorization for those roles. A person confirms exact settings and toolpath together in Studio before export. Establish the printer and material before relying on a toolpath. Studio requests and events arrive through tool results, MCP notifications, wait_for_studio_request and get_studio_events. Acknowledge completed edits before waiting for more Studio requests. Events are ordered observations; act on the latest. No tool grants hardware operation or final approval.';

// The optional service supplies Studio's release and diagnostics controls.
export function createLocalRuntime({ printsRoot = resolve(root, 'Prints'), autoOpen = process.env.SAAM_NO_AUTO_OPEN !== '1',localExtension=installedExtension,thingi10kClient,relay } = {}) {
  const libraryRoot = resolve(printsRoot);
  let resourceClient;
  const getResourceClient=async()=>resourceClient??=loadExtensionEntry('thingi10k','resource-client')
    .then(create=>create({cacheDirectory:resolve(libraryRoot,'.thingi10k')}));
  const meshLibrary=thingi10kClient??{
    search:async args=>(await getResourceClient()).search(args),
    download:async(fileId,options)=>(await getResourceClient()).download(fileId,options)
  };
  const ownerId=randomUUID();
  const studioEvents=createStudioEvents(),agentRequests=createAgentRequests(libraryRoot,{ownerId,events:studioEvents});
  const tour=createTour(libraryRoot,{ownerId,agentRequests});
  const studioSessions = new Map(),preferredStudioByPrint=new Map(),imports=new Map(),generations=new Map();
  const generationStatus=()=>[...[...studioSessions.values()].map(({server:studio})=>studio.generationStatus()).filter(Boolean),
    ...[...imports.values()].map(({controller,...job})=>({...job,cancellable:!controller.signal.aborted,elapsedMs:Date.now()-job.startedAt,estimatedRemainingMs:null})),
    ...[...generations.values()].map(({job,...identity})=>({...identity,studioInstanceId:null,status:job.status,cancellable:job.cancellable,progress:job.progress,elapsedMs:Date.now()-identity.startedAt}))];
  async function importSTL(bundleId,dir,{source,units,machineId,setupFile:remembered}){
    const jobId=randomUUID(),controller=new AbortController(),startedAt=Date.now();
    imports.set(jobId,{jobId,printId:bundleId,studioInstanceId:null,status:'importing',startedAt,controller,progress:{stage:'import'}});
    studioEvents.record('import-started',{jobId,printId:bundleId});
    const progress=value=>{
      const before=imports.get(jobId);imports.set(jobId,{...before,progress:value});
      if(value.stage==='repair'&&before.progress.stage!=='repair')studioEvents.record('import-repair-started',{jobId,printId:bundleId,elapsedMs:Date.now()-startedAt});
    };
    let downloaded,candidate,phase='acquire';
    try{
      const sourcePath=source.kind==='local'?source.path:(downloaded=await meshLibrary.download(source.fileId,{signal:controller.signal,progress})).sourcePath;
      controller.signal.throwIfAborted();
      phase='geometry';
      const {prepareSTLImport,releaseSTLImport}=await import('../../../core/geom/import-stl.mjs');
      candidate=await prepareSTLImport(sourcePath,{units,attribution:downloaded?.attribution,signal:controller.signal,progress});
      let committed;
      try{
        phase='bundle';
        const {commitSTLImport}=await import('../../../core/print/import-stl.mjs');
        committed=await commitSTLImport(dir,candidate,{machineId,setupFile:remembered,signal:controller.signal});
        phase='cleanup';
      }finally{await releaseSTLImport(candidate);}
      studioEvents.record('import-completed',{jobId,printId:bundleId});
      return downloaded?{...downloaded,...committed,imported:true,nextStep:'Show the imported geometry in Studio with its dimensions. Nothing is approved.'}:committed;
    }catch(error){
      if(downloaded&&!controller.signal.aborted&&(phase==='geometry'||phase==='bundle')){
        const result={...downloaded,imported:false,error:error.message,
          nextStep:'The downloaded original and attribution are retained at sourcePath and sourcePath + .json. Automatic repair could not accept this input; explain the reported failure and choose a corrected source or ask a builder to diagnose it.'};
        studioEvents.record('import-failed',{jobId,printId:bundleId,error:error.message});return result;
      }
      studioEvents.record(controller.signal.aborted?'import-cancelled':'import-failed',{jobId,printId:bundleId,error:error.message});throw error;
    }
    finally{imports.delete(jobId);}
  }
  // Every runtime-owned Studio instance starts here, showing dir or no print.
  async function startStudio(dir){
    const studio = createStudio(dir, { libraryRoot,agentOwnerId:ownerId,agentRequests,studioEvents,relay });
    try{await studio.ready();}catch(error){await studio.shutdown().catch(()=>{});throw error;}
    try{await new Promise((resolveListen, reject) => { studio.once('error', reject); studio.listen(0, '127.0.0.1', resolveListen); });}
    catch(error){await studio.shutdown().catch(()=>{});throw error;}
    const session = { server: studio, url: `http://127.0.0.1:${studio.address().port}` },studioInstanceId=studio.agentSession().instanceId;
    studioSessions.set(studioInstanceId, session);
    studio.agentWorking(agent.working);
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
  // Settings select available guidance; only summary consumes the print state.
  async function withMachineHint(bundleId,state,machine){
    const result=summary(bundleId,state),hint=await machineHint(root,{to:machine});
    return hint?{...result,gatedGuidance:hint}:result;
  }
  async function skills() {
    const found = [];
    for (const id of [...SKILL_IDS,...GUIDANCE_IDS]) {
      try {
        const { text: manual } = await readGuidance(root, `skills/${id}/SKILL.md`);
        found.push({ ...skillMetadata(id, manual), manualTool: 'read_skill' });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for(const extension of await listExtensions({appRoot:root})){
      const {text:manual}=await readGuidance(root,`extensions/${extension.id}/SKILL.md`);
      found.push({...skillMetadata(extension.id,manual),layer:'extension',origin:extension.origin,
        digest:extension.digest,manualTool:'read_skill'});
    }
    found.push(...await localExtension.skills?.()??[]);
    return found.sort((a, b) => a.id.localeCompare(b.id));
  }
  const immediateTools=new Set(['begin_studio_work','respond_to_studio_request','wait_for_studio_request','get_studio_requests','get_studio_events','get_studio_sessions','cancel_studio_calculation','get_tour']);
  const operationObservers=new Set();
  const diagnosticFields=(value,keys)=>Object.fromEntries(keys.filter(key=>value&&Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  const reportOperation=event=>{for(const observer of operationObservers)try{observer(event);}catch{/* Diagnostics never fail an operation. */}};
  function tool(name, description, shape, action, readOnly = true, openWorld = false) {
    const tracked=Boolean(shape.bundleId)&&!immediateTools.has(name);
    const instanceScope=tracked&&!readOnly&&!['request_review','create_bundle','import_stl_bundle','import_thingi10k_bundle','remember_setup','deliver_toolpath'].includes(name);
    // The full strict schema makes unexpected top-level approval data an error
    // instead of letting Zod silently discard it.
    const schema=z.object({...shape,...(tracked?{requestIds:z.array(z.string()).optional()}: {}),...(instanceScope?{studioInstanceId:z.string().optional()}: {})}).strict();
    operations.set(name,{name,description,schema,readOnly,openWorld,tracked,instanceScope,immediate:immediateTools.has(name),action});
  }
  async function associatedStudio(bundleId,studioInstanceId,requestIds){
    const dir=await directory(bundleId);
    const requested=[];
    for(const id of requestIds??[]){
      const record=await agentRequests.get(id);
      if(record?.studioInstanceId)requested.push(record.studioInstanceId);
    }
    if(studioInstanceId)requested.push(studioInstanceId);
    const ids=[...new Set(requested)];
    if(ids.length>1)throw Error('Edit requests name different Studio instances. Choose one before changing the print.');
    if(!ids.length){
      const matches=[...studioSessions.entries()].filter(([,session])=>session.server.currentPrint()===dir);
      if(matches.length>1)throw Error('Specify studioInstanceId because multiple owned Studio instances display this print.');
      if(matches.length===1)ids.push(matches[0][0]);
    }
    if(!ids.length)return null;
    const session=studioSessions.get(ids[0]);
    if(!session||session.server.currentPrint()!==dir)throw Error('That Studio instance is not owned by this agent or no longer displays this print.');
    return {dir,server:session.server};
  }
  // Runs one operation to its result and throws its failure; the transport
  // decides how either reaches the agent.
  // `session` carries per-session limits, such as how long this client may listen.
  function invoke(name,args={},session){
    const operation=operations.get(name);
    if(!operation)return Promise.reject(Error(`Unknown SAAM operation ${name}.`));
    const execute=async()=>{
      const started=operationObservers.size?Date.now():null;
      try{
        const {requestIds,...input}=operation.schema.parse(args);
        const touch=async()=>{for(const id of requestIds??[])await agentRequests.activity(id,{directory:await directory(input.bundleId)});};
        if(operation.tracked)await touch();
        let result;
      try{
        if(operation.instanceScope){
          const {studioInstanceId,...fields}=input;
          const studio=await associatedStudio(fields.bundleId,studioInstanceId,requestIds);
          result=studio?await studio.server.runBundleEdit(studio.dir,instance=>operation.action(fields,session,instance)):await operation.action(fields,session);
        }else result=await operation.action(input,session);
      }finally{if(operation.tracked)await touch();}
        if(started!==null)reportOperation({kind:'operation',name,status:'completed',durationMs:Date.now()-started,readOnly:operation.readOnly,
          parameters:diagnosticFields(input,['bundleId','kind','machineId','units','action','expectedRevision','skillId']),
          result:diagnosticFields(result,['revision','geometryHash','generationHash','exportHash','toolpathApproved','programChecked','imported','status'])});
        if(result&&typeof result==='object'&&!Array.isArray(result)&&!['get_studio_events','wait_for_studio_request'].includes(name)){
          if(!operation.immediate){const pending=await agentRequests.query({status:'queued'});if(pending.length)result={...result,studioRequests:pending};}
          // Delivered events push at once; every tool result also carries whatever is still queued.
          const events=studioEvents.drain();if(events.length)result={...result,studioEvents:events};
        }
        return publicBundleIdentity(result);
      }catch(error){if(started!==null)reportOperation({kind:'operation',name,status:'failed',durationMs:Date.now()-started,
        parameters:diagnosticFields(args,['bundleId','kind','machineId','units','action','expectedRevision','skillId']),error:error.message});throw error;}
    };
    if(operation.immediate)return execute();
    const run=work.tail.then(execute);
    work.tail=run.then(()=>undefined,()=>undefined);
    return run;
  }

  // The desktop client has local command access, including script sections.
  const machineIdSchema=z.string().optional().describe('Reusable printer profile for discovery before selecting a bundle. Use bundleId for saved capabilities.');
  async function manualContext({bundleId,machineId}){
    if(bundleId)return {client:'script',machine:(await read(bundleId,{program:false})).state.machine};
    return {client:'script',machineId};
  }
  tool('maker_onboarding','Start here for maker work when context is missing. Returns maker guidance, the skill index and print tools, including local script sections. Reuse it for the conversation.',
    {machineId:machineIdSchema,bundleId:bundleIdSchema.optional()}, async ({machineId,bundleId}) => ({ role:'maker',
      sources: await onboardingSources(root,await manualContext({machineId,bundleId})),
      nextStep: 'Reuse these sources for the conversation. Read skill manuals (read_skill) and linked references (read_guidance) when a task needs them. Authoring guidance uses builder onboarding in the local toolkit; core implementation requires explicit developer authorization.' }));
  tool('list_machines', 'List installed machine profiles and declared outputs. Catalog presence is not proof that a particular recipe is supported.', {}, async () => MACHINE_IDS.map(id => {
    const m = loadMachine(id);
    return { id, name: m.name, capabilities: m.capabilities, tools: m.tools, materials: m.materials,
      outputs: m.outputs.map(({ id, extension, flavor, implemented, experimental, constraints, reason }) => ({ id, extension, flavor, implemented: implemented !== false, experimental, constraints, reason })),
      defaultSetup: m.defaultSetup };
  }));
  tool('list_skills', 'List toolpath, geometry, hybrid, guidance and extension manuals. Extensions compose engine operations; catalog membership does not establish recipe compatibility.', {}, skills);
  tool('read_skill', 'Read a skill or guidance manual by ID, or one section as ID#heading whatever its gate. Sections gated to command access or to machine capabilities are listed in omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Links are repository paths for read_guidance.',
    { skillId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}(#[^\s#]{1,200})?$/), machineId: machineIdSchema, bundleId:bundleIdSchema.optional() }, async ({ skillId: name, machineId,bundleId }) => {
    const [skillId, anchor] = name.split('#');
    const extension=await readExtension(skillId,{appRoot:root});
    if (!SKILL_IDS.includes(skillId)&&!GUIDANCE_IDS.includes(skillId)&&!extension) {
      const local=await localExtension.readSkill?.(skillId);if(local)return local;
      throw new Error('Unknown skill or guidance manual ID. Use list_skills and its manual links.');
    }
    const { text: manual, ...reference } = await readManual(root, `${extension?'extensions':'skills'}/${skillId}/SKILL.md${anchor ? '#' + anchor : ''}`, await manualContext({machineId,bundleId}));
    return { skillId, manual, ...reference };
  });
  tool('read_guidance', 'Read published repository Markdown by relative path, optionally with #heading for one section whatever its gate. Results list the headings with their gates and the gated sections omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Short IDs: makers, geometry, development, glossary, mcp, print-tools. This reader does not expose private files, source code or register capabilities.',
    { guidanceId: z.string().min(1), machineId: machineIdSchema,bundleId:bundleIdSchema.optional() }, async ({ guidanceId, machineId,bundleId }) => readManual(root, guidanceId, {...await manualContext({machineId,bundleId}),headings:true}));
  tool('get_recipe_defaults', 'Get process, setup and common assignment defaults, including remembered setup. Supply geometry or standalone Trace/Inject assignments before create_bundle. Defaults never confer job approval.',
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
    return { ...summary(bundleId, state), plan, planComplete: includeGeometry||!state.plan.geometry,
      ...(!includeGeometry&&state.geometry ? { geometry: { omitted: true, shape: state.plan.geometry?.shape ?? 'unknown',
        nativeFile: state.geometry.nativeFile, boundsMm: state.geometry.boundsMm } } : {}) };
  });
  tool('create_bundle', 'Create an unapproved bundle with authored/imported geometry or standalone Trace/Inject assignments. Defaults alone are incomplete. Then request_review.',
    { bundleId: bundleIdSchema, kind: kindSchema, machineId: z.string(), plan: objectSchema }, async ({ bundleId, kind, machineId, plan }) => {
      noApprovalFields(plan);
      const machine = loadMachine(machineId), recipe = await recipes[kind]();
      recipe.validatePlan(plan);
      const dir = await directory(bundleId, { create: true }), bundle = await bundles[kind]();
      await bundle.initBundle(dir, plan, { machineId, setupFile: await setupFile(machineId) });
      return withMachineHint(bundleId, await bundle.loadBundle(dir), machine);
    }, false);
  tool('import_stl_bundle', 'Import a local STL into a new named bundle. Default units auto chooses a reasonable mm/inch assumption from model size and printer bounds, without interrupting the person; honor explicit units when supplied. Preserves source bytes and hash and reuses remembered setup. Show geometry dimensions; units can be corrected with set_stl_units.',
    { bundleId: bundleIdSchema, sourcePath: z.string().min(1), units: z.enum(['auto','mm', 'inch']).default('auto'), machineId: z.string() },
    async ({ bundleId, sourcePath, units, machineId }) => {
      loadMachine(machineId);
      if (!isAbsolute(sourcePath) || !/\.stl$/i.test(sourcePath)) throw new Error('Choose an absolute path to a local .stl source file.');
      const source = await stat(sourcePath);
      if (!source.isFile()) throw new Error('STL source must be a regular file.');
      const dir = await directory(bundleId, { create: true });
      const remembered=await setupFile(machineId);
      await importSTL(bundleId,dir,{source:{kind:'local',path:sourcePath},units,machineId,setupFile:remembered});
      return summary(bundleId, await (await bundles.shell()).loadBundle(dir));
    }, false);
  tool('search_thingi10k', 'Find meshes by descriptive keywords (such as bunny), numeric file ID or a Thingiverse thing URL. Reads the Thingi10K mirror index; returns per-file source and license links. Prefer making tailored geometry when attractive. Read the thingi10k skill manual.',
    {query:z.string().min(1),limit:z.number().int().min(1).default(10),offset:z.number().int().min(0).default(0)},
    async args=>meshLibrary.search(args),true,true);
  tool('import_thingi10k_bundle', 'Download a selected Thingi10K STL file ID on the SAAM host and import an unapproved print. ALWAYS give its license link in chat and briefly identify the source unless obvious. Recognized defects receive automatic repair; returns attribution and a retained download even if import fails. Review geometry with request_review after successful import.',
    {bundleId:bundleIdSchema,fileId:z.string().regex(/^[1-9][0-9]{0,11}$/),machineId:z.string(),units:z.enum(['auto','mm','inch']).default('auto')},
    async({bundleId,fileId,machineId,units})=>{
      const dir=await directory(bundleId,{create:true});
      const remembered=await setupFile(machineId);
      const result=await importSTL(bundleId,dir,{source:{kind:'thingi10k',fileId},machineId,units,setupFile:remembered});
      return {...result,...(result.imported?summary(bundleId,await (await bundles.shell()).loadBundle(dir)):{bundleId})};
    },false,true);
  localExtension.registerMcp?.({tool,z,bundleIdSchema,objectSchema,idSchema,read,noApprovalFields});
  tool('set_stl_units','Correct an imported mesh to mm or inch units, rescaling its current geometry and preserving the original STL bytes and printing settings. Invalidates geometry/toolpath confirmations; show the corrected size for geometry review.',
    {bundleId:bundleIdSchema,units:z.enum(['mm','inch']),expectedRevision:z.string()},async({bundleId,units,expectedRevision})=>{
      const {setSTLUnits}=await import('../../../core/print/import-stl.mjs');
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
        return summary(bundleId,await createExtensionBundle(dir,'gridfinity',parameters,{machineId,setupFile:await setupFile(machineId)}));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      if(!expectedRevision)throw Error('Gridfinity edits require expectedRevision from the current print.');
      return summary(bundleId,await applyExtensionEdit(dir,'gridfinity',parameters,{expectedRevision,part}));
    },false);
  tool('apply_text', 'Add, edit or remove raised/recessed text using a local font and a part or independent spline reference. Read text for request fields; assignments can replace the common plan.slices list atomically with geometry. Rebuilds actual geometry and invalidates approvals; use request_review afterward.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({bundleId,expectedRevision,request},session)=>{
      noApprovalFields(request);
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Text modifies shared shell/mesh prints.');
      return summary(bundleId,await applyExtensionEdit(dir,'text',request,{expectedRevision}));
    },false);
  tool('apply_heat_set', 'Add, edit or remove a heat-set insert hole; its reinforcement (a six-loop annulus and connecting fins) is written as slice assignments ahead of the others. Select the exact insertId from the heat-set-inserts manual size/profile table; read its request and geometry limits. Rebuilds geometry and invalidates affected approvals; use request_review afterward.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({bundleId,expectedRevision,request})=>{
      noApprovalFields(request);
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Heat-set inserts modify shared shell/mesh prints.');
      return summary(bundleId,await applyExtensionEdit(dir,'heat-set-inserts',request,{expectedRevision}));
    },false);
  tool('intersect_geometry', 'Query saved or draft geometry before placement: horizontal sections, vertical top crossings, spline surface cuts, or draft slice families. Families report layer counts, ownership, full-crossing findings and sampled local thickness; no recipe is saved. includeLoops adds chart/world points. Geometry findings are not machine/export approval.',
    {bundleId:bundleIdSchema.optional(),request:z.object({geometry:geometrySchema.optional(),part:z.string().optional(),sectionsAtZ:z.array(z.number()).optional(),topsAtXY:z.array(z.tuple([z.number(),z.number()])).optional(),surfaces:z.array(patchSchema.omit({name:true}).extend({offsetMm:z.tuple([z.number(),z.number(),z.number()]).optional()})).optional(),families:z.array(draftFamilySchema).describe('Ordinary assignment patches; default first/pitch 0.2mm and width0.4mm, override stack/process explicitly. Geometry belongs to outer request; part null inside drafts.').optional(),includeLoops:z.boolean().optional()}).strict()},async({bundleId,request})=>
      intersectRequest(bundleId===undefined?null:(await read(bundleId,{program:false})).dir,request));
  tool('combine_geometry', 'Combine a print’s geometry (or one part) with a new operand: request {operation: union|difference|intersection, operand, part?}. The result is a boolean solid; repeating an operation appends to it, and a difference subtracts every later operand. Operands are spline, mesh, blob-field or boolean geometry in the same coordinates. Spline operands stay native: each layer combines their exact sections. Invalidates approvals; use request_review afterward. GEOMETRY.md#booleans.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),request:objectSchema},async({bundleId,expectedRevision,request})=>{
      noApprovalFields(request);
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Booleans combine shared shell/mesh prints.');
      return summary(bundleId,await combineGeometry(dir,request,{expectedRevision}));
    },false);
  tool('slice', 'Add, edit or remove one general deposition assignment in plan.slices. Shared recipe validation; add fills defaults, edit merges objects and replaces arrays. before controls ownership order. Returns saved settings and immediate deposition diagnostics; blocked findings leave valid intermediate recipes editable. No export or confirmation is created.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),assignment:slicePatchSchema.optional(),before:z.string().nullable().describe('Existing assignment id to insert before; null appends; omitted retains edit position or appends an add.').optional()},
    async({bundleId,expectedRevision,...request})=>{
      noApprovalFields(request.assignment);
      const {dir}=await locate(bundleId),result=await applySlice(dir,request,{expectedRevision});
      return {...summary(bundleId,result.state),edit:result.edit};
    },false);
  tool('modulate', 'Add, edit or remove a field modifier in plan.modulations. Select world/slice/curve frame, assignment/role and layer scope. Runs before final support publication; changes invalidate dependent output and confirmation. Add requires channel, amplitude, field and direction for displacement/tilt; edit patches saved settings. Read slice#modulation.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),modifier:modulationPatchSchema.optional()},
    async({bundleId,expectedRevision,...request})=>{
      noApprovalFields(request.modifier);
      const {dir}=await locate(bundleId),result=await applyModulation(dir,request,{expectedRevision});
      return {...summary(bundleId,result.state),edit:result.edit};
    },false);
  tool('adjust_recipe', 'Apply a validated recipe patch at expectedRevision. experimental.substrateAdaptation is boolean, default false: on adapts gap/volume and surface-following placement to deposited substrate. Edits invalidate final confirmation; read fresh state if stale.',
    { bundleId: bundleIdSchema, expectedRevision: z.string().min(1), patch: z.object({experimental:z.object({substrateAdaptation:z.boolean().describe('Experimental deposited-substrate adaptation; default false.').optional()}).strict().optional()}).passthrough() }, async ({ bundleId, expectedRevision, patch }) => {
      noApprovalFields(patch);
      const { dir, bundle, state } = await read(bundleId,{program:false});
      const options={expectedRevision,setupFile:state.machine?await setupFile(state.machine.id):undefined};
      const next=Object.keys(patch).every(key=>SETTINGS_FIELDS.includes(key))
        ?await adjustSettings(dir,patch,options):await bundle.adjustBundle(dir,patch,options);
      return summary(bundleId, next);
    }, false);
  tool('check_bundle', 'Validate saved native geometry, recipe and any exact generated export using the shared bundle checks. Does not generate or approve.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { state } = await read(bundleId);
    if (state.programError) throw new Error(state.programError);
    return { ...summary(bundleId, state), checked: [...(state.geometry?['geometry']:[]),'plan',...(state.program?['exact-export']:[])], physicalValidation: 'not performed' };
  });
  tool('check_path', 'Check path feasibility using the same generator, without approvals or persisted SAAMpath/export artifacts. Reports software checks only; production generation and exact-export review remain required.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle } = await locate(bundleId);
    return { bundleId, ...await bundle.checkPathBundle(dir), physicalValidation: 'not performed' };
  });
  tool('record_extension_dependency','Record supplied named extension configuration in the existing recipe skills record. No defaults, installation lookup or execution. Later operations validate what they consume. Null removes the named record.',
    {bundleId:bundleIdSchema,extensionId:idSchema,configuration:objectSchema.nullable(),expectedRevision:z.string()},
    async({bundleId,extensionId,configuration,expectedRevision})=>summary(bundleId,
      await recordExtensionDependency(await directory(bundleId),extensionId,configuration,{expectedRevision})),false);
  tool('remember_setup', 'Remember this saved print setup for later prints on the same machine, shared with CLI initialization. This saves setup defaults, never job approvals.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle, state } = await read(bundleId,{program:false});
    await rememberSetup(dir, { setupFile: await setupFile(state.machine.id) });
    return { bundleId, machineId: state.machine.id, remembered: true, approvalsChanged: false };
  }, false);
  tool('get_approval_status', 'Read the fresh hash-bound final settings/toolpath approval from the saved bundle. Caller-provided approvals are never accepted.', { bundleId: bundleIdSchema }, async ({ bundleId }) => summary(bundleId, (await read(bundleId)).state));
  tool('begin_studio_work','Start Studio work as early as practical for an edit to an existing print — you may acknowledge the person first; the claim it records is what later mutations and result reports check, so make it before either. Identify the Studio instance when more than one is open. Edits start Updating preview; guidance stays visually quiet. For a Studio-originated request, pass its requestId to claim that request. Resolve every started request with respond_to_studio_request.',
    {bundleId:bundleIdSchema.optional(),studioInstanceId:z.string().optional(),instruction:z.string().min(1),requestId:z.string().optional(),kind:z.enum(['edit','guidance']).default('edit')},async({bundleId,studioInstanceId,instruction,requestId,kind})=>{
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
      const editSession=studioInstanceId?studioSessions.get(studioInstanceId):null;
      if(editSession&&editSession.server.currentPrint()!==dir)throw Error('That Studio instance is displaying another print.');
      if(requestId){if(record?.printId!==bundleId)throw Error('That request belongs to another print.');if(record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');return agentRequests.update(requestId,{status:'working'});}
      return agentRequests.begin({directory:dir,instruction,kind,studioInstanceId});
    },false);
  tool('respond_to_studio_request','After saving the intended inputs, publish status working with resultStage geometry or toolpath for every edit. Intermediate saves cannot finish a request; automatic tour generation waits for this target. Bind every included request when combining edits. Use waiting when paused for a choice or confirmation; resume the same requestId without losing its target. Complete after sending guidance or presenting the requested result; geometry-only work needs no generation. Mark failures explicitly. Studio clears Updating preview when the bound result is displayed, independently of this acknowledgement.',
    {requestId:z.string(),status:z.enum(['working','waiting','completed','failed','cancelled']).default('completed'),resultStage:z.enum(['geometry','toolpath']).optional(),message:z.string().default('')},async({requestId,...response})=>agentRequests.update(requestId,response),false);
  tool('wait_for_studio_request','Wait for Studio to request maker-agent input. Send any completed edit acknowledgement in chat commentary BEFORE this call. Do not defer it to the final response. While guiding a tour, call this between lessons instead of ending the turn and requiring the participant to ask for guidance. Claim a returned request and resolve it after doing its work. Prepare imported-model start layers silently; Studio leads the early lessons. Give proactive chat guidance only at the designated infill lesson and completion. Repeat after a timeout while the participant is navigating, without waiting for a chat message. Omit waitMs: the session uses the longest wait its client allows.',
    {after:z.array(z.string()).optional(),waitMs:z.number().int().min(0).max(LISTEN_LIMIT_MS).optional(),claim:z.boolean().optional(),studioInstanceId:z.string().optional()},async(args,session)=>{
      if(args.studioInstanceId&&!studioSessions.has(args.studioInstanceId))throw Error('That Studio instance is not owned by this agent.');
      const {defaultMs,maxMs}=session.listen,waitMs=Math.min(maxMs,args.waitMs??defaultMs);
      const result=await agentRequests.wait({...args,waitMs}),generation=generationStatus();
      return generation.length?{...result,generation}:result;
    });
  tool('get_studio_events','Read and clear the Studio event queue: what the person did in your owned Studio instances since your last read (lesson changes, opened prints, imports, exports, approvals, displayed results, calculation start/finish/failure/cancellation, viewer connections) plus live import/repair and toolpath progress with elapsed time. Delivered events also arrive on tool results and listener waits; sequence numbers identify repeats. Set history to include recently read events.',
    {history:z.boolean().default(false)},async({history})=>({events:studioEvents.drain(),generation:generationStatus(),...(history?{recent:studioEvents.history()}:{})}));
  tool('get_studio_requests','Read outstanding work and the latest edit outcome per print. Set history for all resolved records; optionally restrict to one print.',{bundleId:bundleIdSchema.optional(),history:z.boolean().default(false)},async({bundleId,...options})=>({requests:await agentRequests.query({...options,printId:bundleId})}));
  tool('get_studio_sessions','List live Studio instances owned exclusively by this agent. One agent may own several instances; print bundles remain shareable across agents.',{},async()=>({sessions:[...studioSessions.values()].map(({server:studio,url})=>({...studio.agentSession(),url}))}));
  tool('cancel_studio_calculation','Cancel a live import/automatic repair or toolpath calculation. Supply studioInstanceId for Studio work; omit it for a tool import or generation. First read get_studio_events for its identity, elapsedMs and actual progress; pass the import jobId or Studio toolpath generationHash; direct tool generation requires both jobId and generationHash. Repairs have no reliable remaining-time estimate and continue unless cancelled. Explain your decision to the person. Cancellation interrupts work and cleans incomplete imports; it does not change the previously open print.',
    {studioInstanceId:z.string().optional(),jobId:z.string().optional(),generationHash:z.string().optional()},async({studioInstanceId,...identity})=>{
      if(!studioInstanceId){
        const imported=imports.get(identity.jobId);
        if(imported){
          imported.controller.abort(Object.assign(Error('Import cancelled.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
          return {cancelled:true,kind:'import',jobId:identity.jobId};
        }
        const generation=generations.get(identity.jobId);
        if(!generation||identity.generationHash!==generation.generationHash)throw Error('Read the active jobId and generationHash before cancelling.');
        const result=generation.job.cancel();await result.done;
        return {cancelled:result.cancelled,committing:result.committing,kind:'generation',jobId:identity.jobId};
      }
      const session=studioSessions.get(studioInstanceId);if(!session)throw Error('Choose a live Studio instance owned by this agent.');
      return session.server.cancelCalculation({...identity,reason:'agent'});
    },false);
  tool('get_tour','Read the active tour print, lesson gates and maker-agent instruction. After reaching the chat lesson, offer infill options in chat. After completion, immediately congratulate the participant, offer help with any difficulties printing the downloaded file, and ask what she wants to make next. Optional bounded wait follows user progress.',
    {after:z.string().optional(),waitMs:z.number().int().min(0).max(25000).optional()},async({after,waitMs=0})=>{
      const deadline=Date.now()+waitMs;
      for(;;){const status=await tour.info(),cursor=JSON.stringify([status.active,status.completed,status.step,status.canNext,status.selected]);
        if(cursor!==after||Date.now()>=deadline)return {...status,cursor};
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    });
  tool('set_tour_start_at','Choose a deposited layer after the first for the identified tour lesson. Use the runId and lessonId from the guidance request scope or get_tour; discard work when that lesson has ended.',
    {startAt:z.object({layer:z.number().int().min(1)}).strict(),runId:z.string(),lessonId:z.string()},async({startAt,...scope})=>tour.setStartAt(startAt,scope),false);
  tool('change_machine','Change a print to a supported printer using its remembered or default setup. Invalidates final settings/toolpath confirmation and validates compatibility before saving.',
    {bundleId:bundleIdSchema,machineId:z.string(),expectedRevision:z.string()},async({bundleId,machineId,expectedRevision})=>{
      const {dir,bundle}=await locate(bundleId);if(!bundle.changeMachine)throw Error('This adapter cannot change its printer.');
      return withMachineHint(bundleId,await changeMachine(dir,machineId,{expectedRevision,setupFile:await setupFile(machineId)}),machineId);
    },false);
  tool('request_review', 'Serve this bundle through an exclusively owned SAAM Studio instance. Reuse is the default: the instance already showing this print, else the sole live instance, is rebound to it in the same browser tab. With several live instances supply studioInstanceId to choose the one to rebind; otherwise an unshown print opens another. Use newInstance only when the person asks for another Studio, or for a compelling reason you tell them. Optional startAt selects a deposited tour layer. No approval or generation is performed.', { bundleId: bundleIdSchema,studioInstanceId:z.string().optional(),newInstance:z.boolean().default(false),startAt:z.object({layer:z.number().int().min(1)}).strict().optional(),...localExtension.reviewSchema?.(z) }, async ({ bundleId,studioInstanceId,newInstance,startAt,...viewOptions }) => {
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
  tool('generate_toolpath', 'Generate and check the declared export from the current geometry and complete settings, including during the tour. This is reviewable output, not approval.', { bundleId: bundleIdSchema }, async ({ bundleId },_session,instance) => {
    const { dir, bundle } = await locate(bundleId);
    const checks=await bundle.generateBundle(dir,{dispatchComputation:async({directory,generationHash})=>{
      const jobId=randomUUID(),startedAt=Date.now();
      const job=new PreparedGenerationJob({key:directory+':'+generationHash,directory,generationHash,
        createWorker:cancellation=>new Worker(new URL('../../../studio/generation-worker.mjs',import.meta.url),{workerData:{directory,generationHash,progress:true,cancellation}})});
      job.worker?.ref();
      generations.set(jobId,{jobId,printId:bundleId,generationHash,startedAt,job});
      studioEvents.record('generation-started',{jobId,printId:bundleId,generationHash,trigger:'agent'});
      try{
        const result=await job.generate(false,instance);
        studioEvents.record('generation-finished',{jobId,printId:bundleId,generationHash,durationMs:Date.now()-startedAt});
        return result;
      }catch(error){
        studioEvents.record(error.code==='GENERATION_CANCELLED'?'generation-cancelled':'generation-failed',{jobId,printId:bundleId,generationHash,error:error.message,stage:error.stage??'generation'});throw error;
      }finally{generations.delete(jobId);await job.dispose();}
    }});
    return { ...summary(bundleId, await bundle.loadBundle(dir)), checks };
  }, false);
  tool('deliver_toolpath', 'Copy the exact current human-reviewed export bytes into the bundle delivery folder. Fails without current toolpath approval. Does not run hardware.', { bundleId: bundleIdSchema }, async ({ bundleId }) => {
    const { dir, bundle } = await locate(bundleId);
    if(await tourExample(dir))throw Error('Exit the tour before confirming a real print.');
    const file = await bundle.deliver(dir), state = await bundle.loadBundle(dir);
    return { ...summary(bundleId, state), file, exportHash: state.exportHash };
  }, false);
  // The runtime outlives its sessions: Studio instances, jobs and bundles stay
  // while desktop agent connections come and go. One session is active at a time; an ended
  // session's late calls are rejected rather than run for its successor.
  const runtime={closing:null,session:null};
  // listen: how long this session's client may hold a wait (default and ceiling).
  // The agent is working from any call other than the listener, and from a
  // listener that returned something to act on, until it listens again or
  // WORKING_MS pass without a call. Studio shows it as its waiting indicators.
  const WORKING_MS=5*60_000;
  const agent={working:false,timer:null};
  function agentWorking(session){
    const activity=session?.activity;
    return Boolean(activity&&!session.ending&&!activity.listening&&activity.lastCall&&Date.now()-activity.lastCall<WORKING_MS);
  }
  function publishWorking(){
    const working=agentWorking(runtime.session);
    clearTimeout(agent.timer);
    if(working){agent.timer=setTimeout(publishWorking,runtime.session.activity.lastCall+WORKING_MS-Date.now()+50);agent.timer.unref?.();}
    if(working===agent.working)return;
    agent.working=working;
    for(const {server:studio} of studioSessions.values())studio.agentWorking?.(working);
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
  function beginSession({listen=LOCAL_LISTEN}={}){
    if(runtime.closing)throw Error('The SAAM runtime is closing.');
    if(runtime.session)throw Error('A SAAM session is already active. End it before starting another.');
    if(!(listen.defaultMs<=listen.maxMs&&listen.maxMs<=LISTEN_LIMIT_MS))throw Error('Invalid listener limits.');
    const session={id:randomUUID(),ending:null,listen,activity:{listening:0,lastCall:0}};runtime.session=session;
    return {id:session.id,
      operations:[...operations.values()].map(({action,...definition})=>definition),
      invoke:(name,args)=>session.ending?Promise.reject(Error('This SAAM session has ended. Start a new session; saved prints remain available.')):observed(session,name,invoke(name,args,session)),
      end:()=>endSession(session)};
  }
  function endSession(session){return session.ending??=Promise.resolve().then(async()=>{
    for(const job of imports.values())job.controller.abort(Object.assign(Error('Import cancelled because the agent session closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
    await Promise.all([...generations.values()].map(({job})=>job.cancel().done));
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
    operationObservers.clear();
    studioSessions.clear();preferredStudioByPrint.clear();
  });}
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
    subscribeRequests:listener=>agentRequests.subscribe(listener),
    subscribeEvents:listener=>studioEvents.subscribe(events=>listener(publicBundleIdentity(events))),
    // Every Studio event as it is recorded, without draining the agent's queue.
    observeEvents:observer=>studioEvents.observe(events=>observer(publicBundleIdentity(events))),
    observeOperations:observer=>{operationObservers.add(observer);return()=>operationObservers.delete(observer);},
    openStudio,
    close
  };
}
