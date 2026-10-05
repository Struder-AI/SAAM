import {readLocalAgentNotes,updateLocalAgentNotes} from './local-agent-notes.mjs';
import {retainFailedImport} from './diagnostics.mjs';
import {watchStudioChanges} from '../../studio/changes.mjs';
import {requireBundleInstance,bundleInstance,recoverBundleInstance} from '../print/studio-ownership.mjs';
import {applyExtensionEdit,createExtensionBundle} from '../print/extension-edits.mjs';
// The local SAAM runtime: every agent operation over the same bundle lifecycle
// and Studio used by the CLI, and the Studio/request state they share. It knows
// no transport; the application's local command interface invokes its operations.
import { z } from 'zod';
import { mkdir, readdir, lstat, realpath, stat, access } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {openBrowser} from '../../studio/browser.mjs';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {PreparedGenerationJob} from '../../studio/prepared-generation-job.mjs';
import {runPortableBundleJob} from './portable-bundle-job.mjs';
import {changeMachine,adjustSettings,recordExtensionDependency} from '../machine/bundle-settings.mjs';
import {SETTINGS_FIELDS} from '../machine/settings.mjs';
import { MACHINE_IDS, loadMachine } from '../machine/profile.mjs';
import { createStudio, listPrints } from '../../studio/server.mjs';
import { bundleFor } from '../../studio/adapter-resolution.mjs';
import {createTour,tourExample} from '../../studio/tour.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {createStudioEvents} from '../../studio/studio-events.mjs';
import {listExtensions,loadExtensionEntry,readExtension,checkoutExtension,exportExtension,importExtension} from '../extensions/library.mjs';
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
const editIdentitySchema={expectedRevision:z.string().min(1).optional(),expectedEditRevision:z.string().min(1).optional()};
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

// Studio owns internal printId records; these fixed public records use bundleId.
function agentRequest(request){
  const {printId,...record}=request;return {bundleId:printId,...record};
}
function agentEvent(event){
  const {printId,...record}=event;
  return Object.hasOwn(event,'printId')?{bundleId:printId,...record}:record;
}
function agentStudioSession(session){
  const {printId,...record}=session;return {bundleId:printId,...record};
}
function agentStudioJob(status){
  if(!status)return null;
  const {printId,...record}=status;return {bundleId:printId,...record};
}
function agentTour(status){
  if(!status.editLesson)return status;
  const {printId,...lesson}=status.editLesson;
  return {...status,editLesson:{bundleId:printId,...lesson}};
}

export function summary(bundleId, state) {
  const programChecked=state.programChecked!==false;
  const lifecycle=lifecycleReview(state,{programChecked});
  return {
    bundleId, kind: state.kind, revision: state.revision, editRevision:state.editRevision, geometryHash:state.geometryHash,
    machineId: state.machine?.id??null, output: state.plan.output, skills: state.skills,
    toolpathApproved: lifecycle.toolpathApproved,
    programChecked,deferRememberSetup:state.deferRememberSetup===true,
    generation: state.review.generation ? { mode: state.review.generation.mode, current: lifecycle.current } : null,
    programError: state.programError ?? null, exportHash: state.exportHash ?? null,
    shortTravel: state.program?.summary?.shortTravel ?? null,
    outputAvailability: state.outputAvailability, limitations: state.limitations,
    nextStep: !state.machine?'Supply the machine, material and recipe components needed for the requested operation.':lifecycle.action==='check'?'Open Studio or check_bundle to check the current export.'
      : lifecycle.action==='generate'?'Generate the toolpath from the complete settings.'
      : lifecycle.action==='review'?'Review settings and the exact toolpath together in Studio.':'Deliver the reviewed export.'
  };
}

export const LOCAL_LISTEN=Object.freeze({defaultMs:25000,maxMs:25000}),LISTEN_LIMIT_MS=30*60*1000;
const CLAUDE_LISTEN=Object.freeze({defaultMs:LISTEN_LIMIT_MS,maxMs:LISTEN_LIMIT_MS});
const expectedStudioSchema=z.object({studioInstanceId:z.string(),bundleId:bundleIdSchema.nullable()}).strict();

export const instructions = 'Use saam help for operations and saam help OP for complete input schemas. Call saam call OP with --input FILE, --stdin or named flags. Result-changing work establishes Studio context automatically. Hand back once with respond_to_studio_request using workRequest.id, including when a new user message interrupts work. Start tours with saam start-tour. Use maker_onboarding once per chat and read individual manuals as needed. A person confirms exact settings and toolpath together in Studio before export. Commands and waits do not own application lifetime. Claude Code may monitor the Studio queue with saam wait for 30 minutes; quiet expiry is normal, renew while work or tour participation continues or let an idle monitor lapse. Codex reads the queue explicitly; automatic wakeup is unverified. Carry the expected Studio/bundle association on the first necessary operation; a stale target is rejected before effects. Return chatId with --chat-id if the command environment has no session ID. No operation grants hardware operation or final approval.';

// The owner supplies the home's paths (homePaths record) and this runtime's private
// stateRoot; the optional service supplies Studio's release and diagnostics controls.
export function createLocalRuntime({ paths, stateRoot, autoOpen = process.env.SAAM_NO_AUTO_OPEN !== '1',localExtension=installedExtension,thingi10kClient,relay,application={} }) {
  const libraryRoot = resolve(paths.prints);
  async function showStudio(url){
    if(application.showStudio)return application.showStudio(url);
    return openBrowser(url);
  }
  let resourceClient;
  const getResourceClient=async()=>resourceClient??=loadExtensionEntry('thingi10k','resource-client').then(create=>create());
  const meshLibrary=thingi10kClient??{
    search:async args=>(await getResourceClient()).search(args),
    download:async(fileId,options)=>(await getResourceClient()).download(fileId,options)
  };
  const app={closing:null},chats=new Map(),allStudios=new Map(),workspaceSessions=new Map(),imports=new Map(),generations=new Map(),calculations=new Map();
  const work={tails:new Map(),pending:new Set()},operationObservers=new Set(),eventObservers=new Set(),activeOperations=new Map(),transferringStudios=new Set();
  function observeEvent(event){for(const observer of eventObservers)try{observer(agentEvent(structuredClone(event)));}catch{/* Diagnostics never fail work. */}}
  function createChat(ownerId,{name=ownerId,client=null}={}){
  const studioEvents=createStudioEvents(),agentRequests=createAgentRequests(libraryRoot,{ownerId,events:studioEvents,folder:resolve(stateRoot,'.studio-requests')});
  studioEvents.observe(observeEvent);
  const tour=createTour(libraryRoot,{ownerId,agentRequests});
  const studioSessions=new Map(),preferredStudioByPrint=new Map(),creationViews=new Set(),activity={calls:0};
  const generationStatus=()=>[...[...calculations.values()].filter(job=>job.ownerId===ownerId).map(({controller,printId,...job})=>({...job,bundleId:printId,cancellable:job.status!=='committing'&&!controller.signal.aborted,elapsedMs:Date.now()-job.startedAt,estimatedRemainingMs:null})),...[...studioSessions.values()].map(({server:studio})=>agentStudioJob(studio.generationStatus())).filter(Boolean),
    ...[...imports.values()].filter(job=>job.ownerId===ownerId).map(({controller,printId,...job})=>({...job,bundleId:printId,cancellable:job.status!=='committing'&&!controller.signal.aborted,elapsedMs:Date.now()-job.startedAt,estimatedRemainingMs:null})),
    ...[...generations.values()].filter(job=>job.ownerId===ownerId).map(({job,printId,...identity})=>({...identity,bundleId:printId,studioInstanceId:null,status:job.status,cancellable:job.cancellable,progress:job.progress,elapsedMs:Date.now()-identity.startedAt}))];
  async function calculateGeometry(bundleId,action){
    const jobId=randomUUID(),controller=new AbortController();
    const job={ownerId,jobId,printId:bundleId,studioInstanceId:null,status:'constructing',startedAt:Date.now(),controller,progress:{stage:'Extracting geometry'}};
    calculations.set(jobId,job);studioEvents.record('geometry-started',{jobId,printId:bundleId});
    const beforeCommit=()=>{controller.signal.throwIfAborted();job.status='committing';job.progress={stage:'Saving geometry'};};
    try{
      const result=await action({signal:controller.signal,beforeCommit});
      studioEvents.record('geometry-completed',{jobId,printId:bundleId});return result;
    }catch(error){studioEvents.record(controller.signal.aborted?'geometry-cancelled':'geometry-failed',{jobId,printId:bundleId,error:error.message});throw error;}
    finally{calculations.delete(jobId);}
  }
  async function importSTL(bundleId,dir,{source,units,machineId,machineSetups}){
    const jobId=randomUUID(),controller=new AbortController(),startedAt=Date.now();
    imports.set(jobId,{ownerId,jobId,printId:bundleId,studioInstanceId:null,status:'importing',startedAt,controller,progress:{stage:'import'}});
    studioEvents.record('import-started',{jobId,printId:bundleId,importDiagnostic:{stage:'acquire',...(source.kind==='thingi10k'?{dataset:{provider:'Thingi10K',fileId:source.fileId}}:{})}});
    const progress=value=>{
      const before=imports.get(jobId);imports.set(jobId,{...before,progress:value});
      if(value.stage==='repair'&&before.progress.stage!=='repair')studioEvents.record('import-repair-started',{jobId,printId:bundleId,elapsedMs:Date.now()-startedAt});
    };
    // Downloaded bytes go only to this import's job folder, which leaves with the job.
    let bytes,downloaded,candidate,phase='acquire';
    try{
      if(source.kind!=='local')({bytes,...downloaded}=await meshLibrary.download(source.fileId,{signal:controller.signal}));
      controller.signal.throwIfAborted();
      phase='geometry';
      const {prepareSTLImport,releaseSTLImport}=await import('../geom/import-stl.mjs');
      candidate=await prepareSTLImport(bytes??source.path,{units,attribution:downloaded?.attribution,signal:controller.signal,progress});
      let committed;
      try{
        phase='bundle';
        const {commitSTLImport}=await import('../print/import-stl.mjs');
        committed=await commitSTLImport(dir,candidate,{machineId,machineSetups,signal:controller.signal});
        phase='cleanup';
      }finally{await releaseSTLImport(candidate);}
      studioEvents.record('import-completed',{jobId,printId:bundleId,importDiagnostic:candidate.importDiagnostic});
      return downloaded?{...downloaded,...committed,imported:true,nextStep:'Show the imported geometry in Studio with its dimensions. Nothing is approved.'}:committed;
    }catch(error){
      const importDiagnostic=error.importDiagnostic??{...candidate?.importDiagnostic,stage:phase,
        ...(downloaded?{sourceSha256:downloaded.attribution.sha256,dataset:{provider:downloaded.attribution.provider,fileId:downloaded.attribution.fileId,revision:downloaded.attribution.revision}}:{}),
        failure:{name:error.name,code:error.code??null,message:error.message}};
      error.importDiagnostic??=importDiagnostic;
      if(downloaded&&!controller.signal.aborted&&(phase==='geometry'||phase==='bundle')){
        const sourcePath=await retainFailedImport(paths,bytes).catch(retention=>{importDiagnostic.evidenceError=retention.message;return null;});
        importDiagnostic.evidence=sourcePath&&basename(sourcePath);
        const result={...downloaded,sourcePath,imported:false,error:error.message,importDiagnostic,
          nextStep:'The downloaded original is kept as diagnostics evidence at sourcePath until another downloaded import fails. Automatic repair could not accept this input; explain the reported failure and choose a corrected source or ask a builder to diagnose it.'};
        studioEvents.record('import-failed',{jobId,printId:bundleId,error:error.message,importDiagnostic});return result;
      }
      studioEvents.record(controller.signal.aborted?'import-cancelled':'import-failed',{jobId,printId:bundleId,error:error.message,importDiagnostic});throw error;
    }
    finally{imports.delete(jobId);}
  }
  async function exchangeBundle(operation,bundleId,dir,packageFile,instance){
    const jobId=randomUUID(),controller=new AbortController(),kind='bundle-'+operation,eventKind=operation==='share'?'bundle-share':'import';
    const job={ownerId,jobId,printId:bundleId,studioInstanceId:null,kind,status:operation==='share'?'sharing':'importing',startedAt:Date.now(),controller,progress:{stage:'Preparing portable bundle'}};
    imports.set(jobId,job);studioEvents.record(eventKind+'-started',{jobId,printId:bundleId,operation:'bundle-'+operation});
    try{
      const result=await runPortableBundleJob(operation,dir,packageFile,{appRoot:root,instance,signal:controller.signal,
        progress:value=>{job.progress=value;},beforeCommit:()=>{
          controller.signal.throwIfAborted();job.status='committing';job.progress={stage:operation==='share'?'Publishing portable ZIP':'Publishing imported bundle'};
        }});
      studioEvents.record(eventKind+'-completed',{jobId,printId:bundleId,operation:'bundle-'+operation});return {...result,bundleId};
    }catch(error){
      studioEvents.record(eventKind+(controller.signal.aborted?'-cancelled':'-failed'),{jobId,printId:bundleId,error:error.message,operation:'bundle-'+operation,
        ...(error.installedExtensions?{installedExtensions:error.installedExtensions}:{})});throw error;
    }finally{imports.delete(jobId);}
  }
  // Every runtime-owned Studio instance starts here, showing dir or no print.
  async function startStudio(dir,{instanceId,sessionToken,restoring=false}={}){
    if(app.closing)throw Error('The SAAM application is quitting.');
    const studio = createStudio(dir, { libraryRoot,machineSetups:paths.machineSetups,agentOwnerId:ownerId,agentRequests,studioEvents,relay,chatName:name,chatClient:client,instanceId,sessionToken,restoring,runtimeId:application.runtime?.id,runtimeLabel:application.runtime?.label,fingerprint:application.fingerprint });
    try{await studio.ready();}catch(error){await studio.shutdown().catch(()=>{});throw error;}
    try{await new Promise((resolveListen, reject) => { studio.once('error', reject); studio.listen(0, '127.0.0.1', resolveListen); });}
    catch(error){await studio.shutdown().catch(()=>{});throw error;}
    studio.interruptWork=async()=>{
      const selected=studio.currentPrint();if(!selected)return;
      const requests=(await agentRequests.query({printId:agentRequests.printId(selected)})).filter(r=>r.workActive&&(!r.studioInstanceId||r.studioInstanceId===studio.agentSession().instanceId));
      const ids=[...new Set(requests.map(r=>r.episodeId??r.id))];
      await Promise.all(ids.map(id=>handBackRequest(id,{status:'waiting',message:'The person requested help in Studio.'})));
    };
    const upstreamUrl=`http://127.0.0.1:${studio.address().port}`,studioInstanceId=studio.agentSession().instanceId;
    const registration={visible:null};
    try{registration.visible=application.registerStudio?await application.registerStudio({instanceId:studioInstanceId,upstreamUrl,sessionToken:studio.sessionToken()}):{url:upstreamUrl};}
    catch(error){await studio.shutdown().catch(()=>{});throw error;}
    const visible=registration.visible;
    const session={server:studio,url:visible.url};
    session.ownerId=ownerId;allStudios.set(studioInstanceId,session);studioSessions.set(studioInstanceId, session);

    studio.once('close',()=>{
      allStudios.delete(studioInstanceId);
      for(const chat of chats.values())chat.releaseStudio(studioInstanceId);
      for(const [id,instance] of preferredStudioByPrint)if(instance===studioInstanceId)preferredStudioByPrint.delete(id);
    });
    return session;
  }
  // Bundle/workspace queues preserve dependent command order; immediate tools bypass them.
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
      if (exclusive){if(!creationViews.has(dir))throw new Error('Print already exists. Choose a new bundleId or reopen it.');await requireBundleInstance(dir);const saved=await access(resolve(dir,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});if(saved)throw new Error('Print already exists. Choose a new bundleId or reopen it.');}
    } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
    return dir;
  }
  async function machineSetupStore() {
    const folder=paths.machineSetups;
    const parent = dirname(folder);
    try {
      if ((await lstat(parent)).isSymbolicLink()) throw new Error('The machine setup parent cannot be a symbolic link or junction.');
      await rejectLinks(folder);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return folder;
  }
  async function locate(bundleId) {
    const dir = await directory(bundleId), bundle = await bundleFor(dir);
    return { dir, bundle };
  }
  async function read(bundleId, {program='source'}={}) {
    const {dir,bundle}=await locate(bundleId);
    return {dir,bundle,state:await bundle.loadBundle(dir,{program})};
  }
  async function applyExtension(bundleId,extensionId,request,options={},kindError='Extensions modify shared shell/mesh prints.'){
    noApprovalFields(request);
    const {dir,state}=await read(bundleId,{program:false});
    if(state.kind!=='shell')throw new Error(kindError);
    const updated=await applyExtensionEdit(dir,extensionId,request,options);
    return {...summary(bundleId,updated),...(updated.extensionReport?{extensionReport:updated.extensionReport}:{})};
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
  const immediateTools=new Set(['begin_studio_work','respond_to_studio_request','wait_for_studio_request','get_studio_requests','get_studio_events','get_studio_sessions','cancel_studio_calculation','get_tour','get_workspace','capture_bundle','get_bundle_instance','recover_bundle_instance','repair_stl']);
  const diagnosticFields=(value,keys)=>Object.fromEntries(keys.filter(key=>value&&Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  const reportOperation=event=>{for(const observer of operationObservers)try{observer(event);}catch{/* Diagnostics never fail an operation. */}};
  // The registry holds each operation's definition (help, validation, scope);
  // perform() below names the entry that runs it.
  function operation(name, description, shape, readOnly = true, openWorld = false) {
    extensionActions.delete(name);
    const tracked=Boolean(shape.bundleId)&&!immediateTools.has(name);
    const resultChanging=tracked&&!readOnly&&!['request_review','set_deferred_setup_save','deliver_toolpath'].includes(name);
    const instanceScope=tracked&&!readOnly&&!['request_review','create_bundle','import_bundle','import_stl_bundle','import_thingi10k_bundle','migrate_bundle'].includes(name);
    // The full strict schema makes unexpected top-level approval data an error
    // instead of letting Zod silently discard it.
    const schema=z.object({...shape,expectedStudio:expectedStudioSchema.optional(),...(tracked?{requestIds:z.array(z.string()).optional(),studioInstanceId:z.string().optional()}: {})}).strict();
    operations.set(name,{name,description,schema,readOnly,openWorld,tracked,instanceScope,resultChanging,immediate:immediateTools.has(name)});
  }
  // A local extension registers operations with its own entries; they run at
  // the extension boundary, and a later registration of a name replaces it.
  const extensionActions=new Map();
  function tool(name, description, shape, action, readOnly, openWorld) {
    operation(name,description,shape,readOnly,openWorld);
    extensionActions.set(name,action);
  }
  // Validate the caller's remembered association before claims, activity or edits.
  // Reuse this boundary before initial attachment; requests retain their original target.
  function assertStudioTarget(studioInstanceId,bundleId,{beforeAttachment=false,capture=false}={}){
    const session=allStudios.get(studioInstanceId),current=session?.server.agentSession();
    if(!current||current.printId!==bundleId){
      const currentStudio=current?{studioInstanceId:current.instanceId,bundleId:current.printId,url:session.url}:null;
      throw Object.assign(Error('The Studio target changed. Resolve the current bundle before continuing this work.'),
        {code:'STUDIO_TARGET_CHANGED',currentStudio,expectedStudio:{studioInstanceId,bundleId}});
    }
    if(session.ownerId!==ownerId&&!capture&&!(beforeAttachment&&session.ownerId===lobby.id))throw Error('That Studio is no longer attached to this chat.');
  }
  async function validateTarget(name,args={},beforeAttachment=false){
    if(args.expectedStudio)assertStudioTarget(args.expectedStudio.studioInstanceId,args.expectedStudio.bundleId,{beforeAttachment,capture:name==='capture_bundle'});
    if(args.studioInstanceId&&args.bundleId&&name!=='request_review')assertStudioTarget(args.studioInstanceId,args.bundleId,{beforeAttachment});
    const ids=[...new Set([...(args.requestIds??[]),...(args.requestId?[args.requestId]:[])])];
    for(const id of ids){
      const request=await agentRequests.get(id);
      if(request.ownerId&&request.ownerId!==ownerId&&!(beforeAttachment&&request.ownerId===lobby.id))throw Error('That Studio request belongs to another agent.');
      if(args.bundleId&&request.printId!==args.bundleId)throw Error('That request belongs to another print.');
      if(args.studioInstanceId&&request.studioInstanceId&&request.studioInstanceId!==args.studioInstanceId)throw Error('That request belongs to another Studio instance.');
      // Hand-back settles the original work, even after the person opens another bundle.
      if(request.studioInstanceId&&(name!=='respond_to_studio_request'||args.status==='working'))assertStudioTarget(request.studioInstanceId,request.printId,{beforeAttachment});
    }
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

  async function visibleBundle(bundleId,{studioInstanceId,requestIds,migrating=false}={}){
    const dir=await directory(bundleId,{create:true,exclusive:false});
    const saved=await access(resolve(dir,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    const retained=[...studioSessions.values()].find(session=>session.server.creationTarget()===dir);
    const existing=saved&&!migrating?await associatedStudio(bundleId,studioInstanceId,requestIds):null;
    if(retained){const view={dir,server:retained.server,url:retained.url,pending:true,migrating,opening:null,stopWatching:null,browserOpenRequested:false};view.stopWatching=watchStudioChanges(libraryRoot,()=>{void revealSavedBundle(view,true).catch(()=>{});});return view;}
    if(existing){const session=allStudios.get(existing.server.agentSession().instanceId);return {...existing,url:session.url,pending:false,browserOpenRequested:false};}
    const reusable=[...studioSessions.values()].filter(session=>session.server.listening&&!session.server.creationTarget()).at(-1);
    if(reusable)assertStudioIdle(reusable);
    const studio=reusable??await startStudio(saved&&!migrating?dir:null);
    if(reusable&&saved&&!migrating)await studio.server.openPrint(dir);
    const browserOpenRequested=autoOpen?await showStudio(studio.url):false;
    const view={dir,server:studio.server,url:studio.url,pending:!saved||migrating,browserOpenRequested,migrating,opening:null,stopWatching:null};
    if(view.pending)view.stopWatching=watchStudioChanges(libraryRoot,()=>{void revealSavedBundle(view,true).catch(()=>{});});
    return view;
  }
  async function revealSavedBundle(view,creating=false){
    if(!view?.pending)return;
    if(view.opening)return view.opening;
    view.opening=(async()=>{
      const saved=await access(resolve(view.dir,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
      if(saved){if(creating)await view.server.showSavedCreation(view.dir);else await view.server.openPrint(view.dir);view.pending=false;view.stopWatching?.();}
    })();
    try{return await view.opening;}finally{view.opening=null;}
  }
  async function handBackRequest(requestId,response){
      if(response.status==='working')return agentRequests.update(requestId,response);

      const underway=[...activeOperations.values()].filter(op=>op.ownerId===ownerId&&op.requestIds?.includes(requestId)).map(op=>op.settled);
      const pending=await agentRequests.startHandback(requestId,response);
      if(!pending)return agentRequests.update(requestId,response);
      if(!pending.handbackPending)return pending;
      const running=[...new Set([...underway,...[...activeOperations.values()].filter(op=>op.ownerId===ownerId&&op.requestIds?.includes(requestId)).map(op=>op.settled)])];
      const completed=await Promise.all(running),last=completed.at(-1);
      if(last?.error)response={...response,status:response.status==='cancelled'?'cancelled':'failed',message:last.error.message};
      const handed=[];for(const id of pending.handbackIds??[requestId])handed.push(await agentRequests.finishHandback(id,response,last?last.snapshot:pending.lastSaved));
      return handed.find(r=>r.id===requestId)??handed[0];
  }
  // Runs one operation to its result and throws its failure; the transport
  // decides how either reaches the agent.
  // `session` carries per-session limits, such as how long this client may listen.
  function invoke(name,args={},session){
    const definition=operations.get(name);
    if(!definition)return Promise.reject(Error(`Unknown SAAM operation ${name}.`));
    const parsed=definition.schema.safeParse(args);
    const execute=async()=>{
      if(app.closing)throw Error('The SAAM application is quitting.');
      const started=operationObservers.size?Date.now():null;
      try{
        if(!parsed.success)throw parsed.error;
        await validateTarget(name,parsed.data);
        const {requestIds,expectedStudio,...input}=parsed.data;
        if(definition.schema.shape.expectedEditRevision&&input.action!=='create'&&!input.expectedEditRevision&&!input.expectedRevision)
          throw Error('Supply expectedEditRevision from the current recipe, or a strict legacy expectedRevision.');
        if(input.bundleId&&!definition.readOnly&&name!=='capture_bundle'){
          const existing=[...allStudios.values()].find(session=>session.server.currentPrint()===resolve(libraryRoot,input.bundleId));
          if(existing&&transferringStudios.has(existing.server.agentSession().instanceId))throw Error('This Studio is transferring to another chat. Retry after the capture finishes.');
          if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before editing.');
        }
        const view=input.bundleId&&!definition.immediate&&!['capture_bundle','request_review'].includes(name)?await visibleBundle(input.bundleId,{studioInstanceId:input.studioInstanceId,requestIds,migrating:name==='migrate_bundle'}):null;
        const associated=definition.instanceScope&&input.action!=='create'&&!view?.pending?view??await associatedStudio(input.bundleId,input.studioInstanceId,requestIds):null;
        const touch=async()=>{for(const id of requestIds??[])await agentRequests.activity(id,{directory:await directory(input.bundleId)});};
        if(input.studioInstanceId&&!studioSessions.has(input.studioInstanceId))throw Error('That Studio is no longer attached to this chat.');
        const callId=randomUUID();
        const {promise:settled,resolve:settleWork}=Promise.withResolvers();
        let workRecords=[],workError;
        if(definition.resultChanging){
          const dir=await directory(input.bundleId,{create:true,exclusive:false});
          const matches=[...studioSessions.values()].filter(s=>s.server.currentPrint()===dir);
          workRecords=await agentRequests.startWork({directory:dir,requestIds,studioInstanceId:input.studioInstanceId??view?.server.agentSession().instanceId??(matches.length===1?matches[0].server.agentSession().instanceId:undefined),instruction:'Working on '+name+'.'});
        }
        if(!definition.readOnly&&name!=='capture_bundle')activeOperations.set(callId,{ownerId,name,bundleId:input.bundleId??null,studioInstanceId:input.studioInstanceId??null,settled,requestIds:workRecords.map(r=>r.id)});
        const call={result:null,saved:workRecords[0]?.lastSaved??null,bookkeepingError:null};
        async function performAndCapture(fields,instance){
          try{return await perform(name,fields,session,instance);}
          finally{try{await revealSavedBundle(view,creationViews.has(view?.dir));view?.stopWatching?.();if(workRecords.length)call.saved=await agentRequests.snapshot(resolve(libraryRoot,input.bundleId));}
            catch(error){call.bookkeepingError=error;}}
        }
      try{
        if(definition.tracked)await touch();
        if(view?.pending&&definition.resultChanging){
          creationViews.add(view.dir);
          try{call.result=await view.server.runBundleCreation(view.dir,instance=>performAndCapture(input,instance),{fresh:!view.migrating});}
          finally{creationViews.delete(view.dir);view.stopWatching?.();}
        }else if(definition.instanceScope&&input.action!=='create'){
          const {studioInstanceId,...fields}=input;
          const studio=associated;
          call.result=studio?await studio.server.runBundleEdit(studio.dir,instance=>performAndCapture(fields,instance)):await performAndCapture(fields);
        }else call.result=await performAndCapture(input);
      }catch(error){workError=error;throw error;}
      finally{
        const originalError=workError;
        const saved=call.saved;let bookkeepingError=call.bookkeepingError;
        try{
          if(bookkeepingError)throw bookkeepingError;
          for(const record of workRecords)await agentRequests.savedWork(record.id,saved);
          if(definition.tracked)await touch();
        }catch(error){bookkeepingError=error;workError??=error;}
        finally{
          if(workError&&workRecords.length)workError.workRequest={id:workRecords[0].episodeId??workRecords[0].id,
            ...(bookkeepingError?{bookkeepingError:bookkeepingError.message}:{}),
            reminder:'This operation failed; the work episode remains active for repair. Hand back once with respond_to_studio_request when the sequence stops.'};
          settleWork({snapshot:saved,error:workError});
          activeOperations.delete(callId);
        }
        if(bookkeepingError&&!originalError)throw bookkeepingError;
      }
        if(workRecords.length&&call.result&&typeof call.result==='object')call.result={...call.result,workRequest:{id:workRecords[0].episodeId??workRecords[0].id,requestIds:workRecords.map(r=>r.id),reminder:'Keep working across intermediate saves. When intent is achieved, a decision is needed, or a new user message interrupts you, call respond_to_studio_request once with this id and completed or waiting status.'}};
        if(view&&call.result&&typeof call.result==='object'&&!Array.isArray(call.result))call.result={...call.result,studio:{studioInstanceId:view.server.agentSession().instanceId,bundleId:view.server.agentSession().printId,url:view.url,browserOpenRequested:view.browserOpenRequested}};
        const result=call.result;
        if(started!==null)reportOperation({kind:'operation',name,status:'completed',durationMs:Date.now()-started,readOnly:definition.readOnly,
          parameters:diagnosticFields(input,['bundleId','kind','machineId','units','action','expectedRevision','skillId','extensionId','workspaceInstanceId']),
          result:diagnosticFields(result,['revision','geometryHash','generationHash','exportHash','toolpathApproved','programChecked','imported','status','workspaceInstanceId','jobId'])});
        if(result&&typeof result==='object'&&!Array.isArray(result)&&!['get_studio_events','wait_for_studio_request'].includes(name)){
          if(!definition.immediate){const pending=await agentRequests.query({status:'queued'});if(pending.length)call.result={...call.result,studioRequests:pending.map(agentRequest)};}
          // Delivered events push at once; every tool result also carries whatever is still queued.
          const events=studioEvents.drain();if(events.length)call.result={...call.result,studioEvents:events.map(agentEvent)};
        }
        return structuredClone(call.result);
      }catch(error){if(started!==null)reportOperation({kind:'operation',name,status:'failed',durationMs:Date.now()-started,
        parameters:diagnosticFields(args,['bundleId','kind','machineId','units','action','expectedRevision','skillId','extensionId','workspaceInstanceId']),error:error.message});throw error;}
    };
    if(['begin_studio_work','respond_to_studio_request'].includes(name)){
      const run=attachments.tail.then(execute);attachments.tail=run.catch(()=>{});return run;
    }
    if(!parsed.success||definition.immediate)return execute();
    // Commands for one bundle remain ordered; unrelated chats and bundles do
    // not wait for its worker. Operations without a bundle keep one own queue.
    const target=parsed.data.bundleId?resolve(libraryRoot,parsed.data.bundleId):parsed.data.workspaceInstanceId?'workspace:'+parsed.data.workspaceInstanceId:libraryRoot;
    const key=process.platform==='win32'?target.toLowerCase():target;
    const tail=work.tails.get(key)??Promise.resolve(),run=tail.then(execute);
    const settled=run.then(()=>undefined,()=>undefined);
    work.tails.set(key,settled);work.pending.add(settled);
    void settled.then(()=>{work.pending.delete(settled);if(work.tails.get(key)===settled)work.tails.delete(key);});
    return run;
  }

  const machineIdSchema=z.string().optional().describe('Reusable printer profile for discovery before selecting a bundle. Use bundleId for saved capabilities.');
  async function manualContext({bundleId,machineId}){
    if(bundleId)return {machine:(await read(bundleId,{program:false})).state.machine};
    return {machineId};
  }
  operation('read_local_agent_notes','Read shared Markdown notes and their home/path/revision identity for every SAAM role.',{});
  operation('update_local_agent_notes','Save the current shared Markdown notes for the explicit home at expectedRevision (null only when absent). On conflict, read again and combine changes.',{home:z.string().min(1),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).nullable(),text:z.string()},false);
  operation('maker_onboarding','Start here for maker work when context is missing. Returns maker guidance, the skill index and print tools, including local script sections. Reuse it for the conversation.',{machineId:machineIdSchema,bundleId:bundleIdSchema.optional()});
  async function makerOnboarding({machineId,bundleId}){return { role:'maker',...(application.setupProblem&&{setupProblem:application.setupProblem}),
      ...(application.runtime&&{runtime:{id:application.runtime.id,label:application.runtime.label,command:application.runtime.command,
        note:'This chat uses this runtime; every result names it. Run each saam command for this chat with runtime.command.'}}),notes:await readLocalAgentNotes(paths),
      sources: await onboardingSources(root,await manualContext({machineId,bundleId})),
      nextStep: 'Reuse these sources for the conversation. Read skill manuals (read_skill) and linked references (read_guidance) when a task needs them. Authoring guidance uses builder onboarding in the local toolkit; core implementation requires explicit developer authorization.' };}
  operation('repair_client_setup','Refresh SAAM command discovery and permissions in Codex and Claude Code. Preserves unrelated settings and reports registration errors.',{},false);
  async function repairClientSetup(){if(!application.retryClients)throw Error('Client setup is available through the SAAM application.');return application.retryClients();}
  operation('list_machines','List installed machine profiles and declared outputs. Catalog presence is not proof that a particular recipe is supported.',{});
  async function listMachines(){return MACHINE_IDS.map(id => {
    const m = loadMachine(id);
    return { id, name: m.name, capabilities: m.capabilities, tools: m.tools, materials: m.materials,
      outputs: m.outputs.map(({ id, extension, flavor, implemented, experimental, constraints, reason }) => ({ id, extension, flavor, implemented: implemented !== false, experimental, constraints, reason })),
      defaultSetup: m.defaultSetup };
  });}
  operation('list_skills','List core skills, guidance and skill/workspace extension manuals. Catalog membership does not establish recipe compatibility.',{});
  operation('list_workspaces','Discover selected workspace extensions and their manuals. Workspace designs create new, unapproved print bundles for ordinary Studio review.',{});
  async function listWorkspacesOperation(){
    const {listWorkspaces}=await import('../extensions/workspaces.mjs');
    return {workspaces:await listWorkspaces({appRoot:root})};
  }
  operation('open_workspace','Open a workspace extension in this application. Reuses its live instance; its saved design and created bundles stay in the configured print library.',{extensionId:idSchema},false);
  const workspaceIdSchema=z.string().min(1).describe('workspaceInstanceId returned by open_workspace.');
  function workspaceSession(workspaceInstanceId){
    const session=workspaceSessions.get(workspaceInstanceId);
    if(!session||session.ownerId!==ownerId)throw Error('Choose a live workspace instance owned by this chat.');
    return session;
  }
  operation('get_workspace','Read the current saved workspace design and bundle-creation job. Preview is a separate operation.',{workspaceInstanceId:workspaceIdSchema});
  async function getWorkspace({workspaceInstanceId}){const workspace=workspaceSession(workspaceInstanceId);await workspace.bundleViews.tail;return {workspaceInstanceId,...await workspace.inspect(),studios:[...workspace.bundleViews.records.values()],...(workspace.bundleViews.error?{viewError:workspace.bundleViews.error}:{})};}
  operation('preview_workspace','Preview the supplied design, or current saved design, without saving or constructing bundles.',{workspaceInstanceId:workspaceIdSchema,design:objectSchema.optional(),interactive:z.boolean().optional()});
  async function previewWorkspace({workspaceInstanceId,design,interactive=false}){return {workspaceInstanceId,...await workspaceSession(workspaceInstanceId).preview(design,{interactive})};}
  operation('close_workspace','Close one owned workspace instance and its background worker, releasing the saved design for reopening. Other workspace and Studio instances remain available.',{workspaceInstanceId:workspaceIdSchema},false);
  async function closeWorkspace({workspaceInstanceId}){
      await workspaceSession(workspaceInstanceId).shutdown();
      return {workspaceInstanceId,closed:true};
    }
  operation('update_workspace','Save a complete workspace design atomically and return its normalized state. Construction remains unapproved until reviewed in Studio.',{workspaceInstanceId:workspaceIdSchema,design:objectSchema},false);
  async function updateWorkspace({workspaceInstanceId,design}){return {workspaceInstanceId,...await workspaceSession(workspaceInstanceId).updateDesign(design)};}
  operation('create_workspace_bundles','Replace the current exported set from the supplied or saved design; complete the new set first and retain independently edited parts. Read get_workspace for progress; review each resulting bundle in Studio.',{workspaceInstanceId:workspaceIdSchema,design:objectSchema.optional()},false);
  async function createWorkspaceBundles({workspaceInstanceId,design}){
      const workspace=workspaceSession(workspaceInstanceId);
      return {workspaceInstanceId,job:await workspace.createBundles(design)};
    }
  operation('read_skill','Read a skill or guidance manual by ID, or one section as ID#heading whatever its gate. Sections gated to machine capabilities or read on request are listed in omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Links are repository paths for read_guidance.',{ skillId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}(#[^\s#]{1,200})?$/), machineId: machineIdSchema, bundleId:bundleIdSchema.optional() });
  async function readSkill({ skillId: name, machineId,bundleId }){
    const [skillId, anchor] = name.split('#');
    const extension=await readExtension(skillId,{appRoot:root});
    if (!SKILL_IDS.includes(skillId)&&!GUIDANCE_IDS.includes(skillId)&&!extension) {
      const local=await localExtension.readSkill?.(skillId);if(local)return local;
      throw new Error('Unknown skill or guidance manual ID. Use list_skills and its manual links.');
    }
    const { text: manual, ...reference } = await readManual(root, `${extension?'extensions':'skills'}/${skillId}/SKILL.md${anchor ? '#' + anchor : ''}`, await manualContext({machineId,bundleId}));
    return { skillId, manual, ...reference };
  }
  operation('read_guidance','Read published repository Markdown, or a skill example recipe (create_bundle input), by relative path, optionally with #heading for one section whatever its gate. Results list the headings with their gates and the gated sections omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Short IDs: makers, geometry, development, glossary, application, print-tools. This reader does not expose private files, source code or register capabilities.',{ guidanceId: z.string().min(1), machineId: machineIdSchema,bundleId:bundleIdSchema.optional() });
  async function readGuidanceOperation({ guidanceId, machineId,bundleId }){return readManual(root, guidanceId, {...await manualContext({machineId,bundleId}),headings:true});}
  operation('get_recipe_defaults','Get process, setup and common assignment defaults, including remembered setup. Supply geometry or standalone Trace/Inject assignments before create_bundle. Defaults never confer job approval.',{ kind: kindSchema, machineId: z.string() });
  async function getRecipeDefaults({ kind, machineId }){return { kind, machineId,
      plan: await (await bundleModule()).proposedPlan(machineId, { machineSetups: await machineSetupStore() }) };}
  operation('list_bundles','Discover saved print names, machines and modification times. Export and approval status are unchecked; use get_bundle or check_bundle for validated status.',{});
  async function listBundles(){
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
  }
  operation('get_bundle','Read fresh validated status and recipe settings. Geometry is omitted by default and planComplete is false; set includeGeometry to obtain the complete editable recipe. SAAMpath and program arrays are always omitted.',{ bundleId: bundleIdSchema, includeGeometry: z.boolean().optional() });
  async function getBundle({ bundleId, includeGeometry = false }){
    const { state } = await read(bundleId);
    const plan = structuredClone(state.plan);
    if (!includeGeometry) delete plan.geometry;
    return { ...summary(bundleId, state), plan, planComplete: includeGeometry||!state.plan.geometry,
      ...(!includeGeometry&&state.geometry ? { geometry: { omitted: true, shape: state.plan.geometry?.shape ?? 'unknown',
        nativeFile: state.geometry.nativeFile, boundsMm: state.geometry.boundsMm } } : {}) };
  }
  operation('create_bundle','Create an unapproved bundle with authored/imported geometry or standalone Trace/Inject assignments. Defaults alone are incomplete. Then request_review.',{ bundleId: bundleIdSchema, kind: kindSchema, machineId: z.string(), plan: objectSchema },false);
  async function createBundle({ bundleId, kind, machineId, plan }){
      noApprovalFields(plan);
      const machine = loadMachine(machineId), recipe = await recipeModule();
      recipe.validatePlan(plan);
      const dir = await directory(bundleId, { create: true }), bundle = await bundleModule();
      await bundle.initBundle(dir, plan, { machineId });
      return withMachineHint(bundleId, await bundle.loadBundle(dir), machine);
    }

  operation('migrate_bundle','Explicitly migrate a legacy split-file bundle into the current saved manifest, retaining original sidecars. Shows the migrated bundle in Studio; no implicit read-time migration.',{bundleId:bundleIdSchema},false);
  async function migrateBundleOperation({bundleId}){
    const dir=await directory(bundleId),bundle=await bundleModule();return {bundleId,...await bundle.migrateBundle(dir)};
  }
  // Maintenance: a crashed Studio leaves its reservation, which bars every Studio
  // from the bundle until deliberately released. These run outside Studio views.
  operation('get_bundle_instance','Maintenance: read the Studio reservation holding a bundle (instance, owner, process, start time), or null. Use when a bundle reports it is open in another Studio instance.',{bundleId:bundleIdSchema});
  async function getBundleInstanceOperation({bundleId}){
    const record=await bundleInstance(await directory(bundleId));
    return {bundleId,instance:record?{instanceId:record.instanceId,ownerId:record.ownerId,pid:record.pid,startedAt:record.startedAt}:null};
  }
  operation('recover_bundle_instance','Maintenance: release a Studio reservation whose process has exited, after a crash. A running instance keeps its bundle.',{bundleId:bundleIdSchema},false);
  async function recoverBundleInstanceOperation({bundleId}){return {bundleId,...await recoverBundleInstance(await directory(bundleId))};}
  operation('repair_stl','Maintenance: repair a local STL into a new absolute outputDirectory (original.stl, repaired.stl in mm, repair.json) with explicit vertex merging, hole filling and shape-change limits. Ordinary imports already repair recognized defects. Import repaired.stl with units mm for review. get_studio_events reports its jobId and progress; cancel_studio_calculation cancels it.',{sourcePath:z.string().min(1),outputDirectory:z.string().min(1),units:z.enum(['mm','inch']),mergeToleranceMm:z.number().min(0).optional(),maxHoleEdges:z.number().int().min(0).optional(),maxHoleDiameterMm:z.number().min(0).optional(),maxSampledDistanceMm:z.number().min(0).optional()},false);
  async function repairStl({sourcePath,outputDirectory,units,...limits}){
    if(!isAbsolute(sourcePath)||!/\.stl$/i.test(sourcePath))throw Error('Choose an absolute path to a local .stl source file.');
    if(!isAbsolute(outputDirectory))throw Error('Choose an absolute path for the new repair directory.');
    const jobId=randomUUID(),controller=new AbortController();
    const job={ownerId,jobId,printId:null,studioInstanceId:null,kind:'stl-repair',status:'repairing',startedAt:Date.now(),controller,progress:{stage:'read-source'}};
    imports.set(jobId,job);
    try{
      const {repairSTLFiles}=await import('../print/repair-stl.mjs');
      return {jobId,directory:outputDirectory,report:await repairSTLFiles(outputDirectory,sourcePath,{...limits,units,signal:controller.signal,progress:value=>{job.progress=value;}})};
    }finally{imports.delete(jobId);}
  }
  operation('extension_library','Builder exchange for the local extension library. checkout copies a bundled extensionId to an editable user copy that survives updates; export writes extensionId to a new absolute packageFile; import validates packageFile without executing it and never replaces a changed copy.',{action:z.enum(['checkout','export','import']),extensionId:z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),packageFile:z.string().optional()},false);
  async function extensionLibrary({action,extensionId,packageFile}){
    if(action!=='import'&&!extensionId)throw Error(`Choose the extensionId to ${action}.`);
    if(action!=='checkout'&&!(packageFile&&isAbsolute(packageFile)))throw Error('Choose an absolute packageFile path.');
    if(action==='checkout')return checkoutExtension(extensionId,{appRoot:root});
    if(action==='export')return exportExtension(extensionId,packageFile,{appRoot:root});
    return importExtension(packageFile,{appRoot:root});
  }
  operation('share_bundle','Package current editable bundle inputs and selected extensions into a new portable ZIP. Toolpaths, programs, approvals and history are excluded; recipient imports, edits and regenerates. Existing package files are never overwritten.',{bundleId:bundleIdSchema,packageFile:z.string()},true,true);
  async function shareBundle({bundleId,packageFile}){
      if(!isAbsolute(packageFile)||!/\.zip$/i.test(packageFile))throw Error('Choose an absolute path for a new .zip package.');
      return exchangeBundle('share',bundleId,await directory(bundleId),packageFile);
    }
  operation('import_bundle','Import a portable editable ZIP into a new bundle. Validates inputs and selected extensions without executing imported scripts. Never overwrites an existing bundle or changed local extension. Open/request_review using the returned bundleId; regenerate before export.',{bundleId:bundleIdSchema,packageFile:z.string()},false,true);
  async function importBundle({bundleId,packageFile},instance){
      if(!isAbsolute(packageFile)||!/\.zip$/i.test(packageFile))throw Error('Choose an absolute path to a .zip package.');
      return exchangeBundle('import',bundleId,await directory(bundleId,{create:true}),packageFile,instance);
    }
  operation('import_stl_bundle','Import a local STL into a new named bundle. Default units auto chooses a reasonable mm/inch assumption from model size and printer bounds, without interrupting the person; honor explicit units when supplied. Preserves source bytes and hash and reuses remembered setup. Show geometry dimensions; units can be corrected with set_stl_units.',{ bundleId: bundleIdSchema, sourcePath: z.string().min(1), units: z.enum(['auto','mm', 'inch']).default('auto'), machineId: z.string() },false);
  async function importStlBundle({ bundleId, sourcePath, units, machineId }){
      loadMachine(machineId);
      if (!isAbsolute(sourcePath) || !/\.stl$/i.test(sourcePath)) throw new Error('Choose an absolute path to a local .stl source file.');
      const source = await stat(sourcePath);
      if (!source.isFile()) throw new Error('STL source must be a regular file.');
      const dir = await directory(bundleId, { create: true });
      const machineSetups=await machineSetupStore();
      await importSTL(bundleId,dir,{source:{kind:'local',path:sourcePath},units,machineId,machineSetups});
      return summary(bundleId, await (await bundleModule()).loadBundle(dir));
    }
  operation('search_thingi10k','Find meshes by descriptive keywords (such as bunny), numeric file ID or a Thingiverse thing URL. Reads the Thingi10K mirror index; returns per-file source and license links. Prefer making tailored geometry when attractive. Read the thingi10k skill manual.',{query:z.string().min(1),limit:z.number().int().min(1).default(10),offset:z.number().int().min(0).default(0)},true,true);
  async function searchThingi10k(args){return meshLibrary.search(args);}
  operation('import_thingi10k_bundle','Download a selected Thingi10K STL file ID on the SAAM host and import an unapproved print. ALWAYS give its license link in chat and briefly identify the source unless obvious. Recognized defects receive automatic repair; returns attribution even if import fails, with the failed download kept as diagnostics evidence. Review geometry with request_review after successful import.',{bundleId:bundleIdSchema,fileId:z.string().regex(/^[1-9][0-9]{0,11}$/),machineId:z.string(),units:z.enum(['auto','mm','inch']).default('auto')},false,true);
  async function importThingi10kBundle({bundleId,fileId,machineId,units}){
      const dir=await directory(bundleId,{create:true});
      loadMachine(machineId);const machineSetups=await machineSetupStore();
      const result=await importSTL(bundleId,dir,{source:{kind:'thingi10k',fileId},machineId,units,machineSetups});
      return {...result,...(result.imported?summary(bundleId,await (await bundleModule()).loadBundle(dir)):{bundleId})};
    }
  localExtension.registerOperations?.({tool,z,bundleIdSchema,objectSchema,idSchema,read,noApprovalFields});
  operation('set_stl_units','Correct an imported mesh to mm or inch units, rescaling its current geometry and preserving the original STL bytes and printing settings. Invalidates geometry/toolpath confirmations; show the corrected size for geometry review.',{bundleId:bundleIdSchema,units:z.enum(['mm','inch']),...editIdentitySchema},false);
  async function setStlUnits({bundleId,units,expectedRevision,expectedEditRevision}){
      const {setSTLUnits}=await import('../print/import-stl.mjs');
      const dir=await directory(bundleId);return summary(bundleId,await setSTLUnits(dir,units,{expectedRevision,expectedEditRevision}));
    }
  operation('blob_field','Create or rebuild a blob-field part: freely placed points, each with positionMm, reachMm and strength, whose smooth falloffs add up; material is where the sum exceeds the threshold (default 0.25, where a lone strength-1 point is a ball of radius reach/2), cut flat at Z = 0. Negative strength carves. Request {points, threshold?, edgeMm?}; GEOMETRY.md#blob-field describes it. Extracted to a mesh for shared slicing and Studio review.',{bundleId:bundleIdSchema,action:z.enum(['create','update']),request:objectSchema,machineId:z.string().optional(),...editIdentitySchema,part:idSchema.optional()},false);
  async function blobField({bundleId,action,request,machineId,expectedRevision,expectedEditRevision,part}){
      noApprovalFields(request);
      if(action==='create'){
        if(!machineId||expectedRevision!==undefined||expectedEditRevision!==undefined||part!==undefined)throw new Error('Creation requires machineId; revision and part apply to updates.');
        loadMachine(machineId);
        const dir=await directory(bundleId,{create:true});
        const machineSetups=await machineSetupStore();
        return summary(bundleId,await calculateGeometry(bundleId,options=>createBlobFieldBundle(dir,request,{machineId,machineSetups,...options})));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Select a shared shell/mesh print.');
      return summary(bundleId,await calculateGeometry(bundleId,options=>updateBlobFieldBundle(dir,request,{expectedRevision,expectedEditRevision,part,...options})));
    }
  operation('gridfinity','gridfinity',{bundleId:bundleIdSchema,action:z.enum(['create','update']),parameters:objectSchema,machineId:z.string().optional(),...editIdentitySchema,part:idSchema.optional()},false);
  async function gridfinity({bundleId,action,parameters,machineId,expectedRevision,expectedEditRevision,part}){
      noApprovalFields(parameters);
      if(action==='create'){
        if(!machineId||expectedRevision!==undefined||expectedEditRevision!==undefined||part!==undefined)throw new Error('Creation requires machineId; revision and part apply to updates.');
        loadMachine(machineId);
        const dir=await directory(bundleId,{create:true});
        return summary(bundleId,await createExtensionBundle(dir,'gridfinity',parameters,{machineId,machineSetups:await machineSetupStore()}));
      }
      if(machineId!==undefined)throw new Error('Use the existing print machine for updates.');
      if(!expectedRevision&&!expectedEditRevision)throw Error('Gridfinity edits require expectedRevision from the current print.');
      return applyExtension(bundleId,'gridfinity',parameters,{expectedRevision,expectedEditRevision,part},'Select a shared shell/mesh print.');
    }
  operation('apply_extension','Apply an installed extension to the current recipe. Read its manual for request fields. Geometry and deposition assignments commit together; return the saved revision and construction report.',{bundleId:bundleIdSchema,extensionId:z.string().regex(/^[a-z][a-z0-9-]*$/),...editIdentitySchema,request:objectSchema,part:idSchema.optional()},false);
  async function applyExtensionOperation({bundleId,extensionId,expectedRevision,expectedEditRevision,request,part}){return applyExtension(bundleId,extensionId,request,{expectedRevision,expectedEditRevision,part});}
  operation('apply_text','Add, edit or remove raised/recessed text using a local font and a part or independent spline reference. Read text for request fields; assignments can replace the common plan.slices list atomically with geometry. Rebuilds actual geometry and invalidates approvals; use request_review afterward.',{bundleId:bundleIdSchema,...editIdentitySchema,request:objectSchema},false);
  async function applyText({bundleId,expectedRevision,expectedEditRevision,request},session){
      return applyExtension(bundleId,'text',request,{expectedRevision,expectedEditRevision},'Text modifies shared shell/mesh prints.');
    }
  operation('apply_heat_set','Add, edit or remove a heat-set insert hole; its reinforcement (a six-loop annulus and connecting fins) is written as slice assignments ahead of the others. Select the exact insertId from the heat-set-inserts manual size/profile table; read its request and geometry limits. Rebuilds geometry and invalidates affected approvals; use request_review afterward.',{bundleId:bundleIdSchema,...editIdentitySchema,request:objectSchema},false);
  async function applyHeatSet({bundleId,expectedRevision,expectedEditRevision,request}){
      return applyExtension(bundleId,'heat-set-inserts',request,{expectedRevision,expectedEditRevision},'Heat-set inserts modify shared shell/mesh prints.');
    }
  operation('intersect_geometry','Query saved or draft geometry before placement: horizontal sections, vertical top crossings, spline surface cuts, or draft slice families. Families report layer counts, ownership, full-crossing findings and sampled local thickness; no recipe is saved. includeLoops adds chart/world points. Geometry findings are not machine/export approval.',{bundleId:bundleIdSchema.optional(),request:z.object({geometry:geometrySchema.optional(),part:z.string().optional(),sectionsAtZ:z.array(z.number()).optional(),topsAtXY:z.array(z.tuple([z.number(),z.number()])).optional(),surfaces:z.array(patchSchema.omit({name:true}).extend({offsetMm:z.tuple([z.number(),z.number(),z.number()]).optional()})).optional(),families:z.array(draftFamilySchema).describe('Ordinary assignment patches; default first/pitch 0.2mm and width0.4mm, override stack/process explicitly. Geometry belongs to outer request; part null inside drafts.').optional(),includeLoops:z.boolean().optional()}).strict()});
  async function intersectGeometry({bundleId,request}){return intersectRequest(bundleId===undefined?null:(await read(bundleId,{program:false})).dir,request);}
  operation('combine_geometry','Combine a print’s geometry (or one part) with a new operand: request {operation: union|difference|intersection, operand, part?}. The result is a boolean solid; repeating an operation appends to it, and a difference subtracts every later operand. Operands are spline, mesh, blob-field or boolean geometry in the same coordinates. Spline operands stay native: each layer combines their exact sections. Invalidates approvals; use request_review afterward. GEOMETRY.md#booleans.',{bundleId:bundleIdSchema,...editIdentitySchema,request:objectSchema},false);
  async function combineGeometryOperation({bundleId,expectedRevision,expectedEditRevision,request}){
      noApprovalFields(request);
      const {dir,state}=await read(bundleId,{program:false});
      if(state.kind!=='shell')throw new Error('Booleans combine shared shell/mesh prints.');
      return summary(bundleId,await combineGeometry(dir,request,{expectedRevision,expectedEditRevision}));
    }
  operation('slice','Add, edit or remove one general deposition assignment in plan.slices. Shared recipe validation; add fills defaults, edit merges objects and replaces arrays. before controls ownership order. Returns saved settings and immediate deposition diagnostics; blocked findings leave valid intermediate recipes editable. No export or confirmation is created.',{bundleId:bundleIdSchema,...editIdentitySchema,action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),assignment:slicePatchSchema.optional(),before:z.string().nullable().describe('Existing assignment id to insert before; null appends; omitted retains edit position or appends an add.').optional()},false);
  async function slice({bundleId,expectedRevision,expectedEditRevision,...request}){
      noApprovalFields(request.assignment);
      const {dir}=await locate(bundleId),result=await applySlice(dir,request,{expectedRevision,expectedEditRevision});
      return {...summary(bundleId,result.state),edit:result.edit};
    }
  operation('modulate','Add, edit or remove a field modifier in plan.modulations. Select world/slice/curve frame, assignment/role and layer scope. Runs before final support publication; changes invalidate dependent output and confirmation. Add requires channel, amplitude, field and direction for displacement/tilt; edit patches saved settings. Read slice#modulation.',{bundleId:bundleIdSchema,...editIdentitySchema,action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),modifier:modulationPatchSchema.optional()},false);
  async function modulate({bundleId,expectedRevision,expectedEditRevision,...request}){
      noApprovalFields(request.modifier);
      const {dir}=await locate(bundleId),result=await applyModulation(dir,request,{expectedRevision,expectedEditRevision});
      return {...summary(bundleId,result.state),edit:result.edit};
    }
  operation('adjust_recipe','Apply a validated recipe patch at expectedEditRevision (or strict legacy expectedRevision). experimental.substrateAdaptation is boolean, default false: on adapts gap/volume and surface-following placement to deposited substrate. Edits invalidate final confirmation; read fresh state if stale.',{ bundleId: bundleIdSchema, ...editIdentitySchema, patch: z.object({experimental:z.object({substrateAdaptation:z.boolean().describe('Experimental deposited-substrate adaptation; default false.').optional()}).strict().optional()}).passthrough() },false);
  async function adjustRecipe({ bundleId, expectedRevision,expectedEditRevision, patch }){
      noApprovalFields(patch);
      const { dir, bundle, state } = await read(bundleId,{program:false});
      const options={expectedRevision,expectedEditRevision};
      const next=Object.keys(patch).every(key=>SETTINGS_FIELDS.includes(key))
        ?await adjustSettings(dir,patch,options):await bundle.adjustBundle(dir,patch,options);
      return summary(bundleId, next);
    }
  operation('check_bundle','Validate saved native geometry, recipe and any exact generated export using the shared bundle checks. Does not generate or approve.',{ bundleId: bundleIdSchema });
  async function checkBundle({ bundleId }){
    const { state } = await read(bundleId);
    if (state.programError) throw new Error(state.programError);
    return { ...summary(bundleId, state), checked: [...(state.geometry?['geometry']:[]),'plan',...(state.program?['exact-export']:[])], physicalValidation: 'not performed' };
  }
  operation('restore_revision','Undo or redo a saved print edit at its current revision. Restoring history invalidates affected confirmation; show the resulting print in Studio.',{bundleId:bundleIdSchema,expectedRevision:z.string().min(1),direction:z.enum(['undo','redo'])},false);
  async function restoreRevision({bundleId,expectedRevision,direction}){
      const {dir,bundle}=await locate(bundleId);return summary(bundleId,await bundle.restoreRevision(dir,{direction,expectedRevision}));
    }
  operation('check_path','Check path feasibility using the same generator, without approvals or persisted SAAMpath/export artifacts. Reports software checks only; production generation and exact-export review remain required.',{ bundleId: bundleIdSchema });
  async function checkPath({ bundleId }){
    const { dir, bundle } = await locate(bundleId);
    return { bundleId, ...await bundle.checkPathBundle(dir), physicalValidation: 'not performed' };
  }
  operation('record_extension_dependency','Record supplied named extension configuration in the existing recipe skills record. No defaults, installation lookup or execution. Later operations validate what they consume. Null removes the named record.',{bundleId:bundleIdSchema,extensionId:idSchema,configuration:objectSchema.nullable(),...editIdentitySchema},false);
  async function recordExtensionDependencyOperation({bundleId,extensionId,configuration,expectedRevision,expectedEditRevision}){return summary(bundleId,
      await recordExtensionDependency(await directory(bundleId),extensionId,configuration,{expectedRevision,expectedEditRevision}));}
  operation('set_deferred_setup_save','Defer remembering the exact exported setup for this bundle (defer:true), or resume normal remembering (false). Persists across sessions; edits and existing remembered defaults are unchanged.',{bundleId:bundleIdSchema,expectedRevision:z.string().min(1),defer:z.boolean()},false);
  async function setDeferredSetupSaveOperation({bundleId,expectedRevision,defer}){
    const {dir,bundle}=await locate(bundleId);return {bundleId,...await bundle.setDeferredSetupSave(dir,{defer,expectedRevision})};
  }
  operation('get_approval_status','Read the fresh hash-bound final settings/toolpath approval from the saved bundle. Caller-provided approvals are never accepted.',{ bundleId: bundleIdSchema });
  async function getApprovalStatus({ bundleId }){return summary(bundleId, (await read(bundleId)).state);}
  operation('begin_studio_work','Optionally establish or claim work context before editing. Ordinary result-changing operations establish context automatically. Pass Studio requestIds on the operation; identify the Studio instance when ambiguous. Begin alone does not dim the view. Hand back once with respond_to_studio_request.',{bundleId:bundleIdSchema.optional(),studioInstanceId:z.string().optional(),instruction:z.string().min(1),requestId:z.string().optional(),kind:z.enum(['edit','guidance']).default('edit')},false);
  async function beginStudioWork({bundleId,studioInstanceId,instruction,requestId,kind}){
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
      if(requestId){if(record?.printId!==bundleId)throw Error('That request belongs to another print.');if(record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');}
      const bundle=await bundleFor(dir),bundleState=await bundle.loadBundle(dir,{program:false});
      if(requestId)return {...agentRequest(await agentRequests.update(requestId,{status:'working'})),editRevision:bundleState.editRevision};
      return {...agentRequest(await agentRequests.begin({directory:dir,instruction,kind,studioInstanceId,bundleState})),editRevision:bundleState.editRevision};
    }
  operation('respond_to_studio_request','Hand back once when the requested intent is achieved, discussion or a decision is needed, or a new user message interrupts autonomous work. Use returned workRequest.id. completed finishes; waiting pauses. The operation already underway settles and its concrete saved revision is displayed before undimming. Omit resultStage to accept the displayed pane, including usable previous toolpath. Intermediate saves remain visible and working. Inspection grants no approval. Legacy working targets remain supported for tours.',{requestId:z.string(),status:z.enum(['working','waiting','completed','failed','cancelled']).default('completed'),resultStage:z.enum(['geometry','toolpath']).optional(),message:z.string().default('')},false);
  async function respondToStudioRequest({requestId,...response}){return agentRequest(await handBackRequest(requestId,response));}
  operation('wait_for_studio_request','Optionally monitor Studio requests and delivered events. Claude Code defaults to 30 minutes; silence and expiry are normal. Renew while bundle work or interactive tour participation continues, or let an idle monitor lapse; attachment, queued requests and SAAM remain. Codex reads explicitly and defaults to a bounded 25-second wait; automatic wakeup is unverified. Acknowledge completed work before waiting. Claim returned requests and hand back after their work. Follow the tour participation context between lessons.',{after:z.array(z.string()).optional(),waitMs:z.number().int().min(0).max(LISTEN_LIMIT_MS).optional(),claim:z.boolean().optional(),studioInstanceId:z.string().optional()});
  async function waitForStudioRequest(args,session){
      if(args.studioInstanceId&&!studioSessions.has(args.studioInstanceId))throw Error('That Studio instance is not owned by this agent.');
      const {defaultMs,maxMs}=session.listen,waitMs=Math.min(maxMs,args.waitMs??defaultMs);
      const result=await agentRequests.wait({...args,claim:false,waitMs}),generation=generationStatus();
      if(args.claim&&result.requests.length){
        const claim=attachments.tail.then(async()=>{
          if(app.closing)throw Error('The SAAM application is quitting.');
          const claimed=[];
          for(const request of result.requests)await validateTarget('wait_for_studio_request',{requestId:request.id});
          for(const request of result.requests)claimed.push(await agentRequests.update(request.id,{status:'working'}));
          return claimed;
        });attachments.tail=claim.catch(()=>{});result.requests=await claim;
      }
      const records={...result,requests:result.requests.map(agentRequest),...(result.events?{events:result.events.map(agentEvent)}:{})};
      return generation.length?{...records,generation}:records;
    }
  operation('get_studio_events','Read and clear the Studio event queue: what the person did in your owned Studio instances since your last read (lesson changes, opened prints, imports, exports, approvals, displayed results, calculation start/finish/failure/cancellation, viewer connections) plus live geometry, import/repair and toolpath progress with elapsed time. Delivered events also arrive on tool results and listener waits; sequence numbers identify repeats. Set history to include recently read events.',{history:z.boolean().default(false)});
  async function getStudioEvents({history}){return {events:studioEvents.drain().map(agentEvent),generation:generationStatus(),...(history?{recent:studioEvents.history().map(agentEvent)}:{})};}
  operation('get_studio_requests','Read outstanding work and the latest edit outcome per print. Set history for all resolved records; optionally restrict to one print.',{bundleId:bundleIdSchema.optional(),history:z.boolean().default(false)});
  async function getStudioRequests({bundleId,...options}){return {requests:(await agentRequests.query({...options,printId:bundleId})).map(agentRequest)};}
  operation('get_studio_sessions','List live Studio instances owned exclusively by this agent. One agent may own several instances; print bundles remain shareable across agents.',{});
  async function getStudioSessions(){return {sessions:[...studioSessions.values()].map(({server:studio,url})=>({...agentStudioSession(studio.agentSession()),url}))};}
  operation('cancel_studio_calculation','Cancel a live geometry, import/automatic repair or toolpath calculation. Supply studioInstanceId for Studio work; omit it for a tool geometry calculation, import or generation. First read get_studio_events for its identity, elapsedMs and actual progress; pass the geometry/import jobId or Studio toolpath generationHash; direct tool generation requires both jobId and generationHash. Repairs have no reliable remaining-time estimate and continue unless cancelled. Explain your decision to the person. Cancellation interrupts work and cleans incomplete imports; it does not change the previously open print.',{studioInstanceId:z.string().optional(),jobId:z.string().optional(),generationHash:z.string().optional()},false);
  async function cancelStudioCalculation({studioInstanceId,...identity}){
      if(!studioInstanceId){
        const calculation=calculations.get(identity.jobId);
        if(calculation){
          if(calculation.ownerId!==ownerId)throw Error('That calculation is not owned by this chat.');
          if(calculation.status==='committing')return {cancelled:false,committing:true,kind:'geometry',jobId:identity.jobId};
          calculation.controller.abort(Object.assign(Error('Geometry calculation cancelled.'),{name:'AbortError',code:'GEOMETRY_CANCELLED'}));
          return {cancelled:true,kind:'geometry',jobId:identity.jobId};
        }
        const imported=imports.get(identity.jobId);
        if(imported&&imported.ownerId===ownerId){
          if(imported.status==='committing')return {cancelled:false,committing:true,kind:imported.kind??'import',jobId:identity.jobId};
          imported.controller.abort(Object.assign(Error('Import cancelled.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
          return {cancelled:true,kind:imported.kind??'import',jobId:identity.jobId};
        }
        const generation=generations.get(identity.jobId);
        if(!generation||generation.ownerId!==ownerId||identity.generationHash!==generation.generationHash)throw Error('Read the active jobId and generationHash before cancelling.');
        const result=generation.job.cancel();await result.done;
        return {cancelled:result.cancelled,committing:result.committing,kind:'generation',jobId:identity.jobId};
      }
      const session=studioSessions.get(studioInstanceId);if(!session)throw Error('Choose a live Studio instance owned by this agent.');
      return session.server.cancelCalculation({...identity,reason:'agent'});
    }
  async function requireTourOwner(){
    const guide=await tour.info(),instanceId=guide.studioOwner?.instanceId;
    if(guide.active&&instanceId&&!studioSessions.has(instanceId))throw Error('The active tour is attached to another chat. Explicitly capture its bundle first.');
    if(instanceId&&transferringStudios.has(instanceId))throw Error('The tour Studio is transferring to another chat.');
    return guide;
  }
  operation('start_tour','Start fresh tour copies in this application, attach this chat and return the first Studio screen plus participation guidance.',{startAtLayer:z.number().int().min(1).optional()},false);
  async function startTour({startAtLayer}){
      await requireTourOwner();
      const existing=[...studioSessions.values()].find(candidate=>!candidate.server.currentPrint());
      const studio=existing??await startStudio(null);
      const prepared=await studio.server.startTour();
      const directory=studio.server.currentPrint();
      const bundleId=agentRequests.printId(directory);
      if(startAtLayer)await studio.server.setStartAt({layer:startAtLayer});
      const browserOpenRequested=autoOpen?await showStudio(studio.url):false;
      return {bundleId,studioInstanceId:studio.server.agentSession().instanceId,url:studio.url,browserOpenRequested,tour:agentTour(await tour.info()),
        notes:await readLocalAgentNotes(paths),sources:await onboardingSources(root,{}),participation:await readManual(root,'examples/prints/README.md#maker-agent-participation',{})};
    }
  operation('get_tour','Read the active tour print, lesson gates and maker-agent instruction. After reaching the chat lesson, offer infill options in chat. After completion, immediately congratulate the participant, offer help with any difficulties printing the downloaded file, and ask what she wants to make next. Optional bounded wait follows user progress.',{after:z.string().optional(),waitMs:z.number().int().min(0).max(25000).optional()});
  async function getTour({after,waitMs=0}){
      const deadline=Date.now()+waitMs;
      for(;;){const status=await tour.info(),cursor=JSON.stringify([status.active,status.completed,status.step,status.canNext,status.selected]);
        if(cursor!==after||Date.now()>=deadline)return {...agentTour(status),cursor};
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    }
  operation('set_tour_start_at','Choose a deposited layer after the first for the identified tour lesson. Use the runId and lessonId from the guidance request scope or get_tour; discard work when that lesson has ended.',{startAt:z.object({layer:z.number().int().min(1)}).strict(),runId:z.string(),lessonId:z.string()},false);
  async function setTourStartAt({startAt,...scope}){await requireTourOwner();return agentTour(await tour.setStartAt(startAt,scope));}
  operation('change_machine','Change a print to a supported printer using its remembered or default setup. Invalidates final settings/toolpath confirmation and validates compatibility before saving.',{bundleId:bundleIdSchema,machineId:z.string(),...editIdentitySchema},false);
  async function changeMachineOperation({bundleId,machineId,expectedRevision,expectedEditRevision}){
      const {dir,bundle}=await locate(bundleId);if(!bundle.changeMachine)throw Error('This adapter cannot change its printer.');
      loadMachine(machineId);return withMachineHint(bundleId,await changeMachine(dir,machineId,{expectedRevision,expectedEditRevision,machineSetups:await machineSetupStore()}),machineId);
    }
  operation('capture_bundle','Explicitly take over the bundle in its existing Studio. Fails while actual work runs; cancels the old chat unfinished requests, preserves the window and rejects its later writes.',{bundleId:bundleIdSchema},false);
  async function captureBundleOperation({bundleId}){return captureBundle(chats.get(ownerId),bundleId);}
  operation('request_review','Show the bundle in its one Studio window, creating a window if needed. An existing attached window is reused. Another chat must explicitly capture the bundle before working on it. Optional startAt selects a deposited tour layer. No approval or generation is performed.',{ bundleId: bundleIdSchema,studioInstanceId:z.string().optional(),startAt:z.object({layer:z.number().int().min(1)}).strict().optional(),...localExtension.reviewSchema?.(z) },false);
  async function requestReview({ bundleId,studioInstanceId,startAt,...viewOptions }){
    const { dir, state } = await read(bundleId);
    const viewPath=await localExtension.reviewPath?.({dir,...viewOptions})??'';
    const existing=[...allStudios.values()].find(candidate=>candidate.server.currentPrint()===dir);
    if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before reviewing.');
    const chosen=studioInstanceId?studioSessions.get(studioInstanceId):existing;
    if(studioInstanceId&&!chosen)throw Error('That Studio instance is not attached to this chat.');
    if(existing&&chosen&&existing!==chosen)throw Error('This bundle already has a Studio instance. Use that window.');
    const empty=[...studioSessions.values()].find(candidate=>!candidate.server.currentPrint());
    const reusable=[...studioSessions.values()].filter(candidate=>candidate.server.listening).at(-1);
    if(!chosen&&!empty&&reusable)assertStudioIdle(reusable);
    const session=chosen??empty??reusable??await startStudio(dir);
    await session.server.openPrint(dir);
    preferredStudioByPrint.set(bundleId,session.server.agentSession().instanceId);
    if(startAt)await session.server.setStartAt(startAt);
    const url=session.url+viewPath;
    // An open viewer is rebound in place; only a Studio nobody is viewing opens a tab.
    const browserOpenRequested = autoOpen && !session.server.viewerCount() ? await showStudio(url) : false;
    return { ...summary(bundleId, state),studioInstanceId:session.server.agentSession().instanceId, url, browserOpenRequested };
  }
  operation('close_studio_session','Close one Studio instance owned by this agent without affecting other instances or the shared print bundle.',{studioInstanceId:z.string()},false);
  async function closeStudioSession({studioInstanceId}){
    const session=studioSessions.get(studioInstanceId);if(!session)throw Error('That Studio instance is not owned by this agent.');
    const result=session.server.agentSession();await session.server.shutdown();return {...agentStudioSession(result),connected:false};
  }
  operation('generate_toolpath','Generate and check the declared export from the current geometry and complete settings, including during the tour. This is reviewable output, not approval.',{ bundleId: bundleIdSchema },false);
  async function generateToolpath({ bundleId },_session,instance){
    const { dir, bundle } = await locate(bundleId);
    const activity={generationHash:null};
    const publishGeneration=active=>{for(const session of studioSessions.values())if(session.server.currentPrint()===dir)session.server.setGenerationActivity({generationHash:activity.generationHash,active});};
    try{
    const checks=await bundle.generateBundle(dir,{dispatchComputation:async({directory,generationHash})=>{
      const jobId=randomUUID(),startedAt=Date.now();
      const job=new PreparedGenerationJob({key:directory+':'+generationHash,directory,generationHash,
        createWorker:cancellation=>new Worker(new URL('../../studio/generation-worker.mjs',import.meta.url),{workerData:{directory,generationHash,progress:true,cancellation}})});
      job.worker?.ref();
      generations.set(jobId,{ownerId,jobId,printId:bundleId,generationHash,startedAt,job});
      activity.generationHash=generationHash;publishGeneration(true);
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
    }finally{if(activity.generationHash)publishGeneration(false);}
  }
  operation('deliver_toolpath','Copy the exact current human-reviewed export bytes into the bundle delivery folder. Fails without current toolpath approval. Does not run hardware.',{ bundleId: bundleIdSchema },false);
  async function deliverToolpath({ bundleId }){
    const { dir, bundle } = await locate(bundleId);
    if(await tourExample(dir))throw Error('Exit the tour before confirming a real print.');
    const file = await bundle.deliver(dir,{machineSetups:paths.machineSetups}), state = await bundle.loadBundle(dir);
    return { ...summary(bundleId, state), file, exportHash: state.exportHash };
  }
  // Runs the named operation's entry with validated input. Each case names the
  // function it calls, so every operation's effects and result stay its own.
  function perform(name,input,session,instance){
    const extension=extensionActions.get(name);
    if(extension)return extension(input,session,instance);
    switch(name){
      case 'read_local_agent_notes':return readLocalAgentNotes(paths);
      case 'update_local_agent_notes':return updateLocalAgentNotes(paths,input);
      case 'maker_onboarding':return makerOnboarding(input);
      case 'repair_client_setup':return repairClientSetup();
      case 'list_machines':return listMachines();
      case 'list_skills':return skills();
      case 'list_workspaces':return listWorkspacesOperation();
      case 'open_workspace':return openWorkspace(input);
      case 'get_workspace':return getWorkspace(input);
      case 'preview_workspace':return previewWorkspace(input);
      case 'close_workspace':return closeWorkspace(input);
      case 'update_workspace':return updateWorkspace(input);
      case 'create_workspace_bundles':return createWorkspaceBundles(input);
      case 'read_skill':return readSkill(input);
      case 'read_guidance':return readGuidanceOperation(input);
      case 'get_recipe_defaults':return getRecipeDefaults(input);
      case 'list_bundles':return listBundles();
      case 'get_bundle':return getBundle(input);
      case 'create_bundle':return createBundle(input);
      case 'migrate_bundle':return migrateBundleOperation(input);
      case 'get_bundle_instance':return getBundleInstanceOperation(input);
      case 'recover_bundle_instance':return recoverBundleInstanceOperation(input);
      case 'repair_stl':return repairStl(input);
      case 'extension_library':return extensionLibrary(input);
      case 'share_bundle':return shareBundle(input);
      case 'import_bundle':return importBundle(input,instance);
      case 'import_stl_bundle':return importStlBundle(input);
      case 'search_thingi10k':return searchThingi10k(input);
      case 'import_thingi10k_bundle':return importThingi10kBundle(input);
      case 'set_stl_units':return setStlUnits(input);
      case 'blob_field':return blobField(input);
      case 'gridfinity':return gridfinity(input);
      case 'apply_extension':return applyExtensionOperation(input);
      case 'apply_text':return applyText(input,session);
      case 'apply_heat_set':return applyHeatSet(input);
      case 'intersect_geometry':return intersectGeometry(input);
      case 'combine_geometry':return combineGeometryOperation(input);
      case 'slice':return slice(input);
      case 'modulate':return modulate(input);
      case 'adjust_recipe':return adjustRecipe(input);
      case 'check_bundle':return checkBundle(input);
      case 'restore_revision':return restoreRevision(input);
      case 'check_path':return checkPath(input);
      case 'record_extension_dependency':return recordExtensionDependencyOperation(input);
      case 'set_deferred_setup_save':return setDeferredSetupSaveOperation(input);
      case 'get_approval_status':return getApprovalStatus(input);
      case 'begin_studio_work':return beginStudioWork(input);
      case 'respond_to_studio_request':return respondToStudioRequest(input);
      case 'wait_for_studio_request':return waitForStudioRequest(input,session);
      case 'get_studio_events':return getStudioEvents(input);
      case 'get_studio_requests':return getStudioRequests(input);
      case 'get_studio_sessions':return getStudioSessions();
      case 'cancel_studio_calculation':return cancelStudioCalculation(input);
      case 'start_tour':return startTour(input);
      case 'get_tour':return getTour(input);
      case 'set_tour_start_at':return setTourStartAt(input);
      case 'change_machine':return changeMachineOperation(input);
      case 'capture_bundle':return captureBundleOperation(input);
      case 'request_review':return requestReview(input);
      case 'close_studio_session':return closeStudioSession(input);
      case 'generate_toolpath':return generateToolpath(input,session,instance);
      case 'deliver_toolpath':return deliverToolpath(input);
      default:throw new Error(`Operation ${name} has a definition but no entry in perform().`);
    }
    throw Error(`Unknown SAAM operation ${name}.`);
  }
  async function sessionInvoke(operation,args={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    activity.calls++;

    try{return await invoke(operation,args,{listen:client==='claude'?CLAUDE_LISTEN:LOCAL_LISTEN});}
    finally{activity.calls--;}
  }
  async function openStudio(){
    if(app.closing)throw Error('The SAAM application is closing.');
    const session=[...studioSessions.values()].filter(({server})=>server.listening).at(-1)??await startStudio(null);
    const browserOpenRequested=autoOpen&&!session.server.viewerCount()?await showStudio(session.url):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  async function showWorkspaceBundles(workspace,event){
    for(const part of event.bundles??[]){
      const bundleId=relative(libraryRoot,resolve(event.directory,part.path)).split(sep).join('/');
      if(workspace.bundleViews.records.has(bundleId))continue;
      const view=await visibleBundle(bundleId),records=await agentRequests.startWork({directory:view.dir,studioInstanceId:view.server.agentSession().instanceId,instruction:'Created workspace part '+part.id+'. Review the draft and continue work before hand-back.'});
      const snapshot=await agentRequests.snapshot(view.dir);
      for(const record of records)await agentRequests.savedWork(record.id,snapshot);
      const result={bundleId,studioInstanceId:view.server.agentSession().instanceId,url:view.url,browserOpenRequested:view.browserOpenRequested,workRequest:{id:records[0].episodeId??records[0].id,requestIds:records.map(record=>record.id)}};
      workspace.bundleViews.records.set(bundleId,result);
      studioEvents.record('workspace-bundle-visible',{workspaceInstanceId:workspace.workspaceInstanceId,jobId:event.jobId,...result});
    }
  }
  function queueWorkspaceViews(workspace,event){
    const run=workspace.bundleViews.tail.then(()=>showWorkspaceBundles(workspace,event));
    const settled=run.catch(error=>{workspace.bundleViews.error=error.message;studioEvents.record('workspace-bundle-view-failed',{workspaceInstanceId:workspace.workspaceInstanceId,jobId:event.jobId,error:error.message});});
    workspace.bundleViews.tail=settled;work.pending.add(settled);
    void settled.then(()=>work.pending.delete(settled));
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
        if(kind==='workspace-bundles-completed'&&!app.closing)queueWorkspaceViews(session,event);
      }});
      session.workspaceInstanceId=workspaceInstanceId;session.ownerId=ownerId;session.bundleViews={records:new Map(),tail:Promise.resolve(),error:null};
      workspaceSessions.set(workspaceInstanceId,session);
      session.server.once('close',()=>{if(workspaceSessions.get(workspaceInstanceId)===session)workspaceSessions.delete(workspaceInstanceId);});
    }
    const browserOpenRequested=autoOpen&&!session.server.viewerCount?.()?await showStudio(session.url):false;
    return {workspaceInstanceId:session.workspaceInstanceId,url:session.url,directory:session.directory,extension:session.extension,browserOpenRequested};
  }
  return {id:ownerId,name,client,requests:agentRequests,events:studioEvents,
    operations:[...operations.values()].map(({action,...definition})=>definition),
    invoke:sessionInvoke,validateTarget,openStudio,startStudio,
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
    if(!capture&&session.ownerId!==lobby.id&&session.ownerId!==chat.id)throw Error('This Studio is already attached to another chat. Use capture_bundle to take it over explicitly.');
    if(session.ownerId===chat.id)return;
    await session.server.attachChat({ownerId:chat.id,agentRequests:chat.requests,studioEvents:chat.events,name:chat.name,client:chat.client});
    chats.get(session.ownerId)?.releaseStudio(session.server.agentSession().instanceId);
    session.ownerId=chat.id;chat.ownStudio(session.server.agentSession().instanceId,session);
  }
  async function connectChat({id,name,client,bundleId,operation,args}={}){
    const known=connectedChats.has(id),chat=beginSession({id,name,client});
    if(bundleId)bundleIdSchema.parse(bundleId);
    if(operation)await chat.validateTarget(operation,args,true);
    // Explicit capture owns its transfer; ordinary connection must not preempt it.
    if(operation==='capture_bundle'){connectedChats.add(chat.id);return chat;}
    const directory=bundleId?resolve(libraryRoot,bundleId):null;
    const targetInstance=args?.expectedStudio?.studioInstanceId??args?.studioInstanceId;
    const selected=targetInstance?allStudios.get(targetInstance):directory?[...allStudios.values()].find(session=>session.server.currentPrint()===directory):null;
    if(selected&&selected.ownerId!==chat.id){await transferStudio(chat,selected,false);}
    else if(!known){
      const available=[...allStudios.values()].find(session=>session.ownerId===lobby.id&&!session.server.currentPrint());
      if(available)await transferStudio(chat,available,false);
    }
    connectedChats.add(chat.id);return chat;
  }
  function assertStudioIdle(session){
    const instanceId=session.server.agentSession().instanceId,directory=session.server.currentPrint();
    if(session.server.attachmentBusy())throw Error('Wait for the current Studio operation to finish before capturing or re-pairing.');
    for(const operation of activeOperations.values())if(operation.ownerId===session.ownerId&&['set_tour_start_at','start_tour'].includes(operation.name)||operation.studioInstanceId===instanceId||operation.bundleId&&resolve(libraryRoot,operation.bundleId)===directory)
      throw Error('A bundle operation is running. Wait for it to finish before capturing or re-pairing.');
    for(const job of calculations.values())if(directory&&resolve(libraryRoot,job.printId)===directory)throw Error('A geometry calculation is running for this bundle.');
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
  async function openStudio({studioInstanceId,newInstance=false}={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    if(newInstance&&studioInstanceId)throw Error('Choose an existing Studio or create a new instance.');
    const session=newInstance?await lobby.startStudio(null):studioInstanceId?allStudios.get(studioInstanceId):[...allStudios.values()].filter(({server})=>server.listening).at(-1);
    if(studioInstanceId&&!session?.server.listening)throw Error('That Studio is no longer running.');
    if(!session)return lobby.openStudio();
    const browserOpenRequested=autoOpen?await showStudio(session.url):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  function notifyStopping(reason){
    for(const {server} of allStudios.values())server.applicationStopping(reason);
  }
  function jobs(){
    return [...[...calculations.values()].map(({controller,...job})=>job),...[...allStudios.values()].map(({server})=>server.generationStatus()).filter(Boolean),
      ...[...imports.values()].map(({controller,...job})=>job),
      ...[...generations.values()].map(({job,...identity})=>({...identity,status:job.status})),
      ...[...workspaceSessions.values()].map(session=>({workspaceInstanceId:session.workspaceInstanceId,inspect:session.inspect}))];
  }
  async function runningJobs(){
    const workspaces=await Promise.all([...workspaceSessions.values()].map(async session=>({workspaceInstanceId:session.workspaceInstanceId,...await session.inspect()})));
    return [...jobs().filter(job=>!job.inspect),...workspaces.filter(value=>value.job&&!['complete','failed','cancelled'].includes(value.job.stage))];
  }
  function close(){return app.closing??=(async()=>{
    for(const job of calculations.values())if(job.status!=='committing')job.controller.abort(Object.assign(Error('SAAM is quitting.'),{name:'AbortError',code:'GEOMETRY_CANCELLED'}));
    for(const job of imports.values())if(job.status!=='committing')job.controller.abort(Object.assign(Error('SAAM is quitting.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
    await Promise.all([...generations.values()].map(({job})=>job.cancel().done));
    // Stop existing Studio workers before draining work; no queued operation may start after closing.
    await Promise.all([...allStudios.values()].map(({server})=>server.shutdown()));
    await Promise.all([...work.pending]);await attachments.tail;
    // An already-running opener can finish while shutdown is draining.
    await Promise.all([...allStudios.values()].map(({server})=>server.shutdown()));
    await Promise.all([...workspaceSessions.values()].map(session=>session.shutdown()));
    for(const chat of chats.values())chat.close();
    chats.clear();connectedChats.clear();allStudios.clear();workspaceSessions.clear();operationObservers.clear();eventObservers.clear();
  })();}
  async function restoreStudios(windows){
    for(const window of windows){
      const attachment=window.attachment;
      const chat=attachment?beginSession({id:attachment.ownerId,name:attachment.name,client:attachment.client}):lobby;
      await chat.startStudio(window.printId?resolve(libraryRoot,window.printId):null,{instanceId:window.instanceId,sessionToken:window.sessionToken,restoring:true});
      if(attachment)connectedChats.add(chat.id);
    }
  }
  async function releaseStudioForCapture(instanceId){
    const session=allStudios.get(instanceId);
    if(!session)throw Error('That Studio is no longer running.');
    assertStudioIdle(session);await cancelOldRequests(session);await session.server.shutdown();
    return {completed:true};
  }
  return {beginSession,connectChat,openStudio,notifyStopping,runningJobs,close,restoreStudios,releaseStudioForCapture,activeCount:()=>activeOperations.size+work.pending.size+transferringStudios.size,
    operations:lobby.operations,
    observeEvents(observer){eventObservers.add(observer);return()=>eventObservers.delete(observer);},
    observeOperations(observer){operationObservers.add(observer);return()=>operationObservers.delete(observer);},
    studios:()=>[...allStudios.values()].map(({server,url})=>({...server.agentSession(),url})),
    chatIds:()=>[...chats.keys()].filter(id=>id!==lobby.id)
  };
}
