import {homePaths} from './home.mjs';
import {applyExtensionEdit,createExtensionBundle} from '../print/extension-edits.mjs';
// The local SAAM runtime: every agent operation over the same bundle lifecycle
// and Studio used by the CLI, and the Studio/request state they share. It knows
// no transport; the application's local command interface invokes its operations.
import { z } from 'zod';
import { mkdir, readdir, lstat, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {openBrowser} from '../../studio/browser.mjs';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {PreparedGenerationJob} from '../../studio/prepared-generation-job.mjs';
import {changeMachine,rememberSetup,adjustSettings,recordExtensionDependency} from '../machine/bundle-settings.mjs';
import {SETTINGS_FIELDS} from '../machine/settings.mjs';
import { MACHINE_IDS, loadMachine } from '../machine/profile.mjs';
import { createStudio, listPrints } from '../../studio/server.mjs';
import { bundleFor } from '../../studio/adapter-resolution.mjs';
import {createTour,tourExample} from '../../studio/tour.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {createStudioEvents} from '../../studio/studio-events.mjs';
import {listExtensions,loadExtensionEntry,readExtension} from '../extensions/library.mjs';
import {createBlobFieldBundle,updateBlobFieldBundle} from '../agent/blob-field.mjs';
import {applySlice} from '../print/slice-edit.mjs';
import {applyModulation} from '../print/modulation.mjs';
import {intersectRequest,combineGeometry} from '../print/geometry-tools.mjs';
import {loadLocalExtension} from '../local-extension.mjs';
import {lifecycleReview} from '../print/review-state.mjs';
import { readGuidance, readManual } from '../agent/manuals.mjs';
import { onboardingSources, machineHint } from '../agent/layers.mjs';
import { SKILL_IDS, GUIDANCE_IDS, EXTENSION_IDS, skillMetadata } from '../../skills/catalog.mjs';
import {slicePatchSchema,modulationPatchSchema,geometrySchema,patchSchema,draftFamilySchema} from './deposition-schemas.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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
async function bundleModule(){return import('../print/bundle.mjs');}
async function recipeModule(){return import('../print/plan.mjs');}

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
  if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not supported in SAAM print bundles.');
  if (info.isFile() && info.nlink > 1) throw new Error('Hard-linked files are not supported in SAAM print bundles.');
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

export const instructions = 'Use saam help for operations and saam help OP for complete input schemas. Call saam call OP with --input FILE, --stdin or named flags. For existing Studio work call begin_studio_work before editing. Start tours with saam start-tour. Use maker_onboarding once per chat and read individual manuals as needed. A person confirms exact settings and toolpath together in Studio before export. Commands and waits do not own application lifetime. Repeat saam wait between Studio requests; Codex background completion wakeup is unverified. Return chatId with --chat-id if the command environment has no session ID. No operation grants hardware operation or final approval.';

// The optional service supplies Studio's release and diagnostics controls.
export function createLocalRuntime({ printsRoot = homePaths().prints, autoOpen = process.env.SAAM_NO_AUTO_OPEN !== '1',localExtension=installedExtension,thingi10kClient,relay,application={},stateRoot=homePaths().state } = {}) {
  const libraryRoot = resolve(printsRoot);
  let resourceClient;
  const getResourceClient=async()=>resourceClient??=loadExtensionEntry('thingi10k','resource-client')
    .then(create=>create({cacheDirectory:resolve(libraryRoot,'.thingi10k')}));
  const meshLibrary=thingi10kClient??{
    search:async args=>(await getResourceClient()).search(args),
    download:async(fileId,options)=>(await getResourceClient()).download(fileId,options)
  };
  const app={closing:null},chats=new Map(),allStudios=new Map(),workspaceSessions=new Map(),imports=new Map(),generations=new Map();
  const work={tail:Promise.resolve()},operationObservers=new Set(),eventObservers=new Set(),activeOperations=new Map(),transferringStudios=new Set();
  function observeEvent(event){for(const observer of eventObservers)try{observer(publicBundleIdentity(event));}catch{/* Diagnostics never fail work. */}}
  function createChat(ownerId,{name=ownerId,client=null}={}){
  const studioEvents=createStudioEvents(),agentRequests=createAgentRequests(libraryRoot,{ownerId,events:studioEvents,folder:resolve(stateRoot,'.studio-requests')});
  studioEvents.observe(observeEvent);
  const tour=createTour(libraryRoot,{ownerId,agentRequests});
  const studioSessions=new Map(),preferredStudioByPrint=new Map(),activity={calls:0};
  const generationStatus=()=>[...[...studioSessions.values()].map(({server:studio})=>studio.generationStatus()).filter(Boolean),
    ...[...imports.values()].filter(job=>job.ownerId===ownerId).map(({controller,...job})=>({...job,cancellable:!controller.signal.aborted,elapsedMs:Date.now()-job.startedAt,estimatedRemainingMs:null})),
    ...[...generations.values()].filter(job=>job.ownerId===ownerId).map(({job,...identity})=>({...identity,studioInstanceId:null,status:job.status,cancellable:job.cancellable,progress:job.progress,elapsedMs:Date.now()-identity.startedAt}))];
  async function importSTL(bundleId,dir,{source,units,machineId,setupFile:remembered}){
    const jobId=randomUUID(),controller=new AbortController(),startedAt=Date.now();
    imports.set(jobId,{ownerId,jobId,printId:bundleId,studioInstanceId:null,status:'importing',startedAt,controller,progress:{stage:'import'}});
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
      const {prepareSTLImport,releaseSTLImport}=await import('../geom/import-stl.mjs');
      candidate=await prepareSTLImport(sourcePath,{units,attribution:downloaded?.attribution,signal:controller.signal,progress});
      let committed;
      try{
        phase='bundle';
        const {commitSTLImport}=await import('../print/import-stl.mjs');
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
    if(app.closing)throw Error('The SAAM application is quitting.');
    const studio = createStudio(dir, { libraryRoot,agentOwnerId:ownerId,agentRequests,studioEvents,relay,application,chatName:name,chatClient:client });
    try{await studio.ready();}catch(error){await studio.shutdown().catch(()=>{});throw error;}
    try{await new Promise((resolveListen, reject) => { studio.once('error', reject); studio.listen(0, '127.0.0.1', resolveListen); });}
    catch(error){await studio.shutdown().catch(()=>{});throw error;}
    const session = { server: studio, url: `http://127.0.0.1:${studio.address().port}` },studioInstanceId=studio.agentSession().instanceId;
    session.ownerId=ownerId;allStudios.set(studioInstanceId,session);studioSessions.set(studioInstanceId, session);
    studio.agentWorking(activity.calls>0);
    studio.once('close',()=>{
      allStudios.delete(studioInstanceId);
      for(const chat of chats.values())chat.releaseStudio(studioInstanceId);
      for(const [id,instance] of preferredStudioByPrint)if(instance===studioInstanceId)preferredStudioByPrint.delete(id);
    });
    return session;
  }
  // One print-work queue per runtime: mutations run in order; immediate tools bypass it.
  const operations=new Map();

  async function directory(bundleId, { create = false, exclusive = create } = {}) {
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
        if (info.isSymbolicLink()) throw new Error('Symbolic links and junctions are not supported in SAAM print paths.');
        if (!info.isDirectory()) throw new Error('Every print path component must be a directory.');
      } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
    }
    try {
      await rejectLinks(dir);
      if (exclusive) throw new Error('Print already exists. Choose a new bundleId or reopen it.');
    } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
    return dir;
  }
  async function setupFile(machineId) {
    loadMachine(machineId);
    const folder=resolve(stateRoot,'machine-setups');
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
      found.push({...skillMetadata(extension.id,manual),...(extension.manifest.kind==='workspace'?{kind:'workspace'}:{}),layer:'extension',origin:extension.origin,
        digest:extension.digest,manualTool:'read_skill'});
    }
    found.push(...await localExtension.skills?.()??[]);
    return found.sort((a, b) => a.id.localeCompare(b.id));
  }
  const immediateTools=new Set(['begin_studio_work','respond_to_studio_request','wait_for_studio_request','get_studio_requests','get_studio_events','get_studio_sessions','cancel_studio_calculation','get_tour','get_workspace','capture_bundle']);
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
    const existing=[...allStudios.values()].find(session=>session.server.currentPrint()===dir);
    if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before editing.');
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
      if(app.closing)throw Error('The SAAM application is quitting.');
      const started=operationObservers.size?Date.now():null;
      try{
        const {requestIds,...input}=operation.schema.parse(args);
        if(input.bundleId&&!operation.readOnly&&name!=='capture_bundle'){
          const existing=[...allStudios.values()].find(session=>session.server.currentPrint()===resolve(libraryRoot,input.bundleId));
          if(existing&&transferringStudios.has(existing.server.agentSession().instanceId))throw Error('This Studio is transferring to another chat. Retry after the capture finishes.');
          if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before editing.');
        }
        const touch=async()=>{for(const id of requestIds??[])await agentRequests.activity(id,{directory:await directory(input.bundleId)});};
        if(input.studioInstanceId&&!studioSessions.has(input.studioInstanceId))throw Error('That Studio is no longer attached to this chat.');
        const callId=randomUUID();
        if(!operation.readOnly&&name!=='capture_bundle')activeOperations.set(callId,{ownerId,name,bundleId:input.bundleId??null,studioInstanceId:input.studioInstanceId??null});
        const call={result:null};
      try{
        if(operation.tracked)await touch();
        if(operation.instanceScope&&input.action!=='create'){
          const {studioInstanceId,...fields}=input;
          const studio=await associatedStudio(fields.bundleId,studioInstanceId,requestIds);
          call.result=studio?await studio.server.runBundleEdit(studio.dir,instance=>operation.action(fields,session,instance)):await operation.action(fields,session);
        }else call.result=await operation.action(input,session);
      }finally{activeOperations.delete(callId);if(operation.tracked)await touch();}
        const result=call.result;
        if(started!==null)reportOperation({kind:'operation',name,status:'completed',durationMs:Date.now()-started,readOnly:operation.readOnly,
          parameters:diagnosticFields(input,['bundleId','kind','machineId','units','action','expectedRevision','skillId','extensionId','workspaceInstanceId']),
          result:diagnosticFields(result,['revision','geometryHash','generationHash','exportHash','toolpathApproved','programChecked','imported','status','workspaceInstanceId','jobId'])});
        if(result&&typeof result==='object'&&!Array.isArray(result)&&!['get_studio_events','wait_for_studio_request'].includes(name)){
          if(!operation.immediate){const pending=await agentRequests.query({status:'queued'});if(pending.length)call.result={...call.result,studioRequests:pending};}
          // Delivered events push at once; every tool result also carries whatever is still queued.
          const events=studioEvents.drain();if(events.length)call.result={...call.result,studioEvents:events};
        }
        return publicBundleIdentity(call.result);
      }catch(error){if(started!==null)reportOperation({kind:'operation',name,status:'failed',durationMs:Date.now()-started,
        parameters:diagnosticFields(args,['bundleId','kind','machineId','units','action','expectedRevision','skillId','extensionId','workspaceInstanceId']),error:error.message});throw error;}
    };
    if(['begin_studio_work','respond_to_studio_request'].includes(name)){
      const run=attachments.tail.then(execute);attachments.tail=run.catch(()=>{});return run;
    }
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
  tool('repair_client_setup','Refresh SAAM command discovery and permissions in detected desktop clients. Preserves unrelated settings and reports any client installation or upgrade still needed.',
    {},async()=>{if(!application.retryClients)throw Error('Client setup is available through the SAAM application.');return application.retryClients();},false);
  tool('list_machines', 'List installed machine profiles and declared outputs. Catalog presence is not proof that a particular recipe is supported.', {}, async () => MACHINE_IDS.map(id => {
    const m = loadMachine(id);
    return { id, name: m.name, capabilities: m.capabilities, tools: m.tools, materials: m.materials,
      outputs: m.outputs.map(({ id, extension, flavor, implemented, experimental, constraints, reason }) => ({ id, extension, flavor, implemented: implemented !== false, experimental, constraints, reason })),
      defaultSetup: m.defaultSetup };
  }));
  tool('list_skills', 'List core skills, guidance and skill/workspace extension manuals. Catalog membership does not establish recipe compatibility.', {}, skills);
  tool('list_workspaces','Discover selected workspace extensions and their manuals. Workspace designs create new, unapproved print bundles for ordinary Studio review.',{},async()=>{
    const {listWorkspaces}=await import('../../workspaces/server.mjs');
    return {workspaces:await listWorkspaces({appRoot:root})};
  });
  tool('open_workspace','Open a workspace extension in this application. Reuses its live instance; its saved design and created bundles stay in the configured print library.',
    {extensionId:idSchema},openWorkspace,false);
  const workspaceIdSchema=z.string().min(1).describe('workspaceInstanceId returned by open_workspace.');
  function workspaceSession(workspaceInstanceId){
    const session=workspaceSessions.get(workspaceInstanceId);
    if(!session||session.ownerId!==ownerId)throw Error('Choose a live workspace instance owned by this chat.');
    return session;
  }
  tool('get_workspace','Read the current saved workspace design and bundle-creation job. Preview is a separate operation.',
    {workspaceInstanceId:workspaceIdSchema},async({workspaceInstanceId})=>({workspaceInstanceId,...await workspaceSession(workspaceInstanceId).inspect()}));
  tool('preview_workspace','Preview the supplied design, or current saved design, without saving or constructing bundles.',
    {workspaceInstanceId:workspaceIdSchema,design:objectSchema.optional(),interactive:z.boolean().optional()},async({workspaceInstanceId,design,interactive=false})=>({workspaceInstanceId,...await workspaceSession(workspaceInstanceId).preview(design,{interactive})}));
  tool('close_workspace','Close one owned workspace instance and its background worker, releasing the saved design for reopening. Other workspace and Studio instances remain available.',
    {workspaceInstanceId:workspaceIdSchema},async({workspaceInstanceId})=>{
      await workspaceSession(workspaceInstanceId).shutdown();
      return {workspaceInstanceId,closed:true};
    },false);
  tool('update_workspace','Save a complete workspace design atomically and return its normalized state. Construction remains unapproved until reviewed in Studio.',
    {workspaceInstanceId:workspaceIdSchema,design:objectSchema},async({workspaceInstanceId,design})=>({workspaceInstanceId,...await workspaceSession(workspaceInstanceId).updateDesign(design)}),false);
  tool('create_workspace_bundles','Start background creation of a fresh bundle set from the supplied design, or the current saved design. Read get_workspace for progress; review each resulting bundle in Studio.',
    {workspaceInstanceId:workspaceIdSchema,design:objectSchema.optional()},async({workspaceInstanceId,design})=>{
      const workspace=workspaceSession(workspaceInstanceId);
      return {workspaceInstanceId,job:await workspace.createBundles(design)};
    },false);
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
  tool('read_guidance', 'Read published repository Markdown by relative path, optionally with #heading for one section whatever its gate. Results list the headings with their gates and the gated sections omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Short IDs: makers, geometry, development, glossary, application, print-tools. This reader does not expose private files, source code or register capabilities.',
    { guidanceId: z.string().min(1), machineId: machineIdSchema,bundleId:bundleIdSchema.optional() }, async ({ guidanceId, machineId,bundleId }) => readManual(root, guidanceId, {...await manualContext({machineId,bundleId}),headings:true}));
  tool('get_recipe_defaults', 'Get process, setup and common assignment defaults, including remembered setup. Supply geometry or standalone Trace/Inject assignments before create_bundle. Defaults never confer job approval.',
    { kind: kindSchema, machineId: z.string() }, async ({ kind, machineId }) => ({ kind, machineId,
      plan: await (await bundleModule()).proposedPlan(machineId, { setupFile: await setupFile(machineId) }) }));
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
      const machine = loadMachine(machineId), recipe = await recipeModule();
      recipe.validatePlan(plan);
      const dir = await directory(bundleId, { create: true }), bundle = await bundleModule();
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
      return summary(bundleId, await (await bundleModule()).loadBundle(dir));
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
      return {...result,...(result.imported?summary(bundleId,await (await bundleModule()).loadBundle(dir)):{bundleId})};
    },false,true);
  localExtension.registerOperations?.({tool,z,bundleIdSchema,objectSchema,idSchema,read,noApprovalFields});
  tool('set_stl_units','Correct an imported mesh to mm or inch units, rescaling its current geometry and preserving the original STL bytes and printing settings. Invalidates geometry/toolpath confirmations; show the corrected size for geometry review.',
    {bundleId:bundleIdSchema,units:z.enum(['mm','inch']),expectedRevision:z.string()},async({bundleId,units,expectedRevision})=>{
      const {setSTLUnits}=await import('../print/import-stl.mjs');
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
  tool('restore_revision','Undo or redo a saved print edit at its current revision. Restoring history invalidates affected confirmation; show the resulting print in Studio.',
    {bundleId:bundleIdSchema,expectedRevision:z.string().min(1),direction:z.enum(['undo','redo'])},async({bundleId,expectedRevision,direction})=>{
      const {dir,bundle}=await locate(bundleId);return summary(bundleId,await bundle.restoreRevision(dir,{direction,expectedRevision}));
    },false);
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
      const result=await agentRequests.wait({...args,claim:false,waitMs}),generation=generationStatus();
      if(args.claim&&result.requests.length){
        const claim=attachments.tail.then(async()=>{
          if(app.closing)throw Error('The SAAM application is quitting.');
          const claimed=[];
          for(const request of result.requests)claimed.push(await agentRequests.update(request.id,{status:'working'}));
          return claimed;
        });attachments.tail=claim.catch(()=>{});result.requests=await claim;
      }
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
        if(imported&&imported.ownerId===ownerId){
          imported.controller.abort(Object.assign(Error('Import cancelled.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
          return {cancelled:true,kind:'import',jobId:identity.jobId};
        }
        const generation=generations.get(identity.jobId);
        if(!generation||generation.ownerId!==ownerId||identity.generationHash!==generation.generationHash)throw Error('Read the active jobId and generationHash before cancelling.');
        const result=generation.job.cancel();await result.done;
        return {cancelled:result.cancelled,committing:result.committing,kind:'generation',jobId:identity.jobId};
      }
      const session=studioSessions.get(studioInstanceId);if(!session)throw Error('Choose a live Studio instance owned by this agent.');
      return session.server.cancelCalculation({...identity,reason:'agent'});
    },false);
  async function requireTourOwner(){
    const guide=await tour.info(),instanceId=guide.studioOwner?.instanceId;
    if(guide.active&&instanceId&&!studioSessions.has(instanceId))throw Error('The active tour is attached to another chat. Explicitly capture its bundle first.');
    if(instanceId&&transferringStudios.has(instanceId))throw Error('The tour Studio is transferring to another chat.');
    return guide;
  }
  tool('start_tour','Start fresh tour copies in this application, attach this chat and return the first Studio screen plus participation guidance.',
    {startAtLayer:z.number().int().min(1).optional()},async({startAtLayer})=>{
      await requireTourOwner();
      const existing=[...studioSessions.values()].find(candidate=>!candidate.server.currentPrint());
      const studio=existing??await startStudio(null);
      const prepared=await studio.server.startTour();
      const directory=studio.server.currentPrint();
      const bundleId=agentRequests.printId(directory);
      if(startAtLayer)await studio.server.setStartAt({layer:startAtLayer});
      const browserOpenRequested=autoOpen?await openBrowser(studio.url):false;
      return {bundleId,studioInstanceId:studio.server.agentSession().instanceId,url:studio.url,browserOpenRequested,tour:await tour.info(),
        sources:await onboardingSources(root,{client:'script'}),participation:await readManual(root,'examples/prints/README.md#maker-agent-participation',{client:'script'})};
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
    {startAt:z.object({layer:z.number().int().min(1)}).strict(),runId:z.string(),lessonId:z.string()},async({startAt,...scope})=>{await requireTourOwner();return tour.setStartAt(startAt,scope);},false);
  tool('change_machine','Change a print to a supported printer using its remembered or default setup. Invalidates final settings/toolpath confirmation and validates compatibility before saving.',
    {bundleId:bundleIdSchema,machineId:z.string(),expectedRevision:z.string()},async({bundleId,machineId,expectedRevision})=>{
      const {dir,bundle}=await locate(bundleId);if(!bundle.changeMachine)throw Error('This adapter cannot change its printer.');
      return withMachineHint(bundleId,await changeMachine(dir,machineId,{expectedRevision,setupFile:await setupFile(machineId)}),machineId);
    },false);
  tool('capture_bundle','Explicitly take over the bundle in its existing Studio. Fails while actual work runs; cancels the old chat unfinished requests, preserves the window and rejects its later writes.',
    {bundleId:bundleIdSchema},async({bundleId})=>captureBundle(chats.get(ownerId),bundleId),false);
  tool('request_review', 'Show the bundle in its one Studio window, creating a window if needed. An existing attached window is reused. Another chat must explicitly capture the bundle before working on it. Optional startAt selects a deposited tour layer. No approval or generation is performed.', { bundleId: bundleIdSchema,studioInstanceId:z.string().optional(),startAt:z.object({layer:z.number().int().min(1)}).strict().optional(),...localExtension.reviewSchema?.(z) }, async ({ bundleId,studioInstanceId,startAt,...viewOptions }) => {
    const { dir, state } = await read(bundleId);
    const viewPath=await localExtension.reviewPath?.({dir,...viewOptions})??'';
    const existing=[...allStudios.values()].find(candidate=>candidate.server.currentPrint()===dir);
    if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before reviewing.');
    const chosen=studioInstanceId?studioSessions.get(studioInstanceId):existing;
    if(studioInstanceId&&!chosen)throw Error('That Studio instance is not attached to this chat.');
    if(existing&&chosen&&existing!==chosen)throw Error('This bundle already has a Studio instance. Use that window.');
    const empty=[...studioSessions.values()].find(candidate=>!candidate.server.currentPrint());
    const session=chosen??empty??await startStudio(dir);
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
        createWorker:cancellation=>new Worker(new URL('../../studio/generation-worker.mjs',import.meta.url),{workerData:{directory,generationHash,progress:true,cancellation}})});
      job.worker?.ref();
      generations.set(jobId,{ownerId,jobId,printId:bundleId,generationHash,startedAt,job});
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
  async function sessionInvoke(operation,args={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    activity.calls++;
    for(const {server} of studioSessions.values())server.agentWorking(operation!=='wait_for_studio_request');
    try{return await invoke(operation,args,{listen:LOCAL_LISTEN});}
    finally{activity.calls--;if(!activity.calls)for(const {server} of studioSessions.values())server.agentWorking(false);}
  }
  async function openStudio(){
    if(app.closing)throw Error('The SAAM application is closing.');
    const session=[...studioSessions.values()].filter(({server})=>server.listening).at(-1)??await startStudio(null);
    const browserOpenRequested=autoOpen&&!session.server.viewerCount()?await openBrowser(session.url):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  async function openWorkspace({extensionId}={}){
    if(app.closing)throw Error('The SAAM runtime is closing.');
    idSchema.parse(extensionId);
    let session=[...workspaceSessions.values()].find(workspace=>workspace.extension.id===extensionId&&workspace.server.listening);
    if(session&&session.ownerId!==ownerId)throw Error('This workspace is attached to another chat.');
    if(!session){
      const workspaceInstanceId=randomUUID(),dir=await directory(`${extensionId}-workspace`,{create:true,exclusive:false});
      const {startWorkspace}=await import('../../workspaces/server.mjs');
      session=await startWorkspace({extensionId,directory:dir,appRoot:root,onEvent:event=>{
        const {kind,...detail}=event;
        studioEvents.record(kind,{...detail,workspaceInstanceId,extensionId});
      }});
      session.workspaceInstanceId=workspaceInstanceId;session.ownerId=ownerId;
      workspaceSessions.set(workspaceInstanceId,session);
      session.server.once('close',()=>{if(workspaceSessions.get(workspaceInstanceId)===session)workspaceSessions.delete(workspaceInstanceId);});
    }
    const browserOpenRequested=autoOpen&&!session.server.viewerCount?.()?await openBrowser(session.url):false;
    return {workspaceInstanceId:session.workspaceInstanceId,url:session.url,directory:session.directory,extension:session.extension,browserOpenRequested};
  }
  return {id:ownerId,name,client,requests:agentRequests,events:studioEvents,
    operations:[...operations.values()].map(({action,...definition})=>definition),
    invoke:sessionInvoke,openStudio,startStudio,
    releaseStudio(id){studioSessions.delete(id);for(const [bundle,idValue] of preferredStudioByPrint)if(idValue===id)preferredStudioByPrint.delete(bundle);},
    ownStudio(id,session){studioSessions.set(id,session);},
    ownsStudio(id){return studioSessions.has(id);},
    studios:()=>[...studioSessions.values()],
    close(){tour.close();agentRequests.close();studioEvents.close();}
  };
  }
  function beginSession({id=randomUUID(),name,client}={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    if(typeof id!=='string'||!id.trim()||id.length>256||/[\x00-\x1f]/.test(id))throw Error('Invalid chat session ID.');
    if(!chats.has(id))chats.set(id,createChat(id,{name,client}));
    return chats.get(id);
  }
  const lobby=beginSession({id:'studio:'+randomUUID(),name:null}),connectedChats=new Set();
  async function attachChat(chat,session,{capture=false}={}){
    if(!capture&&session.ownerId!==lobby.id&&session.ownerId!==chat.id)throw Error('This Studio is already attached to another chat. Re-pair it in Studio first.');
    if(session.ownerId===chat.id)return;
    if(chat.id===lobby.id)await session.server.detachChat({ownerId:chat.id,agentRequests:chat.requests,studioEvents:chat.events});
    else await session.server.attachChat({ownerId:chat.id,agentRequests:chat.requests,studioEvents:chat.events,name:chat.name,client:chat.client});
    chats.get(session.ownerId)?.releaseStudio(session.server.agentSession().instanceId);
    session.ownerId=chat.id;chat.ownStudio(session.server.agentSession().instanceId,session);
  }
  async function connectChat({id,name,client,bundleId}={}){
    const known=connectedChats.has(id),chat=beginSession({id,name,client});
    if(bundleId)bundleIdSchema.parse(bundleId);
    const directory=bundleId?resolve(libraryRoot,bundleId):null;
    const selected=directory?[...allStudios.values()].find(session=>session.server.currentPrint()===directory):null;
    if(selected&&selected.ownerId!==chat.id){await transferStudio(chat,selected,false);}
    else if(!known){
      const candidates=[...allStudios.values()].filter(session=>session.ownerId===lobby.id&&session.server.waitingClient()&&(!client||session.server.waitingClient()===client));
      const relevant=bundleId?candidates.filter(session=>!session.server.currentPrint()):candidates;
      const populated=relevant.filter(session=>session.server.currentPrint());
      if(populated.length>1)throw Error('Several Studio prints are waiting. Name the bundle with --bundle-id to choose your window.');
      const waiting=populated[0]??relevant[0]??[...allStudios.values()].find(session=>session.ownerId===lobby.id&&!session.server.currentPrint());
      if(waiting)await transferStudio(chat,waiting,false);
    }
    connectedChats.add(chat.id);return chat;
  }
  function assertStudioIdle(session){
    const instanceId=session.server.agentSession().instanceId,directory=session.server.currentPrint();
    if(session.server.attachmentBusy())throw Error('Wait for the current Studio operation to finish before capturing or re-pairing.');
    for(const operation of activeOperations.values())if(operation.ownerId===session.ownerId&&['set_tour_start_at','start_tour'].includes(operation.name)||operation.studioInstanceId===instanceId||operation.bundleId&&resolve(libraryRoot,operation.bundleId)===directory)
      throw Error('A bundle operation is running. Wait for it to finish before capturing or re-pairing.');
    for(const job of imports.values())if(directory&&resolve(libraryRoot,job.printId)===directory)throw Error('An import is running for this bundle.');
    for(const job of generations.values())if(directory&&resolve(libraryRoot,job.printId)===directory)throw Error('A generation is running for this bundle.');
  }
  async function cancelOldRequests(session){
    const chat=chats.get(session.ownerId),instanceId=session.server.agentSession().instanceId;
    for(const request of await chat.requests.query())if(request.studioInstanceId===instanceId&&['queued','working','waiting'].includes(request.status))
      await chat.requests.update(request.id,{status:'cancelled',message:'The Studio was explicitly transferred to another chat.'});
  }
  const attachments={tail:Promise.resolve()};
  function transferStudio(chat,session,capture){
    const operation=attachments.tail.then(async()=>{
      if(!capture&&session.ownerId!==lobby.id&&session.ownerId!==chat.id)throw Error('This Studio is attached to another chat. Use capture_bundle to take it over explicitly.');
      assertStudioIdle(session);
      const instanceId=session.server.agentSession().instanceId;
      transferringStudios.add(instanceId);
      try{
        const workspaces=await runningJobs(),directory=session.server.currentPrint();
        if(workspaces.some(job=>job.job?.directory&&directory?.startsWith(job.job.directory)))throw Error('Workspace construction is running for this bundle.');
        if(session.ownerId!==chat.id&&session.ownerId!==lobby.id)await cancelOldRequests(session);
        await attachChat(chat,session,{capture});
        return {studioInstanceId:instanceId,bundleId:session.server.agentSession().printId,url:session.url,chatId:chat.id,captured:true};
      }finally{transferringStudios.delete(instanceId);}

    });
    attachments.tail=operation.catch(()=>{});return operation;
  }
  async function captureBundle(chat,bundleId){
    bundleIdSchema.parse(bundleId);
    const directory=resolve(libraryRoot,bundleId),session=[...allStudios.values()].find(candidate=>candidate.server.currentPrint()===directory);
    if(!session)return chat.invoke('request_review',{bundleId});
    return transferStudio(chat,session,true);
  }
  async function detachStudio(instanceId){
    const session=allStudios.get(instanceId);
    if(!session)throw Error('That Studio is no longer running.');
    await transferStudio(lobby,session,true);
    return {studioInstanceId:instanceId,attached:false};
  }
  async function openStudio(){
    const session=[...allStudios.values()].filter(({server})=>server.listening).at(-1);
    if(!session)return lobby.openStudio();
    const browserOpenRequested=autoOpen?await openBrowser(session.url):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  function jobs(){
    return [...[...allStudios.values()].map(({server})=>server.generationStatus()).filter(Boolean),
      ...[...imports.values()].map(({controller,...job})=>({...job,status:'importing'})),
      ...[...generations.values()].map(({job,...identity})=>({...identity,status:job.status})),
      ...[...workspaceSessions.values()].map(session=>({workspaceInstanceId:session.workspaceInstanceId,inspect:session.inspect}))];
  }
  async function runningJobs(){
    const workspaces=await Promise.all([...workspaceSessions.values()].map(async session=>({workspaceInstanceId:session.workspaceInstanceId,...await session.inspect()})));
    return [...jobs().filter(job=>!job.inspect),...workspaces.filter(value=>value.job&&!['complete','failed','cancelled'].includes(value.job.stage))];
  }
  function close(){return app.closing??=(async()=>{
    for(const job of imports.values())job.controller.abort(Object.assign(Error('SAAM is quitting.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
    await Promise.all([...generations.values()].map(({job})=>job.cancel().done));
    // Stop existing Studio workers before draining work; no queued operation may start after closing.
    await Promise.all([...allStudios.values()].map(({server})=>server.shutdown()));
    await work.tail;await attachments.tail;
    // An already-running opener can finish while shutdown is draining.
    await Promise.all([...allStudios.values()].map(({server})=>server.shutdown()));
    await Promise.all([...workspaceSessions.values()].map(session=>session.shutdown()));
    for(const chat of chats.values())chat.close();
    chats.clear();connectedChats.clear();allStudios.clear();workspaceSessions.clear();operationObservers.clear();eventObservers.clear();
  })();}
  return {beginSession,connectChat,detachStudio,openStudio,runningJobs,close,
    operations:lobby.operations,
    observeEvents(observer){eventObservers.add(observer);return()=>eventObservers.delete(observer);},
    observeOperations(observer){operationObservers.add(observer);return()=>operationObservers.delete(observer);},
    studios:()=>[...allStudios.values()].map(({server,url})=>({...server.agentSession(),url})),
    chatIds:()=>[...chats.keys()].filter(id=>id!==lobby.id)
  };
}
