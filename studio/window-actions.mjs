// The person's actions in a Studio window: one queue of commands on the shown
// print (open, import, edit, restore, generate), Export and its offered download,
// and the progress and cancellation of the calculation each starts.
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {importStudioSTL} from './import-stl.mjs';
import {printName,requestedDownloadName} from './print-name.mjs';
import {exportReviewed} from '../core/export/reviewed-export.mjs';
import {pipeline} from 'node:stream/promises';
import {withBundleInstance} from '../core/print/studio-ownership.mjs';
import {editPart} from '../core/application/part-execution.mjs';

export function createWindowActions(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {chat,displayedResults,downloadLinks,instanceId,libraryRoot,machineSetups,note,noteSourceSkew,
    operations,partCommandRoute,paths,printDirectory,printId,printIdFor,reportedMessage,resolveBundle,
    routeStudio,selection,session,stageDownload,tourHere,work,workIdFor}=ctx;
  function queueOperation(action){
    operations.active++;
    const run=work.queue.then(action).finally(()=>{operations.active--;});
    work.queue=run.catch(()=>{});return run;
  }
  const projectedCalculation=()=>work.calculation&&work.calculation.selectionVersion===selection.version&&work.calculation.ownerId===chat.current.binding.ownerId
    &&(session.dir===work.calculation.directory||!session.dir&&session.reservedDirectory===work.calculation.directory)?work.calculation:null;
  function observeCalculation(directory,read,cancel){
    const target=resolve(directory);
    if(session.closed||target!==session.dir&&(!operations.creating||target!==session.reservedDirectory))throw Error('The Studio calculation target changed.');
    if(projectedCalculation())throw Error('This Studio already has a geometry calculation.');
    const projection={directory:target,selectionVersion:selection.version,ownerId:chat.current.binding.ownerId,read,cancel};
    work.calculation=projection;
    return {selectionVersion:projection.selectionVersion,publish:()=>{if(projectedCalculation()===projection)publishProgress();},finish:()=>{
      if(work.calculation!==projection)return;
      const current=projectedCalculation()===projection,status=projectionStatus(projection);work.calculation=null;
      if(current)publishProgress({...status,status:'idle',cancellable:false,progress:null});
    }};
  }
  function projectionStatus(projection){
    const {bundleId,...status}=projection.read();
    return {...status,studioInstanceId:instanceId,directory:projection.directory,printId:printIdFor(projection.directory),selectionVersion:projection.selectionVersion};
  }
  const outputGenerating=()=>work.generationRun?.calculated===true&&work.generationRun.directory===session.dir;
  const cancelledGeneration=()=>Object.assign(new Error('Toolpath calculation cancelled.'),{code:'GENERATION_CANCELLED'});
  const cancelGeneration=async(reason='person')=>{
    const run=work.generationRun;
    if(!run?.calculated||run.committing||run.controller.signal.aborted)return {cancelled:false,committing:Boolean(run?.committing)};
    work.generationCancelled={directory:run.directory,editRevision:run.editRevision};
    note('generation-cancelled',{printId:workIdFor(run.directory),directory:run.directory,editRevision:run.editRevision,reason});
    run.controller.abort(cancelledGeneration());
    await run.finished;return {cancelled:true,committing:false};
  };
  const cancelCalculation=async({jobId,editRevision,selectionVersion,reason='person'}={})=>{
    if(work.exportRun&&jobId===work.exportRun.jobId){
      if(work.exportRun.committing)return {cancelled:false,committing:true,kind:'export'};
      work.exportRun.controller.abort(Object.assign(new Error('Export cancelled.'),{name:'AbortError',code:'EXPORT_CANCELLED'}));
      note('export-cancelled',{directory:work.exportRun.directory,printId:workIdFor(work.exportRun.directory),reason});
      publishProgress();return {cancelled:true,kind:'export',jobId};
    }
    const projected=projectedCalculation();
    if(projected){
      if(jobId!==projected.read().jobId||selectionVersion&&selectionVersion!==projected.selectionVersion)throw Error('The calculation changed. Read its current jobId before cancelling.');
      const result=projected.cancel();publishProgress();return result;
    }
    if(work.importProgress){
      if(jobId!==work.importProgress.jobId)throw Error('The import changed. Read its current jobId before cancelling.');
      work.importController.abort(Object.assign(new Error('Import cancelled.'),{name:'AbortError',code:'IMPORT_CANCELLED'}));
      publishProgress();return {cancelled:true,kind:'import',jobId};
    }
    if(jobId||!editRevision||editRevision!==work.generationRun?.editRevision)throw Error('The calculation changed. Read its current identity before cancelling.');
    return {...await cancelGeneration(reason),kind:'generation'};
  };
  // Only a real calculation is reported; reusing or promoting a valid saved
  // program starts nothing the person or agent would wait on.
  const calculationStatus=()=>{
    const projected=projectedCalculation();if(projected)return projectionStatus(projected);
    if(work.importProgress)return {...work.importProgress,cancellable:!work.importController.signal.aborted,elapsedMs:Date.now()-work.importProgress.startedAt,estimatedRemainingMs:null};
    if(work.exportRun){
      const {progress}=work.exportRun,percent=progress?.total>0?Math.floor(100*progress.completed/progress.total):null;
      return {studioInstanceId:instanceId,selectionVersion:selection.version,printId:printIdFor(work.exportRun.directory),directory:work.exportRun.directory,
        jobId:work.exportRun.jobId,kind:'export',status:'exporting',cancellable:!work.exportRun.committing&&!work.exportRun.controller.signal.aborted,
        startedAt:work.exportRun.startedAt,elapsedMs:Date.now()-work.exportRun.startedAt,progress:{...progress,...(percent===null?{}:{percent})}};
    }
    const run=work.generationRun?.calculated?work.generationRun:null;
    const progress=run?.progress??null,percent=progress?.total>0?Math.floor(100*progress.completed/progress.total):null;
    const directory=run?.directory??session.dir;
    return {studioInstanceId:instanceId,selectionVersion:selection.version,printId:directory&&printIdFor(directory),directory,editRevision:run?.editRevision??null,
      status:run?'generating':'idle',cancellable:Boolean(run&&!run.committing&&!run.controller.signal.aborted),
      trigger:run?.trigger??null,startedAt:run?.startedAt??null,elapsedMs:run?Date.now()-run.startedAt:null,progress:progress?{...progress,percent}:null};
  };
  const activeCalculationStatus=()=>{const status=calculationStatus();return ['generating','importing','constructing','committing','exporting'].includes(status.status)?status:null;};
  const generationStatus=()=>{const status=activeCalculationStatus();return status?{...status,printId:workIdFor(status.directory)}:null;};
  const publishProgress=(status=activeCalculationStatus())=>ctx.lifetime.notify('studio-update',{kind:'progress',selectionVersion:selection.version,status});
  const runImport=async(source,{name,units,directory,signal}={})=>{
    signal?.throwIfAborted();
    if(session.closed)throw Error('Studio is closing. Reopen it before importing.');
    if(tourHere(await chat.current.tour.info()))throw Error('This Studio is running the tour; import after the tour ends.');
    signal?.throwIfAborted();
    work.importController=new AbortController();
    const controller=work.importController,abort=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    work.importProgress={studioInstanceId:instanceId,printId:session.dir?printId():null,directory:session.dir??null,jobId:randomBytes(16).toString('hex'),name:name??null,editRevision:null,status:'importing',startedAt:Date.now(),progress:{stage:'Checking your STL',phase:'import'}};publishProgress();
    note('import-started',{jobId:work.importProgress.jobId,name:name??null,units:units??null});
    let imported;
    try{imported=await importStudioSTL(libraryRoot,source,{name,units,directory,paths,signal:work.importController.signal,
      onProgress:value=>{
        if(value.phase==='repair'&&work.importProgress.progress.phase!=='repair')note('import-repair-started',{jobId:work.importProgress.jobId,name:name??null,elapsedMs:Date.now()-work.importProgress.startedAt});
        work.importProgress={...work.importProgress,progress:value};publishProgress();
      }});}
    catch(error){note(work.importController.signal.aborted?'import-cancelled':'import-failed',{jobId:work.importProgress.jobId,name:name??null,error:error.message,importDiagnostic:error.importDiagnostic??{stage:work.importProgress.progress.phase??'import',failure:{name:error.name,code:error.code??null,message:error.message}},elapsedMs:Date.now()-work.importProgress.startedAt});throw error;}
    finally{signal?.removeEventListener('abort',abort);const finished=work.importProgress;work.importProgress=null;work.importController=null;publishProgress({...finished,status:'idle',progress:null,cancellable:false});}
    await ctx.openPrint(imported.directory);
    note('import-completed',{name:await printName(session.dir),units:units??null,importDiagnostic:imported.importDiagnostic});
    return imported;
  };
  const publishGenerationFailure=async(error,snapshot,trigger)=>{
      const {directory:generationDir,state}=snapshot;
      if(error.code==='GENERATION_CANCELLED')throw error;
      // Before the message reaches the page, the event queue and the failure
      // request, say whether this process is behind the files the worker read.
      await noteSourceSkew(error);
      const reported=reportedMessage(error);
      work.generationFailure={directory:generationDir,editRevision:state.editRevision,message:reported,stage:error.stage??'generation'};
      // A person's failed generation asks the agent to diagnose it; an agent's is its own error outcome.
      try{const record=trigger==='agent'?null:await chat.current.binding.ask({directory:generationDir,studioInstanceId:instanceId,
        key:'generation-failure:'+generationDir+':'+state.editRevision+':'+reported,
        instruction:(error.stage==='export'?'SAAMpath construction succeeded; machine export failed. Inspect the selected exporter and its representation requirements. Error: ':'Toolpath generation failed for this print. Inspect the current recipe and deposition inputs. Error: ')+reported+
          '\nFix the cause, or leave out only what cannot be made and say what was left out; unchanged inputs fail again. Explain material process changes to the maker, then verify the result is displayed in Studio. Resolve this request after recovery, or report the concrete blocker.'});
        note('generation-failed',{printId:workIdFor(generationDir),directory:generationDir,editRevision:state.editRevision,trigger,error:reported,stage:error.stage??'generation',...(record?{requestId:record.id}:{})});}
      finally{throw error;} // A notification failure must not hide the generation error.
  };
  // Callers hold this Studio's bundle edit (runBundleEdit), so the worker
  // commits under its reservation.
  const generationHost={prepare(){work.generationCancelled=null;},async run({directory,editRevision,development,trigger},action){
    const finished=Promise.withResolvers();
    while(work.generationRun)await work.generationRun.finished;
    const run=work.generationRun={directory,editRevision,trigger,controller:new AbortController(),
      finished:finished.promise,calculated:false,committing:false,progress:null,startedAt:null};
    const calculating=()=>{
      if(run.calculated)return;
      run.calculated=true;run.startedAt=Date.now();
      note('generation-started',{printId:workIdFor(run.directory),directory:run.directory,editRevision:run.editRevision,development,trigger});
      ctx.lifetime.notify('studio-update',{kind:'state',kinds:['generation']});
    };
    try{
      const checks=await action({signal:run.controller.signal,
        progress:progress=>{calculating();run.progress=progress;publishProgress();},
        beforeCommit:()=>{run.committing=true;publishProgress();}});
      work.generationFailure=null;
      if(run.calculated)note('generation-finished',{printId:workIdFor(run.directory),directory:run.directory,editRevision:run.editRevision,development,trigger,durationMs:Date.now()-run.startedAt});
      return checks;
    }catch(error){await publishGenerationFailure(error,{directory:run.directory,state:{editRevision:run.editRevision}},trigger);}
    finally{
      work.generationRun=null;finished.resolve();
      if(run.calculated){
        publishProgress({studioInstanceId:instanceId,printId:printIdFor(run.directory),directory:run.directory,editRevision:run.editRevision,status:'idle',cancellable:false,progress:null});
        ctx.lifetime.notify('studio-update',{kind:'state',kinds:['generation']});
      }
    }
  }};
  // Generation keeps its observations in the home this Studio was given.
  const generate=({directory=session.dir,trigger='generate',...options}={})=>partCommandRoute.generateAt(directory,{trigger,paths,...options},generationHost);
  const exportPrint=async(state,data,progress)=>{
    const name=requestedDownloadName(data.name,await printName(state.dir,state.plan),state.exportName);
    if(work.exportRun)throw Error('An Export is already being prepared. Wait for it or cancel it first.');
    // Export runs in its own worker; the person can cancel until the file commits.
    const run=work.exportRun={jobId:randomBytes(16).toString('hex'),directory:state.dir,controller:new AbortController(),startedAt:Date.now(),
      committing:false,progress:{stage:'Preparing Export'}};
    publishProgress();
    let prepared;
    try{prepared=await exportReviewed(state,{machineSetups,paths,signal:run.controller.signal,
      progress:value=>{if(work.exportRun===run){run.progress=value;publishProgress();}},
      beforeCommit:()=>{run.committing=true;run.progress={stage:'Saving the file'};publishProgress();}});}
    finally{work.exportRun=null;publishProgress({studioInstanceId:instanceId,printId:printIdFor(run.directory),directory:run.directory,jobId:run.jobId,kind:'export',status:'idle',cancellable:false,progress:null});}
    try{
    const inTour=progress.active&&progress.directory===state.dir;
    if(inTour)await chat.current.tour.exportPrepared(prepared.outputId);
    note('export-ready',{directory:state.dir,printId:workIdFor(state.dir),tour:inTour,name,outputId:prepared.outputId,report:prepared.report});
    return {...prepared,name};
    }catch(error){try{await prepared.artifact.release();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}
  };
  // Offered downloads: an exported program's bytes read through a short-lived capability.
  async function downloadRoute(req,res,url,origin,send){
    if(req.method==='GET'&&url.pathname.startsWith('/api/download/')){
      if(req.headers.origin&&req.headers.origin!==origin){send({error:'Invalid local session'},403);return true;}
      const staged=downloadLinks.get(url.pathname.slice('/api/download/'.length));
      if(!staged){send({error:'Download link expired or unavailable. Export the reviewed file again.'},404);return true;}
      const {bytes,artifact}=staged,lease=artifact?.openRead();
      try{
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':artifact?.byteLength??bytes.length,
        'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(staged.name)}`,'Referrer-Policy':'no-referrer'});
      if(lease)await pipeline(lease.stream,res);else res.end(bytes);
      }finally{await lease?.close();}return true;
    }
    return false;
  }
  // Commands that must not wait in the queue: cancellation and Export of the displayed result.
  async function immediateActionRoute(res,url,data,send){
    if(url.pathname==='/api/cancel-generation'){
      if(data.printId!==printId()||!data.editRevision||data.editRevision!==work.generationRun?.editRevision)throw Error('The calculation changed. Refresh before cancelling.');
      send(await cancelGeneration());return true;
    }
    if(url.pathname==='/api/cancel-calculation'){
      send(await cancelCalculation(data));return true;
    }
    if(url.pathname==='/api/export'){
      if(session.inspection||session.normalReviewPending)throw Error('Return to normal review and display the current toolpath before exporting.');
      // A ready displayed result starts Export at the click, independently
      // of Studio's edit/generation queue. Later work cannot retarget it.
      const captured=displayedResults.get(data.exportSnapshot);
      if(!captured||captured.state.dir!==session.dir||captured.bundle!==await session.opened)
        throw Error('The displayed toolpath is unavailable. Review it before exporting.');
      const prepared=await withBundleInstance(captured.state.dir,captured.reservation,
        async()=>exportPrint(captured.state,data,await chat.current.tour.info()));
      if(data.downloadLink===true){send(stageDownload(prepared));return true;}
      let lease;
      try{lease=prepared.artifact.openRead();res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':prepared.artifact.byteLength,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(prepared.name)}`});await pipeline(lease.stream,res);}
      finally{try{await lease?.close();}finally{await prepared.artifact.release();}}return true;
    }
    return false;
  }
  // The person's queued actions on the shown print: import, ask the agent, open, restore, edit and generate.
  async function actionRoute(url,data,body,importing,progress,current,send){
    if(importing){
      if(tourHere(progress))await ctx.leaveTour('import-stl');
      await runImport(body,{name:data.name,units:data.units});
      send({ok:true});return true;
    }
    if(url.pathname==='/api/agent-request'){
      send(await chat.current.binding.ask({directory:session.dir,kind:'guidance',studioInstanceId:instanceId,interrupt:true,instruction:'The person requests help with '+await printName(session.dir)+'. '+(progress.active&&progress.directory===session.dir?progress.agentInstruction??'Help with the current tour lesson.':'Ask what change they want.')}));return true;
    }
    if(url.pathname==='/api/open'){
      const selected=await printDirectory(data.path,resolveBundle);
      if(tourHere(progress)&&selected!==session.dir)await ctx.leaveTour('open');
      // Another runtime's print reopens this window in that runtime.
      const routed=await routeStudio?.(selected);
      if(!routed){
        await ctx.openPrint(selected);
      }
    }
    else if(url.pathname==='/api/history'){
      if(tourHere(progress))throw Error('Exit the tour before restoring edits.');
      const updated=await ctx.runBundleEdit(session.dir,()=>current.restoreRevision(session.dir,{direction:data.direction,expectedRevision:data.revision}));
      note('plan-updated',{revision:updated.revision,history:data.direction});
    }
    else if(url.pathname==='/api/plan'){
      const updated=await ctx.runBundleEdit(session.dir,()=>editPart(session.dir,data.plan,data.revision,{expectedEditRevision:data.expectedEditRevision})),edit=updated?.review?.history?.at(-1);
      const changed=data.expectedEditRevision?updated?.editRevision!==data.expectedEditRevision:updated?.revision!==data.revision;
      const changes=changed&&edit?.event==='plan-edited'?edit.changes??[]:[];
      note('plan-updated',{revision:updated.revision,changes});
    }
    else if(url.pathname==='/api/generate'){
      await ctx.runBundleEdit(session.dir,()=>generate({development:data.development===true,expectedEditRevision:data.editRevision}));
    }
    else throw new Error('Unknown operation.');
    send({ok:true});return true;
  }
  return {queueOperation,projectedCalculation,observeCalculation,projectionStatus,outputGenerating,cancelledGeneration,cancelGeneration,cancelCalculation,calculationStatus,activeCalculationStatus,generationStatus,publishProgress,runImport,publishGenerationFailure,generationHost,generate,exportPrint,downloadRoute,immediateActionRoute,actionRoute};
}
