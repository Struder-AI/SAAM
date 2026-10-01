import {createTour,tourExample,useExample} from './tour.mjs';
import {bundleFor,readStableBundle,supportsBundleSchema} from './adapter-resolution.mjs';
import {TOUR_STEPS,TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createAgentRequests,workSnapshot} from './agent-requests.mjs';
import {composeStudioState} from './state-response.mjs';
import {printName,downloadName,requestedDownloadName} from './print-name.mjs';
import {importStudioSTL,loadStudioImportRepair} from './import-stl.mjs';
import http from 'node:http';
import {watchStudioChanges} from './changes.mjs';
import {createStudioEvents} from './studio-events.mjs';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {PreparedGenerationJob} from './prepared-generation-job.mjs';
import {claimBundleInstance,releaseBundleInstance,withBundleInstance} from '../core/print/studio-ownership.mjs';
import { viewerLifetime, DEFAULT_DISCONNECT_MS } from './lifetime.mjs';


const here=dirname(fileURLToPath(import.meta.url));
export const root=resolve(here,'..');
// This process keeps one module graph for its lifetime, while generation
// workers, the CLI and MCP load whatever is on disk at the moment they run.
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
let skewNotice=null,skewCheckedAt=0;
export async function noteSourceSkew(error){
  if(!(error instanceof Error)||skewNotes.has(error))return error;
  skewNotes.set(error,'');
  if(!skewNotice&&Date.now()-skewCheckedAt>=3000){skewCheckedAt=Date.now();skewNotice=await sourceSkewNotice();}
  if(skewNotice)skewNotes.set(error,' '+skewNotice);
  return error;
}
export function reportedMessage(error){const note=skewNotes.get(error);return note?error.message+note:error.message;}
// Explicit browser module allowlist; no generic repository/file serving.
const playerModules=new Set(['core/private/studio/numeric.mjs','core/private/studio/rigid.mjs','core/private/studio/frame.mjs',
  'core/private/export/numeric.mjs','core/private/export/rigid.mjs','core/private/export/frame.mjs','core/private/toolpath/numeric.mjs',
  'studio/source-player.mjs','studio/source-worker.mjs','studio/move-store.mjs',
  'studio/machine-session.mjs','studio/machine-view.mjs','core/export/source-time.mjs','core/export/machine-study.mjs',
  'core/machine/presentation.mjs','core/machine/rigid.mjs','core/machine/jog.mjs',
  'core/machine/dobot-kinematics.mjs','core/machine/denso-kinematics.mjs',
  'core/print/review-state.mjs',
  'core/export/denso-player.mjs','core/machine/denso.mjs','core/path/pose.mjs',
  'core/export/griffin-player.mjs','core/export/gcode-lines.mjs','core/export/bambu-player.mjs','core/export/bambu-change.mjs','core/export/bambu-x1-change.mjs','core/machine/filaments.mjs',
  'core/export/dobot-player.mjs','core/export/dobot-lua-subset.mjs','core/machine/rules.mjs','core/geom/tolerance.mjs','core/path/process-controls.mjs']);

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
export async function listPrints(libraryRoot,resolveBundle=bundleFor) {
  const prints=[];
  async function walk(dir,depth){
    let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(entries.some(e=>e.name==='plan.json'&&e.isFile())){
      try{const document=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8')),{bundle,...plan}=document,machine=bundle?bundle.machine:JSON.parse(await readFile(resolve(dir,'machine.json'),'utf8'));
        if(supportsBundleSchema(plan.schema)||await resolveBundle(dir))prints.push({path:dir,name:await printName(dir,plan),machine:machine?.name??'No printer selected',machineId:machine?.id??null,modified:(await stat(resolve(dir,'plan.json'))).mtime.toISOString()});
      }catch{/* One damaged bundle must not hide the other prints. */}
      return;
    }
    for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.'))await walk(resolve(dir,entry.name),depth+1);
  }
  await walk(resolve(libraryRoot),0);return prints.sort((a,b)=>b.modified.localeCompare(a.modified));
}
// Studio opened without a print (a relay computer's launch instance) serves the
// page, the library and the tour; everything that reads a print answers this.
const noPrint=()=>Object.assign(Error('No print is open. Open a saved print, import an STL, start the tour, or ask your chat to make a part.'),{code:'NO_PRINT'});
const printFreeRoutes=new Set(['/api/open','/api/tour','/api/view-performance','/api/import-stl','/api/cancel-calculation']);
// Studio's view of a relay link, when this computer is paired with one: status()
// and linkCode() come from relay-device.mjs. The connector URL is the relay's /mcp.
const relayView=status=>({...status,connectorUrl:new URL('/mcp',status.relayUrl).href});
// A local development launcher may explicitly supply a scratch adapter resolver.
// This is a function supplied by code, never a module path supplied by a print or HTTP request.
// A null directory opens Studio with no print; the person or agent opens one later.
export function createStudio(directory,{disconnectMs=DEFAULT_DISCONNECT_MS,libraryRoot=resolve(root,'Prints'),resolveBundle=bundleFor,agentOwnerId,agentRequests,closeAgentRequests=false,studioEvents,relay}={}) {
  const instanceId=randomBytes(16).toString('hex');
  const sessionOwnerId=agentOwnerId??agentRequests?.ownerId??`studio:${instanceId}`;
  if(agentRequests?.ownerId&&agentRequests.ownerId!==sessionOwnerId)throw Error('A Studio instance belongs to exactly one agent owner.');
  const requests=agentRequests??createAgentRequests(libraryRoot,{ownerId:sessionOwnerId}),ownsRequests=!agentRequests;
  const tour=createTour(libraryRoot,{ownerId:sessionOwnerId,studioId:instanceId,agentRequests:requests});
  const geometryOnly=guide=>guide.active&&guide.directory===dir&&guide.step<L.playback;
  const viewFingerprint=(id,fingerprint,guide)=>id+fingerprint+(geometryOnly(guide)?':geometry':':program');
  let dir=directory?resolve(directory):null;
  const token=randomBytes(24).toString('hex'),viewPerformance=[];
  // Whether the owning chat is working; its runtime pushes changes here.
  const agentActivity={working:false};
  const workIdFor=directory=>directory?requests.printId(directory,{optional:true}):null;
  // Studio observations for the owning agent: person-driven actions, worker
  // outcomes and displayed results, tagged with this instance and its print.
  const events=studioEvents??createStudioEvents(),ownsEvents=!studioEvents,closingPolls=new AbortController(),queuedNoted=new Set();
  const note=(kind,detail={})=>events.record(kind,{studioInstanceId:instanceId,printId:workIdFor(dir),directory:dir,...detail});
  // Authenticated delivery issues a bounded, short-lived read-only capability.
  // Its HTTP attachment avoids browser-specific blob URL download handling.
  const downloadLinks=new Map();
  const stageDownload=({name,bytes,exportHash})=>{
    const now=Date.now();for(const [key,value] of downloadLinks)if(value.expiresAt<=now)downloadLinks.delete(key);
    if(downloadLinks.size>=16)downloadLinks.delete(downloadLinks.keys().next().value);
    const key=randomBytes(24).toString('hex'),expiresAt=now+10*60*1000;
    downloadLinks.set(key,{bytes,name,exportHash,expiresAt});return {url:'/api/download/'+key,name,exportHash,expiresAt};
  };
  const printIdFor=directory=>createHash('sha256').update(resolve(directory)).digest('hex');
  const printId=()=>printIdFor(dir);
  let queue=Promise.resolve();
  let editTail=Promise.resolve(),reservation=null,reservedDirectory=null,switching=false;
  // Association reserves this bundle before the instance becomes usable.
  // A Studio without a print remains unreserved until it opens one.
  let opened=dir?(async()=>{
    const selected=dir,adapter=await resolveBundle(selected);
    await readStableBundle(adapter,selected,{program:false});
    const claim=await claimBundleInstance(selected,{instanceId,ownerId:sessionOwnerId});
    try{await tour.attachStudio(selected);}
    catch(error){await releaseBundleInstance(selected,claim);throw error;}
    reservation=claim;reservedDirectory=selected;return adapter;
  })():Promise.resolve(null);
  opened.catch(()=>{});
  const runBundleEdit=(target,action)=>{
    if(closed)return Promise.reject(Error('Studio is closing. Reopen it before editing.'));
    const selected=resolve(target);
    const run=editTail.then(async()=>{
      await opened;
      if(switching||dir!==selected)throw Error('The Studio print changed before editing.');
      if(!reservation||reservedDirectory!==selected)throw Error('This Studio instance has no association with the print. Open it again.');
      return withBundleInstance(selected,reservation,()=>action(reservation));
    });
    editTail=run.catch(()=>{});
    return run;
  };
  const releaseInstance=()=>{
    const run=editTail.then(async()=>{
      if(reservation){await releaseBundleInstance(reservedDirectory,reservation);reservation=null;reservedDirectory=null;}
    });
    editTail=run.catch(()=>{});
    return run;
  };
  const displayedResults=new Map();
  // Speculation never enters the HTTP mutation queue or the browser's busy
  // state. Keep one worker/candidate, replacing it when the reviewed plan changes.
  let preparation,generationFailure,generationCancelled,importProgress,importController,generationRun=null,closed=false;
  const stateTag=(fingerprint,guide,failure=generationFailure,cancelled=generationCancelled,records=[],importRepair=null)=>
    'W/"'+createHash('sha256').update(JSON.stringify([instanceId,fingerprint,guide,failure,cancelled,records,importRepair])).digest('base64url')+'"';
  const matchesStateTag=(header,tag)=>typeof header==='string'&&header.split(',').some(value=>{
    const candidate=value.trim();return candidate==='*'||candidate.replace(/^W\//,'')===tag.replace(/^W\//,'');
  });
  const discardPreparation=(error=new Error('The prepared print changed.'))=>{
    const previous=preparation;preparation=null;
    return previous?.dispose(error);
  };
  const cancelGeneration=async(reason='person')=>{
    const job=preparation;if(!job)return {cancelled:false,committing:false};
    const result=job.cancel();if(!result.cancelled)return {cancelled:false,committing:result.committing};
    generationCancelled={directory:job.directory,generationHash:job.generationHash};
    note('generation-cancelled',{generationHash:job.generationHash,reason});
    if(preparation===job)preparation=null;
    await result.done;return {cancelled:true,committing:false};
  };
  const cancelCalculation=async({jobId,generationHash,reason='person'}={})=>{
    if(importProgress){
      if(jobId!==importProgress.jobId)throw Error('The import changed. Read its current jobId before cancelling.');
      importController.abort(Object.assign(new Error('Import cancelled.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
      publishProgress();return {cancelled:true,kind:'import',jobId};
    }
    if(jobId||!generationHash||generationHash!==preparation?.generationHash)throw Error('The calculation changed. Read its current identity before cancelling.');
    return {...await cancelGeneration(reason),kind:'generation'};
  };
  const planPreparation=(state,readDir,session)=>{
    if(session.closed||!session.workerEnabled)return {action:'skip'};
    // Geometry-only reads deliberately omit program bytes. A matching saved
    // generation is enough to defer speculation; explicit review still checks
    // its bytes and will regenerate if that stored result is damaged.
    if(state.program||state.outputAvailability||state.review?.generation?.generationHash===state.generationHash&&!state.programError)return {action:'discard'};
    const key=readDir+':'+state.generationHash;
    return {action:session.currentKey===key?'reuse':'create',key};
  };
  const prepare=(state,readDir,{computationRequired=false}={})=>{
    const key=readDir+':'+state.generationHash;
    const decision=computationRequired
      ?(closed||resolveBundle!==bundleFor?{action:'skip'}:{action:preparation?.key===key?'reuse':'create',key})
      :planPreparation(state,readDir,{closed,workerEnabled:resolveBundle===bundleFor,currentKey:preparation?.key});
    if(decision.action==='skip')return null;
    if(decision.action==='discard'){discardPreparation();return null;}
    if(decision.action==='reuse')return preparation;
    discardPreparation();
    return preparation=new PreparedGenerationJob({key:decision.key,directory:readDir,generationHash:state.generationHash,
      createWorker:cancellation=>new Worker(new URL('./generation-worker.mjs',import.meta.url),
        {workerData:{directory:readDir,generationHash:state.generationHash,progress:true,cancellation}}),onUpdate:()=>publishProgress()});
  };
  // Only a real calculation is an event; a mode transition of a valid saved
  // program starts nothing the person or agent would wait on.
  const preparationStatus=()=>{
    if(importProgress)return {...importProgress,cancellable:!importController.signal.aborted,elapsedMs:Date.now()-importProgress.startedAt,estimatedRemainingMs:null};
    const job=preparation,run=generationRun;
    const progress=job?.progress??null,percent=progress?.total>0?Math.floor(100*progress.completed/progress.total):null;
    const directory=run?.directory??job?.directory??dir;
    return {studioInstanceId:instanceId,printId:directory&&printIdFor(directory),directory,generationHash:run?.generationHash??job?.generationHash??null,
      status:run?(job?.status==='preparing'?'preparing':'generating'):(job?.status??'idle'),cancellable:Boolean(job?.cancellable),error:job?.error??null,
      requested:Boolean(run),trigger:run?.trigger??null,startedAt:run?.startedAt??null,
      elapsedMs:run?Date.now()-run.startedAt:null,progress:progress?{...progress,percent}:null};
  };
  const activePreparationStatus=()=>{const status=preparationStatus();return status.requested||['preparing','generating','importing'].includes(status.status)?status:null;};
  const generationStatus=()=>{const status=activePreparationStatus();return status?{...status,printId:status.directory?requests.printId(status.directory,{optional:true}):null}:null;};
  const publishProgress=(status=activePreparationStatus())=>lifetime.notify('studio-update',{kind:'progress',status});
  const runImport=async(source,{name,units,directory,signal}={})=>{
    signal?.throwIfAborted();
    if(closed)throw Error('Studio is closing. Reopen it before importing.');
    if((await tour.info()).active)throw Error('Import STL is available after you finish or exit the tour.');
    await discardPreparation();
    signal?.throwIfAborted();
    importController=new AbortController();
    const controller=importController,abort=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    importProgress={studioInstanceId:instanceId,printId:dir?printId():null,directory:dir??null,jobId:randomBytes(16).toString('hex'),name:name??null,generationHash:null,status:'importing',startedAt:Date.now(),progress:{stage:'Checking your STL',phase:'import'}};publishProgress();
    note('import-started',{jobId:importProgress.jobId,name:name??null,units:units??null});
    let imported;
    try{imported=await importStudioSTL(libraryRoot,source,{name,units,directory,signal:importController.signal,
      onProgress:value=>{
        if(value.phase==='repair'&&importProgress.progress.phase!=='repair')note('import-repair-started',{jobId:importProgress.jobId,name:name??null,elapsedMs:Date.now()-importProgress.startedAt});
        importProgress={...importProgress,progress:value};publishProgress();
      }});}
    catch(error){note(importController.signal.aborted?'import-cancelled':'import-failed',{jobId:importProgress.jobId,name:name??null,error:error.message,elapsedMs:Date.now()-importProgress.startedAt});throw error;}
    finally{signal?.removeEventListener('abort',abort);const finished=importProgress;importProgress=null;importController=null;publishProgress({...finished,status:'idle',progress:null,cancellable:false});}
    await openPrint(imported.directory);
    note('import-completed',{name:await printName(dir),units:units??null});
    return imported;
  };
  const readGeneration=async current=>{
    generationCancelled=null;
    const directory=dir,state=(await readStableBundle(current,directory,{program:false})).state;
    if(state.inspection)throw Error('This inspection does not support print generation.');
    return {directory,state};
  };
  const beginGeneration=(snapshot,development,trigger)=>{
    if(generationRun)return;
    generationRun={directory:snapshot.directory,generationHash:snapshot.state.generationHash,trigger,development,startedAt:Date.now()};
    note('generation-started',{generationHash:snapshot.state.generationHash,development,trigger});
    publishProgress();
  };
  const executeGeneration=async(current,snapshot,development,trigger)=>{
    const {directory:generationDir,state}=snapshot;
    let calculated=false;
    const markCalculation=()=>{if(!calculated){calculated=true;beginGeneration(snapshot,development,trigger);}};
    async function dispatchComputation(execution){
      const {directory:executionDir,state:executionState}=execution;
      // A stopped worker needs restarting; a completed preparation diagnostic
      // is already useful and need not be recomputed on the first Continue.
      if(preparation?.status==='failed'&&(!preparation.worker||generationFailure?.directory===executionDir&&generationFailure.generationHash===executionState.generationHash))await discardPreparation();
      const job=prepare(executionState,executionDir,{computationRequired:true});
      if(!job)return execution.runLocally();
      if(job.status==='preparing')markCalculation();
      const checked=await job.generate(development,reservation);
      if(preparation===job)preparation=null;
      return checked;
    }
    const checks=await current.generateBundle(dir,{development,
      dispatchComputation:resolveBundle===bundleFor?dispatchComputation:undefined,
      onProgress:progress=>{if(progress.stage==='Preparing geometry')markCalculation();}});
    return {directory:generationDir,generationHash:state.generationHash,calculated,checks};
  };
  const publishGeneration=async(outcome,development,trigger)=>{
    generationFailure=null;
    if(outcome.calculated)note('generation-finished',{generationHash:outcome.generationHash,development,trigger,durationMs:Date.now()-generationRun.startedAt});
    const guide=await tour.info();
    if(guide.active&&guide.directory===outcome.directory&&guide.step===L.playback&&!guide.startAt)await tour.requestStartLayer();
  };
  const publishGenerationFailure=async(error,snapshot,trigger)=>{
      const {directory:generationDir,state}=snapshot;
      if(error.code==='GENERATION_CANCELLED')throw error;
      // Before the message reaches the page, the event queue and the failure
      // request, say whether this process is behind the files the worker read.
      await noteSourceSkew(error);
      const reported=reportedMessage(error);
      generationFailure={directory:generationDir,generationHash:state.generationHash,message:reported,stage:error.stage??'generation'};
      try{const record=await requests.begin({directory:generationDir,source:'studio',studioInstanceId:instanceId,
        key:'generation-failure:'+generationDir+':'+state.generationHash+':'+reported,
        instruction:(error.stage==='export'?'SAAMpath construction succeeded; machine export failed. Inspect the selected exporter and its representation requirements. Error: ':'Toolpath generation failed for this print. Inspect the current recipe and deposition inputs. Error: ')+reported+
          '\nDiagnose the cause before regenerating. Do not blindly retry unchanged inputs or relax quality limits to hide the failure. Explain material process changes to the maker, then verify the current result is displayed in Studio. Resolve this request after recovery, or report the concrete blocker.'});
        note('generation-failed',{generationHash:state.generationHash,trigger,error:reported,stage:error.stage??'generation',requestId:record.id});}
      finally{throw error;} // A notification failure must not hide the generation error.
  };
  const generate=async(current,development,trigger='generate')=>{
    const snapshot=await readGeneration(current);
    try{
      const outcome=await executeGeneration(current,snapshot,development,trigger);
      await publishGeneration(outcome,development,trigger);
    }catch(error){await publishGenerationFailure(error,snapshot,trigger);}
    finally{
      const finished=generationRun;generationRun=null;
      publishProgress(finished?{studioInstanceId:instanceId,printId:printIdFor(finished.directory),
        directory:finished.directory,generationHash:finished.generationHash,status:'idle',cancellable:false,progress:null}:null);
    }
  };
  const exportPrint=async(current,state,data,progress)=>{
    const name=requestedDownloadName(data.name,await printName(state.dir,state.plan),state.exportName);
    const delivered=await current.exportReviewed(state);
    const inTour=progress.active&&progress.directory===state.dir;
    if(inTour)await tour.downloaded(delivered.exportHash);
    note('export-delivered',{tour:inTour,name,exportHash:delivered.exportHash});
    return {...delivered,name};
  };
  const openPrint=async input=>{
    await opened;
    const next=await printDirectory(input,resolveBundle),adapter=await resolveBundle(next);
    await readStableBundle(adapter,next,{program:false});
    if(next!==dir){
      const claim=await claimBundleInstance(next,{instanceId,ownerId:sessionOwnerId});
      switching=true;
      try{await releaseInstance();discardPreparation();dir=next;reservation=claim;reservedDirectory=next;opened=Promise.resolve(adapter);}
      catch(error){await releaseBundleInstance(next,claim);throw error;}
      finally{switching=false;}
    }else opened=Promise.resolve(adapter);
  };
  // Called only by a human Studio action choosing the geometry to print.
  const validateGeometrySelection=async(adapter,seen)=>{
    const state=(await readStableBundle(adapter,dir,{program:false,live:true})).state;
    if(seen&&(seen.revision!==state.revision||seen.geometryHash!==state.geometryHash))throw Error('The geometry changed. Review the current shape before confirming.');
  };
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host;
    if(!/^127\.0\.0\.1:\d+$/.test(host??'')){res.writeHead(403);res.end('Localhost only.');return;}
    const origin=`http://${host}`;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
    const url=new URL(req.url,origin);
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try {
      if(req.method==='GET'&&url.pathname.startsWith('/api/download/')){
        if(req.headers.origin&&req.headers.origin!==origin){send({error:'Invalid local session'},403);return;}
        const staged=downloadLinks.get(url.pathname.slice('/api/download/'.length));
        if(!staged||staged.expiresAt<=Date.now()){send({error:'Download link expired or unavailable. Export the reviewed file again.'},404);return;}
        const {bytes}=staged;
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,
          'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(staged.name)}`,'Referrer-Policy':'no-referrer'});
        res.end(bytes);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/viewer'){
        if(url.searchParams.get('token')!==token||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid local session'},403);return;}
        lifetime.attach(res);
        if(!res.writableEnded)res.write(`event: agent-activity\ndata: ${JSON.stringify(agentActivity)}\n\n`);
        return;
      }
      if(req.method==='GET'&&url.pathname==='/') {
        const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token).replace('__RELAY__',relay?'on':'');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      if(req.method==='GET'&&['/work-state.mjs','/agent-ui.mjs','/tour-ui.mjs','/tour-catalog.mjs','/viewer-session.mjs','/view-performance.mjs','/refresh-plan.mjs','/viewer-renderer.mjs','/studio-state.mjs','/studio-controls.mjs','/relay-panel.mjs','/app.mjs','/playback.mjs','/camera.mjs','/toolpath-view.mjs','/mesh-view.mjs','/material-view.mjs','/machine-view.mjs','/settings.mjs','/style.css'].includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/struder-logo.png'){
        res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(resolve(here,'struder-logo.png')));return;
      }
      if(req.method==='GET'&&playerModules.has(url.pathname.slice(1))){
        res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,url.pathname.slice(1))));return;
      }
      if(url.pathname==='/api/relay'||url.pathname==='/api/relay/link-code'||url.pathname==='/api/relay/pair'||url.pathname==='/api/relay/update'||url.pathname==='/api/relay/quit'){
        // An invite pairs this computer, link codes pair a chat with it, and an
        // update replaces SAAM: the same session token and origin checks as
        // Studio's other routes guard them. Absent without a relay.
        const reading=req.method==='GET'&&url.pathname==='/api/relay',issuing=req.method==='POST'&&url.pathname==='/api/relay/link-code',pairing=req.method==='POST'&&url.pathname==='/api/relay/pair',updating=req.method==='POST'&&url.pathname==='/api/relay/update',quitting=req.method==='POST'&&url.pathname==='/api/relay/quit';
        if(!relay||!reading&&!issuing&&!pairing&&!updating&&!quitting){send({error:'Not found'},404);return;}
        if(req.headers['x-saam-token']!==token||(reading?req.headers.origin&&req.headers.origin!==origin:req.headers.origin!==origin)){send({error:'Invalid local session'},403);return;}
        if(reading){send(relayView(relay.status()));return;}
        if(pairing){
          const chunks=[];let size=0;
          for await(const chunk of req){size+=chunk.length;if(size>4_000)throw Error('Request too large.');chunks.push(chunk);}
          const {invite}=JSON.parse(Buffer.concat(chunks).toString()||'{}');
          try{send(await relay.pair(String(invite??'')));}catch(error){send({error:error.message},400);}
          return;
        }
        // Update or quit at an idle boundary: never under a running calculation.
        if((updating||quitting)&&['preparing','generating'].includes(generationStatus()?.status)){send({error:`Wait for the toolpath calculation to finish, then ${updating?'update':'quit'}.`},409);return;}
        if(updating){try{send(await relay.update());}catch(error){send({error:'SAAM could not update: '+error.message},502);}return;}
        if(quitting){try{send(await relay.quit());}catch(error){send({error:error.message},400);}return;}
        try{const {code,expiresAt}=await relay.linkCode();send({code,expiresAt});}
        catch(error){send({error:'The relay could not issue a code: '+error.message},502);}
        return;
      }
      if(req.method==='GET'&&url.pathname==='/api/tour'){send(await tour.info());return;}
      if(req.method==='GET'&&url.pathname==='/api/view-performance'){send({reports:viewPerformance});return;}
      if(req.method==='GET'&&url.pathname==='/api/agent-requests'){
        const workId=workIdFor(dir),records=workId?await requests.query({printId:workId}):[];
        send({requests:records.filter(record=>!record.studioInstanceId||record.studioInstanceId===instanceId)});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/agent-events'){
        // The owning agent's queue, readable across processes. A bounded wait
        // ends on a delivered event; held events wait for this read.
        if(url.searchParams.get('owner')!==sessionOwnerId||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid agent owner'},403);return;}
        const waitMs=Math.min(25000,Math.max(0,Number(url.searchParams.get('wait'))||0)),instance=url.searchParams.get('instance'),after=(url.searchParams.get('after')??'').split(',').filter(Boolean);
        const pendingRequests=async()=>(await requests.query({status:'queued'})).filter(record=>(!instance||record.studioInstanceId===instance)&&!after.includes(record.id));
        let queued=await pendingRequests();
        if(waitMs>0&&!queued.length&&!events.pendingDelivery()){await events.wait({waitMs,signal:closingPolls.signal});queued=await pendingRequests();}
        send({ownerId:sessionOwnerId,studioInstanceId:instanceId,requests:queued,events:events.drain(),generation:[generationStatus()].filter(Boolean),
          ...(url.searchParams.has('history')?{recent:events.history()}:{})});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/preparation'){
        send(preparationStatus());return;
      }
      if(req.method==='GET'&&url.pathname==='/api/prints'){
        const p=await tour.info(),prints=p.active
          ?(await Promise.all(Object.values(p.copies).map(name=>listPrints(resolve(libraryRoot,'tour',name),resolveBundle)))).flat()
          :await listPrints(libraryRoot,resolveBundle);
        send({prints});return;
      }
      if(req.method==='GET')await queue;
      // State without a print is empty rather than missing, so the page's checks log nothing.
      if(req.method==='GET'&&!dir){
        if(url.pathname==='/api/state'){res.writeHead(204);res.end();return;}
        const error=noPrint();send({error:error.message,code:error.code},404);return;
      }
      const readDir=dir,readId=dir&&printId();
      const bundle=await opened;
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const condition=req.headers['if-none-match'];
        const workId=requests.printId(readDir,{optional:true}),allRecords=workId?await requests.query({printId:workId}):[],records=allRecords.filter(record=>!record.studioInstanceId||record.studioInstanceId===instanceId),guide=await tour.info({records});
        const {state,fingerprint,presentationFingerprint}=await readStableBundle(bundle,readDir,{program:geometryOnly(guide)?false:'source'});
        if(readDir!==dir)throw new Error('The print is being updated.');
        const responseFingerprint=viewFingerprint(readId,fingerprint,guide),failure=generationFailure,cancelled=generationCancelled;
        const importRepair=await loadStudioImportRepair(readDir);
        if(readDir!==dir)throw new Error('The print is being updated.');
        const tag=stateTag(responseFingerprint,guide,failure,cancelled,records,importRepair);
        if(condition&&matchesStateTag(condition,tag)){res.setHeader('ETag',tag);res.writeHead(304);res.end();return;}
        const presentation=viewFingerprint(readId,presentationFingerprint,guide),name=await printName(readDir,state.plan);
        const assembled=composeStudioState(state,{directory:readDir,printId:readId,workId,instanceId,guide,records,importRepair,
          printName:name,fingerprint:responseFingerprint,presentationFingerprint:presentation,
          generationFailure:failure,generationCancelled:cancelled,now:Date.now()});
        if(state.checkedBytes){
          const snapshot=`${readId}:${state.revision}:${state.exportHash}`;
          const {dir,plan,revision,exportName,exportHash,checkedBytes}=state;
          displayedResults.set(snapshot,{bundle,state:{dir,plan,revision,exportName,exportHash,checkedBytes}});
          assembled.response.exportSnapshot=snapshot;
        }
        res.setHeader('ETag',tag);
        send(assembled.response);
        // Speculate only on the tour's explicitly selected, confirmed part.
        // Ordinary edits use explicit generation; starting a second worker here
        // competes with the agent and may slice inputs it is still changing.
        if(assembled.preparation)prepare(assembled.preparation.state,assembled.preparation.directory);
        return;
      }
      if(req.method==='GET'&&url.pathname==='/api/sources'){
        const {state}=await readStableBundle(bundle,readDir,{program:'source',allSources:true});
        if(readDir!==dir)throw new Error('The print is being updated.');
        for(const [key,value] of [['printId',readId],['revision',state.revision],['exportHash',state.exportHash]])
          if(url.searchParams.get(key)!==value)throw new Error('The reviewed program changed. Reload before continuing.');
        if(!state.program||state.programError)throw new Error(state.programError??'Generate the program first.');
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        for(const [name,text] of Object.entries(state.sources)){
          if(res.destroyed)return;
          if(!res.write(JSON.stringify({name,text})+'\n'))await new Promise(done=>{
            const finish=()=>{res.off('drain',finish);res.off('close',finish);done();};res.once('drain',finish);res.once('close',finish);
          });
        }
        res.end();return;
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(url.pathname==='/api/agent-open'||url.pathname==='/api/agent-cancel-calculation'||url.pathname==='/api/agent-import-stl'){
        // The owning agent shows another print in this instance from any process,
        // so switching prints needs no second Studio.
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>64_000)throw Error('Request too large.');chunks.push(chunk);}
        const data=JSON.parse(Buffer.concat(chunks).toString()||'{}');
        if(data.owner!==sessionOwnerId||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid agent owner'},403);return;}
        if(url.pathname==='/api/agent-cancel-calculation'){send(await cancelCalculation({...data,reason:'agent'}));return;}
        if(url.pathname==='/api/agent-import-stl'){
          const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort(Object.assign(Error('Import cancelled because its requesting agent disconnected.'),{name:'AbortError'}));};
          res.once('close',disconnect);
          try{send(await server.importSTL(data,{signal:controller.signal}));}finally{res.off('close',disconnect);}return;
        }
        await server.openPrint(data.path);send(server.agentSession());return;
      }
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      // A print, once open, stays open, so this check cannot go stale in the queue.
      if(!dir&&!printFreeRoutes.has(url.pathname))throw noPrint();
      const importing=url.pathname==='/api/import-stl',chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>(importing?64*1024*1024:64_000))throw Error('Request too large.');chunks.push(chunk);}
      const body=Buffer.concat(chunks),data=importing?Object.fromEntries(url.searchParams):JSON.parse(body.toString()||'{}');
      // Browser-measured view bursts, kept in memory for an agent to read.
      if(url.pathname==='/api/view-performance'){viewPerformance.push({receivedAt:new Date().toISOString(),...data});viewPerformance.splice(0,viewPerformance.length-20);send({ok:true});return;}
      if(url.pathname==='/api/cancel-generation'){
        if(data.printId!==printId()||!data.generationHash||data.generationHash!==preparation?.generationHash)throw Error('The calculation changed. Refresh before cancelling.');
        send(await cancelGeneration());return;
      }
      if(url.pathname==='/api/cancel-calculation'){
        send(await cancelCalculation(data));return;
      }
      if(url.pathname==='/api/export'){
        const run=queue.then(async()=>{
          const captured=displayedResults.get(data.exportSnapshot);
          if(!captured||captured.state.dir!==dir||captured.bundle!==await opened)
            throw Error('The displayed program changed. Reload before exporting.');
          const live=(await readStableBundle(captured.bundle,dir,{program:false})).state;
          if(live.revision!==captured.state.revision||
            live.review.generation?.exportHash!==captured.state.exportHash||
            live.review.generation?.generationHash!==live.generationHash||
            live.review.generation?.mode!=='production')
            throw Error('The displayed program changed. Reload before exporting.');
          const currentBytes=await readFile(resolve(dir,live.review.generation.file));
          if(createHash('sha256').update(currentBytes).digest('hex')!==captured.state.exportHash)
            throw Error('The displayed program changed. Reload before exporting.');
          return exportPrint(captured.bundle,captured.state,data,await tour.info());
        });
        queue=run.catch(()=>{});
        const delivered=await run;
        if(data.downloadLink===true){send(stageDownload(delivered));return;}
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(delivered.name)}`});res.end(delivered.bytes);return;
      }
      const run=queue.then(async()=>{
        if(data.printId&&data.printId!==printId())throw new Error('The open print changed. Reload before continuing.');
        const current=await opened;
        const progress=await tour.info();
        if(importing){
          await runImport(body,{name:data.name,units:data.units});
          send({ok:true});return;
        }
        if(url.pathname==='/api/view-ready'){
          let presentedRequests=[];
          const stage=data.stage??(progress.step===L.geometry?'geometry':'toolpath');
          if(!['geometry','toolpath'].includes(stage))throw Error('Unknown displayed stage.');
          const state=(await readStableBundle(current,dir,{program:stage==='geometry'?false:'source'})).state;
          if(data.revision===state.revision&&(stage==='geometry'||state.program&&!state.programError&&data.exportHash===state.exportHash)){
            presentedRequests=await requests.presented(dir,{...workSnapshot(state),stage,studioInstanceId:instanceId});
            note('view-presented',{stage,revision:state.revision,exportHash:stage==='toolpath'?state.exportHash??null:null,presentedRequestIds:presentedRequests.map(record=>record.id)});
            for(const record of presentedRequests)note('request-presented',{requestId:record.id,requestKind:record.kind,stage});
            const advisory=state.program?.summary?.shortTravel;
            if(stage==='toolpath'&&advisory?.count&&requests.printId(dir,{optional:true}))
              await requests.begin({directory:dir,source:'studio',kind:'advisory',studioInstanceId:instanceId,
                key:`short-travel:${dir}:${state.exportHash}`,
                evidence:{exportHash:state.exportHash,generationHash:state.generationHash,skills:state.skills,shortTravel:advisory},
                instruction:`Toolpath quality advisory for export ${state.exportHash}: ${advisory.message}\n`+
                  `Affected recipe skills: ${(state.skills??[]).join(', ')}. This notification preserves source locations and operation counts in evidence.shortTravel. `+
                  'Mention this finding to the person in your next reply, then acknowledge this advisory as completed and continue the current user task; no repair or new approval is required.'});
          }
          send({...await tour.acknowledgeView(dir,data,state),presentedRequests});return;
        }
        if(url.pathname==='/api/agent-request'){
          send(await requests.begin({directory:dir,source:'studio',kind:'guidance',studioInstanceId:instanceId,instruction:'The person requests help with '+await printName(dir)+'. '+(progress.active&&progress.directory===dir?progress.agentInstruction??'Help with the current tour lesson.':'Ask what change they want.')}));return;
        }
        if(url.pathname==='/api/tour-playback'){
          if(!['play','pause','tick'].includes(data.event))throw Error('Unknown playback event');
          const played=await tour.playback(data.event);if(data.event!=='tick')note('tour-playback',{event:data.event,step:played.step});send(played);return;
        }
        if(url.pathname==='/api/tour'){
          // This button explicitly selects the displayed part without turning
          // navigation into a separate approval stage.
          if(data.action==='step'&&progress.step===L.import&&data.step===L.playback)
            await validateGeometrySelection(current,data);
          const ending=['exit','cancel','finish'].includes(data.action);
          const result=await tour.action(data.action,data.step);
          if(ending&&dir)await useExample(dir);
          if(!ending&&result.directory&&resolve(result.directory)!==dir)await openPrint(result.directory);
          const lesson=TOUR_STEPS[result.data.step];
          note(data.action==='fresh'?'tour-started':data.action==='step'?'tour-lesson':data.action==='finish'?'tour-finished':'tour-exited',
            {action:data.action,step:result.data.step,lesson:lesson?{title:lesson.title,tab:lesson.tab,gate:lesson.gate??null}:null,runId:result.data.runId,lessonId:result.data.lessonId,
             active:result.data.active,completed:result.data.completed,canNext:result.data.canNext,agentInstruction:result.data.agentInstruction??null});
          if(result.directory&&result.data.active&&TOUR_STEPS[result.data.step].tab==='toolpath'){
            const adapter=await opened,state=(await readStableBundle(adapter,dir,{program:'source'})).state;
            if(!state.program||state.programError)await runBundleEdit(dir,()=>generate(adapter,false,'tour-step'));
            if(result.data.step===L.playback&&!result.data.startAt)await tour.requestStartLayer();
          }
        }
        else if(url.pathname==='/api/use-example'){
          if(progress.active)throw Error('Exit the tour first.');
          if(!await tourExample(dir))throw Error('This print is already using the normal workflow.');
          await useExample(dir);note('example-adopted',{});
        }
        else if(url.pathname==='/api/open'){
          const selected=await printDirectory(data.path,resolveBundle);
          if(progress.active)await tour.select(selected);
          await openPrint(selected);
          const adapter=await opened,state=(await readStableBundle(adapter,dir,{program:progress.active?false:'source'})).state;
          // Geometry stays visible in the STL lesson while a worker prepares its
          // selected part. Continuing commits this exact candidate.
          if(progress.active)prepare(state,dir);
          note('print-opened',{name:await printName(dir,state.plan),tour:progress.active,revision:state.revision});
        }
        else if(url.pathname==='/api/history'){
          if(progress.active)throw Error('Exit the tour before restoring edits.');
          const updated=await runBundleEdit(dir,()=>current.restoreRevision(dir,{direction:data.direction,expectedRevision:data.revision}));
          note('plan-updated',{revision:updated.revision,history:data.direction});
        }
        else if(url.pathname==='/api/plan'){
          const updated=await runBundleEdit(dir,()=>current.updatePlan(dir,data.plan,data.revision)),edit=updated?.review?.history?.at(-1);
          const changes=updated?.revision!==data.revision&&edit?.event==='plan-edited'?edit.changes??[]:[];
          note('plan-updated',{revision:data.revision??null,changes});
        }
        else if(url.pathname==='/api/generate'){
          if(data.generationHash&&((await readStableBundle(current,dir,{program:false})).state).generationHash!==data.generationHash)throw Error('The print changed before generation. Review the updated print.');
          await runBundleEdit(dir,()=>generate(current,data.development===true));
        }
        else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent){await noteSourceSkew(error);send({error:reportedMessage(error),code:error.code},400);}else res.end();}
  });
  // Local adapters reopen through the same serialized and validated operation
  // as the picker, including when the person changed this viewer's print.
  server.openPrint=input=>{
    const run=queue.then(async()=>{const before=dir;await openPrint(input);if(dir!==before)lifetime.notify('studio-update',{kind:'state',kinds:['print']});});
    queue=run.catch(()=>{});return run;
  };
  server.importSTL=({directory,source,units},{signal}={})=>{
    const run=queue.then(()=>{
      if(typeof directory!=='string'||typeof source!=='string')throw Error('Import needs a destination and local STL path.');
      return runImport(resolve(source),{name:basename(source),directory,units,signal});
    });
    queue=run.catch(()=>{});return run;
  };
  server.setStartAt=startAt=>tour.setStartAt(startAt);
  server.currentPrint=()=>dir;
  const lifetime=viewerLifetime(server,{disconnectMs,onViewers:count=>note(count?'viewer-opened':'viewer-closed',{viewers:count}),onClosing:()=>{
    closed=true;closingPolls.abort();importController?.abort(Object.assign(Error('Import cancelled because Studio closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
  },
    onShutdown:async()=>{try{importController?.abort(Object.assign(Error('Import cancelled because Studio closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));await opened.catch(()=>{});await queue;await releaseInstance();await tour.closeStudio();}finally{tour.close();if(ownsRequests||closeAgentRequests)requests.close();if(ownsEvents)events.close();}}});
  const stopRequestFeed=requests.subscribe(record=>{
    if(record.source==='studio'&&record.status==='queued'&&record.studioInstanceId===instanceId&&!queuedNoted.has(record.id)){
      queuedNoted.add(record.id);note('request-queued',{requestId:record.id,requestKind:record.kind,instruction:record.instruction,scope:record.scope??null,printId:record.printId});
    }
    if((!record.studioInstanceId||record.studioInstanceId===instanceId)&&record.printId===workIdFor(dir))lifetime.notify('studio-update',{kind:'state',kinds:['requests'],instanceId});
  });
  let checkingGeneration=false;
  const stopWatching=watchStudioChanges(libraryRoot,kinds=>{
    const external=kinds.filter(kind=>kind!=='requests');
    if(external.length)lifetime.notify('studio-update',{kind:'state',kinds:external});
    const job=preparation;
    if(kinds.includes('print')&&job?.cancellable&&!checkingGeneration){
      checkingGeneration=true;
      void resolveBundle(job.directory).then(adapter=>readStableBundle(adapter,job.directory,{program:false})).then(({state})=>{
        if(preparation===job&&state.generationHash!==job.generationHash)return cancelGeneration('inputs-changed');
      }).catch(()=>{/* A partial external write will be rechecked at commit. */}).finally(()=>{checkingGeneration=false;});
    }
  });
  server.once('close',()=>{closed=true;stopWatching();stopRequestFeed();discardPreparation();void releaseInstance().catch(error=>note('instance-release-failed',{error:error.message}));});
  server.shutdown=lifetime.shutdown;server.viewerCount=lifetime.viewers;
  server.agentWorking=working=>{agentActivity.working=Boolean(working);lifetime.notify('agent-activity',agentActivity);};
  server.studioEvents=events;server.generationStatus=generationStatus;
  server.cancelCalculation=cancelCalculation;
  server.runBundleEdit=runBundleEdit;
  server.ready=()=>opened;
  server.agentSession=()=>({instanceId,ownerId:sessionOwnerId,printId:workIdFor(dir),directory:dir,connected:!closed});
  server.agentDisconnected=async ownerId=>lifetime.notify('agent-connection-closed',{ownerId,closedAt:Date.now(),requests:await requests.query()});
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--toolkit') {
  const command=process.argv[3];
  if(!['start-tour','open-print','create-preview'].includes(command)) {
    console.error('Use --toolkit start-tour, open-print or create-preview. Other toolkit commands use scripts/agent-toolkit.mjs.');
    process.exitCode=1;
  } else {
    // Keep the existing permission-scoped launcher and managed server lifetime.
    // Do not await dynamic import here: the toolkit lazily imports this module.
    import('../scripts/agent-toolkit.mjs').then(({runCLI})=>runCLI(process.argv.slice(3))).catch(error=>{console.error(error.message);process.exitCode=1;});
  }
} else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),startIndex=args.indexOf('--start-at-layer');
  const startAt=startIndex<0?null:{layer:Number(args[startIndex+1])};if(startIndex>=0)args.splice(startIndex,2);
  const [requested]=args;
  const guide=createTour(resolve(root,'Prints'));
  const dir=requested?resolve(requested):(await guide.action('fresh')).directory;
  if(startAt)await guide.setStartAt(startAt);
  const bundle=await bundleFor(dir);
  await readStableBundle(bundle,dir,{program:false});
  const server=createStudio(dir),port=Number(process.env.SAAM_STUDIO_PORT??0);
  try{await server.ready();}catch(error){await server.shutdown().catch(()=>{});throw error;}
  server.listen(port,'127.0.0.1',()=>console.log(`SAAM Studio: http://127.0.0.1:${server.address().port}\nPrint: ${dir}\nNo deadline to open. Closes ${DEFAULT_DISCONNECT_MS/60000} minutes after the last viewer disconnects.`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.shutdown());
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
