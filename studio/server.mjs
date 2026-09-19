import {createTour,referenceAdapter,tourExample,useExample} from './tour.mjs';
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
import { viewerLifetime, DEFAULT_DISCONNECT_MS } from './lifetime.mjs';
import {loadLocalExtension} from '../core/local-extension.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const root=resolve(here,'..');
const installedExtension=await loadLocalExtension(root);
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
// Appended to a failure that already happened, once per error. A detected skew
// persists until this process restarts, which is the only cure for it.
let skewNotice=null,skewCheckedAt=0;
export async function annotateSourceSkew(error){
  if(!(error instanceof Error)||error.sourceSkewChecked)return error;
  error.sourceSkewChecked=true;
  if(!skewNotice&&Date.now()-skewCheckedAt>=3000){skewCheckedAt=Date.now();skewNotice=await sourceSkewNotice();}
  if(skewNotice)error.message+=' '+skewNotice;
  return error;
}
// Explicit browser module allowlist; no generic repository/file serving.
const playerModules=new Set(['studio/source-player.mjs','studio/source-worker.mjs','studio/move-store.mjs',
  'studio/machine-session.mjs','studio/machine-view.mjs','core/export/source-time.mjs','core/export/machine-study.mjs',
  'core/machine/presentation.mjs','core/machine/rigid.mjs','core/machine/jog.mjs',
  'core/machine/dobot-kinematics.mjs','core/machine/denso-kinematics.mjs',
  'core/export/denso-player.mjs','core/machine/denso.mjs','core/path/pose.mjs',
  'core/export/griffin.mjs','core/export/gcode-lines.mjs','core/export/bambu-player.mjs',
  'core/export/dobot-player.mjs','core/export/dobot-lua-subset.mjs','core/machine/rules.mjs','core/geom/tolerance.mjs','core/path/process-controls.mjs']);

// Studio reviews whatever print it is opened on. A bundle names its own schema,
// and that selects its geometry/recipe adapter. Both adapters use the single
// workflow implementation in core/print/workflow.mjs.
const bundles={
  'saam-machine-study/1':()=>import('./machine-study.mjs'),
  'saam-shell-plan/1':()=>import('../core/print/bundle.mjs')
};
export async function bundleFor(directory) {
  const plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));
  const load=bundles[plan.schema];
  if(!load)throw new Error(`This print uses ${plan.schema??'an unknown plan format'}, which Studio cannot review.`);
  const adapter=await load();return plan.schema==='saam-shell-plan/1'?referenceAdapter(adapter):adapter;
}
// A CLI update replaces several bundle files. Retry only reads caught between
// those replacements; persistent corruption still fails the normal validation.
// One fingerprint pass on each side of the load yields both the source and
// presentation fingerprints; presentation derives from files source covers.
export async function readStableBundle(adapter,directory,options){
  for(let attempt=0;;attempt++){
    let before;
    try{
      before=await adapter.bundleFingerprints(directory,options);
      const state=await adapter.loadBundle(directory,options);
      if(before.source!==(await adapter.bundleFingerprints(directory,options)).source)throw Error('The print is being updated.');
      return {state,fingerprint:before.source,presentationFingerprint:before.presentation};
    }catch(error){
      const changing=before!==undefined&&before.source!==(await adapter.bundleFingerprints(directory,options)).source;
      if(attempt>=3||!changing&&error.code!=='ENOENT'&&!/Plan and geometry disagree|being updated/.test(error.message))throw error;
      await new Promise(resolve=>setTimeout(resolve,60*(attempt+1)));
    }
  }
}
// A selected plan, export or delivery file reopens its owning print bundle.
// Standalone foreign programs need an interpreter contract before review.
export async function printDirectory(input,resolveBundle=bundleFor) {
  if(typeof input!=='string'||!input.trim()||input.length>4096)throw new Error('Choose a saved print folder or a file inside it.');
  let dir=await realpath(isAbsolute(input)?input:resolve(root,input));
  if(!(await stat(dir)).isDirectory())dir=dirname(dir);
  for(let depth=0;depth<4;depth++){
    try{await resolveBundle(dir);return dir;}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=dirname(dir);if(parent===dir)break;dir=parent;
  }
  throw new Error('No SAAM print bundle found. Open the saved print folder containing plan.json, geometry and machine.json. Standalone G-code/3MF import is not supported.');
}
export async function listPrints(libraryRoot,resolveBundle=bundleFor) {
  const prints=[];
  async function walk(dir,depth){
    let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(entries.some(e=>e.name==='plan.json'&&e.isFile())){
      try{const plan=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8')),machine=JSON.parse(await readFile(resolve(dir,'machine.json'),'utf8'));
        if(bundles[plan.schema]||await resolveBundle(dir))prints.push({path:dir,name:await printName(dir,plan),machine:machine.name,modified:(await stat(resolve(dir,'plan.json'))).mtime.toISOString()});
      }catch{/* One damaged bundle must not hide the other prints. */}
      return;
    }
    if(depth<3)for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.'))await walk(resolve(dir,entry.name),depth+1);
  }
  await walk(resolve(libraryRoot),0);return prints.sort((a,b)=>b.modified.localeCompare(a.modified));
}
// A local development launcher may explicitly supply a scratch adapter resolver.
// This is a function supplied by code, never a module path supplied by a print or HTTP request.
export function createStudio(directory,{disconnectMs=DEFAULT_DISCONNECT_MS,libraryRoot=resolve(root,'Prints'),resolveBundle=bundleFor,localExtension=installedExtension,agentOwnerId,agentRequests,closeAgentRequests=false,studioEvents}={}) {
  const instanceId=randomBytes(16).toString('hex');
  const sessionOwnerId=agentOwnerId??agentRequests?.ownerId??`studio:${instanceId}`;
  if(agentRequests?.ownerId&&agentRequests.ownerId!==sessionOwnerId)throw Error('A Studio instance belongs to exactly one agent owner.');
  const requests=agentRequests??createAgentRequests(libraryRoot,{ownerId:sessionOwnerId}),ownsRequests=!agentRequests;
  const tour=createTour(libraryRoot,{ownerId:sessionOwnerId,studioId:instanceId,agentRequests:requests});
  const geometryOnly=guide=>guide.active&&guide.directory===dir&&guide.step<L.playback;
  const viewFingerprint=(id,fingerprint,guide)=>id+fingerprint+(geometryOnly(guide)?':geometry':':program');
  const metadata=state=>({revision:state.revision,review:{...state.review,history:undefined},
    toolpathApproved:state.toolpathApproved,tourExample:state.tourExample??null,
    programError:state.programError??null,exportHash:state.exportHash??null});
  let dir=resolve(directory);
  const token=randomBytes(24).toString('hex'),viewPerformance=[];
  // Studio observations for the owning agent: person-driven actions, worker
  // outcomes and displayed results, tagged with this instance and its print.
  const events=studioEvents??createStudioEvents(),ownsEvents=!studioEvents,closingPolls=new AbortController(),queuedNoted=new Set();
  const note=(kind,detail={})=>events.record(kind,{studioInstanceId:instanceId,printId:requests.printId(dir,{optional:true}),directory:dir,...detail});
  // Authenticated delivery issues a bounded, short-lived read-only capability.
  // Its HTTP attachment avoids browser-specific blob URL download handling.
  const downloadLinks=new Map();
  const stageDownload=(file,name,bytes)=>{
    const now=Date.now();for(const [key,value] of downloadLinks)if(value.expiresAt<=now)downloadLinks.delete(key);
    if(downloadLinks.size>=16)downloadLinks.delete(downloadLinks.keys().next().value);
    const key=randomBytes(24).toString('hex'),exportHash=createHash('sha256').update(bytes).digest('hex'),expiresAt=now+10*60*1000;
    downloadLinks.set(key,{file,name,exportHash,expiresAt});return {url:'/api/download/'+key,name,exportHash,expiresAt};
  };
  const printId=()=>createHash('sha256').update(dir).digest('hex');
  // Resolved on the first request; the no-op catch keeps an unopened print
  // from raising an unhandled rejection before a request reports it.
  const attached=tour.attachStudio(dir);
  let opened=attached.then(()=>resolveBundle(dir));opened.catch(()=>{});
  let queue=Promise.resolve();
  // Speculation never enters the HTTP mutation queue or the browser's busy
  // state. Keep one worker/candidate, replacing it when the reviewed plan changes.
  let preparation,generationFailure,generationCancelled,importProgress,generationRun=null,closed=false;
  const discardPreparation=(error=new Error('The prepared print changed.'))=>{
    const previous=preparation;preparation=null;
    return previous?.dispose(error);
  };
  const cancelGeneration=async(reason='person')=>{
    const job=preparation;if(!job)return {cancelled:false,committing:false};
    const result=job.cancel();if(!result.cancelled)return {cancelled:false,committing:result.committing};
    generationCancelled={directory:job.directory,planHash:job.planHash};
    note('generation-cancelled',{planHash:job.planHash,reason});
    if(preparation===job)preparation=null;
    await result.done;return {cancelled:true,committing:false};
  };
  const prepare=(state,readDir)=>{
    if(closed||resolveBundle!==bundleFor)return null;
    // Geometry-only reads deliberately omit program bytes. A matching saved
    // generation is enough to defer speculation; explicit review still checks
    // its bytes and will regenerate if that stored result is damaged.
    if(state.program||state.outputAvailability||state.review?.generation?.planHash===state.planHash&&!state.programError){discardPreparation();return null;}
    const key=readDir+':'+state.planHash;
    if(preparation?.key===key)return preparation;
    discardPreparation();
    return preparation=new PreparedGenerationJob({key,directory:readDir,planHash:state.planHash,
      createWorker:cancellation=>new Worker(new URL('./generation-worker.mjs',import.meta.url),
        {workerData:{directory:readDir,planHash:state.planHash,progress:true,cancellation}})});
  };
  // Only a real calculation is an event; a mode transition of a valid saved
  // program starts nothing the person or agent would wait on.
  const generationStatus=()=>{
    const job=preparation,run=generationRun;
    if(!run&&!(job&&['preparing','generating'].includes(job.status)))return null;
    const progress=job?.progress??null,percent=progress?.total>0?Math.floor(100*progress.completed/progress.total):null;
    const directory=run?.directory??job.directory;
    return {studioInstanceId:instanceId,printId:requests.printId(directory,{optional:true}),directory,planHash:run?.planHash??job.planHash,
      status:run?(job?.status==='preparing'?'preparing':'generating'):'preparing',requested:Boolean(run),trigger:run?.trigger??null,
      startedAt:run?.startedAt??null,elapsedMs:run?Date.now()-run.startedAt:null,progress:progress?{...progress,percent}:null};
  };
  const generate=async(current,development,trigger='generate')=>{
    generationCancelled=null;
    const generationDir=dir,state=await current.loadBundle(generationDir,{program:'source'});
    if(state.inspection)throw Error('This inspection does not support print generation.');
    const calculating=!(state.program&&!state.programError);
    if(calculating){generationRun={directory:generationDir,planHash:state.planHash,trigger,development,startedAt:Date.now()};note('generation-started',{planHash:state.planHash,development,trigger});}
    try{
      if(state.program&&!state.programError){
        // A valid saved development export needs only the shared mode transition.
        // Do not start a new slicing worker for an already-reviewed program.
        if(!development&&state.review.generation?.mode!=='production')await current.generateBundle(generationDir,{development:false});
      }else if(resolveBundle===bundleFor){
        // A stopped worker needs restarting; a completed preparation diagnostic
        // is already useful and need not be recomputed on the first Continue.
        if(preparation?.status==='failed'&&(!preparation.worker||generationFailure?.directory===generationDir&&generationFailure.planHash===state.planHash))await discardPreparation();
        const job=prepare(state,dir);
        if(job){await job.generate(development);if(preparation===job)preparation=null;}
        else await current.generateBundle(dir,{development});
      }else await current.generateBundle(dir,{development});
      generationFailure=null;
      if(calculating)note('generation-finished',{planHash:state.planHash,development,trigger,durationMs:Date.now()-generationRun.startedAt});
      const guide=await tour.info();
      if(guide.active&&guide.directory===generationDir&&guide.step===L.playback&&!guide.startAt)await tour.requestStartLayer();
    }catch(error){
      if(error.code==='GENERATION_CANCELLED')throw error;
      // Before the message reaches the page, the event queue and the failure
      // request, say whether this process is behind the files the worker read.
      await annotateSourceSkew(error);
      generationFailure={directory:generationDir,planHash:state.planHash,message:error.message};
      try{const record=await requests.begin({directory:generationDir,source:'studio',studioInstanceId:instanceId,
        key:'generation-failure:'+generationDir+':'+state.planHash+':'+error.message,
        instruction:'Toolpath generation failed for this print. Error: '+error.message+
          '\nInspect the current recipe and relevant skill limits, diagnose the cause and apply appropriate fixes before regenerating. Do not blindly retry unchanged inputs or relax quality limits to hide the failure. Explain material process changes to the maker, then regenerate and verify the current toolpath is displayed in Studio. Resolve this request after recovery, or report the concrete blocker.'});
        note('generation-failed',{planHash:state.planHash,trigger,error:error.message,requestId:record.id});}
      finally{throw error;} // A notification failure must not hide the generation error.
    }finally{generationRun=null;}
  };
  const openPrint=async input=>{
    const next=await printDirectory(input,resolveBundle),adapter=await resolveBundle(next);
    await readStableBundle(adapter,next,{program:false});
    if(next!==dir)discardPreparation();
    dir=next;opened=Promise.resolve(adapter);
  };
  // Called only by a human Studio action choosing the geometry to print.
  const validateGeometrySelection=async(adapter,seen)=>{
    const state=await adapter.loadBundle(dir,{program:false,live:true});
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
        const bytes=await readFile(staged.file);
        if(createHash('sha256').update(bytes).digest('hex')!==staged.exportHash)throw Error('The staged delivery changed. Export the reviewed file again.');
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,
          'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(staged.name)}`,'Referrer-Policy':'no-referrer'});
        res.end(bytes);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/viewer'){
        if(url.searchParams.get('token')!==token||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid local session'},403);return;}
        lifetime.attach(res);return;
      }
      if(req.method==='GET'&&url.pathname==='/') {
        const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      if(req.method==='GET'&&['/work-state.mjs','/agent-ui.mjs','/tour-ui.mjs','/tour-catalog.mjs','/viewer-session.mjs','/view-performance.mjs','/refresh-plan.mjs','/app.mjs','/playback.mjs','/camera.mjs','/toolpath-view.mjs','/mesh-view.mjs','/material-view.mjs','/machine-view.mjs','/settings.mjs','/style.css'].includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/struder-logo.png'){
        res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(resolve(here,'struder-logo.png')));return;
      }
      if(req.method==='GET'&&playerModules.has(url.pathname.slice(1))){
        res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/tour'){send(await tour.info());return;}
      if(req.method==='GET'&&url.pathname==='/api/view-performance'){send({reports:viewPerformance});return;}
      if(req.method==='GET'&&url.pathname==='/api/agent-requests'){
        const workId=requests.printId(dir,{optional:true}),records=workId?await requests.query({printId:workId}):[];
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
        if(importProgress){send(importProgress);return;}
        const job=preparation;
        send({printId:printId(),planHash:job?.planHash??null,cancellable:Boolean(job?.cancellable),status:job?.status??'idle',progress:job?.progress??null,error:job?.error??null});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/prints'){
        const p=await tour.info(),prints=p.active
          ?(await Promise.all(Object.values(p.copies).map(name=>listPrints(resolve(libraryRoot,'tour',name),resolveBundle)))).flat()
          :await listPrints(libraryRoot,resolveBundle);
        send({prints});return;
      }
      if(req.method==='GET')await queue;
      const readDir=dir,readId=printId();
      const bundle=await opened;
      if(req.method==='GET'&&await localExtension.studioGet?.({url,res,token,dir:readDir,printId:readId,bundle,send,assertCurrent:()=>{if(readDir!==dir)throw new Error('The open print changed.');}}))return;
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const workId=requests.printId(readDir,{optional:true}),allRecords=workId?await requests.query({printId:workId}):[],records=allRecords.filter(record=>!record.studioInstanceId||record.studioInstanceId===instanceId),guide=await tour.info({records});
        const {state,fingerprint,presentationFingerprint}=await readStableBundle(bundle,readDir,{program:geometryOnly(guide)?false:'source'});
        if(readDir!==dir)throw new Error('The print is being updated.');
        const importRepair=await loadStudioImportRepair(readDir),failure=generationFailure,cancelled=generationCancelled;
        const presentation=viewFingerprint(readId,presentationFingerprint,guide),name=await printName(readDir,state.plan);
        const assembled=composeStudioState(state,{directory:readDir,printId:readId,workId,instanceId,guide,records,importRepair,
          printName:name,fingerprint:viewFingerprint(readId,fingerprint,guide),presentationFingerprint:presentation,
          generationFailure:failure,generationCancelled:cancelled,now:Date.now()});
        send(assembled.response);
        // Speculate only on the tour's explicitly selected, confirmed part.
        // Ordinary edits use explicit generation; starting a second worker here
        // competes with the agent and may slice inputs it is still changing.
        if(assembled.preparation)prepare(assembled.preparation.state,assembled.preparation.directory);
        return;
      }
      if(req.method==='GET'&&url.pathname==='/api/sources'){
        const fingerprint=await bundle.bundleFingerprint(readDir),state=await bundle.loadBundle(readDir,{program:'source',allSources:true});
        if(fingerprint!==await bundle.bundleFingerprint(readDir)||readDir!==dir)throw new Error('The print is being updated.');
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
      if(req.method==='GET'&&url.pathname==='/api/revision'){
        const guide=await tour.info();
        const options={program:!geometryOnly(guide)},current=await bundle.bundleFingerprints(readDir,options),raw=current.source;
        const fingerprint=viewFingerprint(readId,raw,guide),presentationFingerprint=viewFingerprint(readId,current.presentation,guide);
        let reviewUpdate;
        if(url.searchParams.has('fingerprint')&&url.searchParams.get('fingerprint')!==fingerprint){
          const {state,fingerprint:checked}=await readStableBundle(bundle,readDir,{program:options.program?'source':false});
          if(checked!==raw||readDir!==dir)throw Error('The print is being updated.');
          reviewUpdate=metadata(state);
        }
        send({instanceId,fingerprint,presentationFingerprint,reviewUpdate,tour:guide});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/gcode') {
        const fingerprint=await bundle.bundleFingerprint(readDir);
        const state=await bundle.loadBundle(readDir,{program:'source'});
        if(readDir!==dir)throw new Error('The open print changed. Reload before continuing.');
        if(fingerprint!==await bundle.bundleFingerprint(readDir))throw new Error('The print is being updated.');
        for(const [name,value] of [['printId',readId],['revision',state.revision],['exportHash',state.exportHash]]){
          if(url.searchParams.has(name)&&url.searchParams.get(name)!==value)throw new Error('The reviewed program changed. Reload before continuing.');
        }
        if(!state.program||state.programError)throw new Error(state.programError??'Generate the program first.');
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(state.code);return;
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(url.pathname==='/api/agent-open'){
        // The owning agent shows another print in this instance from any process,
        // so switching prints needs no second Studio.
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>64_000)throw Error('Request too large.');chunks.push(chunk);}
        const data=JSON.parse(Buffer.concat(chunks).toString()||'{}');
        if(data.owner!==sessionOwnerId||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid agent owner'},403);return;}
        await server.openPrint(data.path);send(server.agentSession());return;
      }
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      const importing=url.pathname==='/api/import-stl',chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>(importing?64*1024*1024:64_000))throw Error('Request too large.');chunks.push(chunk);}
      const body=Buffer.concat(chunks),data=importing?Object.fromEntries(url.searchParams):JSON.parse(body.toString()||'{}');
      // Browser-measured view bursts, kept in memory for an agent to read.
      if(url.pathname==='/api/view-performance'){viewPerformance.push({receivedAt:new Date().toISOString(),...data});viewPerformance.splice(0,viewPerformance.length-20);send({ok:true});return;}
      if(url.pathname==='/api/cancel-generation'){
        if(data.printId!==printId()||data.planHash&&data.planHash!==preparation?.planHash)throw Error('The calculation changed. Refresh before cancelling.');
        send(await cancelGeneration());return;
      }
      const run=queue.then(async()=>{
        if(data.printId&&data.printId!==printId())throw new Error('The open print changed. Reload before continuing.');
        const current=await opened;
        const progress=await tour.info();
        if(importing){
          if(progress.active)throw Error('Import STL is available after you finish or exit the tour.');
          await discardPreparation();
          const state=await current.loadBundle(dir,{program:false});
          importProgress={printId:printId(),planHash:null,status:'importing',progress:{stage:'Checking your STL'}};
          note('import-started',{name:data.name??null,units:data.units??null});
          let imported;
          try{imported=await importStudioSTL(libraryRoot,body,{name:data.name,units:data.units,machineId:state.machine.id,
            onProgress:value=>{importProgress.progress=value;}});}
          catch(error){note('import-failed',{name:data.name??null,error:error.message});throw error;}
          finally{importProgress=null;}
          await openPrint(imported.directory);
          note('import-completed',{name:await printName(dir),units:data.units??null});
          send({ok:true});return;
        }
        if(url.pathname==='/api/view-ready'){
          let presentedRequests=[];
          const stage=data.stage??(progress.step===L.geometry?'geometry':'toolpath');
          if(!['geometry','toolpath'].includes(stage))throw Error('Unknown displayed stage.');
          const state=await current.loadBundle(dir,{program:stage==='geometry'?false:'source'});
          if(data.revision===state.revision&&(stage==='geometry'||state.program&&!state.programError&&data.exportHash===state.exportHash)){
            presentedRequests=await requests.presented(dir,{...workSnapshot(state),stage,studioInstanceId:instanceId});
            note('view-presented',{stage,revision:state.revision,exportHash:stage==='toolpath'?state.exportHash??null:null,presentedRequestIds:presentedRequests.map(record=>record.id)});
            for(const record of presentedRequests)note('request-presented',{requestId:record.id,requestKind:record.kind,stage});
            const advisory=state.program?.summary?.shortTravel;
            if(stage==='toolpath'&&advisory?.count&&requests.printId(dir,{optional:true}))
              await requests.begin({directory:dir,source:'studio',kind:'advisory',studioInstanceId:instanceId,
                key:`short-travel:${dir}:${state.exportHash}`,
                evidence:{exportHash:state.exportHash,planHash:state.planHash,skills:state.skills,shortTravel:advisory},
                instruction:`Toolpath quality advisory for export ${state.exportHash}: ${advisory.message}\n`+
                  `Affected recipe skills: ${(state.skills??[]).join(', ')}. This notification preserves source locations and operation counts in evidence.shortTravel. `+
                  'Mention this finding to the person in your next reply, then acknowledge this advisory as completed and continue the current user task; no repair or new approval is required.'});
          }
          send({...await tour.acknowledgeView(dir,data,state),presentedRequests});return;
        }
        if(url.pathname==='/api/agent-request'){
          send(await requests.begin({directory:dir,source:'studio',kind:'guidance',studioInstanceId:instanceId,instruction:'The person requests help with '+await printName(dir)+'. '+(progress.active&&progress.directory===dir?progress.agentInstruction??'Help with the current tour lesson.':'Ask what change they want.')}));return;
        }
        if(url.pathname==='/api/tour-export'){
          if(!progress.active||progress.directory!==dir)throw Error('Open this print in its tour to confirm and export.');
          let state=await current.loadBundle(dir,{program:'source'});
          if(data.revision!==state.revision||data.exportHash!==state.exportHash||!state.program||state.programError)throw Error('The print changed. Review the loaded toolpath before exporting.');
          const shownHash=state.exportHash;
          await useExample(dir);
          try{
            state=await current.loadBundle(dir,{program:'source'});
            if(state.review.generation?.mode!=='production'){await generate(current,false,'tour-export');state=await current.loadBundle(dir,{program:'source'});}
            if(state.exportHash!==shownHash)throw Error('The regenerated toolpath changed. Review it, then confirm export again.');
            if(!state.toolpathApproved)state=await current.approve(dir,{actor:'Local user — tour export',revision:state.revision,program:'source'});
            const file=await current.deliver(dir),name=requestedDownloadName(data.name,await printName(dir),basename(file)),bytes=await readFile(file);
            await tour.downloaded(state.exportHash);
            note('export-delivered',{tour:true,name,exportHash:state.exportHash,revision:state.revision});
            if(data.downloadLink===true){send(stageDownload(file,name,bytes));return;}
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`});res.end(bytes);return;
          }finally{await tour.restoreReference(dir);}
        }
        if(progress.active&&progress.directory===dir&&['/api/deliver','/api/approve'].includes(url.pathname))throw Error('Use Confirm settings & export to approve and download the tour toolpath.');
        if(url.pathname==='/api/tour-playback'){
          if(!['play','pause','tick'].includes(data.event))throw Error('Unknown playback event');
          const played=await tour.playback(data.event);if(data.event!=='tick')note('tour-playback',{event:data.event,step:played.step});send(played);return;
        }
        if(url.pathname==='/api/tour'){
          // This button explicitly selects the displayed part without turning
          // navigation into a separate approval stage.
          if(data.action==='step'&&progress.step===L.import&&data.step===L.playback)
            await validateGeometrySelection(current,data);
          const result=await tour.action(data.action,data.step);
          if(['exit','cancel','finish'].includes(data.action))await useExample(dir);
          else if(result.directory&&resolve(result.directory)!==dir)await openPrint(result.directory);
          const lesson=TOUR_STEPS[result.data.step];
          note(data.action==='fresh'?'tour-started':data.action==='step'?'tour-lesson':data.action==='finish'?'tour-finished':'tour-exited',
            {action:data.action,step:result.data.step,lesson:lesson?{title:lesson.title,tab:lesson.tab,gate:lesson.gate??null}:null,runId:result.data.runId,lessonId:result.data.lessonId,
             active:result.data.active,completed:result.data.completed,canNext:result.data.canNext,agentInstruction:result.data.agentInstruction??null});
          if(result.directory&&result.data.active&&TOUR_STEPS[result.data.step].tab==='toolpath'){
            const adapter=await opened,state=await adapter.loadBundle(dir,{program:'source'});
            if(!state.program||state.programError||state.review.generation?.mode!=='production')await generate(adapter,false,'tour-step');
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
          const adapter=await opened,state=await adapter.loadBundle(dir,{program:progress.active?false:'source'});
          // Geometry stays visible in the STL lesson while a worker prepares its
          // selected part. Continuing commits this exact candidate.
          if(progress.active)prepare(state,dir);
          note('print-opened',{name:await printName(dir,state.plan),tour:progress.active,revision:state.revision});
        }
        else if(await localExtension.studioPost?.({url,data,dir,printId:printId(),send}))return;
        else if(url.pathname==='/api/plan'){await current.updatePlan(dir,data.plan,data.revision);note('plan-updated',{revision:data.revision??null});}
        else if(url.pathname==='/api/approve'){
          const state=await current.approve(dir,{actor:data.actor,revision:data.revision,program:'source'});
          const {revision,review,toolpathApproved}=metadata(state);
          note('approved',{revision});
          const {source,presentation}=await current.bundleFingerprints(dir,{program:!geometryOnly(progress)});
          send({ok:true,approval:{revision,review,toolpathApproved,
            programAvailable:Boolean(state.program),programError:state.programError??null,exportHash:state.exportHash??null,
            presentationFingerprint:viewFingerprint(printId(),presentation,progress),fingerprint:viewFingerprint(printId(),source,progress)}});return;
        }
        else if(url.pathname==='/api/generate'){
          if(data.planHash&&(await current.loadBundle(dir,{program:false})).planHash!==data.planHash)throw Error('The print changed before generation. Review the updated print.');
          await generate(current,data.development===true);
        }
        else if(url.pathname==='/api/deliver') {
          const file=await current.deliver(dir),name=basename(file);
          const selectedName=requestedDownloadName(data.name,await printName(dir),name),delivered=await readFile(file);
          note('export-delivered',{tour:false,name:selectedName,exportHash:createHash('sha256').update(delivered).digest('hex')});
          if(data.downloadLink===true){send(stageDownload(file,selectedName,delivered));return;}
          const contentType=name.endsWith('.3mf')?'application/vnd.ms-package.3dmanufacturing-3dmodel+xml':name.endsWith('.zip')?'application/zip':'text/plain';
          res.writeHead(200,{'Content-Type':contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(selectedName)}`});res.end(delivered);return;
        } else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent){await annotateSourceSkew(error);send({error:error.message,code:error.code},400);}else res.end();}
  });
  // Local adapters reopen through the same serialized and validated operation
  // as the picker, including when the person changed this viewer's print.
  server.openPrint=input=>{
    const run=queue.then(async()=>{const before=dir;await openPrint(input);if(dir!==before)lifetime.notify('studio-change',{kinds:['print']});});
    queue=run.catch(()=>{});return run;
  };
  server.setStartAt=startAt=>tour.setStartAt(startAt);
  server.currentPrint=()=>dir;
  const lifetime=viewerLifetime(server,{disconnectMs,onViewers:count=>note(count?'viewer-opened':'viewer-closed',{viewers:count}),onClosing:()=>closingPolls.abort(),
    onShutdown:async()=>{try{await attached;await queue;await tour.closeStudio();}finally{tour.close();if(ownsRequests||closeAgentRequests)requests.close();if(ownsEvents)events.close();}}});
  const stopRequestFeed=requests.subscribe(record=>{
    if(record.source==='studio'&&record.status==='queued'&&record.studioInstanceId===instanceId&&!queuedNoted.has(record.id)){
      queuedNoted.add(record.id);note('request-queued',{requestId:record.id,requestKind:record.kind,instruction:record.instruction,scope:record.scope??null,printId:record.printId});
    }
    if((!record.studioInstanceId||record.studioInstanceId===instanceId)&&record.printId===requests.printId(dir,{optional:true}))lifetime.notify('studio-change',{kinds:['requests'],instanceId});
  });
  let checkingGeneration=false;
  const stopWatching=watchStudioChanges(libraryRoot,kinds=>{
    const external=kinds.filter(kind=>kind!=='requests');
    if(external.length)lifetime.notify('studio-change',{kinds:external});
    const job=preparation;
    if(kinds.includes('print')&&job?.cancellable&&!checkingGeneration){
      checkingGeneration=true;
      void resolveBundle(job.directory).then(adapter=>readStableBundle(adapter,job.directory,{program:false})).then(({state})=>{
        if(preparation===job&&state.planHash!==job.planHash)return cancelGeneration('inputs-changed');
      }).catch(()=>{/* A partial external write will be rechecked at commit. */}).finally(()=>{checkingGeneration=false;});
    }
  });
  server.once('close',()=>{closed=true;stopWatching();stopRequestFeed();discardPreparation();});
  server.shutdown=lifetime.shutdown;
  server.studioEvents=events;server.generationStatus=generationStatus;
  server.agentSession=()=>({instanceId,ownerId:sessionOwnerId,printId:requests.printId(dir,{optional:true}),directory:dir,connected:!closed});
  server.agentDisconnected=async ownerId=>lifetime.notify('agent-connection-closed',{ownerId,requests:await requests.query()});
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
  await bundle.loadBundle(dir,{program:false});
  const server=createStudio(dir),port=Number(process.env.SAAM_STUDIO_PORT??0);
  server.listen(port,'127.0.0.1',()=>console.log(`SAAM Studio: http://127.0.0.1:${server.address().port}\nPrint: ${dir}\nNo deadline to open. Closes ${DEFAULT_DISCONNECT_MS/60000} minutes after the last viewer disconnects.`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void server.shutdown());
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
