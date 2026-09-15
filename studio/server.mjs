import {createTour,referenceAdapter,tourExample,useExample} from './tour.mjs';
import {TOUR_STEPS,TOUR_LESSONS as L} from './tour-catalog.mjs';
import {createAgentRequests,workSnapshot} from './agent-requests.mjs';
import {printName,downloadName} from './print-name.mjs';
import {importStudioSTL} from './import-stl.mjs';
import http from 'node:http';
import {watchStudioChanges} from './changes.mjs';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {attachCheckedProgramWorker} from '../core/print/program-handoff.mjs';
import { viewerLifetime, DEFAULT_DISCONNECT_MS } from './lifetime.mjs';
import {loadLocalExtension} from '../core/local-extension.mjs';

const here=dirname(fileURLToPath(import.meta.url));
export const root=resolve(here,'..');
const installedExtension=await loadLocalExtension(root);
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
  'saam-wedge-plan/1':()=>import('../skills/wedge-demo/scripts/bundle.mjs'),
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
export async function readStableBundle(adapter,directory,options){
  for(let attempt=0;;attempt++){
    let before;
    try{
      before=await adapter.bundleFingerprint(directory);
      const state=await adapter.loadBundle(directory,options);
      if(before!==await adapter.bundleFingerprint(directory))throw Error('The print is being updated.');
      return {state,fingerprint:before};
    }catch(error){
      const changing=before!==undefined&&before!==await adapter.bundleFingerprint(directory);
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
        if(bundles[plan.schema]||await resolveBundle(dir))prints.push({path:dir,name:await printName(dir),machine:machine.name,modified:(await stat(resolve(dir,'plan.json'))).mtime.toISOString()});
      }catch{/* One damaged bundle must not hide the other prints. */}
      return;
    }
    if(depth<3)for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.'))await walk(resolve(dir,entry.name),depth+1);
  }
  await walk(resolve(libraryRoot),0);return prints.sort((a,b)=>b.modified.localeCompare(a.modified));
}
// A local development launcher may explicitly supply a scratch adapter resolver.
// This is a function supplied by code, never a module path supplied by a print or HTTP request.
export function createStudio(directory,{disconnectMs=DEFAULT_DISCONNECT_MS,libraryRoot=resolve(root,'Prints'),resolveBundle=bundleFor,localExtension=installedExtension,agentOwnerId}={}) {
  const tour=createTour(libraryRoot,{ownerId:agentOwnerId});
  const requests=createAgentRequests(libraryRoot,{ownerId:agentOwnerId});
  const tourFingerprint=async()=>{const p=await tour.info();return JSON.stringify([p.active,p.step,p.selected,p.step===L.playback?null:p.canNext,p.startAt,p.completed]);};
  let dir=resolve(directory);
  const token=randomBytes(24).toString('hex');
  const instanceId=randomBytes(16).toString('hex');
  const printId=()=>createHash('sha256').update(dir).digest('hex');
  // Resolved on the first request; the no-op catch keeps an unopened print
  // from raising an unhandled rejection before a request reports it.
  let opened=Promise.resolve().then(()=>resolveBundle(dir));opened.catch(()=>{});
  let queue=Promise.resolve();
  // Speculation never enters the HTTP mutation queue or the browser's busy
  // state. Keep one worker/candidate, replacing it when the reviewed plan changes.
  let preparation,generationFailure,closed=false;
  const discardPreparation=()=>{
    const previous=preparation;preparation=null;
    if(previous){previous.detachSource?.();previous.reject?.(new Error('The prepared print changed.'));return previous.worker?.terminate();}
  };
  const prepare=(state,readDir)=>{
    if(closed||resolveBundle!==bundleFor)return null;
    if(state.program||state.outputAvailability){discardPreparation();return null;}
    const key=readDir+':'+state.planHash;
    if(preparation?.key===key)return preparation;
    discardPreparation();
    let worker;
    try{worker=new Worker(new URL('./generation-worker.mjs',import.meta.url),{workerData:{directory:readDir,planHash:state.planHash,progress:true}});}
    catch(error){return preparation={key,error:error.message};}
    const job={key,planHash:state.planHash,worker,pending:null,error:null,ready:false,progress:{stage:'Preparing geometry'},detachSource:attachCheckedProgramWorker(worker,state.planHash)};preparation=job;
    worker.on('message',message=>{
      if(message.type==='progress'){job.progress=message.progress;return;}
      if(message.type==='prepared'){job.error=message.error??null;job.ready=!message.error;return;}
      if(message.type==='generated'){
        const pending=job.pending;job.pending=null;job.reject=null;
        if(message.error)pending?.reject(new Error(message.error));
        else{
          // The earlier provenance listener retained checked source metadata.
          // Release the complete motion program before source requests begin.
          const stopped=preparation===job?discardPreparation():undefined;
          Promise.resolve(stopped).then(()=>pending?.resolve(message.checks),error=>pending?.reject(error));
        }
      }
    });
    const failed=error=>{
      job.error=error.message;job.pending?.reject(error);job.pending=null;job.reject=null;
      job.detachSource();
      void job.worker?.terminate();job.worker=null;
    };
    worker.on('error',failed);
    worker.on('exit',code=>{if(code&&preparation===job)failed(new Error('Toolpath preparation stopped unexpectedly.'));});
    worker.unref();
    return job;
  };
  const generate=async(current,development)=>{
    const generationDir=dir,state=await current.loadBundle(generationDir,{program:'source'});
    try{
      if(state.program&&!state.programError){
        // A valid saved development export needs only the shared mode transition.
        // Do not start a new slicing worker for an already-reviewed program.
        if(!development&&state.review.generation?.mode!=='production')await current.generateBundle(generationDir,{development:false});
      }else if(resolveBundle===bundleFor){
        // Retry failed speculation only on an explicit generation request.
        if(preparation?.error)await discardPreparation();
        const job=prepare(state,dir);
        if(job)await new Promise((resolve,reject)=>{
          if(job.error){reject(new Error(job.error));return;}
          job.pending={resolve,reject};job.reject=reject;
          job.worker.postMessage({type:'generate',development});
        });
        else await current.generateBundle(dir,{development});
      }else await current.generateBundle(dir,{development});
      generationFailure=null;
    }catch(error){
      generationFailure={directory:generationDir,planHash:state.planHash,message:error.message};
      try{await requests.begin({directory:generationDir,source:'studio',
        key:'generation-failure:'+generationDir+':'+state.planHash+':'+error.message,
        instruction:'Toolpath generation failed for this print. Error: '+error.message+
          '\nInspect the current recipe and relevant skill limits, diagnose the cause and apply appropriate fixes before regenerating. Do not blindly retry unchanged inputs or relax quality limits to hide the failure. Explain material process changes to the maker, preserve required human confirmations, then regenerate and verify the current toolpath is displayed in Studio. Resolve this request after recovery, or report the concrete blocker.'});}
      finally{throw error;} // A notification failure must not hide the generation error.
    }
  };
  const openPrint=async input=>{
    const next=await printDirectory(input,resolveBundle),adapter=await resolveBundle(next);
    await readStableBundle(adapter,next,{program:false});
    discardPreparation();
    dir=next;opened=Promise.resolve(adapter);
  };
  // Called only by a human Studio action choosing the geometry to print.
  const confirmGeometryForToolpath=async(adapter,actor)=>{
    const state=await adapter.loadBundle(dir,{program:false,live:true});
    if(!state.geometryApproved)await adapter.approve(dir,{stage:'geometry',actor,revision:state.revision,program:false});
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
      if(req.method==='GET'&&url.pathname==='/api/viewer'){
        if(url.searchParams.get('token')!==token||(req.headers.origin&&req.headers.origin!==origin)){send({error:'Invalid local session'},403);return;}
        lifetime.attach(res);return;
      }
      if(req.method==='GET'&&url.pathname==='/') {
        const html=(await readFile(resolve(here,'index.html'),'utf8')).replace('__CSRF__',token);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      if(req.method==='GET'&&['/work-state.mjs','/agent-ui.mjs','/tour-ui.mjs','/tour-catalog.mjs','/viewer-session.mjs','/app.mjs','/playback.mjs','/camera.mjs','/toolpath-view.mjs','/mesh-view.mjs','/material-view.mjs','/machine-view.mjs','/settings.mjs','/style.css'].includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(resolve(here,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/struder-logo.png'){
        res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(resolve(here,'struder-logo.png')));return;
      }
      if(req.method==='GET'&&playerModules.has(url.pathname.slice(1))){
        res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(resolve(root,url.pathname.slice(1))));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/tour'){send(await tour.info());return;}
      if(req.method==='GET'&&url.pathname==='/api/agent-requests'){send({requests:await requests.list()});return;}
      if(req.method==='GET'&&url.pathname==='/api/preparation'){
        const job=preparation;
        send({printId:printId(),planHash:job?.planHash??null,status:!job?'idle':job.error?'failed':job.pending?'generating':job.ready?'ready':'preparing',progress:job?.progress??null,error:job?.error??null});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/prints'){
        const p=await tour.info(),prints=await listPrints(libraryRoot,resolveBundle);
        send({prints:p.active?prints.filter(item=>[...Object.values(p.copies),...p.imports].some(name=>resolve(libraryRoot,'tour',name)===item.path)):prints});return;
      }
      await queue;
      const readDir=dir,readId=printId();
      const bundle=await opened;
      if(req.method==='GET'&&await localExtension.studioGet?.({url,res,token,dir:readDir,printId:readId,bundle,send,assertCurrent:()=>{if(readDir!==dir)throw new Error('The open print changed.');}}))return;
      if(req.method==='GET'&&url.pathname==='/api/state') {
        const guide=await tour.info(),geometryOnly=guide.active&&guide.step<L.playback;
        const {state,fingerprint}=await readStableBundle(bundle,readDir,{program:geometryOnly?false:'source'});
        if(readDir!==dir)throw new Error('The print is being updated.');
        state.tour=guide;state.localPrintDirectory=readDir;state.instanceId=instanceId;
        state.work={printId:requests.printId(readDir),snapshot:workSnapshot(state),requests:await requests.list()};
        if(generationFailure?.directory===readDir&&generationFailure.planHash===state.planHash&&!state.program)
          state.generationError=generationFailure.message;
        delete state.code;delete state.dir;state.printName=await printName(readDir);state.downloadName=downloadName(state.printName,state.exportName);state.printId=readId;state.fingerprint=readId+fingerprint+await tourFingerprint();state.sourceTransport='ndjson';send(state);
        if(!geometryOnly||guide.active&&guide.step===L.import)prepare(state,readDir);return;
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
      if(req.method==='GET'&&url.pathname==='/api/revision'){send({instanceId,fingerprint:readId+await bundle.bundleFingerprint(readDir)+await tourFingerprint()});return;}
      if(req.method==='GET'&&['/api/program','/api/gcode'].includes(url.pathname)) {
        const fingerprint=await bundle.bundleFingerprint(readDir);
        const state=await bundle.loadBundle(readDir,{program:'source',sourceFile:url.searchParams.get('file')??undefined});
        if(readDir!==dir)throw new Error('The open print changed. Reload before continuing.');
        if(fingerprint!==await bundle.bundleFingerprint(readDir))throw new Error('The print is being updated.');
        for(const [name,value] of [['printId',readId],['revision',state.revision],['exportHash',state.exportHash]]){
          if(url.searchParams.has(name)&&url.searchParams.get(name)!==value)throw new Error('The reviewed program changed. Reload before continuing.');
        }
        if(!state.program||state.programError)throw new Error(state.programError??'Generate the program first.');
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(state.code);return;
      }
      if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send({error:'Not found'},404);return;}
      if(req.headers.origin!==origin||req.headers['x-saam-token']!==token){send({error:'Invalid local session'},403);return;}
      const importing=url.pathname==='/api/import-stl',chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>(importing?64*1024*1024:64_000))throw Error('Request too large.');chunks.push(chunk);}
      const body=Buffer.concat(chunks),data=importing?Object.fromEntries(url.searchParams):JSON.parse(body.toString()||'{}');
      const run=queue.then(async()=>{
        if(data.printId&&data.printId!==printId())throw new Error('The open print changed. Reload before continuing.');
        const current=await opened;
        const progress=await tour.info();
        if(importing){
          if(progress.active&&progress.step!==L.import)throw Error('Use Import STL during the mesh lesson, or exit the tour.');
          const state=await current.loadBundle(dir,{program:false});
          const imported=await importStudioSTL(libraryRoot,body,{name:data.name,units:data.units,machineId:state.machine.id,tour:progress.active});
          if(progress.active)await tour.imported(imported);
          await openPrint(imported);
          if(progress.active){await confirmGeometryForToolpath(await opened,'Local user — STL selected for printing');await generate(await opened,false);await tour.requestStartLayer();}
          send({ok:true});return;
        }
        if(url.pathname==='/api/view-ready'){
          const stage=data.stage??(progress.step===L.geometry?'geometry':'toolpath');
          if(!['geometry','toolpath'].includes(stage))throw Error('Unknown displayed stage.');
          const state=await current.loadBundle(dir,{program:stage==='geometry'?false:'source'});
          if(data.revision===state.revision&&(stage==='geometry'||state.program&&!state.programError&&data.exportHash===state.exportHash))
            await requests.presented(dir,{...workSnapshot(state),stage});
          send(await tour.acknowledgeView(dir,data,state));return;
        }
        if(url.pathname==='/api/agent-request'){
          send(await requests.begin({directory:dir,source:'studio',instruction:'The person requests help with '+await printName(dir)+'. Follow the current tour instruction: '+(progress.agentInstruction??'Ask what change they want.')}));return;
        }
        if(url.pathname==='/api/tour-export'){
          if(!progress.active||progress.step!==L.export||progress.directory!==dir)throw Error('Continue to the export lesson first.');
          let state=await current.loadBundle(dir,{program:'source'});
          if(data.revision!==state.revision||data.exportHash!==state.exportHash||!state.program||state.programError)throw Error('The print changed. Review the loaded toolpath before exporting.');
          const shownHash=state.exportHash;
          await useExample(dir);
          try{
            state=await current.loadBundle(dir,{program:'source'});
            if(!state.geometryApproved)throw Error('Confirm the current geometry before exporting. Select the updated print in the print-selection lesson.');
            if(state.review.generation?.mode!=='production'){await generate(current,false);state=await current.loadBundle(dir,{program:'source'});}
            if(state.exportHash!==shownHash)throw Error('The regenerated toolpath changed. Review it, then confirm export again.');
            if(!state.toolpathApproved)state=await current.approve(dir,{stage:'toolpath',actor:'Local user — tour export',revision:state.revision,program:'source'});
            const file=await current.deliver(dir),name=downloadName(await printName(dir),basename(file)),bytes=await readFile(file);
            await tour.downloaded(state.exportHash);
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`});res.end(bytes);return;
          }finally{if((await tour.info()).active)await tour.action('resume');}
        }
        if(progress.active&&progress.directory===dir&&['/api/approve','/api/deliver'].includes(url.pathname))throw Error('Exit the tour before confirming a real print.');
        if(url.pathname==='/api/tour-playback'){
          if(!['play','pause','tick'].includes(data.event))throw Error('Unknown playback event');
          send(await tour.playback(data.event));return;
        }
        if(url.pathname==='/api/tour'){
          const result=await tour.action(data.action,data.step);
          if(['exit','pause','finish'].includes(data.action))await useExample(dir);
          else if(result.directory&&resolve(result.directory)!==dir)await openPrint(result.directory);
          if(result.directory&&result.data.active&&TOUR_STEPS[result.data.step].tab==='toolpath'){
            await confirmGeometryForToolpath(await opened,'Local user — continue with selected print');
            const adapter=await opened,state=await adapter.loadBundle(dir,{program:'source'});
            if(!state.program||state.programError||state.review.generation?.mode!=='production'){await generate(adapter,false);}
          }
        }
        else if(url.pathname==='/api/use-example'){
          if(progress.active)throw Error('Exit the tour first.');
          if(!await tourExample(dir))throw Error('This print is already using the normal workflow.');
          await useExample(dir);await tour.action('pause');
        }
        else if(url.pathname==='/api/open'){
          const selected=await printDirectory(data.path,resolveBundle);
          if(progress.active)await tour.select(selected);
          await openPrint(selected);
          const adapter=await opened,state=await adapter.loadBundle(dir,{program:progress.active?false:'source'});
          if(progress.active||state.program&&!state.programError)await confirmGeometryForToolpath(adapter,'Local user — print selected');
          // Geometry stays visible in the STL lesson while a worker prepares its
          // selected part. Continuing commits this exact candidate.
          if(progress.active)prepare(await adapter.loadBundle(dir,{program:false}),dir);
        }
        else if(await localExtension.studioPost?.({url,data,dir,printId:printId(),send}))return;
        else if(url.pathname==='/api/plan')await current.updatePlan(dir,data.plan,data.revision);
        else if(url.pathname==='/api/approve'){
          const state=await current.approve(dir,{...data,program:'source'});
          const {revision,review,geometryApproved,planApproved,toolpathApproved}=state;
          send({ok:true,approval:{revision,review,geometryApproved,planApproved,toolpathApproved,
            programAvailable:Boolean(state.program),programError:state.programError??null,exportHash:state.exportHash??null,
            fingerprint:printId()+await current.bundleFingerprint(dir)}});return;
        }
        else if(url.pathname==='/api/generate'){
          if(data.planHash&&(await current.loadBundle(dir,{program:false})).planHash!==data.planHash)throw Error('The print changed before generation. Review the updated print.');
          await generate(current,data.development===true);
        }
        else if(url.pathname==='/api/deliver') {
          const file=await current.deliver(dir),name=basename(file);
          const contentType=name.endsWith('.3mf')?'application/vnd.ms-package.3dmanufacturing-3dmodel+xml':name.endsWith('.zip')?'application/zip':'text/plain';
          res.writeHead(200,{'Content-Type':contentType,'Content-Disposition':`attachment; filename="${name}"`});res.end(await readFile(file));return;
        } else throw new Error('Unknown operation.');
        send({ok:true});
      });
      queue=run.catch(()=>{});await run;
    } catch(error){if(!res.headersSent)send({error:error.message},400);else res.end();}
  });
  // Local adapters reopen through the same serialized and validated operation
  // as the picker, including when the person changed this viewer's print.
  server.openPrint=input=>{
    const run=queue.then(()=>openPrint(input));
    queue=run.catch(()=>{});return run;
  };
  server.setStartAt=startAt=>tour.setStartAt(startAt);
  server.currentPrint=()=>dir;
  const lifetime=viewerLifetime(server,{disconnectMs});
  const stopWatching=watchStudioChanges(libraryRoot,kinds=>lifetime.notify('studio-change',{kinds}));
  server.once('close',()=>{closed=true;stopWatching();discardPreparation();});
  server.shutdown=lifetime.shutdown;
  server.agentDisconnected=async ownerId=>lifetime.notify('agent-connection-closed',{ownerId,requests:await requests.list()});
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
  // Retain the old flag as a harmless alias: viewer-owned shutdown is universal.
  const args=process.argv.slice(2),startIndex=args.indexOf('--start-at-layer');
  const startAt=startIndex<0?null:{layer:Number(args[startIndex+1])};if(startIndex>=0)args.splice(startIndex,2);
  const requested=args.find(arg=>arg!=='--close-when-idle');
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
