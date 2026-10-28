import {readLocalAgentNotes,updateLocalAgentNotes} from '../agent/local-notes.mjs';
import {createAssetTransport} from './acquired-assets.mjs';
import {createResultImages} from './result-images.mjs';
import {createOwnedJobs} from './owned-jobs.mjs';
import {watchStudioChanges} from '../../studio/changes.mjs';
import {requireBundleInstance} from '../print/studio-ownership.mjs';
import {bundleRuntime,recordBundleRuntime} from '../print/bundle-runtime.mjs';
import {withBundleWriteLock} from '../print/bundle-lock.mjs';
import {createExtensionBundleAccess} from '../print/extension-edits.mjs';
import {createExtensionOperations} from '../extensions/operations.mjs';
import {summary} from '../print/summary.mjs';
import {createBundleViewQueries} from '../print/view-values.mjs';
import {createBundleEditOperations} from '../print/edit-operations.mjs';
import {createBundleCommandResults} from './command-results.mjs';
import {createBundleSourceOperations} from './source-operations.mjs';
import {createPartCommandRoutes} from '../agent/part-command-routes.mjs';
import {createPortableExchangeOperations} from '../extensions/portable.mjs';
import {bundleIdSchema} from '../print/identity.mjs';
export {summary};
// The local SAAM runtime: every agent operation over the same bundle lifecycle
// and Studio used by the CLI, and the Studio/request state they share. It knows
// no transport; the application's local command interface invokes its operations.
import { z } from 'zod';
import { mkdir, readdir, lstat, realpath, access } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {openBrowser} from '../../studio/browser.mjs';
import {randomUUID} from 'node:crypto';

import { loadMachine,installedMachine } from '../machine/profile.mjs';
import {createSettingsQueries} from '../machine/query-operations.mjs';
import { createStudio } from '../../studio/server.mjs';
import {tourStatus,tourExample} from '../../studio/tour.mjs';
import {createStudioAgentOperations} from '../../studio/agent-operations.mjs';
import {createWorkspaceRegistry} from '../../workspaces/agent-operations.mjs';
import {createChatChannel,requestPrintId,workEvidence} from './chat-requests.mjs';
import {createRequestStore} from './chat-request-store.mjs';
import {contactIncludes} from './client-lifecycle.mjs';
import {loadExtensionEntry} from '../extensions/library.mjs';


import {loadLocalExtension} from '../local-extension.mjs';
import {lifecycleReview} from '../print/review-state.mjs';
import { readManual } from '../agent/manuals.mjs';
import {prepareContextRead,loadContextRead,assembleContextRead,builderOnboarding,listSkills,discoverWorkspaces} from '../agent/context-operations.mjs';
import {readArchitectureSource} from '../agent/published-source.mjs';
import {withObservationFlow,listObservations,readObservationRepresentation,openObservationNative,openObservationRepresentation,closeObservationRetention} from '../contracts/observations.mjs';
import {createInspectionValues} from '../agent/inspection-values.mjs';
import { onboardingSources, machineHint } from '../agent/layers.mjs';



import {slicePatchSchema,modulationPatchSchema,geometrySchema,patchSchema,draftStackSchema} from './deposition-schemas.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const installedExtension=await loadLocalExtension(root);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).refine(id => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id), 'Reserved filename.');
// Shell/mesh is the only bundle kind; the parameter is retained (and defaults)
// so the tool surface stays stable.
const kindSchema = z.enum(['shell']).default('shell');
const objectSchema = z.record(z.string(), z.unknown());
const editIdentitySchema={expectedRevision:z.string().min(1).optional(),expectedEditRevision:z.string().min(1).optional()};
// Review state belongs to Bundle and the person exports from Studio: a review
// field anywhere in a recipe or request is removed, and its path returned.
const REVIEW_FIELD=/approval|approved|^review$|^actor$|^generation$|^history$|^__proto__$|^constructor$|^prototype$/i;
const REVIEW_ARGUMENTS=['plan','patch','request','parameters','assignment','modifier'];
function noApprovalFields(value,at=[]) {
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value).flatMap(key=>{
    if(!REVIEW_FIELD.test(key))return noApprovalFields(value[key],[...at,key]);
    delete value[key];return [[...at,key].join('.')];
  });
}
// Arguments an operation does not read, misspelled ones included, are removed
// and named; a known argument of the wrong type still fails. A union follows
// the branch whose only objection is unknown keys.
function unknownArgumentPaths(issues,at=[]){
  return issues.flatMap(issue=>{
    const path=[...at,...issue.path];
    if(issue.code==='unrecognized_keys')return issue.keys.map(key=>[...path,key]);
    const branch=issue.code==='invalid_union'?issue.errors.find(errors=>errors.length&&errors.every(error=>error.code==='unrecognized_keys')):null;
    return branch?unknownArgumentPaths(branch,path):[];
  });
}
function parseArguments(schema,args){
  const input=structuredClone(args),ignored=[];
  for(;;){
    const parsed=schema.safeParse(input);
    const removed=parsed.success?[]:unknownArgumentPaths(parsed.error.issues).filter(path=>{
      const parent=path.slice(0,-1).reduce((value,key)=>value?.[key],input);
      return parent&&typeof parent==='object'&&Object.hasOwn(parent,path.at(-1))&&delete parent[path.at(-1)];
    });
    ignored.push(...removed.map(path=>path.join('.')+' (not an input of this operation)'));
    if(removed.length)continue;
    if(!parsed.success)return {parsed,ignored};
    for(const name of REVIEW_ARGUMENTS)ignored.push(...noApprovalFields(parsed.data[name],[name]).map(path=>path+' (review state belongs to Bundle; the person exports from Studio)'));
    return {parsed,ignored};
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
export const LOCAL_LISTEN=Object.freeze({defaultMs:25000,maxMs:25000}),LISTEN_LIMIT_MS=30*60*1000;
const CLAUDE_LISTEN=Object.freeze({defaultMs:LISTEN_LIMIT_MS,maxMs:LISTEN_LIMIT_MS});
// Why a client event put the agent with the person: the hand-back message for each reason.
const counterMessages=Object.freeze({turn:'The agent ended its turn.',message:'The person sent a message.',interrupt:'The person interrupted the agent.',input:'The agent is waiting for your input.',failed:'The agent turn failed.',closed:'The chat closed.'});
const expectedStudioSchema=z.object({studioInstanceId:z.string(),bundleId:bundleIdSchema.nullable(),selectionVersion:z.string()}).strict();

export const instructions = 'Use saam help for operations and saam help OP for complete input schemas. Call saam call OP with --input FILE, --stdin or named flags. Result-changing work establishes Studio context automatically. Hand back once with respond_to_studio_request using workRequest.id, including when a new user message interrupts work. Start tours with saam start-tour. Use maker_onboarding once per chat and read individual manuals as needed. A person confirms exact settings and toolpath together in Studio before export. Commands and waits do not own application lifetime. Native adapters report client lifecycle and deliver Studio events as context; only idle chats receive brief file-change wake prompts. Restart clients after setup changes; approve Codex context hooks through the yellow fishhook below the chat composer. Carry expectedStudio with studioInstanceId, bundleId and selectionVersion; retired selections and original request IDs reject stale edits. Return chatId with --chat-id if the command environment has no session ID. No operation grants hardware operation or final approval. Studio event reads retain observations: use afterSeq/cursor only as read positions and ack_studio_events with exact eventIds after delivery. wait_for_studio_request retains its observations and optionally claims requests; the CLI acknowledges its returned event IDs only after awaited output succeeds. Failed acknowledgement is a separate delivery retry, never a reason to replay delivered work. Pure request reads use get_studio_requests. When commandResult.status is available, read get_bundle_command_result with the returned bundleId and commandResult.id for the complete associated edit/findings before interpreting the result or handing work back. That immutable historical report is distinct from live get_bundle state.';

// The owner supplies the home's paths (homePaths record) and this runtime's private
// stateRoot; the optional service supplies Studio's release and diagnostics controls.
export function createLocalRuntime({ paths, stateRoot, autoOpen = process.env.SAAM_NO_AUTO_OPEN !== '1',localExtension=installedExtension,thingi10kClient,relay,application={} }) {
  paths=Object.freeze({...paths});
  const roots=Object.freeze({appRoot:root,dataRoot:paths.home});
  const retentionOwner=randomUUID();
  const libraryRoot = resolve(paths.prints);
  const requestStore=createRequestStore(resolve(stateRoot,'.studio-requests'));
  async function showStudio(url,visibility){
    if(application.showStudio)return application.showStudio(url,visibility);
    return openBrowser(url);
  }
  // A window opened for a viewer counts as present while the browser starts, so no second one opens.
  const present=session=>session.server.viewerCount()>0||Date.now()-(session.shownAt??0)<60000;
  async function show(session,url=session.url){
    if(!autoOpen||session.visibility==='hidden'||session.server.viewerCount())return false;
    const opened=await showStudio(url,session.visibility);if(opened)session.shownAt=Date.now();return opened;
  }
  let resourceClient;
  const getResourceClient=async()=>resourceClient??=loadExtensionEntry('thingi10k','resource-client',roots).then(create=>create());
  const meshLibrary=thingi10kClient??{
    search:async args=>(await getResourceClient()).search(args),
    download:async(fileId,options)=>(await getResourceClient()).download(fileId,options)
  };
  const resultImages=createResultImages({paths});
  const app={closing:null},chats=new Map(),allStudios=new Map(),ownedJobs=createOwnedJobs();
  const workspaceRegistry=createWorkspaceRegistry({...roots,isClosing:()=>Boolean(app.closing)});
  const work={tails:new Map(),pending:new Set()},operationObservers=new Set(),eventObservers=new Set(),clientEventObservers=new Set(),activeOperations=new Map(),transferringStudios=new Set(),monitorCalls=new Set(),passiveMonitors=new Set();
  // A request belongs to the chat attached to its Studio, else to the chat that wrote it.
  const requestOwner=record=>allStudios.get(record.studioInstanceId)?.ownerId??record.ownerId;
  function observeEvent(event){for(const observer of eventObservers)try{observer(agentEvent(structuredClone(event)));}catch{/* Diagnostics never fail work. */}}
  function createChat(ownerId,{name=ownerId,client=null,lobby:isLobby=false,visibility='visible'}={}){
  const presentation={visibility};
  const {requests:agentRequests,events:studioEvents,binding}=createChatChannel(libraryRoot,{ownerId,folder:resolve(stateRoot,'.studio-requests'),store:requestStore,ownerOf:requestOwner,
    attachment:isLobby?null:Object.freeze({ownerId,name,client}),onHandBack:releaseHandbackImages});
  async function releaseHandbackImages(record){
    if(!record?.printId)return;
    const active=await agentRequests.query({printId:record.printId});
    if(active.some(request=>request.workActive||request.handbackPending))return;
    await resultImages.release(ownerId,record.printId);
  }
  studioEvents.observe(event=>{observeEvent(event);if(!isLobby)return Promise.all([...clientEventObservers].map(observer=>observer({client,sessionId:ownerId,event:agentEvent(event)})));});
  const legacyWorkspaceViews=new Map();
  const workspaceCommands=workspaceRegistry.bindChat({ownerId,directory,onEvent(event){
    const {kind,...detail}=event;studioEvents.record(kind,detail);
    if(kind==='workspace-bundles-completed'&&!app.closing)queueWorkspaceViews(event.workspaceInstanceId,event);
    if(kind==='workspace-closed')legacyWorkspaceViews.delete(event.workspaceInstanceId);
  }});
  const studioSessions=new Map(),creationViews=new Set(),rememberedTargets=new Map(),activity={calls:0,pendingWork:new Set()};
  const generationStatus=()=>[...ownedJobs.list({ownerId}),...[...studioSessions.values()].map(({server:studio})=>agentStudioJob(studio.generationStatus())).filter(job=>job&&job.kind!=='geometry')];
  async function calculateGeometry(bundleId,action,studio){
    return ownedJobs.run({ownerId,bundleId,studioInstanceId:studio?.agentSession().instanceId??null,kind:'geometry',status:'constructing',progress:{stage:'Preparing geometry'},
      cancellation:{message:'Geometry calculation cancelled.',code:'GEOMETRY_CANCELLED'},commitStage:'Saving geometry',
      project:studio?({read,cancel})=>studio.observeCalculation(resolve(libraryRoot,bundleId),read,cancel):undefined,
      event:(name,detail)=>studioEvents.record(name,detail)},async job=>{
      job.event('geometry-started');
      try{
        const result=await action(job);job.event('geometry-completed');return result;
      }catch(error){job.event(job.signal.aborted?'geometry-cancelled':'geometry-failed',{error:error.message});throw error;}
    });
  }
  async function runSourceJob({bundleId,kind,status,progress},action){
    return ownedJobs.run({ownerId,bundleId,kind,status,progress,
      cancellation:{message:'Import cancelled.',code:'IMPORT_CANCELLED'},event:(name,detail)=>studioEvents.record(name,detail)},action);
  }
  // Every runtime-owned Studio instance starts here, showing dir or no print.
  async function startStudio(dir,{instanceId,sessionToken,selectionVersion,restoring=false,visibility=presentation.visibility}={}){
    if(app.closing)throw Error('The SAAM application is quitting.');
    const studio = createStudio(dir, { libraryRoot,paths,machineSetups:paths.machineSetups,chat:binding,relay,instanceId,sessionToken,selectionVersion,restoring,runtimeId:application.runtime?.id,runtimeLabel:application.runtime?.label,studioTitle:application.runtime?.studioTitle,fingerprint:application.fingerprint,partCommands,
      routeStudio:target=>routeWindow(allStudios.get(studio.agentSession().instanceId),target),selectedValues:inspectionValues });
    try{await studio.ready();}catch(error){await studio.shutdown().catch(()=>{});throw error;}
    try{await new Promise((resolveListen, reject) => { studio.once('error', reject); studio.listen(0, '127.0.0.1', resolveListen); });}
    catch(error){await studio.shutdown().catch(()=>{});throw error;}
    const upstreamUrl=`http://127.0.0.1:${studio.address().port}`,studioInstanceId=studio.agentSession().instanceId;
    const registration={visible:null};
    try{registration.visible=application.registerStudio?await application.registerStudio({instanceId:studioInstanceId,upstreamUrl,visibility,chatVisibility:presentation.visibility,sessionToken:studio.sessionToken()}):{url:upstreamUrl};}
    catch(error){await studio.shutdown().catch(()=>{});throw error;}
    const visible=registration.visible;
    const session={server:studio,url:visible.url,visibility};
    session.ownerId=ownerId;allStudios.set(studioInstanceId,session);studioSessions.set(studioInstanceId, session);

    studio.once('close',()=>{
      allStudios.delete(studioInstanceId);
      for(const chat of chats.values())chat.releaseStudio(studioInstanceId);
      studioCommands.release(studioInstanceId);
    });
    return session;
  }
  // The window this chat's next view uses, in order: its own window someone is viewing; an idle
  // window someone is viewing, here or (through the orchestrator, preferring this chat's previous
  // window) in another runtime; its own window; a new one. dir: the saved print to show, if any.
  async function viewStudio(dir,{expectedStudio,studioInstanceId}={}){
    const own=[...studioSessions.values()].filter(session=>session.server.listening&&!session.server.creationTarget());
    const explicitId=expectedStudio?.studioInstanceId??studioInstanceId;
    if(explicitId&&!studioSessions.has(explicitId))throw Error('That Studio is no longer attached to this chat.');
    const session=(explicitId?allStudios.get(explicitId):null)??own.filter(present).at(-1)??(presentation.visibility==='hidden'?null:await adoptWindow(chats.get(ownerId)));
    const moved=session||presentation.visibility==='hidden'?null:await application.adoptWindow?.({chatId:ownerId});
    // The moved window's viewer is reconnecting to it.
    if(moved)return Object.assign(await startStudio(dir,moved),{shownAt:Date.now()});
    const reused=session??own.at(-1);
    if(!reused)return startStudio(dir);
    assertStudioIdle(reused,0,reused.ownerId===ownerId?ownerId:null);
    if(dir&&reused.server.currentPrint()!==dir)await reused.server.openPrint(dir,{expectedStudio});
    return reused;
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
  async function read(bundleId, {program='source'}={}) {
    const {dir,state}=await bundleViews.readBundle(bundleId,{program});
    return {dir,state};
  }
  const bundleCommandResults=createBundleCommandResults(resolve(paths.local??resolve(paths.home,'local'),'bundle-command-results'));
  const bundleViews=createBundleViewQueries({directory,libraryRoot,commandResults:bundleCommandResults});
  const retainedQuery=async(name,input)=>{
    if(name!=='read_contract_observations')throw Error('Unknown retained value query.');
    const folder=resolve(paths.state??stateRoot,'contract-observations');
    if(input.representation&&!input.id)throw Error('An admitted representation needs an observation identity.');
    return input.id?readObservationRepresentation(folder,input.id,input.representation,{ownerId:retentionOwner}):listObservations(folder,input);
  };
  const inspectionValues=createInspectionValues({queryRuntime:retainedQuery,libraryRoot,openNativeRuntime:async(name,{id,signal})=>{
    if(name!=='read_contract_observations')throw Error('Unknown retained value query.');
    return openObservationNative(resolve(paths.state??stateRoot,'contract-observations'),id,{signal,ownerId:retentionOwner});
  },openRepresentationRuntime:async(name,{id,representation,signal})=>{
    if(name!=='read_contract_observations')throw Error('Unknown retained value query.');
    return openObservationRepresentation(resolve(paths.state??stateRoot,'contract-observations'),id,{representation,signal,ownerId:retentionOwner});
  }});
  const settingsQueries=createSettingsQueries({...roots,machineSetupsPath:paths.machineSetups});
  const bundleEdits=createBundleEditOperations({...roots,directory,runGeometry:calculateGeometry,machineSetupsPath:paths.machineSetups,commandResults:bundleCommandResults});
  const sourceCommands=createBundleSourceOperations({...roots,directory,paths,machineSetupsPath:paths.machineSetups,assets:createAssetTransport({meshLibrary,paths}),runJob:runSourceJob});
  const portableCommands=createPortableExchangeOperations({directory,runJob:runSourceJob,assets:createAssetTransport({meshLibrary,paths}),...roots,paths});
  const partCommands=createPartCommandRoutes({directory});
  async function readTourSnapshot(directory){
    return bundleViews.readSnapshot(requestPrintId(libraryRoot,directory));
  }
  const extensionCommands=createExtensionOperations({...roots,Bundle:createExtensionBundleAccess({...roots,directory,machineSetupsPath:paths.machineSetups}),runGeometry:calculateGeometry});
  // Settings select available guidance; only summary consumes the print state.
  async function withMachineHint(bundleId,state,machine){
    const result=summary(bundleId,state),hint=machine?await machineHint(root,{to:installedMachine(state.machineId,roots)}):null;
    return hint?{...result,gatedGuidance:hint}:result;
  }
  const immediateTools=new Set(['builder_onboarding','read_contract_source','read_contract_observations','begin_studio_work','respond_to_studio_request','wait_for_studio_request','get_studio_requests','get_studio_events','ack_studio_events','claim_studio_requests','get_studio_sessions','cancel_studio_calculation','get_tour','get_workspace','capture_bundle','get_bundle_instance','recover_bundle_instance','repair_stl']);
  const diagnosticFields=(value,keys)=>Object.fromEntries(keys.filter(key=>value&&Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  const reportOperation=event=>{for(const observer of operationObservers)try{observer(event);}catch{/* Diagnostics never fail an operation. */}};
  // The registry holds each operation's definition (help, validation, scope);
  // perform() below names the entry that runs it.
  function operation(name, description, shape, readOnly = true, openWorld = false, resultStage = null, creation = 'none', effect = 'part') {
    extensionActions.delete(name);
    const tracked=Boolean(shape.bundleId)&&!immediateTools.has(name);
    const resultChanging=tracked&&!readOnly&&effect!=='artifact'&&!['request_review','set_deferred_setup_save','set_phase_colours'].includes(name);
    const instanceScope=tracked&&!readOnly&&effect!=='artifact'&&!['request_review','create_bundle','import_bundle','import_stl_bundle','import_thingi10k_bundle'].includes(name);
    // The strict schema names unexpected arguments, which invoke removes and reports.
    const schema=z.object({...shape,expectedStudio:expectedStudioSchema.optional(),...(tracked?{requestIds:z.array(z.string()).optional(),studioInstanceId:z.string().optional()}: {})}).strict();
    operations.set(name,{name,description,schema,readOnly,openWorld,tracked,instanceScope,resultChanging,resultStage,creation,effect,immediate:immediateTools.has(name)});
  }
  // A local extension registers operations with its own entries; they run at
  // the extension boundary, and a later registration of a name replaces it.
  const extensionActions=new Map();
  function tool(name, description, shape, action, readOnly, openWorld, resultStage) {
    operation(name,description,shape,readOnly,openWorld,resultStage);
    extensionActions.set(name,action);
  }
  // Validate the caller's remembered association before claims, activity or edits.
  // Reuse this boundary before initial attachment; requests retain their original target.
  function assertStudioTarget(studioInstanceId,bundleId,{beforeAttachment=false,capture=false,selectionVersion}={}){
    const session=allStudios.get(studioInstanceId),current=session?.server.agentSession();
    if(!current||current.printId!==bundleId||selectionVersion&&selectionVersion!==current.selectionVersion){
      const currentStudio=current?{studioInstanceId:current.instanceId,bundleId:current.printId,selectionVersion:current.selectionVersion,url:session.url}:null;
      throw Object.assign(Error('The Studio target changed. Resolve the current bundle before continuing this work.'),
        {code:'STUDIO_TARGET_CHANGED',currentStudio,expectedStudio:{studioInstanceId,bundleId}});
    }
    if(session.ownerId!==ownerId&&!capture&&!(beforeAttachment&&session.ownerId===lobby.id))throw Error('That Studio is no longer attached to this chat.');
  }
  async function validateTarget(name,args={},beforeAttachment=false){
    const definition=operations.get(name),creating=definition?.creation==='always'||definition?.creation==='action'&&args.action==='create';
    if(args.expectedStudio&&args.studioInstanceId&&args.expectedStudio.studioInstanceId!==args.studioInstanceId)
      throw Error('expectedStudio and studioInstanceId name different Studio instances.');
    if(args.bundleId&&name!=='capture_bundle')await requireOwnRuntime(args.bundleId);
    // Named saved-value queries do not inherit an old window association. Review
    // explicitly rebinds a print; explicit targets and request IDs remain guarded.
    if(name!=='request_review'&&definition?.tracked&&!definition.readOnly&&args.bundleId&&!args.expectedStudio&&!args.studioInstanceId){
      const records=await agentRequests.query({printId:args.bundleId});
      const previous=records.findLast(record=>record.ownerId===ownerId&&record.selectionVersion&&record.studioInstanceId);
      const remembered=rememberedTargets.get(args.bundleId)??(previous?{studioInstanceId:previous.studioInstanceId,selectionVersion:previous.selectionVersion}:null);
      if(remembered)assertStudioTarget(remembered.studioInstanceId,args.bundleId,{beforeAttachment,selectionVersion:remembered.selectionVersion});
    }
    if(args.expectedStudio)assertStudioTarget(args.expectedStudio.studioInstanceId,args.expectedStudio.bundleId,{beforeAttachment,capture:name==='capture_bundle',selectionVersion:args.expectedStudio.selectionVersion});
    if(args.expectedStudio&&args.bundleId&&(definition?.tracked||name==='capture_bundle')&&!creating&&name!=='request_review'&&args.bundleId!==args.expectedStudio.bundleId)
      assertStudioTarget(args.expectedStudio.studioInstanceId,args.bundleId,{beforeAttachment,selectionVersion:args.expectedStudio.selectionVersion,capture:name==='capture_bundle'});
    if(args.studioInstanceId){
      const current=allStudios.get(args.studioInstanceId)?.server.agentSession();
      assertStudioTarget(args.studioInstanceId,!creating&&args.bundleId&&name!=='request_review'?args.bundleId:current?.printId,{beforeAttachment,capture:name==='capture_bundle'});
    }
    const ids=[...new Set([...(args.requestIds??[]),...(args.requestId?[args.requestId]:[])])];
    for(const id of ids){
      const request=await agentRequests.get(id);
      if(request.inspectionSuperseded&&(name!=='respond_to_studio_request'||args.status==='working'))throw Object.assign(Error('The original Studio selection was retired. Read the current Studio target before editing.'),{code:'STUDIO_TARGET_CHANGED',currentStudio:request.studioInstanceId?allStudios.get(request.studioInstanceId)?.server.agentSession()??null:null});
      const owner=requestOwner(request);
      const retiredHandback=name==='respond_to_studio_request'&&args.status!=='working'&&request.inspectionSuperseded&&request.ownerId===ownerId;
      if(owner&&owner!==ownerId&&!retiredHandback&&!(beforeAttachment&&owner===lobby.id))throw Error('That Studio request belongs to another agent.');
      if(args.bundleId&&request.printId!==args.bundleId)throw Error('That request belongs to another print.');
      if(args.studioInstanceId&&request.studioInstanceId&&request.studioInstanceId!==args.studioInstanceId)throw Error('That request belongs to another Studio instance.');
      if(args.expectedStudio&&request.studioInstanceId&&request.studioInstanceId!==args.expectedStudio.studioInstanceId)throw Error('That request belongs to another Studio instance.');
      // Hand-back settles the original work, even after the person opens another bundle.
      if(request.studioInstanceId&&(name!=='respond_to_studio_request'||args.status==='working'))assertStudioTarget(request.studioInstanceId,request.printId,{beforeAttachment,selectionVersion:request.selectionVersion});
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

  async function visibleBundle(bundleId,{studioInstanceId,requestIds,expectedStudio}={}){
    const dir=await directory(bundleId,{create:true,exclusive:false});
    const saved=await access(resolve(dir,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    const retained=[...studioSessions.values()].find(session=>session.server.creationTarget()===dir);
    if(retained&&(expectedStudio?.studioInstanceId??studioInstanceId)&&(expectedStudio?.studioInstanceId??studioInstanceId)!==retained.server.agentSession().instanceId)throw Error('This bundle is being created in another Studio instance.');
    const existing=saved?await associatedStudio(bundleId,studioInstanceId,requestIds):null;
    if(retained){const view={dir,server:retained.server,url:retained.url,pending:true,opening:null,stopWatching:null,browserOpenRequested:false};view.stopWatching=watchStudioChanges(libraryRoot,()=>{void revealSavedBundle(view,true).catch(()=>{});});return view;}
    if(existing){const session=allStudios.get(existing.server.agentSession().instanceId);return {...existing,url:session.url,pending:false,browserOpenRequested:false};}
    const studio=await viewStudio(saved?dir:null,{expectedStudio,studioInstanceId});
    const browserOpenRequested=await show(studio);
    const view={dir,server:studio.server,url:studio.url,pending:!saved,browserOpenRequested,opening:null,stopWatching:null};
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
  // The client reports the agent is with the person (`reason`): each active episode
  // hands back as the agent's own waiting hand-back would.
  async function endTurn(reason,contact){
    const message=counterMessages[reason];if(!message)throw Error('Unknown turn end reason '+reason+'.');
    // Include calls still validating or queued: their episode may not exist yet.
    // Calls accepted after this contact remain autonomous work of their own.
    for(const call of activity.pendingWork)if(contactIncludes(contact,call.nativeContext))call.handback={status:'waiting',message};
    const episodes=new Set((await agentRequests.query()).filter(r=>r.ownerId===ownerId&&r.workActive&&contactIncludes(contact,r.nativeContext)).map(r=>r.episodeId??r.id));
    await Promise.all([...episodes].map(id=>agentRequests.handBack(id,{status:'waiting',message})));
    return {handedBack:episodes.size};
  }
  // Runs one operation to its result and throws its failure; the transport
  // decides how either reaches the agent.
  // `session` carries per-session limits, such as how long this client may listen.
  function invoke(name,args={},session,onActivity,completion){
    const definition=operations.get(name);
    if(!definition)return Promise.reject(Error(`Unknown SAAM operation ${name}.`));
    const {parsed,ignored}=parseArguments(definition.schema,args);
    const execute=async(handbackTicket)=>{
      if(app.closing)throw Error('The SAAM application is quitting.');
      const started=operationObservers.size?Date.now():null;
      try{
        if(!parsed.success)throw ignored.length?Object.assign(Error(parsed.error.message+' Ignored arguments: '+ignored.join('; ')+'.',{cause:parsed.error}),{ignoredArguments:ignored}):parsed.error;
        if(!handbackTicket)await validateTarget(name,parsed.data);
        const {requestIds,expectedStudio,...input}=parsed.data;
        if(name==='claim_studio_requests')input.requestIds=requestIds;
        if(definition.schema.shape.expectedEditRevision&&input.action!=='create'&&!input.expectedEditRevision&&!input.expectedRevision)
          throw Error('Supply expectedEditRevision from the current recipe, or a strict legacy expectedRevision.');
        if(input.bundleId&&!definition.readOnly&&name!=='capture_bundle'){
          const existing=[...allStudios.values()].find(session=>session.server.currentPrint()===resolve(libraryRoot,input.bundleId));
          if(existing&&transferringStudios.has(existing.server.agentSession().instanceId))throw Error('This Studio is transferring to another chat. Retry after the capture finishes.');
          if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before editing.');
        }
        const remembered=expectedStudio??session?.workCall?.target;
        const view=input.bundleId&&!definition.readOnly&&!definition.immediate&&!['capture_bundle','request_review'].includes(name)?await visibleBundle(input.bundleId,{studioInstanceId:input.studioInstanceId,requestIds,expectedStudio:remembered}):null;
        const associated=definition.instanceScope&&input.action!=='create'&&!view?.pending?view??await associatedStudio(input.bundleId,input.studioInstanceId,requestIds):null;
        if(remembered)assertStudioTarget(remembered.studioInstanceId,remembered.bundleId,{selectionVersion:remembered.selectionVersion,capture:name==='capture_bundle'});
        const selectionVersion=view?.server.agentSession().selectionVersion??associated?.server.agentSession().selectionVersion;
        const creating=Boolean(view?.pending&&definition.resultChanging);
        if(session?.workCall&&view)session.workCall.studioInstanceId=view.server.agentSession().instanceId;
        const touch=async()=>{for(const id of requestIds??[])await agentRequests.activity(id,{directory:await directory(input.bundleId)});};
        if(input.studioInstanceId&&!studioSessions.has(input.studioInstanceId))throw Error('That Studio is no longer attached to this chat.');
        const callId=randomUUID();
        let episode=null,workError;
        if(definition.resultChanging){
          const dir=await directory(input.bundleId,{create:true,exclusive:false});
          const matches=[...studioSessions.values()].filter(s=>s.server.currentPrint()===dir);
          episode=await agentRequests.beginOperation({directory:dir,requestIds,studioInstanceId:input.studioInstanceId??view?.server.agentSession().instanceId??(matches.length===1?matches[0].server.agentSession().instanceId:undefined),nativeContext:session?.workCall?.nativeContext,selectionVersion:view?.server.agentSession().selectionVersion,instruction:'Working on '+name+'.'});
          if(session?.workCall?.handback)void agentRequests.handBack(episode.records[0].episodeId??episode.records[0].id,session.workCall.handback)
            .catch(error=>studioEvents.record('handback-failed',{requestId:episode.records[0].id,message:error.message}));
        }
        // The bundle's work evidence before this operation: the episode's last save, else its baseline.
        const before=episode?episode.saved??episode.records[0]?.baseline??null:null,workRecords=episode?.records??[];
        const setCallActive=active=>{
          if(!definition.readOnly&&name!=='capture_bundle'){
            if(active)activeOperations.set(callId,{ownerId,name,bundleId:input.bundleId??null,studioInstanceId:input.studioInstanceId??null});
            else activeOperations.delete(callId);
          }
          onActivity?.(active);
        };
        setCallActive(true);
        const call={result:null,saved:episode?.saved??null,bookkeepingError:null};
        async function performAndCapture(fields,instance){
          try{return await withObservationFlow({directory:resolve(paths.state??stateRoot,'contract-observations'),retentionOwner,operation:name,bundleId:fields.bundleId,invocationId:callId,caller:{chatId:ownerId,client}},async function performObserved(){
            return perform(name,fields,{...session,invocationId:callId,expectedStudio:remembered,handbackTicket},instance,view?.server??associated?.server,setCallActive,completion);
          });}
          finally{try{await revealSavedBundle(view,creationViews.has(view?.dir));view?.stopWatching?.();if(episode)call.saved=await workEvidence(resolve(libraryRoot,input.bundleId));}
            catch(error){call.bookkeepingError=error;}}
        }
      try{
        if(definition.tracked&&!definition.readOnly)await touch();
        if(view?.pending&&definition.resultChanging){
          creationViews.add(view.dir);
          try{call.result=await view.server.runBundleCreation(view.dir,instance=>performAndCapture(input,instance),{selectionVersion});}
          finally{creationViews.delete(view.dir);view.stopWatching?.();}
        }else if(definition.instanceScope&&input.action!=='create'){
          const {studioInstanceId,...fields}=input;
          const studio=associated;
          call.result=studio?await studio.server.runBundleEdit(studio.dir,instance=>performAndCapture(fields,instance),{selectionVersion}):await performAndCapture(fields);
        }else call.result=await performAndCapture(input);
      }catch(error){workError=error;throw error;}
      finally{
        const originalError=workError;
        const saved=call.saved;let bookkeepingError=call.bookkeepingError;
        try{
          if(bookkeepingError)throw bookkeepingError;
          if(episode)await agentRequests.saved(episode,saved,{selectionVersion:creating&&view?.server.currentPrint()===view?.dir?view?.server.agentSession().selectionVersion:undefined});
          if(definition.tracked&&!definition.readOnly)await touch();
        }catch(error){bookkeepingError=error;workError??=error;}
        finally{
          if(workError&&workRecords.length)workError.workRequest={id:workRecords[0].episodeId??workRecords[0].id,
            ...(bookkeepingError?{bookkeepingError:bookkeepingError.message}:{}),
            reminder:'This operation failed; the work episode remains active for repair. Hand back once with respond_to_studio_request when the sequence stops.'};
          try{
            if(!workError&&episode&&call.result&&typeof call.result==='object'&&!Array.isArray(call.result)){
              const visualStudio=view?.server??associated?.server;
              const visualCheck=await resultImages.capture(visualStudio,input.bundleId,before,call.saved,definition.resultStage,ownerId,{waitForViewer:view?.browserOpenRequested});
              if(visualCheck)call.result={...call.result,visualCheck};
            }
          }finally{
            try{
              if(episode){
                agentRequests.settle(episode,{error:workError});
                if(view&&(view.server.currentPrint()!==view.dir||!creating&&selectionVersion!==view.server.agentSession().selectionVersion))
                  await agentRequests.retire({directory:view.dir,studioInstanceId:view.server.agentSession().instanceId});
              }
            }finally{activeOperations.delete(callId);}
          }
        }
        if(bookkeepingError&&!originalError)throw bookkeepingError;
      }
        if(workRecords.length&&call.result&&typeof call.result==='object')call.result={...call.result,workRequest:{id:workRecords[0].episodeId??workRecords[0].id,requestIds:workRecords.map(r=>r.id),reminder:'Keep working across intermediate saves. When intent is achieved, a decision is needed, or a new user message interrupts you, call respond_to_studio_request once with this id and completed or waiting status.'}};
        if(ignored.length&&call.result&&typeof call.result==='object'&&!Array.isArray(call.result))call.result={...call.result,ignoredArguments:ignored};
        if(view&&call.result&&typeof call.result==='object'&&!Array.isArray(call.result)){
          const current=view.server.agentSession(),studio={studioInstanceId:current.instanceId,bundleId:current.printId,selectionVersion:current.selectionVersion,url:view.url,browserOpenRequested:view.browserOpenRequested};
          rememberedTargets.set(input.bundleId,studio);call.result={...call.result,studio};
        }
        if(['request_review','capture_bundle'].includes(name)&&call.result?.studioInstanceId){
          const current=allStudios.get(call.result.studioInstanceId)?.server.agentSession();
          if(current){call.result={...call.result,selectionVersion:current.selectionVersion};rememberedTargets.set(current.printId,{studioInstanceId:current.instanceId,selectionVersion:current.selectionVersion});}
        }
        const result=call.result;
        if(started!==null)reportOperation({kind:'operation',name,status:'completed',durationMs:Date.now()-started,readOnly:definition.readOnly,
          parameters:diagnosticFields(input,['bundleId','kind','machineId','units','action','expectedRevision','skillId','extensionId','workspaceInstanceId']),
          result:diagnosticFields(result,['revision','geometryId','editRevision','outputId','programChecked','imported','status','workspaceInstanceId','jobId'])});
        if(result&&typeof result==='object'&&!Array.isArray(result)&&!['get_studio_events','wait_for_studio_request'].includes(name)){
          if(!definition.immediate){const pending=await agentRequests.inspect({status:'queued'});if(pending.length)call.result={...call.result,studioRequests:pending.map(agentRequest)};}
          // Delivered events push at once; every tool result also carries whatever is still queued.
          const {events,cursor}=studioEvents.pending();if(events.length)call.result={...call.result,studioEvents:events.map(agentEvent),studioEventCursor:cursor};
        }
        return structuredClone(call.result);
      }catch(error){if(started!==null)reportOperation({kind:'operation',name,status:'failed',durationMs:Date.now()-started,
        parameters:diagnosticFields(args,['bundleId','kind','machineId','units','action','expectedRevision','skillId','extensionId','workspaceInstanceId']),error:error.message});throw error;}
    };
    if(name==='respond_to_studio_request'&&parsed.success){
      const prepared=attachments.tail.then(async()=>{
        if(app.closing)throw Error('The SAAM application is quitting.');
        await validateTarget(name,parsed.data);
        const {requestId,expectedStudio,...response}=parsed.data;
        return agentRequests.prepareHandBack(requestId,response);
      });
      attachments.tail=prepared.then(()=>undefined,()=>undefined);
      return prepared.then(ticket=>execute(ticket));
    }
    if(name==='begin_studio_work'){
      const run=attachments.tail.then(()=>execute());attachments.tail=run.catch(()=>{});return run;
    }
    if(!parsed.success||definition.immediate)return execute();
    // Commands for one bundle remain ordered; unrelated chats and bundles do
    // not wait for its worker. Operations without a bundle keep one own queue.
    const target=parsed.data.bundleId?resolve(libraryRoot,parsed.data.bundleId):parsed.data.workspaceInstanceId?'workspace:'+parsed.data.workspaceInstanceId:libraryRoot;
    const key=process.platform==='win32'?target.toLowerCase():target;
    const tail=work.tails.get(key)??Promise.resolve(),run=tail.then(()=>execute());
    const settled=run.then(()=>undefined,()=>undefined);
    work.tails.set(key,settled);work.pending.add(settled);
    void settled.then(()=>{work.pending.delete(settled);if(work.tails.get(key)===settled)work.tails.delete(key);});
    return run;
  }

  const machineIdSchema=z.string().optional().describe('Reusable printer profile for discovery before selecting a bundle. Use bundleId for saved capabilities.');
  async function readContextOperation(operation,input){
    const selection=await prepareContextRead({operation,root,paths,localExtension,input,setupProblem:application.setupProblem,runtime:application.runtime});
    if(selection.kind==='local')return selection.result;
    // The caller uses its existing Bundle/Settings query permissions. Context
    // receives captured values only, with no resolver or retained lookup handle.
    const saved=input.bundleId?installedMachine((await read(input.bundleId,{program:false})).state.machineId,roots)??undefined:undefined;
    const prepared=await loadContextRead(root,selection);
    const capturedSettings=input.bundleId?saved:input.machineId?loadMachine(input.machineId,roots):undefined;
    return assembleContextRead({root,prepared,capturedSettings});
  }
  operation('read_local_agent_notes','Read shared Markdown notes and their home/path/revision identity for every SAAM role.',{});
  operation('read_contract_source','Read complete source shipped with the selected SAAM version. Reads are contained and exclude private/local/runtime data; no write or execution authority.',{file:z.string().min(1)});
  operation('read_contract_observations','Read retained typed wire observations. Supply id for the exact occurrence, otherwise filter metadata by wireIds/flowId. Complete replies for declared Slice numerical schemas carry versioned exact JSON text; generic and legacy values stay parsed. Optional representation selects complete (default), descriptor, or native manifest/hash/length, without inline native bytes. Missing or changed captures stay unavailable. Observation availability does not establish domain completion.',{wireIds:z.array(z.string()).optional(),flowId:z.string().optional(),id:z.string().optional(),representation:z.enum(['complete','descriptor','native']).optional()});
  operation('update_local_agent_notes','Save the current shared Markdown notes for the explicit home at expectedRevision (null only when absent). On conflict, read again and combine changes.',{home:z.string().min(1),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).nullable(),text:z.string()},false);
  operation('maker_onboarding','Start here for maker work when context is missing. Returns maker guidance, the skill index and print tools, including local script sections. Reuse it for the conversation.',{machineId:machineIdSchema,bundleId:bundleIdSchema.optional()});
  operation('builder_onboarding','Start installed local extension authoring through desktop chat. Returns published manuals/examples, selected extension discovery, local extension folder and publication identity. Core changes require a source checkout and identified development runtime.',{});
  operation('repair_client_setup','Refresh SAAM command discovery and permissions in Codex and Claude Code. Preserves unrelated settings and reports registration errors.',{},false);
  async function repairClientSetup(){if(!application.retryClients)throw Error('Client setup is available through the SAAM application.');return application.retryClients();}
  operation('report_bug','Before reporting, read application#bug-reports with read_guidance. Explain one understood expectation gap compactly, or substantively narrow a difficult problem through specific checks. Send through the alpha service; require relay acknowledgement and tell the person what was sent. If unactivated, describe it in chat.',
    {description:z.string().trim().max(1000).optional().describe('Follow application#bug-reports: concise Problem, Cause/investigation and Evidence. Make the expected/actual gap easy to judge. Keep a small established bug separate from a broader unfinished investigation; unresolved reports need specific findings and areas ruled out. Maximum 1000 characters, not a target.'),
      printId:bundleIdSchema.optional().describe('bundleId of the print concerned, when there is one.')},false,true);
  // One route with Studio's Report a bug: the release service sends it and waits for the relay.
  async function reportBug({description,printId}){
    if(!relay)throw Error('Bug reports travel through the SAAM application.');
    return relay.report({description,context:{reporter:'agent',client,printId:printId??null,runtimeId:application.runtime?.id??null,runtimeLabel:application.runtime?.label??null}});
  }
  operation('list_machines','List installed machine profiles, the machine extension providing each (its contract: read_skill with that id) and declared outputs; skipped names unreadable extensions and profiles. Catalog presence is not proof that a particular recipe is supported.',{});
  // A machine extension or profile that cannot be read is named in skipped; the others list.
  operation('list_skills','List core skills, guidance and skill/workspace extension manuals; skipped names unreadable extensions. Catalog membership does not establish recipe compatibility.',{});
  operation('list_workspaces','Discover selected workspace extensions and their manuals. Workspace designs create new print bundles for ordinary Studio review.',{});
  operation('open_workspace','Open a workspace extension in this application. Reuses its live instance; its saved design and created bundles stay in the configured print library.',{extensionId:idSchema},false);
  const workspaceIdSchema=z.string().min(1).describe('workspaceInstanceId returned by open_workspace.');
  operation('get_workspace','Read the current saved workspace design and bundle-creation job. Preview is a separate operation.',{workspaceInstanceId:workspaceIdSchema});
  operation('preview_workspace','Preview the supplied design, or current saved design, without saving or constructing bundles.',{workspaceInstanceId:workspaceIdSchema,design:objectSchema.optional(),interactive:z.boolean().optional()});
  operation('close_workspace','Close one owned workspace instance and its background worker, releasing the saved design for reopening. Other workspace and Studio instances remain available.',{workspaceInstanceId:workspaceIdSchema},false);
  operation('update_workspace','Save a complete workspace design atomically and return its normalized state. Construction is reviewed in Studio.',{workspaceInstanceId:workspaceIdSchema,design:objectSchema},false);
  operation('create_workspace_bundles','Replace the current exported set from the supplied or saved design; complete the new set first and retain independently edited parts. Read get_workspace for progress; review each resulting bundle in Studio.',{workspaceInstanceId:workspaceIdSchema,design:objectSchema.optional()},false);
  operation('read_skill','Read a skill or guidance manual by ID, or one section as ID#heading whatever its gate. Sections gated to machine capabilities or read on request are listed in omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Links are repository paths for read_guidance.',{ skillId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}(#[^\s#]{1,200})?$/), machineId: machineIdSchema, bundleId:bundleIdSchema.optional() });
  operation('read_guidance','Read published repository Markdown, or a skill example recipe (create_bundle input), by relative path, optionally with #heading for one section whatever its gate. Results list the headings with their gates and the gated sections omitted; bundleId uses the saved printer snapshot; machineId selects a reusable profile before bundle selection. Short IDs: makers, geometry, development, glossary, application, print-tools. This reader does not expose private files, source code or register capabilities.',{ guidanceId: z.string().min(1), machineId: machineIdSchema,bundleId:bundleIdSchema.optional() });
  operation('get_recipe_defaults','Get process, setup and common assignment defaults, including remembered setup; without machineId, generic defaults. Supply geometry or standalone Trace/Inject assignments before create_bundle. Defaults never confer job approval.',{ kind: kindSchema, machineId: z.string().optional() });
  operation('list_bundles','Discover saved print names, machines and modification times. Export status is unchecked; use get_bundle or check_bundle for validated status.',{});
  operation('get_bundle','Read fresh validated status and recipe settings. Geometry is omitted by default and planComplete is false; set includeGeometry to obtain the complete editable recipe. SAAMpath and program arrays are always omitted.',{ bundleId: bundleIdSchema, includeGeometry: z.boolean().optional() });
  operation('get_bundle_command_result','Read an exact retained Bundle command report by commandResult.id. Returns its captured summary/edit/findings, even if the part later changes or creation failed. Does not read current part state, consume the report or acknowledge work.',{bundleId:bundleIdSchema,id:z.string().regex(/^[a-f0-9]{64}$/)});
operation('create_bundle','Create and show a bundle with authored/imported geometry or standalone Trace/Inject assignments; an unfinished recipe is saved as it is. Missing fields take current defaults (generic without machineId; a machine can be selected later) and unread fields are ignored, both named in limitations. Generate the toolpath when construction feedback is needed. Then request_review.',{ bundleId: bundleIdSchema, kind: kindSchema, machineId: z.string().optional(), plan: objectSchema },false,false,'geometry','always');
  // Compatibility delivery: command outcome, then explicit captured value/manual queries.
  async function createBundle(input,studio){
    const created=await bundleEdits.createBundle(input,studio);
    const {state}=await bundleViews.readBundle(input.bundleId,{program:true,kind:created.kind});
    return withMachineHint(input.bundleId,state,input.machineId);
  }
  operation('migrate_bundle','Tidy a bundle: save its recipe as SAAM reads it (defaults filled, unread fields removed, legacy assignment forms rewritten), clearing its field notes. Generation never requires it; regenerate afterwards. Shows the bundle in Studio.',{bundleId:bundleIdSchema},false);
  operation('get_bundle_instance','Maintenance: read the Studio reservation holding a bundle (instance, owner, process, start time), or null. Use when a bundle reports it is open in another Studio instance.',{bundleId:bundleIdSchema});
  operation('recover_bundle_instance','Maintenance: release a Studio reservation whose process has exited, after a crash. A running instance keeps its bundle.',{bundleId:bundleIdSchema},false);
  operation('repair_stl','Maintenance: normalize source vertices below print resolution and repair a local STL into a new absolute outputDirectory (original.stl, repaired.stl in mm, repair.json). Optional vertex tolerance adds a larger merge; hole limits use boundary edge count and bounding-box diagonal in mm. Ordinary imports repair recognized defects and fill holes within 500 edges and 2 mm. Import repaired.stl with units mm for review. get_studio_events reports its jobId and progress; cancel_studio_calculation cancels it.',{sourcePath:z.string().min(1),outputDirectory:z.string().min(1),units:z.enum(['mm','inch']),mergeToleranceMm:z.number().min(0).optional(),maxHoleEdges:z.number().int().min(0).optional(),maxHoleDiameterMm:z.number().min(0).optional(),maxSampledDistanceMm:z.number().min(0).optional()},false);
  operation('extension_library','Builder exchange for the local extension library. checkout copies a bundled extensionId to an editable user copy that survives updates; export writes extensionId to a new absolute packageFile; import validates packageFile without executing it and never replaces a changed copy.',{action:z.enum(['checkout','export','import']),extensionId:z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),packageFile:z.string().optional()},false);
  operation('share_bundle','Package current editable bundle inputs and selected extensions into a new portable ZIP. Toolpaths, programs and history are excluded; recipient imports, edits and regenerates. Existing package files are never overwritten.',{bundleId:bundleIdSchema,packageFile:z.string()},false,true,null,'none','artifact');
  operation('import_bundle','Import a portable editable ZIP into a new bundle. Validates inputs and selected extensions without executing imported scripts. Never overwrites an existing bundle or changed local extension. Open/request_review using the returned bundleId; regenerate before export.',{bundleId:bundleIdSchema,packageFile:z.string()},false,true,'geometry','always');
  operation('import_stl_bundle','Import a local STL into a new named bundle. Default units auto chooses a reasonable mm/inch assumption from model size and printer bounds, without interrupting the person; honor explicit units when supplied. Preserves source bytes and hash and reuses remembered setup. Show geometry dimensions; units can be corrected with set_stl_units.',{ bundleId: bundleIdSchema, sourcePath: z.string().min(1), units: z.enum(['auto','mm', 'inch']).default('auto'), machineId: z.string() },false,false,'geometry','always');
  operation('search_thingi10k','Find meshes by descriptive keywords (such as bunny), numeric file ID or a Thingiverse thing URL. Reads the Thingi10K mirror index; returns per-file source and license links. Prefer making tailored geometry when attractive. Read the thingi10k skill manual.',{query:z.string().min(1),limit:z.number().int().min(1).default(10),offset:z.number().int().min(0).default(0)},true,true);
  async function searchThingi10k(args){return meshLibrary.search(args);}
  operation('import_thingi10k_bundle','Download a selected Thingi10K STL file ID on the SAAM host and import it as a print. ALWAYS give its license link in chat and briefly identify the source unless obvious. Recognized defects receive automatic repair; returns attribution even if import fails, with the failed download kept as diagnostics evidence. Review geometry with request_review after successful import.',{bundleId:bundleIdSchema,fileId:z.string().regex(/^[1-9][0-9]{0,11}$/),machineId:z.string(),units:z.enum(['auto','mm','inch']).default('auto')},false,true,'geometry','always');
  localExtension.registerOperations?.({tool,z,bundleIdSchema,objectSchema,idSchema,read,noApprovalFields});
  operation('set_stl_units','Correct an imported mesh to mm or inch units, rescaling its current geometry and preserving the original STL bytes and printing settings. Invalidates geometry/toolpath confirmations; show the corrected size for geometry review.',{bundleId:bundleIdSchema,units:z.enum(['mm','inch']),...editIdentitySchema},false,false,'geometry');
  operation('blob_field','Create or rebuild a blob-field part: freely placed points, each with positionMm, reachMm and strength, whose smooth falloffs add up; material is where the sum exceeds the threshold (default 0.25, where a lone strength-1 point is a ball of radius reach/2), cut flat at Z = 0. Negative strength carves. Request {points, threshold?, edgeMm?}; GEOMETRY.md#blob-field describes it. Extracted to a mesh for shared slicing and Studio review.',{bundleId:bundleIdSchema,action:z.enum(['create','update']),request:objectSchema,machineId:z.string().optional(),...editIdentitySchema,part:idSchema.optional()},false,false,'geometry','action');
  operation('apply_extension','Apply an installed extension to the current recipe, or with machineId create a new print from it (never overwriting one). Read its manual for request fields. Geometry and deposition assignments commit together; assignments replaces plan.slices in the same revision when an edit removes material they select; return the saved revision and construction report.',{bundleId:bundleIdSchema,extensionId:z.string().regex(/^[a-z][a-z0-9-]*$/),machineId:z.string().optional(),...editIdentitySchema,request:objectSchema,part:idSchema.optional(),assignments:z.array(objectSchema).optional()},false,false,'geometry');
  operation('intersect_geometry','Query saved or draft geometry before placement: horizontal sections, vertical top crossings, spline surface cuts, or draft slice stacks. Stacks report layer counts, ownership, full-crossing findings and sampled local thickness; no recipe is saved. includeLoops adds chart/world points.',{bundleId:bundleIdSchema.optional(),request:z.object({geometry:geometrySchema.optional(),part:z.string().optional(),sectionsAtZ:z.array(z.number()).optional(),topsAtXY:z.array(z.tuple([z.number(),z.number()])).optional(),surfaces:z.array(patchSchema.omit({name:true}).extend({offsetMm:z.tuple([z.number(),z.number(),z.number()]).optional()})).optional(),edges:z.array(z.object({geometry:z.string().min(1).optional(),model:z.object({path:z.array(z.number().int().nonnegative()).optional(),vertices:z.array(z.number().int().nonnegative()).optional(),closed:z.boolean().optional(),face:z.string().optional(),loop:z.number().int().nonnegative().optional(),edge:z.number().int().nonnegative().optional()}).strict().optional(),range:z.tuple([z.number(),z.number()]).optional(),part:z.string().nullable().optional(),normal:z.tuple([z.number(),z.number(),z.number()]).optional(),slice:z.object({assignment:z.string().min(1),part:z.string().nullable().optional(),index:z.number().int().nonnegative().optional()}).strict().optional(),loop:z.number().int().nonnegative().optional()}).passthrough()).describe('Choose model edges, saved XYZ curves or prepared Slice boundaries; range trims an edge. Model edges report every crossed Slice target. No deposition is generated. includeLoops returns curve geometry.').optional(),stacks:z.array(draftStackSchema).describe('Ordinary assignment patches; default first/pitch 0.2mm and width0.4mm, override stack/process explicitly. Geometry belongs to outer request; part null inside drafts.').optional(),includeLoops:z.boolean().optional()}).strict()});
  operation('combine_geometry','Combine a print’s geometry (or one part) with a new operand: request {operation: union|difference|intersection, operand, part?}. The result is a boolean solid; repeating an operation appends to it, and a difference subtracts every later operand. Operands are spline, mesh, blob-field or boolean geometry in the same coordinates. Spline operands stay native: each layer combines their exact sections. Use request_review afterward. GEOMETRY.md#booleans.',{bundleId:bundleIdSchema,...editIdentitySchema,request:objectSchema},false,false,'geometry');
  operation('slice','Add, edit or remove one general deposition assignment in plan.slices. Shared recipe validation; add fills defaults, edit merges objects and replaces arrays. before controls ownership order. Generation reports deposition findings. No export or confirmation is created. Returns a completed outcome and commandResult; read get_bundle_command_result for the exact associated saved settings/findings.',{bundleId:bundleIdSchema,...editIdentitySchema,action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),assignment:slicePatchSchema.optional(),before:z.string().nullable().describe('Existing assignment id to insert before; null appends; omitted retains edit position or appends an add.').optional()},false);
  operation('modulate','Add, edit or remove a field modifier in plan.modulations. Select world/slice/curve frame, assignment/role and layer scope. Runs before final support publication; changes invalidate dependent output and confirmation. Add requires channel, amplitude, field and direction for displacement/tilt; edit patches saved settings. Read slice#contact-poses-and-extensions. Returns a completed outcome and commandResult; read get_bundle_command_result for the exact associated saved settings/findings.',{bundleId:bundleIdSchema,...editIdentitySchema,action:z.enum(['add','edit','remove']),id:z.string().regex(/^[a-z][a-z0-9-]*$/),modifier:modulationPatchSchema.optional()},false);
  operation('adjust_recipe','Apply a recipe patch at expectedEditRevision (or strict legacy expectedRevision). Unread fields are ignored and named in limitations. Edits invalidate final confirmation; read fresh state if stale. Returns a completed outcome and commandResult; read get_bundle_command_result for the exact associated saved settings/findings.',{ bundleId: bundleIdSchema, ...editIdentitySchema, patch: z.object({experimental:z.object({substrateAdaptation:z.literal(false,{error:'Deprecated experimental.substrateAdaptation.'}).describe('Deprecated; disabled legacy field only.').optional()}).strict().optional()}).passthrough() },false);
  operation('check_bundle','Validate saved native geometry, recipe and any exact generated export using the shared bundle checks. Does not generate.',{ bundleId: bundleIdSchema });
  operation('restore_revision','Undo or redo a saved print edit at its current revision. Restoring history invalidates affected confirmation; show the resulting print in Studio. Returns a completed outcome and commandResult; read get_bundle_command_result for the exact associated saved settings/findings.',{bundleId:bundleIdSchema,expectedRevision:z.string().min(1),direction:z.enum(['undo','redo'])},false);
  operation('record_extension_dependency','Record supplied named extension configuration in the existing recipe skills record. No defaults, installation lookup or execution. Later operations validate what they consume. Null removes the named record. Returns a completed outcome and commandResult; read get_bundle_command_result for the exact associated saved settings/findings.',{bundleId:bundleIdSchema,extensionId:idSchema,configuration:objectSchema.nullable(),...editIdentitySchema},false);
  operation('set_deferred_setup_save','Set (defer:true) or clear (false) this bundle\'s optional flag that skips remembering its exported setup; clearing removes the flag. Persists across sessions; edits and remembered defaults are unchanged. Returns a completed outcome and commandResult; read get_bundle_command_result for the exact associated saved settings/findings.',{bundleId:bundleIdSchema,expectedRevision:z.string().min(1),defer:z.boolean()},false);
  operation('set_phase_colours','Choose Studio colours for SAAMpath phases of this print ({phase:"#rrggbb"}); null clears. Overrides local preferences and defaults; display only; outputs are unchanged.',{bundleId:bundleIdSchema,expectedRevision:z.string().min(1),phaseColours:objectSchema.nullable()},false);
  operation('begin_studio_work','Optionally establish or claim work context before editing. Ordinary result-changing operations establish context automatically. Pass Studio requestIds on the operation; identify the Studio instance when ambiguous. Begin alone does not dim the view. Hand back once with respond_to_studio_request.',{bundleId:bundleIdSchema.optional(),studioInstanceId:z.string().optional(),instruction:z.string().min(1),requestId:z.string().optional(),kind:z.enum(['edit','guidance']).default('edit')},false);
  async function beginStudioWork({bundleId,studioInstanceId,instruction,requestId,kind}){
      const record=requestId?await agentRequests.get(requestId):null;
      if(!studioInstanceId&&record?.studioInstanceId)studioInstanceId=record.studioInstanceId;
      const session=studioInstanceId?studioSessions.get(studioInstanceId):null;
      if(studioInstanceId&&!session)throw Error('That Studio instance is not owned by this agent.');
      if(!bundleId&&record)bundleId=record.printId;
      if(!bundleId){
        let selected=session?.server.currentPrint();
        if(!session){
          const guide=await tourStatus(libraryRoot,binding,readTourSnapshot);
          selected=guide.active&&studioSessions.has(guide.studioOwner?.instanceId)?guide.directory:studioSessions.size===1?[...studioSessions.values()][0].server.currentPrint():null;
        }
        if(!selected)throw Error(session||studioSessions.size===1?'Create or open a print in that Studio before beginning work.':'Specify bundleId or studioInstanceId when no single active Studio instance is available.');
        bundleId=requestPrintId(libraryRoot,selected);
      }
      const dir=await directory(bundleId);
      if(!studioInstanceId){
        const matches=[...studioSessions.values()].filter(candidate=>candidate.server.currentPrint()===dir);
        if(matches.length>1)throw Error('Specify studioInstanceId because multiple owned Studio instances display this print.');
        if(matches.length===1)studioInstanceId=matches[0].server.agentSession().instanceId;
      }
      const editSession=studioInstanceId?studioSessions.get(studioInstanceId):null;
      if(editSession&&editSession.server.currentPrint()!==dir)throw Error('That Studio instance is displaying another print.');
      if(requestId){if(record?.printId!==bundleId)throw Error('That request belongs to another print.');if(record.studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');}
      const bundleState=await (await import('../print/bundle.mjs')).loadBundle(dir,{program:false});
      if(requestId)return {...agentRequest(await agentRequests.update(requestId,{status:'working'})),editRevision:bundleState.editRevision};
      return {...agentRequest(await agentRequests.begin({directory:dir,instruction,kind,studioInstanceId,bundleState})),editRevision:bundleState.editRevision};
    }
  operation('respond_to_studio_request','Hand back once when the requested intent is achieved, discussion or a decision is needed, or a new user message interrupts autonomous work. Use returned workRequest.id. completed finishes; waiting pauses. The operation already underway settles and its concrete saved revision is displayed before undimming. Omit resultStage to accept the displayed pane, including usable previous toolpath. Intermediate saves remain visible and working. Legacy working targets remain supported for tours.',{requestId:z.string(),status:z.enum(['working','waiting','completed','failed','cancelled']).default('completed'),resultStage:z.enum(['geometry','toolpath']).optional(),message:z.string().default('')},false);
  async function respondToStudioRequest({requestId,...response},session){return agentRequest(await session.handbackTicket.completion);}
  operation('claim_studio_requests','Claim identified queued Studio requests for work. Original request and Studio selection authority are validated before any claim. Hand back each returned workRequest when finished.',{requestIds:z.array(z.string()).min(1)},false);
  async function claimStudioRequests({requestIds}){
    const claim=attachments.tail.then(async()=>{
      if(app.closing)throw Error('The SAAM application is quitting.');
      const claimed=[];
      for(const requestId of requestIds)await validateTarget('claim_studio_requests',{requestId});
      for(const requestId of requestIds){
        if(app.closing)throw Error('The SAAM application is quitting.');
        claimed.push(await agentRequests.update(requestId,{status:'working'}));
      }
      return claimed;
    });attachments.tail=claim.catch(()=>{});
    return {status:'completed',requestIds:(await claim).map(request=>request.id)};
  }
  operation('wait_for_studio_request',"Monitor the person’s Studio requests while the agent is available at the interaction counter. Hand back autonomous work before waiting. Keep consecutive autonomous edits dimmed until completion, discussion or human interruption settles underway work and its saved view. Waiting, polling, silence and monitor expiry do not mark the agent busy, cancel work or close SAAM. Claude Code defaults to 30 minutes; Codex defaults to 25 seconds. Renew while part work or interactive tour participation continues, or let an idle monitor lapse. The command optionally claims requests but retains its observations. The calling adapter acknowledges exact event IDs only after its output succeeds; claims and acknowledgements are independently available.",{after:z.array(z.string()).optional(),waitMs:z.number().int().min(0).max(LISTEN_LIMIT_MS).optional(),claim:z.boolean().optional(),studioInstanceId:z.string().optional()},false);
  async function waitForStudioRequest(args,session,setCallActive,completion){
      if(app.closing)throw Error('The SAAM application is quitting.');
      // This owned call still drains on shutdown while its passive interval is
      // absent from busy accounting. Completion includes result delivery flush.
      monitorCalls.add(completion);void completion.then(()=>monitorCalls.delete(completion));
      if(args.studioInstanceId&&!studioSessions.has(args.studioInstanceId))throw Error('That Studio instance is not owned by this agent.');
      const {defaultMs,maxMs}=session.listen,waitMs=Math.min(maxMs,args.waitMs??defaultMs);
      const controller=new AbortController(),monitor={controller};
      passiveMonitors.add(monitor);
      let result;
      setCallActive(false);
      try{result=await agentRequests.wait({after:args.after,studioInstanceId:args.studioInstanceId,waitMs,signal:controller.signal});}
      finally{passiveMonitors.delete(monitor);setCallActive(true);}
      if(app.closing)throw Error('The SAAM application is quitting.');
      await validateTarget('wait_for_studio_request',{...args,...(session.expectedStudio?{expectedStudio:session.expectedStudio}:{})});
      const generation=generationStatus();
      const claimed=args.claim&&result.requests.length
        ?await claimStudioRequests({requestIds:result.requests.map(request=>request.id)})
        :null;
      const requests=claimed?await Promise.all(claimed.requestIds.map(async requestId=>agentRequest(await agentRequests.get(requestId)))):result.requests.map(agentRequest);
      if(app.closing)throw Error('The SAAM application is quitting.');
      const records={requests,events:result.events.map(agentEvent),cursor:result.cursor};
      return generation.length?{...records,generation}:records;
    }
  operation('get_studio_events','Read Studio observations without consuming them. afterSeq filters the current queue’s retained sequence; cursor is a read position, not delivery authority. Stable event IDs identify repeats and explicit acknowledgement. Events also arrive on tool results and waits. Set history to include acknowledged observations.',{history:z.boolean().default(false),afterSeq:z.number().int().min(0).optional()});
  async function getStudioEvents({history,afterSeq}){const {events,cursor}=afterSeq===undefined?studioEvents.pending():studioEvents.read({afterSeq}),jobFindings=ownedJobs.findings(ownerId);return {events:events.map(agentEvent),cursor,generation:generationStatus(),...(jobFindings?{jobFindings}:{}),...(history?{recent:studioEvents.history().map(agentEvent)}:{})};}
  operation('ack_studio_events','Acknowledge exactly the supplied Studio event IDs after delivery. Other observations remain pending; repeated IDs are harmless and acknowledged observations remain in bounded history. The retired throughSeq form is refused because sequence numbers can recur after Runtime replacement.',{eventIds:z.array(z.string().min(1)).optional(),throughSeq:z.number().int().min(0).optional()},false);
  function acknowledgeStudioEvents(input){
    if(input.throughSeq!==undefined)throw Error('Deprecated throughSeq; supply eventIds.');
    if(!Array.isArray(input.eventIds))throw Error('Supply eventIds to acknowledge delivered Studio events.');
    return studioEvents.acknowledgeIds(input.eventIds);
  }
  operation('get_studio_requests','Read outstanding work and the latest edit outcome per print. Set history for all resolved records; optionally restrict to one print.',{bundleId:bundleIdSchema.optional(),history:z.boolean().default(false)});
  async function getStudioRequests({bundleId,...options}){return {requests:(await agentRequests.inspect({...options,printId:bundleId})).map(agentRequest)};}
  operation('get_studio_sessions','List live Studio instances owned exclusively by this agent. One agent may own several instances; print bundles remain shareable across agents.',{});
  async function getStudioSessions(){return {sessions:[...studioSessions.values()].map(({server:studio,url,visibility})=>({...agentStudioSession(studio.agentSession()),url,visibility}))};}
  operation('cancel_studio_calculation','Cancel a live geometry, import/automatic repair or toolpath calculation. Supply studioInstanceId for Studio work, including toolpath generation; omit it for a tool geometry calculation or import. First read get_studio_events for its identity, elapsedMs and actual progress; pass the geometry/import jobId or the toolpath editRevision. Repairs have no reliable remaining-time estimate and continue unless cancelled. Explain your decision to the person. Cancellation interrupts work and cleans incomplete imports; it does not change the previously open print.',{studioInstanceId:z.string().optional(),jobId:z.string().optional(),editRevision:z.string().optional()},false);
  async function cancelStudioCalculation({studioInstanceId,...identity}){
      if(!studioInstanceId){
        return ownedJobs.cancel(identity.jobId,{ownerId});
      }
      const session=studioSessions.get(studioInstanceId);if(!session)throw Error('Choose a live Studio instance owned by this agent.');
      return session.server.cancelCalculation({...identity,reason:'agent'});
    }
  const studioCommands=createStudioAgentOperations({libraryRoot,binding,ownerId,
    lifecycle:{owned:studioSessions,all:allStudios,transferring:transferringStudios,acquire:viewStudio,show,
      reviewPath:options=>localExtension.reviewPath?.(options),capture:resultImages.capture},
    values:{readBundle:bundleViews.readBundle,readSnapshot:readTourSnapshot,summary:bundleViews.summary,selectInspection:inspectionValues.select},
    commands:{setPhaseColours:bundleEdits.setPhaseColours}});
  operation('start_tour','Start fresh tour copies in this application, attach this chat and return the first Studio screen plus participation guidance.',{startAtLayer:z.number().int().min(1).optional()},false);
  async function startTour(input){
    return {...await studioCommands.startTour(input),notes:await readLocalAgentNotes(paths),
      sources:await onboardingSources(root,{}),participation:await readManual(root,'examples/prints/README.md#maker-agent-participation',{})};
  }
  operation('get_tour','Read the active tour print, lesson gates and maker-agent instruction. After reaching the chat lesson, offer infill options in chat. After completion, immediately congratulate the participant, offer help with printing the prepared file, and ask what she wants to make next. Optional bounded wait follows user progress.',{after:z.string().optional(),waitMs:z.number().int().min(0).max(25000).optional()});
  operation('set_tour_start_at','Choose a deposited layer after the first for the identified tour lesson. Use the runId and lessonId from the guidance request scope or get_tour; discard work when that lesson has ended.',{startAt:z.object({layer:z.number().int().min(1)}).strict(),runId:z.string(),lessonId:z.string()},false);
  // The tour's own Studio records the choice.
  operation('change_machine','Change a print to a supported printer using its remembered or default setup. Invalidates final settings/toolpath confirmation and validates compatibility before saving.',{bundleId:bundleIdSchema,machineId:z.string(),...editIdentitySchema},false);
  operation('capture_bundle','Explicitly take over the bundle in its existing Studio. Fails while actual work runs; cancels the old chat unfinished requests, preserves the window and rejects its later writes.',{bundleId:bundleIdSchema},false);
  async function captureBundleOperation({bundleId},{expectedStudio}={}){return captureBundle(chats.get(ownerId),bundleId,expectedStudio);}
  operation('request_review',"Show the bundle in its owned Studio. Optional inspection:{observationId} atomically selects that part's exact retained occurrence until closed or explicitly replaced. Omit inspection to return to normal review. startAt is normal review only and cannot accompany inspection. No generation or Export approval.",{ bundleId: bundleIdSchema,studioInstanceId:z.string().optional(),startAt:z.object({layer:z.number().int().min(1)}).strict().optional(),inspection:z.object({observationId:z.string().regex(/^[a-f0-9-]{36}$/)}).strict().optional(),...localExtension.reviewSchema?.(z) },false);
  operation('close_studio_session','Close one Studio instance owned by this agent without affecting other instances or the shared print bundle.',{studioInstanceId:z.string()},false);
  operation('generate_toolpath','Generate and save neutral SAAMpath from the recipe, independently of a machine adapter. Includes the tour. The person reviews it in Studio; Export captures its path/settings and writes a transient machine program for download. Generation is not approval.',{ bundleId: bundleIdSchema },false,false,'toolpath');
  // Runs inside the displaying Studio's held edit (invoke); that Studio owns the job.
  async function generateToolpath({ bundleId },instance){
    const dir=await directory(bundleId);
    // The operation established the displaying Studio before running.
    const studio=instance?allStudios.get(instance.instanceId):[...studioSessions.values()].find(session=>session.server.currentPrint()===dir);
    const checks=await partCommands.generateToolpath({bundleId},studio.server.generationHost());
    const {state}=await bundleViews.readBundle(bundleId,{program:true});
    return {...summary(bundleId,state),checks};
  }
  // Runs the named operation's entry with validated input. Each case names the
  // function it calls, so every operation's effects and result stay its own.
  function perform(name,input,session,instance,calculationStudio,setCallActive,completion){
    const extension=extensionActions.get(name);
    if(extension)return extension(input,session,instance);
    switch(name){
      case 'read_local_agent_notes':return readLocalAgentNotes(paths);
      case 'read_contract_source':return readArchitectureSource({root,file:input.file});
      case 'read_contract_observations':return retainedQuery(name,input);
      case 'update_local_agent_notes':return updateLocalAgentNotes(paths,input);
      case 'maker_onboarding':return readContextOperation('maker_onboarding',input);
      case 'builder_onboarding':return builderOnboarding({root,paths,setupProblem:application.setupProblem,runtime:application.runtime});
      case 'repair_client_setup':return repairClientSetup();
      case 'report_bug':return reportBug(input);
      case 'list_machines':return settingsQueries.listMachines();
      case 'list_skills':return listSkills({root,paths,localExtension});
      case 'list_workspaces':return discoverWorkspaces({root,paths});
      case 'open_workspace':return workspaceCommands.openWorkspace(input).then(showWorkspace);
      case 'get_workspace':return workspaceCommands.getWorkspace(input,workspaceViewValues(input.workspaceInstanceId));
      case 'preview_workspace':return workspaceCommands.previewWorkspace(input);
      case 'close_workspace':return workspaceCommands.closeWorkspace(input);
      case 'update_workspace':return workspaceCommands.updateWorkspace(input);
      case 'create_workspace_bundles':return workspaceCommands.createWorkspaceBundles(input);
      case 'read_skill':return readContextOperation('read_skill',input);
      case 'read_guidance':return readContextOperation('read_guidance',input);
      case 'get_recipe_defaults':return settingsQueries.getRecipeDefaults(input,bundleViews.recipeDefaults());
      case 'list_bundles':return bundleViews.listBundles();
      case 'get_bundle':return bundleViews.getBundle(input);
      case 'get_bundle_command_result':return bundleViews.getBundleCommandResult(input);
      case 'create_bundle':return createBundle(input,calculationStudio);
      case 'migrate_bundle':return bundleEdits.migrateBundle(input,{invocationId:session.invocationId});
      case 'get_bundle_instance':return bundleViews.getBundleInstance(input);
      case 'recover_bundle_instance':return bundleEdits.recoverBundleInstance(input);
      case 'repair_stl':return sourceCommands.repairStl(input);
      case 'extension_library':return extensionCommands.extensionLibrary(input);
      case 'share_bundle':return portableCommands.shareBundle(input);
      case 'import_bundle':return portableCommands.importBundle(input,instance);
      case 'import_stl_bundle':return sourceCommands.importStlBundle(input);
      case 'search_thingi10k':return searchThingi10k(input);
      case 'import_thingi10k_bundle':return sourceCommands.importThingi10kBundle(input);
      case 'set_stl_units':return bundleEdits.setStlUnits(input,{invocationId:session.invocationId});
      case 'blob_field':return extensionCommands.blobField(input,calculationStudio);
      case 'apply_extension':return extensionCommands.applyExtension(input,calculationStudio);
      case 'intersect_geometry':return bundleViews.intersectGeometry(input);
      case 'combine_geometry':return bundleEdits.combineGeometry(input,{invocationId:session.invocationId});
      case 'slice':return bundleEdits.slice(input,{invocationId:session.invocationId});
      case 'modulate':return bundleEdits.modulate(input,{invocationId:session.invocationId});
      case 'adjust_recipe':return bundleEdits.adjustRecipe(input,{invocationId:session.invocationId});
      case 'check_bundle':return bundleViews.checkBundle(input);
      case 'restore_revision':return bundleEdits.restoreRevision(input,{invocationId:session.invocationId});
      case 'record_extension_dependency':return bundleEdits.recordExtensionDependency(input,{invocationId:session.invocationId});
      case 'set_deferred_setup_save':return bundleEdits.setDeferredSetupSave(input,{invocationId:session.invocationId});
      case 'set_phase_colours':return studioCommands.setPhaseColours(input);
      case 'begin_studio_work':return beginStudioWork({...input,studioInstanceId:input.studioInstanceId??session.expectedStudio?.studioInstanceId});
      case 'respond_to_studio_request':return respondToStudioRequest(input,session);
      case 'wait_for_studio_request':return waitForStudioRequest(input,session,setCallActive,completion);
      case 'claim_studio_requests':return claimStudioRequests(input);
      case 'get_studio_events':return getStudioEvents(input);
      case 'ack_studio_events':return acknowledgeStudioEvents(input);
      case 'get_studio_requests':return getStudioRequests(input);
      case 'get_studio_sessions':return getStudioSessions();
      case 'cancel_studio_calculation':return cancelStudioCalculation(input);
      case 'start_tour':return startTour(input);
      case 'get_tour':return studioCommands.getTour(input);
      case 'set_tour_start_at':return studioCommands.setTourStartAt(input);
      case 'change_machine':return bundleEdits.changeMachine(input).then(state=>withMachineHint(input.bundleId,state,input.machineId));
      case 'capture_bundle':return captureBundleOperation(input,session);
      case 'request_review':return studioCommands.requestReview(input,session);
      case 'close_studio_session':return studioCommands.closeStudioSession(input);
      case 'generate_toolpath':return generateToolpath(input,instance);
      default:throw new Error(`Operation ${name} has a definition but no entry in perform().`);
    }
    throw Error(`Unknown SAAM operation ${name}.`);
  }
  async function sessionInvoke(operation,args={},context={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    activity.calls++;
    const matched=(args.studioInstanceId?studioSessions.get(args.studioInstanceId):[...studioSessions.values()].find(session=>session.server.currentPrint()===resolve(libraryRoot,args.bundleId??'')))?.server.agentSession();
    const target=args.expectedStudio??(matched?{studioInstanceId:matched.instanceId,bundleId:matched.printId,selectionVersion:matched.selectionVersion}:null);
    const workCall=operations.get(operation)?.resultChanging?{handback:context.nativeContext?.closed?{status:'waiting',message:counterMessages.closed}:null,nativeContext:context.nativeContext??null,bundleId:args.bundleId,studioInstanceId:target?.studioInstanceId,target}:null;
    if(workCall)activity.pendingWork.add(workCall);
    const completion=Promise.withResolvers();
    try{return await invoke(operation,args,{listen:client==='claude'?CLAUDE_LISTEN:LOCAL_LISTEN,workCall},context.onActivity,completion.promise);}
    finally{try{activity.calls--;if(workCall)activity.pendingWork.delete(workCall);await studioEvents.flush();}
      finally{completion.resolve();}}
  }
  // dispatch:false: the caller shows the window itself (the person's own launch).
  async function openStudio({dispatch=true}={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    const session=[...studioSessions.values()].filter(({server})=>server.listening).at(-1)??await startStudio(null);
    const browserOpenRequested=dispatch?await show(session):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  async function showWorkspaceBundles(workspaceInstanceId,views,event){
    for(const part of event.bundles??[]){
      const bundleId=relative(libraryRoot,resolve(event.directory,part.path)).split(sep).join('/');
      if(views.records.has(bundleId))continue;
      const view=await visibleBundle(bundleId),episode=await agentRequests.beginOperation({directory:view.dir,studioInstanceId:view.server.agentSession().instanceId,instruction:'Created workspace part '+part.id+'. Review the draft and continue work before hand-back.'}),records=episode.records;
      try{await agentRequests.saved(episode,await workEvidence(view.dir));}finally{agentRequests.settle(episode);}
      const result={bundleId,studioInstanceId:view.server.agentSession().instanceId,url:view.url,browserOpenRequested:view.browserOpenRequested,workRequest:{id:records[0].episodeId??records[0].id,requestIds:records.map(record=>record.id)}};
      views.records.set(bundleId,result);
      studioEvents.record('workspace-bundle-visible',{workspaceInstanceId:workspaceInstanceId,jobId:event.jobId,...result});
    }
  }
  function queueWorkspaceViews(workspaceInstanceId,event){
    let views=legacyWorkspaceViews.get(workspaceInstanceId);
    if(!views){views={records:new Map(),tail:Promise.resolve(),error:null};legacyWorkspaceViews.set(workspaceInstanceId,views);}
    const run=views.tail.then(()=>showWorkspaceBundles(workspaceInstanceId,views,event));
    const settled=run.catch(error=>{views.error=error.message;studioEvents.record('workspace-bundle-view-failed',{workspaceInstanceId,jobId:event.jobId,error:error.message});});
    views.tail=settled;work.pending.add(settled);
    void settled.then(()=>work.pending.delete(settled));
  }
  async function showWorkspace(result){
    if(!legacyWorkspaceViews.has(result.workspaceInstanceId))legacyWorkspaceViews.set(result.workspaceInstanceId,{records:new Map(),tail:Promise.resolve(),error:null});
    const browserOpenRequested=autoOpen&&presentation.visibility!=='hidden'&&!workspaceRegistry.hasViewer(result.workspaceInstanceId)?await showStudio(result.url):false;
    return {...result,browserOpenRequested};
  }
  async function workspaceViewValues(workspaceInstanceId){
    const views=legacyWorkspaceViews.get(workspaceInstanceId);
    if(!views)return {studios:[]};
    await views.tail;
    return {studios:[...views.records.values()],...(views.error?{viewError:views.error}:{})};
  }
  return {id:ownerId,name,client,requests:agentRequests,binding,
    acknowledgeEvents(eventIds){return studioEvents.acknowledgeIds(eventIds);},
    visibility:()=>presentation.visibility,
    setVisibility(value){if(!['hidden','visible'].includes(value))throw Error('Studio visibility must be hidden or visible.');presentation.visibility=value;for(const session of studioSessions.values())session.visibility=value;},
    operations:[...operations.values()].map(({action,...definition})=>definition),
    invoke:sessionInvoke,endTurn,validateTarget,openStudio,startStudio,acceptedWork:()=>[...activity.pendingWork],
    releaseStudio(id){studioSessions.delete(id);studioCommands.release(id);},
    ownStudio(id,session){studioSessions.set(id,session);},
    ownsStudio(id){return studioSessions.has(id);},
    studios:()=>[...studioSessions.values()],
    close(){studioEvents.close();return agentRequests.close();}
  };
  }
  function beginSession({id=randomUUID(),name,client,lobby=false,visibility='visible'}={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    if(typeof id!=='string'||!id.trim()||id.length>256||/[\x00-\x1f]/.test(id))throw Error('Invalid chat session ID.');
    if(!chats.has(id))chats.set(id,createChat(id,{name,client,lobby,visibility}));
    return chats.get(id);
  }
  const lobby=beginSession({id:'studio:'+randomUUID(),name:null,lobby:true}),connectedChats=new Set();
  async function attachChat(chat,session,{capture=false,expectedStudio}={}){
    if(!capture&&session.ownerId!==lobby.id&&session.ownerId!==chat.id)throw Error('This Studio is already attached to another chat. Use capture_bundle to take it over explicitly.');
    const attached=await session.server.attachChat(chat.binding,{expectedStudio});
    if(session.ownerId===chat.id)return attached;
    chats.get(session.ownerId)?.releaseStudio(session.server.agentSession().instanceId);
    session.ownerId=chat.id;chat.ownStudio(session.server.agentSession().instanceId,session);
    return attached;
  }
  async function prepareChatCommand({id,name,client,bundleId,operation,args={},visibility}={}){
    const known=connectedChats.has(id),chat=beginSession({id,name,client,visibility});
    if(visibility!==undefined)chat.setVisibility(visibility);
    if(bundleId)bundleIdSchema.parse(bundleId);
    if(!known)await chat.requests.recover();
    const prepared=attachments.tail.then(async()=>{
      if(app.closing)throw Error('The SAAM application is closing.');
      const input=structuredClone(args);
      if(operation)await chat.validateTarget(operation,input,true);
      // Explicit capture owns its transfer; ordinary connection must not preempt it.
      if(operation==='capture_bundle'){connectedChats.add(chat.id);return {chat,args:input};}
      const directory=bundleId?resolve(libraryRoot,bundleId):null;
      const targetInstance=input.expectedStudio?.studioInstanceId??input.studioInstanceId;
      const selected=targetInstance?allStudios.get(targetInstance):directory?[...allStudios.values()].find(session=>session.server.currentPrint()===directory):null;
      const available=!selected&&!known&&chat.visibility()!=='hidden'?[...allStudios.values()].find(session=>session.visibility!=='hidden'&&session.ownerId===lobby.id&&!session.server.currentPrint()):null;
      const target=selected??available;
      const before=target?.server.agentSession();
      const expectedStudio=input.expectedStudio??(before?{studioInstanceId:before.instanceId,bundleId:before.printId,selectionVersion:before.selectionVersion}:null);
      const transferred=target&&target.ownerId!==chat.id?await transferStudioNow(chat,target,false,expectedStudio):null;
      // Only this submitted command receives the token created by its validated
      // attachment. Caller inputs and future commands retain their own authority.
      if(target&&targetInstance){
        input.expectedStudio=transferred?{studioInstanceId:transferred.studioInstanceId,bundleId:transferred.bundleId,selectionVersion:transferred.selectionVersion}:expectedStudio;
      }
      connectedChats.add(chat.id);return {chat,args:input};
    });
    attachments.tail=prepared.then(()=>undefined,()=>undefined);return prepared;
  }
  async function connectChat(options){return (await prepareChatCommand(options)).chat;}
  async function submitCommand({operation,nativeContext,nativeContact,...connection},{onActivity}={}){
    const prepared=await prepareChatCommand({...connection,operation});
    if(nativeContact)void prepared.chat.endTurn(nativeContact.reason,nativeContact.context).catch(error=>console.error('Client lifecycle recovery: '+error.message));
    return prepared.chat.invoke(operation,prepared.args,{nativeContext,onActivity});
  }
  // Idle: no work, no tour and no unfinished request in the window; another chat may then take it.
  async function idleWindow(session){
    const instanceId=session.server.agentSession().instanceId;
    try{assertStudioIdle(session);}catch{return false;}
    if(transferringStudios.has(instanceId)||await session.server.inTour())return false;
    const requests=await chats.get(session.ownerId)?.requests.query()??[];
    return !requests.some(request=>request.studioInstanceId===instanceId&&['queued','working','waiting'].includes(request.status));
  }
  async function adoptWindow(chat){
    const candidates=[...allStudios.values()].filter(session=>session.visibility!=='hidden'&&session.ownerId!==chat.id&&session.server.listening&&!session.server.creationTarget()&&present(session))
      .sort((a,b)=>(b.ownerId===lobby.id)-(a.ownerId===lobby.id));
    for(const session of candidates){
      if(!await idleWindow(session))continue;
      try{await transferStudio(chat,session,session.ownerId!==lobby.id);return session;}catch{/* It became busy; try the next. */}
    }
    return null;
  }
  // ownOperations: Studio operations of the caller itself, such as the open request that moves a window;
  // caller: the chat viewing its own window, whose running operation (start_tour, request_review) is not other work.
  function assertStudioIdle(session,ownOperations=0,caller=null){
    const instanceId=session.server.agentSession().instanceId,directory=session.server.currentPrint();
    if(session.server.attachmentBusy(ownOperations))throw Error('Wait for the current Studio operation to finish before capturing or re-pairing.');
    if(session.ownerId!==caller&&(chats.get(session.ownerId)?.acceptedWork()??[]).some(call=>!call.studioInstanceId||call.studioInstanceId===instanceId||call.bundleId&&resolve(libraryRoot,call.bundleId)===directory))
      throw Error('A bundle operation is accepted. Wait for it to settle before capturing or re-pairing.');
    for(const operation of activeOperations.values())if(operation.ownerId!==caller&&(operation.ownerId===session.ownerId&&['set_tour_start_at','start_tour'].includes(operation.name)||operation.studioInstanceId===instanceId||operation.bundleId&&resolve(libraryRoot,operation.bundleId)===directory))
      throw Error('A bundle operation is running. Wait for it to finish before capturing or re-pairing.');
    for(const job of ownedJobs.list())if(directory&&job.bundleId&&resolve(libraryRoot,job.bundleId)===directory)throw Error('A calculation is running for this bundle.');
  }
  async function cancelOldRequests(session){
    const chat=chats.get(session.ownerId),instanceId=session.server.agentSession().instanceId;
    await chat.requests.retire({studioInstanceId:instanceId,message:'The Studio was explicitly transferred to another chat.'});
  }
  const attachments={tail:Promise.resolve()};
  async function transferStudioNow(chat,session,capture,expectedStudio){
      if(expectedStudio)await chat.validateTarget(capture?'capture_bundle':'request_review',{expectedStudio},true);
      if(!capture&&session.ownerId!==lobby.id&&session.ownerId!==chat.id)throw Error('This Studio is attached to another chat. Use capture_bundle to take it over explicitly.');
      assertStudioIdle(session);
      const instanceId=session.server.agentSession().instanceId;
      transferringStudios.add(instanceId);
      try{
        const workspaces=await runningJobs(),directory=session.server.currentPrint();
        if(workspaces.some(job=>job.job?.directory&&directory?.startsWith(job.job.directory)))throw Error('Workspace construction is running for this bundle.');
        const attached=await attachChat(chat,session,{capture,expectedStudio})??session.server.agentSession();
        return {studioInstanceId:instanceId,bundleId:attached.printId,selectionVersion:attached.selectionVersion,url:session.url,chatId:chat.id,captured:true};
      }finally{transferringStudios.delete(instanceId);}

  }
  function transferStudio(chat,session,capture,expectedStudio){
    const current=session.server.agentSession(),target=expectedStudio??{studioInstanceId:current.instanceId,bundleId:current.printId,selectionVersion:current.selectionVersion};
    const operation=attachments.tail.then(()=>transferStudioNow(chat,session,capture,target));
    attachments.tail=operation.catch(()=>{});return operation;
  }
  async function captureBundle(chat,bundleId,expectedStudio){
    bundleIdSchema.parse(bundleId);
    const directory=resolve(libraryRoot,bundleId),owner=await printRuntime(bundleId);
    if(owner){
      // Taking over another runtime's print: this code must read it before anything changes.
      await import('../print/bundle.mjs').then(bundle=>bundle.loadBundle(directory,{program:false})).catch(error=>{
        throw Object.assign(Error(application.runtime.label+' cannot read print '+bundleId+': '+error.message+' Keep using '+owner.command+' for it, or update this runtime.'),{code:'BUNDLE_UNREADABLE'});});
      await application.releaseBundle?.(bundleId);
      await withBundleWriteLock(directory,()=>recordBundleRuntime(directory,application.runtime),{wait:true});
    }
    const session=[...allStudios.values()].find(candidate=>candidate.server.currentPrint()===directory);
    if(expectedStudio)await chat.validateTarget('capture_bundle',{bundleId,expectedStudio},true);
    const taken=owner?{takenOverFrom:owner.label}:{};
    if(!session)return {...await chat.invoke('request_review',{bundleId}),...taken};
    return {...await transferStudio(chat,session,true,expectedStudio),...taken};
  }
  // A print another runtime last wrote: null for this runtime's own (and in processes without runtimes).
  async function printRuntime(bundleId){
    const self=application.runtime;if(!self)return null;
    const dir=resolve(libraryRoot,bundleId);
    const saved=await access(resolve(dir,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    const owner=saved?await bundleRuntime(dir):self;
    return owner.id===self.id?null:owner;
  }
  async function requireOwnRuntime(bundleId){
    const owner=await printRuntime(bundleId);
    if(owner)throw Object.assign(Error('Print '+bundleId+' was last saved by SAAM runtime '+owner.label+'. Use '+owner.command+' for it, or take it over in this runtime ('+application.runtime.label+') with: '+application.runtime.command+' call capture_bundle --bundle-id '+bundleId),
      {code:'BUNDLE_OTHER_RUNTIME',bundleRuntime:owner});
  }
  // The person opened another runtime's print in Studio: the orchestrator moves this window to that runtime.
  async function routeWindow(session,dir){
    const bundleId=relative(await realpath(libraryRoot),dir).split(sep).join('/'),owner=await printRuntime(bundleId);
    if(!owner)return null;
    const fallback='Print '+bundleId+' belongs to SAAM runtime '+owner.label;
    const agent='Ask an agent to open it: '+owner.command+' call request_review --bundle-id '+bundleId;
    if(!application.routeWindow)throw Error(fallback+'. '+agent);
    assertStudioIdle(session,1);
    try{return await application.routeWindow({instanceId:session.server.agentSession().instanceId,printId:bundleId,owner});}
    catch(error){if(error.code==='BUNDLE_INSTANCE_BUSY')throw error;throw Error(fallback+', which SAAM cannot start ('+error.message+'). '+agent);}
  }
  async function openStudio({studioInstanceId,newInstance=false,dispatch=true,visibility='visible'}={}){
    if(app.closing)throw Error('The SAAM application is closing.');
    if(newInstance&&studioInstanceId)throw Error('Choose an existing Studio or create a new instance.');
    const session=newInstance?await lobby.startStudio(null,{visibility}):studioInstanceId?allStudios.get(studioInstanceId):[...allStudios.values()].filter(session=>session.server.listening&&session.visibility===visibility).at(-1)??await lobby.startStudio(null,{visibility});
    if(studioInstanceId&&!session?.server.listening)throw Error('That Studio is no longer running.');
    session.visibility=visibility;
    const browserOpenRequested=dispatch?await show(session):false;
    return {studioInstanceId:session.server.agentSession().instanceId,url:session.url,browserOpenRequested};
  }
  function notifyStopping(reason){
    for(const {server} of allStudios.values())server.applicationStopping(reason);
  }
  function jobs(){
    return [...ownedJobs.list().map(({bundleId,...job})=>({...job,printId:bundleId})),...[...allStudios.values()].map(({server})=>server.generationStatus()).filter(job=>job&&job.kind!=='geometry'),
      ...workspaceRegistry.jobInspections()];
  }
  async function runningJobs(){
    const workspaces=await workspaceRegistry.inspectJobs();
    return [...jobs().filter(job=>!job.inspect),...workspaces.filter(value=>value.job&&!['complete','failed','cancelled'].includes(value.job.stage))];
  }
  function close(){return app.closing??=(async()=>{
    for(const {controller} of passiveMonitors)controller.abort();
    const jobDrain=ownedJobs.close();
    // Stop existing Studio workers before draining work; no queued operation may start after closing.
    await Promise.all([...allStudios.values()].map(({server})=>server.shutdown()));
    await Promise.all([...work.pending]);await jobDrain;await attachments.tail;await Promise.all([...monitorCalls]);
    // An already-running opener can finish while shutdown is draining.
    await Promise.all([...allStudios.values()].map(({server})=>server.shutdown()));
    await workspaceRegistry.closeAll();
    await Promise.all([...chats.values()].map(chat=>chat.requests.drain()));
    await Promise.all([...chats.values()].map(chat=>chat.close()));
    await requestStore.close();
    chats.clear();connectedChats.clear();allStudios.clear();operationObservers.clear();eventObservers.clear();clientEventObservers.clear();
    await resultImages.close();
    await closeObservationRetention(resolve(paths.state??stateRoot,'contract-observations'),{ownerId:retentionOwner});
  })();}
  async function restoreStudios(windows){
    for(const window of windows){
      const attachment=window.attachment;
      const recovering=Boolean(attachment&&!chats.has(attachment.ownerId));
      const chat=attachment?beginSession({id:attachment.ownerId,name:attachment.name,client:attachment.client,visibility:window.chatVisibility??window.visibility??'visible'}):lobby;
      if(recovering)await chat.requests.recover();
      await chat.startStudio(window.printId?resolve(libraryRoot,window.printId):null,{instanceId:window.instanceId,sessionToken:window.sessionToken,selectionVersion:window.selectionVersion,restoring:true,visibility:window.visibility??'visible'});
      if(attachment)connectedChats.add(chat.id);
    }
  }
  // Closes a Studio whose window moves to another runtime. A routed window was
  // checked by its own open request, which may still be finishing.
  // idle: another runtime's chat adopts the window only if nobody is working in it.
  async function releaseStudio(instanceId,{routed=false,idle=false}={}){
    const session=allStudios.get(instanceId);
    if(!session)throw Error('That Studio is no longer running.');
    if(idle&&!await idleWindow(session))throw Error('That Studio window is in use.');
    if(!routed)assertStudioIdle(session);
    await cancelOldRequests(session);await session.server.shutdown();
    return {completed:true};
  }
  // A turn end reaches only a chat this runtime holds; it never starts or attaches one.
  async function endTurn(chatId,reason,contact){
    const chat=chats.get(chatId),result=chat&&chat!==lobby?await chat.endTurn(reason,contact):{handedBack:0};
    if(reason==='closed')await resultImages.release(chatId);
    return result;
  }
  // Local response delivery names an existing chat; it never attaches or starts one.
  function acknowledgeResponseEvents({chatId,eventIds}){
    if(typeof chatId!=='string'||!chatId||!Array.isArray(eventIds)||eventIds.some(id=>typeof id!=='string'||!id))throw Error('Response acknowledgement needs exact chat and event IDs.');
    const chat=chats.get(chatId);
    if(app.closing||!chat)throw Object.assign(Error('The original Runtime/chat is unavailable for delivery acknowledgement.'),{code:'STUDIO_EVENT_ACK_UNAVAILABLE'});
    return chat.acknowledgeEvents(eventIds);
  }
  function acknowledgeClientEvents({client,sessionId,eventIds}){
    if(typeof client!=='string'||!client||typeof sessionId!=='string'||!sessionId||!Array.isArray(eventIds)||eventIds.some(id=>typeof id!=='string'||!id))throw Error('Client acknowledgment needs exact client, session and event IDs.');
    const chat=chats.get(sessionId);
    if(!chat||chat.client!==client)return {acknowledged:true};
    return chat.acknowledgeEvents(eventIds);
  }
  return {beginSession,connectChat,submitCommand,endTurn,openStudio,notifyStopping,runningJobs,close,restoreStudios,releaseStudio,acknowledgeClientEvents,acknowledgeResponseEvents,activeCount:()=>activeOperations.size+work.pending.size+transferringStudios.size,
    operations:lobby.operations,
    observeEvents(observer){eventObservers.add(observer);return()=>eventObservers.delete(observer);},
    observeClientEvents(observer){clientEventObservers.add(observer);return()=>clientEventObservers.delete(observer);},
    observeOperations(observer){operationObservers.add(observer);return()=>operationObservers.delete(observer);},
    studios:()=>[...allStudios.values()].map(({server,url,visibility})=>({...server.agentSession(),url,visibility,chatVisibility:chats.get(server.agentSession().attachment?.ownerId)?.visibility()??visibility})),
    chatIds:()=>[...chats.keys()].filter(id=>id!==lobby.id)
  };
}
