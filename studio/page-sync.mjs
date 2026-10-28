// The page's side of the window session: it keeps the page's print state in step
// with the window (pushed changes, else fallback polling), adopts each new state
// with its drawn Paath, and reports each drawn view back as its receipt.
import {prepareStudioState,withoutPreviewMaterial} from './studio-state.mjs';
import {outputView,planRefreshNavigation} from './refresh-plan.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';
import {needsTourToolpath} from './tour-ui.mjs';
import {sourceSession} from './studio/machine-session.mjs';
import {viewerReadyForCaptures,viewerConnected} from './viewer-session.mjs';

export function createPageSync(ctx){
  // The page's records and values this part uses; ctx.NAME marks another part.
  const {$,NO_PRINT,machinePose,orbitView,playState,printSync,studioTitle,studioWork,
    viewState}=ctx;
  // Give the compositor two frames to show what was just rendered, then continue
  // regardless: a hidden or unpainted tab runs no frame callback at all, and
  // opening, loading and acknowledging a drawn view must not wait on one.
  function painted(){
    return new Promise(resolve=>{
      const timer=setTimeout(resolve,150),done=()=>{clearTimeout(timer);resolve();};
      requestAnimationFrame(()=>requestAnimationFrame(done));
    });
  }
  async function loadAndAdoptStudioState(follow=false,reopen=false,fetchedState=null,fetchedTag=null) {
    let fetched=fetchedState;
    if(!fetched){
      const response=await fetch('/api/state');
      if(response.status===204)throw Object.assign(new Error(NO_PRINT),{code:'NO_PRINT'});
      if(!response.ok)throw new Error((await response.json()).error);
      fetchedTag=response.headers?.get?.('etag')??null;fetched=await response.json();
    }
    const loaded=printSync.state?.printId===fetched.printId?printSync.state:null,previous=!reopen?loaded:null;
    ctx.agentUI.received(fetched.work);
    const presentationChanged=!previous||previous.editRevision!==fetched.editRevision||previous.outputId!==fetched.outputId
      ||previous.geometryId!==fetched.geometryId;
    if(presentationChanged)ctx.clearManual();
    const scenes=ctx.viewer.sceneState();
    const adopted=await prepareStudioState(fetched,{previous:loaded?.inspection?null:previous,follow,presentation:loaded?.inspection?null:viewState.activePresentation,
      pathMoves:scenes.pathMoves,materialMoves:scenes.materialMoves,decode:decodeInWorker,decodeNeutral:decodeSavedPathInWorker,
      // Serializable metadata is bound before the proxy-backed cached move store is adopted.
      bind:bindCachedProgram});
    printSync.state=adopted.state;printSync.stateTag=fetchedTag;ctx.chatUI.reflect();
    if(studioWork.generationTarget&&studioWork.generationTarget.printId!==printSync.state.printId){
      studioWork.generationTarget=null;clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;
      $('#cancel-generation').hidden=true;
    }
    return {adopted,loaded,previous,presentationChanged,follow};
  }
  async function presentStudioState({adopted,loaded,previous,presentationChanged,follow}) {
    if(printSync.state.inspection){
      const changed=loaded?.inspection?.selectionId!==printSync.state.inspection.selectionId;
      if(changed){ctx.stop();ctx.clearManual();ctx.paathView.clear();machinePose.machineSession?.dispose();machinePose.machineSession=null;viewState.selected=null;orbitView.fitBounds=null;orbitView.zoom=1;orbitView.pan=[0,0];ctx.cameras.reset();}
      const chosen=printSync.state.inspection,model=await ctx.inspectionUI.select(chosen);
      if(printSync.state.inspection?.selectionId!==chosen.selectionId)return;
      ctx.applyInspectionModel(model);document.title=studioTitle(printSync.state.printName);await painted();
      if(changed)await ctx.inspectionUI.ready(chosen);return;
    }
    if(loaded?.inspection){ctx.inspectionUI.clear();ctx.paathView.clear();ctx.viewer.clearProgram();ctx.viewer.publishGeometry({geometry:null});viewState.activePresentation=null;}
    // Metadata can change while the exact same source/move buffers are reused.
    const outputState=outputView(printSync.state);
    $('#kind-label').textContent=(completedOutputState(printSync.state).previous?'Previous toolpath · ':printSync.state.neutralProgram?'Saved SAAMpath · '
      :outputState.review.generation?.mode==='development'?'Development preview · ':'')+(outputState.machine?.name??'No printer selected');
    document.title=studioTitle(printSync.state.printName);
    $('#open-print').title='Open print: '+printSync.state.printName;
    // Geometry keys off the previously loaded state's geometry id (none on a
    // print switch), so a different print always rebuilds.
    if(!ctx.viewer.sceneState().hasGeometry||!loaded||loaded.geometryId!==printSync.state.geometryId)
      ctx.viewer.publishGeometry({geometry:printSync.state.geometry});
    const presentation=await applyProgramPresentation(adopted.presentation,printSync.state);printSync.state=presentation.state;
    if(presentationChanged)ctx.layerFade.reset();
    const navigation=planRefreshNavigation(previous,printSync.state,{follow,tab:viewState.tab,seconds:playState.seconds,duration:presentation.duration,selected:viewState.selected,
      hasSelectedEdge:ctx.viewer.sceneState().hasSelectedEdge(viewState.selected),tourInitialTab:!previous&&printSync.state.tourExample?studioWork.tourUI?.initialTab():undefined});
    ctx.applyRefreshNavigation(navigation);
    viewState.machineColors=ctx.machineTheme();
    if(machinePose.machineSession?.scene){
      const d=machinePose.machineSession.scene.descriptor;$('#machine-basis').textContent=d.basis;
      $('#machine-limitations').replaceChildren(...d.limitations.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
      await machinePose.machineSession.sample(playState.seconds,{manual:machinePose.manualValues,jog:machinePose.manualJog});
    }else{$('#machine-basis').textContent='';$('#machine-limitations').replaceChildren();}
    ctx.render();
    if(printSync.state.outputGenerating)void ctx.pollPreparation();
    await acknowledgeDisplayedView(navigation.inspectionFailure);
  }
  async function ensureTourGeneration(follow=false){
    if(printSync.state?.inspection)return;
    if(needsTourToolpath(printSync.state)){
      ctx.activity('Preparing your toolpath…');
      try{
        await ctx.api('generate',{development:false,editRevision:printSync.state.editRevision});
        await presentStudioState(await loadAndAdoptStudioState(follow));
      }
      catch(error){printSync.state.generationError=error.message;ctx.message(error.message,true);ctx.render();}
    }
  }
  async function refresh(follow=false,reopen=false,fetchedState=null,fetchedTag=null) {
    await presentStudioState(await loadAndAdoptStudioState(follow,reopen,fetchedState,fetchedTag));
    await ensureTourGeneration(follow);
  }
  async function applyProgramPresentation(decision,next){
    if(decision.effects.program==='clear')ctx.clearProgramView();
    let publication=null;
    if(decision.effects.buildPath||decision.effects.buildMaterial){
      const shown=outputView(next),visible=shown.program??next.neutralProgram;
      publication=await ctx.paathView.present(machinePose.machineSession,{program:visible,plan:shown.plan,geometry:shown.geometry,
        buildPath:decision.effects.buildPath,buildMaterial:decision.effects.buildMaterial,onProgress:progress=>ctx.activity('Preparing material view…',progress)});}
    const state=publication?.previewMaterialConsumed?withoutPreviewMaterial(next):next;
    viewState.activePresentation={...decision.model,
      presentedState:decision.effects.program==='clear'?outputView({...state,program:null}):state.program?outputView(state):decision.model.presentedState,
      program:state.program??decision.model.program};
    return {duration:ctx.duration(),state};
  }
  function acknowledgeDisplayedView(failure){
    if(printSync.state?.inspection)return Promise.resolve();
    studioWork.presentationPending={failure};
    if(studioWork.acknowledging)return studioWork.acknowledging;
    studioWork.acknowledging=(async()=>{
    try{
      do{
        const pending=studioWork.presentationPending;studioWork.presentationPending=null;
        await painted();
        if(pending.failure||printSync.state.normalReviewPending||ctx.agentUI.presentState(printSync.state,viewState.tab,{requiresToolpath:needsTourToolpath(printSync.state)})){
          const presented=await studioWork.tourUI?.acknowledgeView(printSync.state,viewState.tab,pending.failure);
          if(presented)ctx.agentUI.updated(presented);
        }
      }while(studioWork.presentationPending);
    }finally{studioWork.acknowledging=false;}
    })();
    return studioWork.acknowledging;
  }
  async function decodeInWorker(snapshot){
    ctx.activity('Loading your toolpath…');
    ctx.paathView.clear();
    machinePose.machineSession?.dispose();machinePose.requestingPose=null;
    const session=machinePose.machineSession=sourceSession(new Worker('/studio/source-worker.mjs',{type:'module'}));
    try{return await session.load({printId:snapshot.printId,revision:snapshot.revision,outputId:snapshot.outputId,
      plan:snapshot.plan,machine:snapshot.machine,valueURL:snapshot.valueURL,inspection:snapshot.pathSummary?.inspection});}
    catch(error){session.dispose();if(machinePose.machineSession===session)machinePose.machineSession=null;throw error;}
  }
  function bindCachedProgram(snapshot){return machinePose.machineSession?.bind(snapshot);}
  async function decodeSavedPathInWorker(snapshot){
    const program=await decodeInWorker({...snapshot,outputId:snapshot.review.path.id});
    return {...program,neutral:true,notice:snapshot.outputAvailability??'Generate to write its machine program before exporting.'};
  }
  async function poll(){
    if(printSync.polling||studioWork.busy)return;printSync.polling=true;const update=printSync.stateUpdate;
    try{
      const needsFullState=!printSync.state||printSync.reconnecting||needsTourToolpath(printSync.state);
      const options=!needsFullState&&printSync.stateTag?{headers:{'If-None-Match':printSync.stateTag}}:undefined;
      const response=await fetch('/api/state',options);
      if(response.status===304){printSync.reconnecting=false;printSync.loadedUpdate=update;if(printSync.state)ctx.render();return;}
      if(response.status===204){printSync.reconnecting=false;return;} // Still no print open.
      if(!response.ok)throw new Error('Reconnecting to your print…');
      const nextTag=response.headers?.get?.('etag')??null,next=await response.json();if(playState.movieController||studioWork.busy)return;
      // Restarted servers have new session credentials. Reload the page and its
      // viewer connection instead of repeatedly posting with the previous token.
      if(printSync.state?.instanceId&&next.instanceId!==printSync.state.instanceId){window.location.reload();return;}
      if(printSync.reconnecting)ctx.message('');
      const refreshUpdatedPrint=()=>refresh(true,false,next,nextTag);
      const metadataOnly=Boolean(printSync.state&&!needsFullState&&next.presentationFingerprint===printSync.state.presentationFingerprint);
      if(metadataOnly)await refreshUpdatedPrint();
      else await ctx.working('Loading and checking the updated print…',refreshUpdatedPrint);
      printSync.reconnecting=false;printSync.loadedUpdate=update;if(printSync.state)ctx.render();
    }catch(e){printSync.reconnecting=true;ctx.agentUI.settled(e);$('#confirm').disabled=true;ctx.message('Could not update the print: '+e.message+' Reconnecting…');}
    finally{printSync.polling=false;}
  }
  async function loadStudio(){
    await studioWork.tourUI.load();await refresh();
    const inspection=new URLSearchParams(location.search),seconds=Number(inspection.get('time'));
    if(!inspection.has('nozzle-clearance')&&!inspection.has('time'))return;
    if(inspection.has('output')&&inspection.get('output')!==printSync.state?.outputId){ctx.message('This inspection link refers to a different saved toolpath.',true);return;}
    if(inspection.get('nozzle-clearance')==='1')$('#nozzle-clearance').checked=true;
    if(printSync.state?.program){
      ctx.clearManual();ctx.stop();viewState.tab='toolpath';ctx.layerFade.reset();
      if(inspection.has('time')&&Number.isFinite(seconds))playState.seconds=Math.max(0,Math.min(ctx.duration(),seconds));
      ctx.render();
    }
  }
  function scheduleChange(){
    if(printSync.changeTimer)clearTimeout(printSync.changeTimer);
    printSync.changeTimer=setTimeout(()=>{
      printSync.changeTimer=null;
      if(studioWork.busy||printSync.polling)scheduleChange();
      else void poll();
    },75);
  }
  // Pushed requests also carry hand-back presentation targets. Refresh navigation
  // and acknowledge the displayed result even when the saved print is unchanged.
  function studioUpdate(event){
    if(event.detail.kind==='progress'){printSync.progressUpdate++;ctx.applyProgress(event.detail.status,studioWork.generationTarget,event.detail.selectionVersion);return;}
    if(event.detail.kind==='visual-check'){void ctx.captureViewerFrame(event.detail);return;}
    const {kinds=[]}=event.detail;
    if(kinds.includes('print')){printSync.stateUpdate++;printSync.progressUpdate++;ctx.clearCalculationProgress();printSync.calculationSelectionVersion=null;if(printSync.state)ctx.render();void ctx.pollPreparation();}
    if(kinds.includes('print')||kinds.includes('generation')||kinds.includes('tour')||kinds.includes('requests'))scheduleChange();
  }
  function studioVisible(){if(document.visibilityState==='visible')scheduleChange();}
  function stopFallbackPolling(){clearInterval(printSync.stateFallbackTimer);clearInterval(printSync.progressFallbackTimer);printSync.stateFallbackTimer=printSync.progressFallbackTimer=null;}
  function startFallbackPolling(){
    if(printSync.stateFallbackTimer)return;
    printSync.stateFallbackTimer=setInterval(poll,15_000);printSync.progressFallbackTimer=setInterval(ctx.pollPreparation,1000);
  }
  function studioConnection(event){
    if(event.detail.open){stopFallbackPolling();void ctx.pollPreparation();}
    else startFallbackPolling();
    scheduleChange();
  }
  function connectStudioUpdates(){
    window.addEventListener('saam-studio-update',studioUpdate);
    viewerReadyForCaptures();
    window.addEventListener('saam-viewer-connection',studioConnection);
    document.addEventListener('visibilitychange',studioVisible);
    if(viewerConnected())studioConnection({detail:{open:true}});else startFallbackPolling();
  }
  function disposeStudioSession(){
    if(printSync.changeTimer){clearTimeout(printSync.changeTimer);printSync.changeTimer=null;}
    clearInterval(studioWork.importElapsedTimer);studioWork.importElapsedTimer=null;
    stopFallbackPolling();machinePose.machineSession?.dispose();ctx.paathView.clear();ctx.executionReview.clear();ctx.inspectionUI.clear();ctx.viewer.dispose();
  }
  function restoreStudioSession(event){
    const reloadRestoredPrint=()=>refresh(false,true);
    if(event.persisted)ctx.working('Restoring your print…',reloadRestoredPrint).catch(error=>ctx.message(error.message,true));
  }
  function connectStudioSession(){
    window.addEventListener('pagehide',disposeStudioSession);
    window.addEventListener('pageshow',restoreStudioSession);
  }
  // Studio opened with no print waits for one: the person opens a print or the
  // tour, or the agent opens one through request_review.
  function showNoPrint(error){
    $('#kind-label').textContent='SAAM STUDIO';$('#view-title').textContent='No print open';
    $('#guidance').textContent=NO_PRINT;ctx.message('');
  }
  function reportOpening(error){
    if(error.code==='NO_PRINT')showNoPrint(error);
    else ctx.message(error.message,true);
  }
  return {loadAndAdoptStudioState,presentStudioState,ensureTourGeneration,refresh,applyProgramPresentation,acknowledgeDisplayedView,painted,decodeInWorker,bindCachedProgram,decodeSavedPathInWorker,poll,loadStudio,scheduleChange,studioUpdate,studioVisible,stopFallbackPolling,startFallbackPolling,studioConnection,connectStudioUpdates,disposeStudioSession,restoreStudioSession,connectStudioSession,showNoPrint,reportOpening};
}
