// The person's actions from the page: each posts one command to the window and
// shows its progress until it settles (open, import, generate, Export).
import {TOUR_LESSONS as L} from './tour-catalog.mjs';
import {nextExportName} from './settings.mjs';

export function createPageActions(ctx){
  // The page's records and values this part uses; ctx.NAME marks another part.
  const {$,exportKey,exportedThisSession,printSync,studioWork,token,viewState}=ctx;
  // A toolpath is being (re)generated and a faded preview is on offer, so the
  // geometry action should return to it rather than start a fresh calculation.
  const generationPending=()=>studioWork.generating||printSync.state?.outputGenerating===true;
  function activity(text='',fraction=null){
    $('#activity').hidden=!text;$('#activity-label').textContent=text;
    const measured=Number.isFinite(fraction);
    $('#activity-percent').hidden=!measured;$('#activity-progress').hidden=!measured;
    if(measured){const value=Math.min(1,Math.max(0,fraction));$('#activity-percent').textContent=Math.floor(value*100)+'%';$('#activity-progress').value=value;}
    $('#activity-detail').textContent=measured?'Progress for this stage.':'Please wait. Studio is working.';
    $('main').setAttribute('aria-busy',String(!!text));
  }
  async function working(text,task,{preview=true,stage=null}={}){
    if(studioWork.busy)return;studioWork.busy=true;ctx.stop();if(preview)ctx.agentUI.loading(stage);activity(text);if(printSync.state)ctx.render();$('#open-print').disabled=true;
    // Paint the indicator before local parsing/drawing can occupy the UI thread.
    if(preview)await ctx.painted();
    let failure;
    try{return await task();}catch(error){failure=error;throw error;}
    finally{studioWork.busy=false;if(preview)ctx.agentUI.settled(failure||(viewState.tab==='toolpath'&&(printSync.state?.generationError||printSync.state?.programError||printSync.state?.programViewError)));activity();$('#open-print').disabled=false;if(printSync.state)ctx.render();}
  }
  async function api(route,data) {
    const target=(route==='generate'||route==='tour'&&!['finish','finish-view'].includes(data?.action)&&(data?.step??printSync.state?.tour?.step)>=L.playback)
      ?{printId:printSync.state?.printId,editRevision:route==='generate'?data?.editRevision:null}:null;
    if(target)studioWork.generationTarget=target;
    try{
      const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({...data,printId:printSync.state?.printId})});
      if(!response.ok){const result=await response.json();throw Object.assign(new Error(result.error),{code:result.code});}
      return response;
    }finally{if(target===studioWork.generationTarget){studioWork.generationTarget=null;$('#cancel-generation').hidden=true;}}
  }
  async function pollPreparation(){
    if(printSync.progressPolling)return;
    const update=printSync.progressUpdate;
    printSync.progressPolling=true;
    try{
      const response=await fetch('/api/preparation');if(!response.ok)return;
      const job=await response.json();
      if(update!==printSync.progressUpdate)return;
      applyProgress(job,studioWork.generationTarget,job.selectionVersion,true);
    }catch{/* The owning generation call reports failures. */}finally{printSync.progressPolling=false;if(update!==printSync.progressUpdate)void pollPreparation();}
  }
  function clearCalculationProgress(){
    studioWork.generationTarget=null;clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;
    $('#cancel-generation').hidden=true;
  }
  function showCalculationProgress(target){
    const job=target?.job;
    if(!job?.progress)return;
    const elapsed=job.startedAt?Date.now()-job.startedAt:job.elapsedMs;
    activity(job.progress.stage+(['importing','constructing','committing','exporting'].includes(job.status)&&elapsed>=1000?` · ${Math.floor(elapsed/1000)}s elapsed`:''),job.progress.total>0?job.progress.completed/job.progress.total:null);
  }
  function applyProgress(job,target=studioWork.generationTarget,selectedVersion=printSync.calculationSelectionVersion,snapshot=false){
    if(!job||job.studioInstanceId&&printSync.state&&job.studioInstanceId!==printSync.state.instanceId)return;
    if(job.selectionVersion&&selectedVersion&&job.selectionVersion!==selectedVersion)return;
    if(selectedVersion&&selectedVersion!==printSync.calculationSelectionVersion){clearCalculationProgress();target=null;printSync.calculationSelectionVersion=selectedVersion;}
    const current=printSync.state&&job.printId===printSync.state.printId;
    if(snapshot&&job.status==='idle'){clearCalculationProgress();if(printSync.state)ctx.render();else activity();return;}
    // The server owns this Studio's calculation, whether the browser or agent
    // started it. Adopt its identity for the same progress/cancellation controls.
    if(current&&job.kind!=='geometry'&&job.kind!=='export'){
      printSync.state.outputGenerating=['preparing','generating'].includes(job.status);
      if(printSync.state.outputGenerating&&(!target||target.printId!==job.printId||target.editRevision&&target.editRevision!==job.editRevision))
        target=studioWork.generationTarget={printId:job.printId,editRevision:job.editRevision};
    }
    if((job.kind==='geometry'&&['constructing','committing'].includes(job.status)||job.kind==='export'&&job.status==='exporting')&&job.selectionVersion===printSync.calculationSelectionVersion){
      if(!target||target.jobId!==job.jobId)target=studioWork.generationTarget={printId:job.printId,jobId:job.jobId,selectionVersion:job.selectionVersion};
    }
    if(!target||studioWork.generationTarget!==target||job.printId!==target.printId||target.jobId&&job.jobId&&job.jobId!==target.jobId
      ||target.editRevision&&job.editRevision!==target.editRevision){if(current)ctx.render();return;}
    target.job=job;
    if(job.status==='idle'){
      clearCalculationProgress();if(current)ctx.render();else activity();return;
    }
    if(current)ctx.render();
    target.editRevision??=job.editRevision;
    target.jobId??=job.jobId;
    $('#cancel-generation').hidden=!job.cancellable;$('#cancel-generation').textContent=job.kind==='export'?'Cancel Export':'Cancel calculation';
    clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;
    if(job.progress&&['preparing','generating','importing','constructing','committing','exporting'].includes(job.status)){
      const showProgress=()=>{
        if(studioWork.generationTarget!==target){clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;return;}
        showCalculationProgress(target);
      };
      showProgress();if(['importing','constructing','committing','exporting'].includes(job.status))studioWork.importElapsedTimer=setInterval(showProgress,1000);
    }
  }
  async function download(){
    // A blank name exports under the print's own name (the server's choice).
    const name=$('#export-name').value.trim();
    const key=exportKey(),response=await api('export',{exportSnapshot:printSync.state.exportSnapshot,name,downloadLink:true});
    if(!response.ok){const error=await response.json();throw new Error(error.error??'Export failed.');}
    const attachment=await response.json();
    let a=$('#reviewed-download');
    if(!a){a=document.createElement('a');a.id='reviewed-download';$('#confirm').insertAdjacentElement('afterend',a);}
    a.href=attachment.url;a.download=attachment.name;a.dataset.exportKey=key;a.hidden=false;
    a.textContent='Download reviewed file';a.title='If the download did not start, use this link. Available for ten minutes.';
    // This requests a native browser download. Browser/host save completion is
    // not observable here; leave a real link for a direct user-initiated retry.
    a.click();exportedThisSession.add(key);
    const source=$('#reviewed-attribution')??document.createElement('a');
    if(attachment.attribution){
      if(!source.isConnected){source.id='reviewed-attribution';source.style.display='block';a.insertAdjacentElement('afterend',source);}
      source.href=attachment.attribution.url;source.download=attachment.attribution.name;source.textContent='Source attribution';source.dataset.exportKey=key;source.hidden=false;
    }else source.remove();
    ctx.message([attachment.report?.notice,...(attachment.report?.limitations??[])].filter(Boolean).join(' '));
    const nextName=name?nextExportName(name):name;
    if(nextName!==name&&exportKey()===key){
      $('#export-name').value=nextName;
      Object.assign(viewState.exportNameState,{value:nextName,dirty:true});
    }
  }
  async function openPrint(path){
    if(studioWork.busy)return;
    ctx.saveView();
    $('#picker-message').textContent='';$('#print-picker').close();
    const loadSavedPrint=async()=>{await api('open',{path});await studioWork.tourUI?.load();await ctx.refresh(false,true);ctx.message('');};
    try{await working('Opening and checking your saved print…',loadSavedPrint);}
    catch(error){ctx.message(error.message,true);$('#picker-message').textContent=error.message;$('#print-picker').showModal();}
  }
  function chooseSTL(){$('#stl-file').value='';$('#stl-file').click();}
  return {api,working,activity,pollPreparation,clearCalculationProgress,showCalculationProgress,applyProgress,generationPending,download,openPrint,chooseSTL};
}
