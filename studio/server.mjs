import {createTour,tourExample,useExample} from './tour.mjs';
import {bundleFor,readStableBundle,supportsBundleSchema} from './adapter-resolution.mjs';
import {TOUR_STEPS,TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createAgentRequests} from './agent-requests.mjs';
import {composeStudioState} from './state-response.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';
import {resolvePhaseColours} from '../core/print/phase-colours.mjs';
import {printName,downloadName,requestedDownloadName} from './print-name.mjs';
import {importStudioSTL,loadStudioImportRepair} from './import-stl.mjs';
import http from 'node:http';
import {watchStudioChanges} from './changes.mjs';
import {createStudioEvents} from './studio-events.mjs';
import { readFile, readdir, stat, realpath, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {PreparedGenerationJob} from './prepared-generation-job.mjs';
import {claimBundleInstance,releaseBundleInstance,reassignBundleInstance,withBundleInstance,bundleInstance} from '../core/print/studio-ownership.mjs';
import { viewerLifetime } from './lifetime.mjs';


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
const playerModules=new Set(['core/private/studio/numeric.mjs','core/geom/frame.mjs',
  'core/private/export/numeric.mjs','core/private/export/temperature.mjs','core/private/toolpath/numeric.mjs',
  'studio/source-player.mjs','studio/source-worker.mjs','studio/move-store.mjs',
  'studio/machine-session.mjs','studio/machine-view.mjs','core/export/source-time.mjs','core/export/machine-study.mjs',
  'core/machine/presentation.mjs','core/machine/jog.mjs',
  'core/machine/dobot-kinematics.mjs','core/machine/denso-kinematics.mjs',
  'core/print/review-state.mjs','core/print/phase-colours.mjs',
  'core/export/denso-player.mjs','core/machine/denso.mjs','core/path/pose.mjs','core/path/action-context.mjs',
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
// localPhaseColours reads the home's phase-colour preference.
export function createStudio(directory,{libraryRoot,machineSetups,localPhaseColours=async()=>null,resolveBundle=bundleFor,agentOwnerId,agentRequests,studioEvents,relay,requestFolder,chatName,chatClient,instanceId=randomBytes(16).toString('hex'),sessionToken,restoring=false,runtimeId,runtimeLabel,fingerprint,routeStudio}) {
  const initialOwnerId=agentOwnerId??agentRequests?.ownerId??`studio:${instanceId}`;
  if(agentRequests?.ownerId&&agentRequests.ownerId!==initialOwnerId)throw Error('The request store belongs to another chat.');
  const initialRequests=agentRequests??createAgentRequests(libraryRoot,{ownerId:initialOwnerId,folder:requestFolder});
  const initialEvents=studioEvents??createStudioEvents();
  const ownedRequests=new Set(agentRequests?[]:[initialRequests]),ownedEvents=new Set(studioEvents?[]:[initialEvents]);
  const chat={current:{ownerId:initialOwnerId,requests:initialRequests,events:initialEvents,
    tour:createTour(libraryRoot,{ownerId:initialOwnerId,studioId:instanceId,agentRequests:initialRequests}),
    attached:initialOwnerId.startsWith('studio:')?null:Object.freeze({ownerId:initialOwnerId,name:chatName??initialOwnerId,client:chatClient??null})},
    stopRequestFeed:null};
  const geometryOnly=guide=>guide.active&&guide.directory===dir&&guide.step<L.playback;
  const viewFingerprint=(id,fingerprint,guide)=>id+fingerprint+(geometryOnly(guide)?':geometry':':program');
  let dir=directory?resolve(directory):null;
  const token=sessionToken??randomBytes(24).toString('hex'),viewPerformance=[];
  const workIdFor=directory=>directory?chat.current.requests.printId(directory,{optional:true}):null;
  // Studio observations for the owning agent: person-driven actions, worker
  // outcomes and displayed results, tagged with this instance and its print.
  const queuedNoted=new Set();
  const note=(kind,detail={})=>chat.current.events.record(kind,{studioInstanceId:instanceId,printId:workIdFor(dir),directory:dir,...detail});
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
  const operations={active:0,creating:false};
  function queueOperation(action){
    operations.active++;
    const run=queue.then(action).finally(()=>{operations.active--;});
    queue=run.catch(()=>{});return run;
  }
  let editTail=Promise.resolve(),reservation=null,reservedDirectory=null,switching=false;
  // Association reserves this bundle before the instance becomes usable.
  // A Studio without a print remains unreserved until it opens one.
  let opened=dir?(async()=>{
    const selected=dir,adapter=await resolveBundle(selected);
    await readStableBundle(adapter,selected,{program:false});
    const claim=await claimBundleInstance(selected,{instanceId,ownerId:chat.current.ownerId,restoring,runtimeId,runtimeLabel});
    try{await chat.current.tour.attachStudio(selected);}
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
  const runBundleCreation=(target,action,{fresh=true}={})=>{
    const selected=resolve(target);
    const run=editTail.then(async()=>{
      await opened;
      // A reused window leaves its print for the bundle being created.
      if(dir&&dir!==selected){
        if(operations.active||(await chat.current.tour.info()).active)throw Error('The Studio changed before bundle creation.');
        if(reservation&&reservedDirectory===dir){await releaseBundleInstance(dir,reservation);reservation=null;reservedDirectory=null;}
        discardPreparation();dir=null;opened=Promise.resolve(null);lifetime.notify('studio-update',{kind:'state',kinds:['print']});
      }
      const previous=reservation&&reservedDirectory===selected?await bundleInstance(selected):null;
      if(previous?.token!==reservation?.token){reservation=null;reservedDirectory=null;}
      if(!reservation&&fresh){await mkdir(dirname(selected),{recursive:true});await mkdir(selected);}
      const claim=reservation??await claimBundleInstance(selected,{instanceId,ownerId:chat.current.ownerId,restoring,runtimeId,runtimeLabel});
      reservation=claim;reservedDirectory=selected;operations.active++;operations.creating=true;
      try{return await withBundleInstance(selected,claim,()=>action(claim));}
      finally{operations.creating=false;operations.active--;}
    });
    editTail=run.catch(()=>{});return run;
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
  let preparation,generationFailure,generationCancelled,importProgress,importController,generationRun=null,externalGeneration=null,closed=false;
  const outputGenerating=()=>Boolean(generationRun?.directory===dir||externalGeneration?.directory===dir);
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
  const prepare=(state,readDir)=>{
    if(closed||resolveBundle!==bundleFor)return null;
    const key=readDir+':'+state.generationHash+':'+state.revision;
    if(preparation?.key===key)return preparation;
    discardPreparation();
    return preparation=new PreparedGenerationJob({key,directory:readDir,generationHash:state.generationHash,
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
  const generationStatus=()=>{const status=activePreparationStatus();return status?{...status,printId:status.directory?chat.current.requests.printId(status.directory,{optional:true}):null}:null;};
  const publishProgress=(status=activePreparationStatus())=>lifetime.notify('studio-update',{kind:'progress',status});
  const runImport=async(source,{name,units,directory,signal}={})=>{
    signal?.throwIfAborted();
    if(closed)throw Error('Studio is closing. Reopen it before importing.');
    if((await chat.current.tour.info()).active)throw Error('Import STL is available after you finish or exit the tour.');
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
    catch(error){note(importController.signal.aborted?'import-cancelled':'import-failed',{jobId:importProgress.jobId,name:name??null,error:error.message,importDiagnostic:error.importDiagnostic??{stage:importProgress.progress.phase??'import',failure:{name:error.name,code:error.code??null,message:error.message}},elapsedMs:Date.now()-importProgress.startedAt});throw error;}
    finally{signal?.removeEventListener('abort',abort);const finished=importProgress;importProgress=null;importController=null;publishProgress({...finished,status:'idle',progress:null,cancellable:false});}
    await openPrint(imported.directory);
    note('import-completed',{name:await printName(dir),units:units??null,importDiagnostic:imported.importDiagnostic});
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
    async function dispatchComputation({directory:executionDir,generationHash}){
      // A stopped worker needs restarting; a completed preparation diagnostic
      // is already useful and need not be recomputed on the first Continue.
      if(preparation?.status==='failed'&&(!preparation.worker||generationFailure?.directory===executionDir&&generationFailure.generationHash===generationHash))await discardPreparation();
      const executionState=(await readStableBundle(current,executionDir,{program:false})).state;
      const job=prepare(executionState,executionDir);
      if(!job)return null;
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
  };
  const publishGenerationFailure=async(error,snapshot,trigger)=>{
      const {directory:generationDir,state}=snapshot;
      if(error.code==='GENERATION_CANCELLED')throw error;
      // Before the message reaches the page, the event queue and the failure
      // request, say whether this process is behind the files the worker read.
      await noteSourceSkew(error);
      const reported=reportedMessage(error);
      generationFailure={directory:generationDir,generationHash:state.generationHash,message:reported,stage:error.stage??'generation'};
      try{const record=await chat.current.requests.begin({directory:generationDir,source:'studio',studioInstanceId:instanceId,
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
    const delivered=await runBundleEdit(state.dir,()=>current.exportReviewed(state,{machineSetups}));
    const inTour=progress.active&&progress.directory===state.dir;
    if(inTour)await chat.current.tour.downloaded(delivered.exportHash);
    note('export-delivered',{tour:inTour,name,exportHash:delivered.exportHash});
    return {...delivered,name};
  };
  const openPrint=async input=>{
    await opened;
    const next=await printDirectory(input,resolveBundle),adapter=await resolveBundle(next);
    await readStableBundle(adapter,next,{program:false});
    if(next!==dir&&reservation&&reservedDirectory===next){discardPreparation();dir=next;opened=Promise.resolve(adapter);return;}
    if(next!==dir){
      const claim=await claimBundleInstance(next,{instanceId,ownerId:chat.current.ownerId,restoring,runtimeId,runtimeLabel});
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
        res.write('event: runtime-code\ndata: '+JSON.stringify({fingerprint})+'\n\n');
        return;
      }
      if(req.method==='GET'&&url.pathname==='/') {
        const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token).replace('__SERVICE__',relay?'on':'').replace('</head>', '<meta name="saam-runtime" content="'+encodeURIComponent(fingerprint??'')+'"></head>').replace('<title>', '<title>'+ (runtimeLabel?escapeTitle(runtimeLabel)+' · ':''));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      if(req.method==='GET'&&['/work-state.mjs','/agent-ui.mjs','/chat-ui.mjs','/tour-ui.mjs','/tour-catalog.mjs','/viewer-session.mjs','/view-performance.mjs','/refresh-plan.mjs','/viewer-renderer.mjs','/studio-state.mjs','/studio-controls.mjs','/neutral-path.mjs','/service-panel.mjs','/app.mjs','/playback.mjs','/camera.mjs','/toolpath-view.mjs','/mesh-view.mjs','/material-view.mjs','/machine-view.mjs','/settings.mjs','/style.css'].includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/struder-logo.png'){
        res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(resolve(here,'struder-logo.png')));return;
      }
      if(req.method==='GET'&&playerModules.has(url.pathname.slice(1))){
        res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,url.pathname.slice(1))));return;
      }
      if(url.pathname==='/api/service'||url.pathname.startsWith('/api/service/')){
        // The optional release service never gates local making or viewing.
        // Mutations use the same local token and origin checks as Studio edits.
        const reading=req.method==='GET'&&url.pathname==='/api/service';
        const action=req.method==='POST'?url.pathname.slice('/api/service/'.length):null;
        if(!relay||!reading&&!['activate','dismiss','check-update','update','quit','report'].includes(action)){send({error:'Not found'},404);return;}
        if(req.headers['x-saam-token']!==token||(reading?req.headers.origin&&req.headers.origin!==origin:req.headers.origin!==origin)){send({error:'Invalid local session'},403);return;}
        if(reading){send(await relay.status());return;}
        if(action==='activate'){
          const {invite}=await serviceInput(req);
          try{send(await relay.activate(String(invite??'')));}catch(error){send({error:error.message},400);}
          return;
        }
        if(action==='report'){
          // The report names the window and print it came from; the person's text is all it adds.
          const {description,stage}=await serviceInput(req);
          const studio={studioInstanceId:instanceId,printId:workIdFor(dir),runtimeId:runtimeId??null,runtimeLabel:runtimeLabel??null,stage:['geometry','toolpath'].includes(stage)?stage:null};
          try{send(await relay.report({description:String(description??''),studio}));}catch(error){send({error:error.message},400);}
          return;
        }
        if(action==='dismiss'){try{send(await relay.dismissFirstRun());}catch(error){send({error:error.message},500);}return;}
        if(action==='check-update'){try{await relay.checkUpdate();send(await relay.status());}catch(error){send({error:error.message},502);}return;}
        if(action==='update'){try{send(await relay.update(await serviceInput(req)));}catch(error){send({error:'SAAM could not update: '+error.message},502);}return;}
        if(action==='quit'){try{send(await relay.quit(await serviceInput(req)));}catch(error){send({error:error.message},400);}return;}
        return;
      }
      if(req.method==='GET'&&url.pathname==='/api/chat'){
        send({instanceId,attachment:server.attachment()});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/tour'){send(await chat.current.tour.info());return;}
      if(req.method==='GET'&&url.pathname==='/api/view-performance'){send({reports:viewPerformance});return;}
      if(req.method==='GET'&&url.pathname==='/api/agent-requests'){
        const workId=workIdFor(dir),records=workId?await chat.current.requests.query({printId:workId}):[];
        send({requests:records.filter(record=>!record.studioInstanceId||record.studioInstanceId===instanceId)});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/preparation'){
        send(preparationStatus());return;
      }
      if(req.method==='GET'&&url.pathname==='/api/prints'){
        const p=await chat.current.tour.info(),prints=p.active
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
      if(req.method==='GET'&&url.pathname==='/api/neutral-path'){
        const {state}=await readStableBundle(bundle,readDir,{program:false});
        const artifact=state.review?.path;
        if(readDir!==dir||url.searchParams.get('printId')!==readId||url.searchParams.get('revision')!==String(state.revision)
          ||state.artifacts.path!=='current'||!artifact||url.searchParams.get('pathHash')!==artifact.hash)
          throw Error('The saved SAAMpath changed. Reload before viewing.');
        const bytes=await bundle.readToolpath(state);
        res.writeHead(200,{'Content-Type':'application/json','Content-Length':bytes.length});res.end(bytes);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const condition=req.headers['if-none-match'];
        const workId=chat.current.requests.printId(readDir,{optional:true}),allRecords=workId?await chat.current.requests.query({printId:workId}):[],records=allRecords.filter(record=>!record.studioInstanceId||record.studioInstanceId===instanceId),guide=await chat.current.tour.info({records});
        const [{state,fingerprint,presentationFingerprint},example]=await Promise.all([
          readStableBundle(bundle,readDir,{program:geometryOnly(guide)?false:'source'}),tourExample(readDir)]);
        if(readDir!==dir)throw new Error('The print is being updated.');
        const responseFingerprint=viewFingerprint(readId,example?`${fingerprint}:tour:${example.id}`:fingerprint,guide),failure=generationFailure,cancelled=generationCancelled;
        const importRepair=await loadStudioImportRepair(readDir);
        const local=await localPhaseColours().then(colours=>({colours}),error=>({problem:'Local phase colours ignored: '+error.message}));
        const phasePalette=resolvePhaseColours(state.phaseColours,local.colours);
        if(readDir!==dir)throw new Error('The print is being updated.');
        const tag=stateTag(responseFingerprint+':output-generating:'+outputGenerating()+':'+JSON.stringify(phasePalette),guide,failure,cancelled,records,importRepair);
        if(condition&&matchesStateTag(condition,tag)){res.setHeader('ETag',tag);res.writeHead(304);res.end();return;}
        const presentation=viewFingerprint(readId,presentationFingerprint,guide),name=await printName(readDir,state.plan);
        const assembled=composeStudioState(state,{directory:readDir,printId:readId,workId,instanceId,guide,example,records,importRepair,
          printName:name,fingerprint:responseFingerprint,presentationFingerprint:presentation,
          generationFailure:failure,generationCancelled:cancelled,outputGenerating:outputGenerating(),phasePalette,phasePaletteProblem:local.problem});
        if(state.checkedBytes){
          const output=state.completedOutput,snapshot=`${readId}:${output.id}`;
          const {dir,checkedBytes}=state;
          for(const key of displayedResults.keys())if(key!==snapshot)displayedResults.delete(key);
          displayedResults.set(snapshot,{bundle,state:{dir,plan:output.plan,machine:output.machine,revision:output.id,completedOutput:output,
            exportName:output.exportName,exportHash:output.exportHash,checkedBytes}});
          assembled.exportSnapshot=snapshot;
        }
        res.setHeader('ETag',tag);
        send(assembled);
        return;
      }
      if(req.method==='GET'&&url.pathname==='/api/sources'){
        const {state}=await readStableBundle(bundle,readDir,{program:'source',allSources:true});
        if(readDir!==dir)throw new Error('The print is being updated.');
        for(const [key,value] of [['printId',readId],['revision',state.completedOutput?.id],['exportHash',state.exportHash]])
          if(url.searchParams.get(key)!==value)throw new Error('The reviewed program changed. Reload before continuing.');
        if(!completedOutputState(state).available)throw new Error(state.programError??'Generate the program first.');
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
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      if(operations.creating&&url.pathname!=='/api/cancel-calculation')throw Error('The print is being created. Wait for the current operation before changing Studio.');
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
        if(outputGenerating())throw Error('Wait for toolpath generation to finish before exporting.');
        const run=queueOperation(async()=>{
          const captured=displayedResults.get(data.exportSnapshot);
          if(!captured||captured.state.dir!==dir||captured.bundle!==await opened)
            throw Error('The displayed program changed. Reload before exporting.');
          if(outputGenerating())throw Error('Wait for toolpath generation to finish before exporting.');
          return exportPrint(captured.bundle,captured.state,data,await chat.current.tour.info());
        });
        queue=run.catch(()=>{});
        const delivered=await run;
        if(data.downloadLink===true){send(stageDownload(delivered));return;}
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(delivered.name)}`});res.end(delivered.bytes);return;
      }
      const run=queueOperation(async()=>{
        if(data.printId&&data.printId!==printId())throw new Error('The open print changed. Reload before continuing.');
        const current=await opened;
        const progress=await chat.current.tour.info();
        if(importing){
          await runImport(body,{name:data.name,units:data.units});
          send({ok:true});return;
        }
        if(url.pathname==='/api/view-ready'){
          let presentedRequests=[];
          const stage=data.stage??(progress.step===L.geometry?'geometry':'toolpath');
          if(!['geometry','toolpath'].includes(stage))throw Error('Unknown displayed stage.');
          const state=(await readStableBundle(current,dir,{program:stage==='geometry'?false:'source'})).state;
          const receiptable=stage==='geometry'||completedOutputState(state,{generating:outputGenerating()}).receipt;
          const inspectable=stage==='geometry'||completedOutputState(state,{generating:outputGenerating()}).available;
          const renderError=typeof data.renderError==='string'?data.renderError.slice(0,2000):null;
          if(data.revision===state.revision&&(inspectable||renderError)&&(stage==='geometry'||data.exportHash===state.exportHash)){
            presentedRequests=await chat.current.requests.presented(dir,{...state.workEvidence,stage,studioInstanceId:instanceId,deliverable:receiptable&&!renderError,renderError});
            note(renderError?'view-failed':'view-presented',{...(renderError?{error:renderError}:{}),stage,revision:state.revision,exportHash:stage==='toolpath'?state.exportHash??null:null,presentedRequestIds:presentedRequests.map(record=>record.id)});
            for(const record of presentedRequests)if(!record.inspectionFailed)note('request-presented',{requestId:record.id,requestKind:record.kind,stage});
            const advisory=state.program?.summary?.shortTravel;
            if(!renderError&&stage==='toolpath'&&advisory?.count&&chat.current.requests.printId(dir,{optional:true}))
              await chat.current.requests.begin({directory:dir,source:'studio',kind:'advisory',studioInstanceId:instanceId,
                key:`short-travel:${dir}:${state.exportHash}`,
                evidence:{exportHash:state.exportHash,generationHash:state.generationHash,skills:state.skills,shortTravel:advisory},
                instruction:`Toolpath quality advisory for export ${state.exportHash}: ${advisory.message}\n`+
                  `Affected recipe skills: ${(state.skills??[]).join(', ')}. This notification preserves source locations and operation counts in evidence.shortTravel. `+
                  'Mention this finding to the person in your next reply, then acknowledge this advisory as completed and continue the current user task; no repair or new approval is required.'});
          }
          const guide=receiptable&&!renderError?await chat.current.tour.acknowledgeView(dir,data,state):await chat.current.tour.info();
          send({...guide,presentedRequests});return;
        }
        if(url.pathname==='/api/agent-request'){
          void server.interruptWork?.().catch(error=>note('handback-failed',{message:error.message}));
          send(await chat.current.requests.begin({directory:dir,source:'studio',kind:'guidance',studioInstanceId:instanceId,instruction:'The person requests help with '+await printName(dir)+'. '+(progress.active&&progress.directory===dir?progress.agentInstruction??'Help with the current tour lesson.':'Ask what change they want.')}));return;
        }
        if(url.pathname==='/api/tour-playback'){
          if(!['play','pause','tick'].includes(data.event))throw Error('Unknown playback event');
          const played=await chat.current.tour.playback(data.event);if(data.event!=='tick')note('tour-playback',{event:data.event,step:played.step});send(played);return;
        }
        if(url.pathname==='/api/tour'){
          // Enter playback only from the geometry that was actually displayed.
          if(data.action==='step'&&progress.step===L.geometry&&data.step===L.playback)
            await validateGeometrySelection(current,data);
          const ending=['exit','cancel','finish','finish-view'].includes(data.action);
          const result=await chat.current.tour.action(data.action,data.step);
          if(ending&&dir)await useExample(dir);
          if(!ending&&result.directory&&resolve(result.directory)!==dir)await openPrint(result.directory);
          const lesson=TOUR_STEPS[result.data.step];
          note(data.action==='fresh'?'tour-started':data.action==='step'?'tour-lesson':ending&&data.action!=='exit'&&data.action!=='cancel'?'tour-finished':'tour-exited',
            {action:data.action,step:result.data.step,lesson:lesson?{title:lesson.title,tab:lesson.tab,gate:lesson.gate??null}:null,runId:result.data.runId,lessonId:result.data.lessonId,
             active:result.data.active,completed:result.data.completed,canNext:result.data.canNext,agentInstruction:result.data.agentInstruction??null});
          if(result.directory&&result.data.active&&TOUR_STEPS[result.data.step].tab==='toolpath'){
            const adapter=await opened,state=(await readStableBundle(adapter,dir,{program:'source'})).state;
            if(!state.program||state.programError)await runBundleEdit(dir,()=>generate(adapter,false,'tour-step'));
          }
        }
        else if(url.pathname==='/api/use-example'){
          if(progress.active)throw Error('Exit the tour first.');
          if(!await tourExample(dir))throw Error('This print is already using the normal workflow.');
          await useExample(dir);note('example-adopted',{});
        }
        else if(url.pathname==='/api/open'){
          if(progress.active)throw Error('Exit the tour to open another print.');
          const selected=await printDirectory(data.path,resolveBundle);
          // Another runtime's print reopens this window in that runtime.
          const routed=await routeStudio?.(selected);
          if(routed)note('print-opened',{runtime:routed.runtime});
          else{
            await openPrint(selected);
            const adapter=await opened,state=(await readStableBundle(adapter,dir,{program:'source'})).state;
            note('print-opened',{name:await printName(dir,state.plan),tour:progress.active,revision:state.revision});
          }
        }
        else if(url.pathname==='/api/history'){
          if(progress.active)throw Error('Exit the tour before restoring edits.');
          const updated=await runBundleEdit(dir,()=>current.restoreRevision(dir,{direction:data.direction,expectedRevision:data.revision}));
          note('plan-updated',{revision:updated.revision,history:data.direction});
        }
        else if(url.pathname==='/api/plan'){
          const updated=await runBundleEdit(dir,()=>current.updatePlan(dir,data.plan,data.revision,{expectedEditRevision:data.expectedEditRevision})),edit=updated?.review?.history?.at(-1);
          const changed=data.expectedEditRevision?updated?.editRevision!==data.expectedEditRevision:updated?.revision!==data.revision;
          const changes=changed&&edit?.event==='plan-edited'?edit.changes??[]:[];
          note('plan-updated',{revision:updated.revision,changes});
        }
        else if(url.pathname==='/api/generate'){
          if(data.generationHash&&((await readStableBundle(current,dir,{program:false})).state).generationHash!==data.generationHash)throw Error('The print changed before generation. Review the updated print.');
          await runBundleEdit(dir,()=>generate(current,data.development===true));
        }
        else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent){await noteSourceSkew(error);send({error:reportedMessage(error),code:error.code,...(error.importDiagnostic?{importDiagnostic:error.importDiagnostic}:{})},400);}else res.end();}
  });
  // The application reopens through the same serialized and validated operation
  // as the picker, including when the person changed this viewer's print.
  server.openPrint=input=>{
    const run=queueOperation(async()=>{const before=dir;await openPrint(input);if(dir!==before)lifetime.notify('studio-update',{kind:'state',kinds:['print']});});
    queue=run.catch(()=>{});return run;
  };
  server.importSTL=({directory,source,units},{signal}={})=>{
    const run=queueOperation(()=>{
      if(typeof directory!=='string'||typeof source!=='string')throw Error('Import needs a destination and local STL path.');
      return runImport(resolve(source),{name:basename(source),directory,units,signal});
    });
    queue=run.catch(()=>{});return run;
  };
  server.startTour=()=>queueOperation(async()=>{
    const result=await chat.current.tour.action('fresh');
    if(result.directory)await openPrint(result.directory);
    note('tour-started',{step:result.data.step,runId:result.data.runId,lessonId:result.data.lessonId});
    lifetime.notify('studio-update',{kind:'state',kinds:['print','tour']});return result.data;
  });
  server.setStartAt=startAt=>chat.current.tour.setStartAt(startAt);
  server.currentPrint=()=>dir;
  server.inTour=async()=>{const guide=await chat.current.tour.info();return Boolean(guide.active&&dir&&guide.directory===dir);};
  server.setGenerationActivity=({generationHash,active})=>{
    if(active)externalGeneration={generationHash,directory:dir};
    else if(externalGeneration?.generationHash===generationHash)externalGeneration=null;
    lifetime.notify('studio-update',{kind:'state',kinds:['generation']});
  };
  server.applicationStopping=reason=>lifetime.notify('studio-update',{kind:'application-stopping',reason});
  const lifetime=viewerLifetime(server,{onViewers:count=>note(count?'viewer-opened':'viewer-closed',{viewers:count}),onClosing:()=>{
    closed=true;importController?.abort(Object.assign(Error('Import cancelled because Studio closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
  },
    onShutdown:async()=>{try{importController?.abort(Object.assign(Error('Import cancelled because Studio closed.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));await opened.catch(()=>{});await queue;await releaseInstance();await chat.current.tour.closeStudio();}finally{chat.current.tour.close();for(const store of ownedRequests)store.close();for(const store of ownedEvents)store.close();}}});
  function observeRequest(record){
    if(record.source==='studio'&&record.status==='queued'&&record.studioInstanceId===instanceId&&!queuedNoted.has(record.id)){
      queuedNoted.add(record.id);note('request-queued',{requestId:record.id,requestKind:record.kind,instruction:record.instruction,scope:record.scope??null,printId:record.printId});
    }
    if((!record.studioInstanceId||record.studioInstanceId===instanceId)&&record.printId===workIdFor(dir))lifetime.notify('studio-update',{kind:'state',kinds:['requests'],instanceId});
  }
  chat.stopRequestFeed=chat.current.requests.subscribe(observeRequest);
  function replaceAttachment(next){
    const run=editTail.then(async()=>{
      await opened;
      if(closed)throw Error('Studio is closing.');
      if(server.attachmentBusy())throw Error('Wait for the current Studio operation to finish before re-pairing.');
      const previous=chat.current;
      if(previous.requests.folder!==next.requests.folder)throw Error('Chat request stores must use the same application state folder.');
      if(reservation)reservation=await reassignBundleInstance(reservedDirectory,reservation,next.ownerId);
      try{await previous.requests.reassignStudio(instanceId,next.ownerId);}
      catch(error){
        if(reservation)reservation=await reassignBundleInstance(reservedDirectory,reservation,previous.ownerId);
        await next.requests.reassignStudio(instanceId,previous.ownerId);
        throw error;
      }
      chat.stopRequestFeed();previous.tour.close();
      const detail={studioInstanceId:instanceId,printId:workIdFor(dir),directory:dir,previousOwnerId:previous.ownerId,ownerId:next.ownerId,attachment:next.attached};
      const kind=next.attached?(previous.attached?'chat-captured':'chat-attached'):'chat-detached';
      previous.events.record(kind,detail);
      chat.current=next;
      if(previous.events!==next.events)next.events.record(kind,detail);
      chat.stopRequestFeed=next.requests.subscribe(observeRequest);
      lifetime.notify('studio-update',{kind:'state',kinds:['chat','requests'],instanceId});
      return server.attachment();
    });
    editTail=run.catch(()=>{});return run;
  }
  server.attachChat=({ownerId,agentRequests,studioEvents,name,client})=>{
    if(typeof ownerId!=='string'||!ownerId||agentRequests?.ownerId!==ownerId||!studioEvents)throw Error('Chat attachment requires its identity, request store and event queue.');
    const next={ownerId,requests:agentRequests,events:studioEvents,
      tour:createTour(libraryRoot,{ownerId,studioId:instanceId,agentRequests}),
      attached:Object.freeze({ownerId,name:name??ownerId,client:client??null})};
    return replaceAttachment(next);
  };
  server.attachment=()=>chat.current.attached;
  server.attachmentBusy=(ownOperations=0)=>operations.active>ownOperations||Boolean(importProgress)||['preparing','generating'].includes(generationStatus()?.status);
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
  server.once('close',()=>{closed=true;stopWatching();chat.stopRequestFeed();discardPreparation();void releaseInstance().catch(error=>note('instance-release-failed',{error:error.message}));});
  server.sessionToken=()=>token;
  server.shutdown=lifetime.shutdown;server.viewerCount=lifetime.viewers;
  Object.defineProperty(server,'studioEvents',{get(){return chat.current.events;}});server.generationStatus=generationStatus;
  server.cancelCalculation=cancelCalculation;
  server.runBundleEdit=runBundleEdit;
  server.runBundleCreation=runBundleCreation;
  server.creationTarget=()=>reservation&&!dir?reservedDirectory:null;
  server.showSavedCreation=async target=>{if(!operations.creating||reservedDirectory!==resolve(target))throw Error('No owned bundle creation is active.');const before=dir;await openPrint(target);if(dir!==before)lifetime.notify('studio-update',{kind:'state',kinds:['print']});};
  server.ready=()=>opened;
  server.agentSession=()=>({instanceId,ownerId:chat.current.ownerId,printId:workIdFor(dir),directory:dir,connected:!closed,attachment:server.attachment()});
  return server;
}
