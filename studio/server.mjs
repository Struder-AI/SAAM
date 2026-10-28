// A Studio window: one HTTP server per window that admits each page request and
// hands it to the part of the window whose flow it is. The parts are the session
// (the print shown and its reservation), its reads, the receipts of drawn views,
// the person's actions, the tour, the service panel and view reports. createStudio
// owns the window's two records and composes the parts over them.
import {createWindowSession} from './window-session.mjs';
import {createWindowReads} from './window-reads.mjs';
import {createViewReceipts} from './view-receipts.mjs';
import {createWindowActions} from './window-actions.mjs';
import {createTourRoutes} from './tour-routes.mjs';
import {createServiceRoute} from './service-route.mjs';
import {createViewReports} from './view-reports.mjs';
import {createTour} from './tour.mjs';
import {createPartCommandRoutes} from '../core/agent/part-command-routes.mjs';
import {bundleFor,supportsBundleSchema} from './adapter-resolution.mjs';
import {listPrints} from '../core/print/view-values.mjs';
export {listPrints};
import {requestPrintId} from '../core/application/chat-requests.mjs';
import http from 'node:http';
import {watchStudioChanges} from './changes.mjs';
import {readdir,stat,realpath} from 'node:fs/promises';
import {resolve,dirname,basename,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {claimBundleInstance,releaseBundleInstance} from '../core/print/studio-ownership.mjs';
import {viewerLifetime} from './lifetime.mjs';
import {createViewerCapture} from './viewer-capture.mjs';
import {createDownloadCapabilities} from './download-capabilities.mjs';


const here=dirname(fileURLToPath(import.meta.url));
export const root=resolve(here,'..');
// This process keeps one module graph for its lifetime, while generation
// workers and command processes load whatever is on disk when they run.
// Source edited after startup is therefore a real explanation for a rejected
// recipe or a failed generation that the print itself cannot produce. Scanned
// only once something has already failed, so the working path pays nothing.
const SOURCE_ROOTS=['core','studio','skills','machines'];
const loadedAtMs=Date.now();
async function changedSince(dir,sinceMs,base,depth=0){
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return null;}
  for(const entry of entries){
    if(entry.name.startsWith('.')||['node_modules','tests','fixtures'].includes(entry.name))continue;
    const path=resolve(dir,entry.name);
    if(entry.isDirectory()){
      const found=depth<6?await changedSince(path,sinceMs,base,depth+1):null;
      if(found)return found;continue;
    }
    if(!/\.(mjs|json)$/.test(entry.name))continue;
    try{if((await stat(path)).mtimeMs>sinceMs)return relative(base,path).replaceAll('\\','/');}catch{/* removed mid-scan */}
  }
  return null;
}
export async function sourceSkewNotice(sinceMs=loadedAtMs,{base=root,roots=SOURCE_ROOTS}={}){
  for(const name of roots){
    const changed=await changedSince(resolve(base,name),sinceMs,base);
    if(changed)return `Studio is running older SAAM source than the files on disk: ${changed} changed after Studio started. Restart Studio, then retry.`;
  }
  return null;
}
// Recorded against a failure that already happened, once per error, and read
// back by whoever reports it: the note rides with the error through every
// rethrow without the error itself being rewritten. A detected skew persists
// until this process restarts, which is the only cure for it.
const skewNotes=new WeakMap();
const skew={notice:null,checkedAt:0};
export async function noteSourceSkew(error){
  if(!(error instanceof Error)||skewNotes.has(error))return error;
  skewNotes.set(error,'');
  if(!skew.notice&&Date.now()-skew.checkedAt>=3000){skew.checkedAt=Date.now();skew.notice=await sourceSkewNotice();}
  if(skew.notice)skewNotes.set(error,' '+skew.notice);
  return error;
}
export function reportedMessage(error){const note=skewNotes.get(error);return note?error.message+note:error.message;}
// Explicit browser module allowlist; no generic repository/file serving.
const playerModules=new Set(['core/private/studio/numeric.mjs','core/geom/frame.mjs','core/contracts/numerical-json.mjs',
  'studio/path-preview.mjs','studio/source-worker.mjs','studio/move-store.mjs','studio/source-preview.mjs','studio/path-view-quality.mjs','studio/toolpath-view.mjs','studio/paath-queries.mjs','studio/paath-view.mjs','studio/execution-review.mjs',
  'studio/machine-session.mjs','studio/machine-view.mjs','core/machine/path-time.mjs',
  'core/machine/presentation.mjs','core/machine/jog.mjs','core/machine/kinematics.mjs',
  'core/print/review-state.mjs','core/print/phase-colours.mjs',
  'core/path/pose.mjs','core/path/action-context.mjs','core/geom/tolerance.mjs','core/dimensions.mjs',
  'core/path/curve-path.mjs','core/path/curve-profiles.mjs','core/path/injection.mjs','core/path/process-controls.mjs','core/path/contracts.mjs','core/private/toolpath/numeric.mjs',
  'core/geom/curve-query.mjs','core/geom/nurbs.mjs','core/geom/surface-frame.mjs','core/geom/curve-ops.mjs','core/geom/bezier-net.mjs','core/geom/convex-clearance.mjs']);

// A selected plan, export or delivery file reopens its owning print bundle.
// Standalone foreign programs need an interpreter contract before review.
export async function printDirectory(input,resolveBundle=bundleFor) {
  if(typeof input!=='string'||!input.trim())throw new Error('Choose a saved print folder or a file inside it.');
  let dir=await realpath(isAbsolute(input)?input:resolve(root,input));
  if(!(await stat(dir)).isDirectory())dir=dirname(dir);
  for(let depth=0;depth<4;depth++){
    try{await resolveBundle(dir);return dir;}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=dirname(dir);if(parent===dir)break;dir=parent;
  }
  throw new Error('No SAAM print bundle found. Open the saved print folder containing plan.json and its referenced artifacts. Standalone G-code/3MF import is not supported.');
}
// Studio opened without a print serves the
// page, the library and the tour; everything that reads a print answers this.
async function serviceInput(request){
  const chunks=[],size={bytes:0};
  for await(const chunk of request){size.bytes+=chunk.length;if(size.bytes>16_000)throw Error('Request too large.');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString()||'{}');
}
function escapeTitle(value){return value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}
const noPrint=()=>Object.assign(Error('No print is open. Open a saved print, import an STL, start the tour, or ask your agent to make a part.'),{code:'NO_PRINT'});
const printFreeRoutes=new Set(['/api/open','/api/tour','/api/view-performance','/api/import-stl','/api/cancel-calculation']);
// A local development launcher may explicitly supply a scratch adapter resolver.
// This is a function supplied by code, never a module path supplied by a print or HTTP request.
// A null directory opens Studio with no print; the person or agent opens one later.
// The owner supplies libraryRoot and, to remember exported setups, machineSetups;
// paths.phaseColours names the home's phase-colour preference. chat is the Application's
// binding for the attached chat (or the lobby); attachChat replaces it.
export function createStudio(directory,{libraryRoot,paths,machineSetups,resolveBundle=bundleFor,chat:binding,relay,instanceId=randomBytes(16).toString('hex'),sessionToken,selectionVersion,restoring=false,runtimeId,runtimeLabel,studioTitle='SAAM Studio',fingerprint,routeStudio,partCommands,selectedValues}) {
  paths=paths===undefined?undefined:Object.freeze({...paths});
  // The window's session: the print it shows, its write reservation and edit
  // order, the review it presents (normal, or a retained inspection) and whether
  // it is closing. opened settles once the shown print is reserved.
  const session={dir:directory?resolve(directory):null,opened:null,reservation:null,reservedDirectory:null,editTail:Promise.resolve(),
    inspection:null,reviewEpoch:randomBytes(16).toString('hex'),normalReviewPending:false,closed:false};
  // The work it runs: one queue of operations; the one generation it runs for the
  // shown print, whoever asked (person, tour step or agent), cancellable until its
  // commit begins; the import or Export in progress; the last generation's outcome;
  // and the calculation it projects. Application owns that job and controller;
  // Studio projects only the accepted selection's read/cancel interface,
  // including a creation with no manifest.
  const work={queue:Promise.resolve(),generationRun:null,generationFailure:undefined,generationCancelled:undefined,
    importProgress:undefined,importController:undefined,exportRun:null,calculation:null,checkingGeneration:false};
  const partCommandRoute=partCommands??createPartCommandRoutes();
  // The library lists every print Studio can show, machine studies included.
  const showable=async(dir,plan)=>supportsBundleSchema(plan.schema)||Boolean(await resolveBundle(dir));
  const attachedTo=next=>({binding:next,tour:createTour(libraryRoot,{studioId:instanceId,chat:next})});
  const chat={current:attachedTo(binding),stopRequestFeed:null};
  // The tour is this Studio's while it runs here; elsewhere this Studio stays an ordinary one.
  const tourHere=guide=>Boolean(guide.active&&guide.studioOwner?.instanceId===instanceId);
  const selection={version:selectionVersion??randomBytes(16).toString('hex')};
  const token=sessionToken??randomBytes(24).toString('hex'),viewPerformance=[];
  const workIdFor=directory=>directory?requestPrintId(libraryRoot,directory,{optional:true}):null;
  // Studio observations for the owning agent: person-driven actions, worker
  // outcomes and displayed results, tagged with this instance and its print.
  const queuedNoted=new Set();
  const note=(kind,detail={})=>chat.current.binding.note(kind,{studioInstanceId:instanceId,printId:workIdFor(session.dir),directory:session.dir,selectionVersion:detail.directory&&detail.directory!==session.dir?undefined:selection.version,...detail});
  // Authenticated delivery issues a bounded, short-lived read-only capability.
  // Its HTTP attachment avoids browser-specific blob URL download handling.
  const downloadLinks=createDownloadCapabilities({onCleanupError:error=>note('download-cleanup-failed',{error:error.message})}),stageDownload=downloadLinks.stage;
  const printIdFor=directory=>createHash('sha256').update(resolve(directory)).digest('hex');
  const printId=()=>printIdFor(session.dir);
  const operations={active:0,creating:false};
  const settlingSelections=new Map();
  // Association reserves this bundle before the instance becomes usable.
  // A Studio without a print remains unreserved until it opens one.
  session.opened=session.dir?(async()=>{
    const selected=session.dir,adapter=await resolveBundle(selected);
    await adapter.loadBundleSnapshot(selected,{program:false});
    const claim=await claimBundleInstance(selected,{instanceId,ownerId:chat.current.binding.ownerId,restoring,runtimeId,runtimeLabel});
    try{await chat.current.tour.attachStudio(selected);}
    catch(error){await releaseBundleInstance(selected,claim);throw error;}
    session.reservation=claim;session.reservedDirectory=selected;return adapter;
  })():Promise.resolve(null);
  session.opened.catch(()=>{});
  const displayedResults=new Map();
  // What the window's parts read from it: values, and the parts that
  // other parts call. Each name is resolved when used, so a part may call one made after it.
  const ctx={
    get attachedTo(){return attachedTo;},get calculationStatus(){return calculationStatus;},get changeReview(){return changeReview;},get chat(){return chat;},
    get displayedResults(){return displayedResults;},get downloadLinks(){return downloadLinks;},get escapeTitle(){return escapeTitle;},get fingerprint(){return fingerprint;},
    get generate(){return generate;},get here(){return here;},get instanceId(){return instanceId;},get leaveTour(){return leaveTour;},
    get libraryRoot(){return libraryRoot;},get lifetime(){return lifetime;},get machineSetups(){return machineSetups;},
    get noPrint(){return noPrint;},get note(){return note;},get noteSourceSkew(){return noteSourceSkew;},get openPrint(){return openPrint;},
    get operations(){return operations;},get outputGenerating(){return outputGenerating;},get partCommandRoute(){return partCommandRoute;},get paths(){return paths;},
    get playerModules(){return playerModules;},get printDirectory(){return printDirectory;},get printId(){return printId;},get printIdFor(){return printIdFor;},
    get publishProgress(){return publishProgress;},get queuedNoted(){return queuedNoted;},get relay(){return relay;},get reportedMessage(){return reportedMessage;},
    get resolveBundle(){return resolveBundle;},get restoring(){return restoring;},get root(){return root;},get routeStudio(){return routeStudio;},
    get runBundleEdit(){return runBundleEdit;},get runtimeId(){return runtimeId;},get runtimeLabel(){return runtimeLabel;},get selectedValues(){return selectedValues;},
    get selection(){return selection;},get server(){return server;},get serviceInput(){return serviceInput;},get session(){return session;},
    get settlingSelections(){return settlingSelections;},get showable(){return showable;},get stageDownload(){return stageDownload;},get studioTitle(){return studioTitle;},
    get token(){return token;},get tourHere(){return tourHere;},get validateGeometrySelection(){return validateGeometrySelection;},get viewPerformance(){return viewPerformance;},
    get viewerCapture(){return viewerCapture;},get work(){return work;},get workIdFor(){return workIdFor;}
  };
  const {changeReview,runBundleEdit,runBundleCreation,releaseInstance,leaveSelection,openPrint,selected,validateGeometrySelection,observeRequest,replaceAttachment}=createWindowSession(ctx);
  const {geometryOnly,viewFingerprint,stateTag,matchesStateTag,pageRoute,readRoute}=createWindowReads(ctx);
  const {receiptRoute}=createViewReceipts(ctx);
  const {queueOperation,projectedCalculation,observeCalculation,projectionStatus,outputGenerating,cancelledGeneration,cancelGeneration,cancelCalculation,calculationStatus,activeCalculationStatus,generationStatus,publishProgress,runImport,publishGenerationFailure,generationHost,generate,exportPrint,downloadRoute,immediateActionRoute,actionRoute}=createWindowActions(ctx);
  const {leaveTour,tourRoute}=createTourRoutes(ctx);
  const {serviceRoute}=createServiceRoute(ctx);
  const {viewReportRoute}=createViewReports(ctx);
  // Each request is admitted here (localhost only, no caching, a strict content
  // policy) and handed to the route for its flow: downloads, the page, the service
  // panel and reads; then posted view reports, immediate commands and, in order,
  // the queued receipts, tour steps and actions.
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host;
    if(!/^127\.0\.0\.1:\d+$/.test(host??'')){res.writeHead(403);res.end('Localhost only.');return;}
    const origin=`http://${host}`;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
    const url=new URL(req.url,origin);
    const send=(data,status=200)=>{
      void Promise.resolve(chat.current.binding.flush?.()).then(()=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));},error=>{
        res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Studio event delivery failed: '+error.message}));
      });
    };
    try {
      if(await downloadRoute(req,res,url,origin,send))return;
      if(await pageRoute(req,res,url,origin,send))return;
      if(await serviceRoute(req,res,url,origin,send))return;
      if(req.method==='GET'&&await readRoute(req,res,url,send))return;
      await session.opened;
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      if(operations.creating&&!session.dir&&!['/api/cancel-calculation','/api/open','/api/import-stl'].includes(url.pathname))throw Error('The print is being created. Wait for the current operation before editing it.');
      // A print, once open, stays open, so this check cannot go stale in the queue.
      if(!session.dir&&!printFreeRoutes.has(url.pathname))throw noPrint();
      const importing=url.pathname==='/api/import-stl',capturing=url.pathname==='/api/visual-check',chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>(importing||capturing?64*1024*1024:64_000))throw Error('Request too large.');chunks.push(chunk);}
      const body=Buffer.concat(chunks),data=importing?Object.fromEntries(url.searchParams):JSON.parse(body.toString()||'{}');
      if(await viewReportRoute(url,data,capturing,send))return;
      if(await immediateActionRoute(res,url,data,send))return;
      const run=queueOperation(async()=>{
        if(data.printId&&(session.dir?data.printId!==printId():!['/api/open','/api/import-stl'].includes(url.pathname)))throw new Error('The open print changed. Reload before continuing.');
        const current=await session.opened;
        const progress=await chat.current.tour.info();
        if(await receiptRoute(url,data,progress,current,send))return;
        if(await tourRoute(url,data,progress,current,send))return;
        await actionRoute(url,data,body,importing,progress,current,send);
      });
      work.queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent){await noteSourceSkew(error);send({error:reportedMessage(error),code:error.code,...(error.importDiagnostic?{importDiagnostic:error.importDiagnostic}:{})},400);}else res.end();}
  });
  // The application reopens through the same serialized and validated operation
  // as the picker, including when the person changed this viewer's print.
  server.reviewEpoch=()=>session.reviewEpoch;
  server.inspectionSelection=()=>session.inspection;
  server.openPrint=(input,{expectedStudio,inspection:retained=null,expectedReviewEpoch}={})=>{
    const run=queueOperation(async()=>{
      if(expectedStudio&&(expectedStudio.studioInstanceId!==instanceId||expectedStudio.bundleId!==workIdFor(session.dir)||expectedStudio.selectionVersion!==selection.version))
        throw Object.assign(Error('The Studio target changed before opening the bundle.'),{code:'STUDIO_TARGET_CHANGED',currentStudio:{studioInstanceId:instanceId,bundleId:workIdFor(session.dir),selectionVersion:selection.version}});
      if(expectedReviewEpoch!==undefined&&expectedReviewEpoch!==session.reviewEpoch)throw Object.assign(Error('The Studio review changed before opening.'),{code:'STUDIO_REVIEW_CHANGED'});
      if(retained&&!selectedValues)throw Error('Retained values are unavailable in this Studio.');
      await openPrint(input);if(retained)changeReview(retained);
      lifetime.notify('studio-update',{kind:'state',kinds:['print','review']});
    });
    work.queue=run.catch(()=>{});return run;
  };
  server.importSTL=({directory,source,units},{signal}={})=>{
    const run=queueOperation(()=>{
      if(typeof directory!=='string'||typeof source!=='string')throw Error('Import needs a destination and local STL path.');
      return runImport(resolve(source),{name:basename(source),directory,units,signal});
    });
    work.queue=run.catch(()=>{});return run;
  };
  server.startTour=()=>queueOperation(async()=>{
    const result=await chat.current.tour.action('fresh');
    if(result.directory)await openPrint(result.directory);
    note('tour-started',{step:result.data.step,runId:result.data.runId,lessonId:result.data.lessonId});
    lifetime.notify('studio-update',{kind:'state',kinds:['print','tour']});return result.data;
  });
  server.setStartAt=(startAt,lesson)=>chat.current.tour.setStartAt(startAt,lesson);
  server.currentPrint=()=>session.dir;
  server.inTour=async()=>{const guide=await chat.current.tour.info();return Boolean(guide.active&&session.dir&&guide.directory===session.dir);};
  // An agent generates through the edit it already holds on this Studio's print.
  server.generate=({trigger='agent',...options}={})=>generate({trigger,...options});
  server.generationHost=()=>generationHost;
  server.applicationStopping=reason=>lifetime.notify('studio-update',{kind:'application-stopping',reason});
  const lifetime=viewerLifetime(server,{onViewers:count=>{note(count?'viewer-opened':'viewer-closed',{viewers:count});if(count)viewerCapture.connected();},onClosing:()=>{
    session.closed=true;downloadLinks.close();work.importController?.abort(Object.assign(Error('Import cancelled because Studio closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
    work.calculation?.cancel();
    if(!work.generationRun?.committing)work.generationRun?.controller.abort(cancelledGeneration());
  },
    onShutdown:async()=>{work.importController?.abort(Object.assign(Error('Import cancelled because Studio closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));await session.opened.catch(()=>{});await work.queue;await downloadLinks.close();await releaseInstance();await Promise.all([...settlingSelections.values()].map(entry=>entry.done));await chat.current.tour.closeStudio();}});
  chat.stopRequestFeed=chat.current.binding.watch(observeRequest);
  server.attachChat=replaceAttachment;
  server.attachment=()=>chat.current.binding.attachment;
  server.attachmentBusy=(ownOperations=0)=>operations.active>ownOperations||settlingSelections.size>0||Boolean(work.importProgress)||generationStatus()?.status==='generating';
  const stopWatching=watchStudioChanges(libraryRoot,kinds=>{
    const external=kinds.filter(kind=>kind!=='requests');
    if(external.length)lifetime.notify('studio-update',{kind:'state',kinds:external});
    const run=work.generationRun;
    if(kinds.includes('print')&&run?.calculated&&!run.committing&&!work.checkingGeneration){
      work.checkingGeneration=true;
      void resolveBundle(run.directory).then(adapter=>adapter.loadBundleSnapshot(run.directory,{program:false})).then(({state})=>{
        if(work.generationRun===run&&state.editRevision!==run.editRevision)return cancelGeneration('inputs-changed');
      }).catch(()=>{/* A partial external write will be rechecked at commit. */}).finally(()=>{work.checkingGeneration=false;});
    }
  });
  const viewerCapture=createViewerCapture({notify:detail=>lifetime.notifyOne('studio-update',detail)});
  server.captureView=async request=>{
    const version=selection.version,presentation=session.reviewEpoch;
    if(session.inspection)throw Error('Return to normal review before capturing fabrication evidence.');
    if(workIdFor(session.dir)!==request.bundleId)throw Error('Studio selected another bundle before its visual check.');
    const frame=await viewerCapture.capture(request);
    if(selection.version!==version||session.reviewEpoch!==presentation||workIdFor(session.dir)!==request.bundleId)throw Error('Studio changed its review during the visual check.');
    return frame;
  };
  server.once('close',()=>{session.closed=true;downloadLinks.close();viewerCapture.close();stopWatching();chat.stopRequestFeed();if(!work.generationRun?.committing)work.generationRun?.controller.abort(cancelledGeneration());void releaseInstance().catch(error=>note('instance-release-failed',{error:error.message}));});
  server.sessionToken=()=>token;
  server.shutdown=lifetime.shutdown;server.viewerCount=lifetime.viewers;
  server.generationStatus=generationStatus;
  server.cancelCalculation=cancelCalculation;
  server.observeCalculation=observeCalculation;
  server.runBundleEdit=runBundleEdit;
  server.runBundleCreation=runBundleCreation;
  server.creationTarget=()=>session.reservation&&!session.dir?session.reservedDirectory:null;
  server.showSavedCreation=async target=>{
    if(settlingSelections.has(resolve(target))&&session.dir!==resolve(target))return;
    if(!operations.creating||session.reservedDirectory!==resolve(target))throw Error('No owned bundle creation is active.');
    const before=session.dir;await openPrint(target);if(session.dir!==before)lifetime.notify('studio-update',{kind:'state',kinds:['print']});
  };
  server.ready=()=>session.opened;
  server.agentSession=()=>({instanceId,ownerId:chat.current.binding.ownerId,printId:workIdFor(session.dir),directory:session.dir,selectionVersion:selection.version,connected:!session.closed,attachment:server.attachment()});
  return server;
}
