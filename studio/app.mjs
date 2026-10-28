import {createPageSync} from './page-sync.mjs';
import {createPageActions} from './page-actions.mjs';
import {createPanels} from './panels.mjs';
import {createViewControls} from './view-controls.mjs';
import {initializeChatUI} from './chat-ui.mjs';
import {createTourUI,needsTourToolpath} from './tour-ui.mjs';
import {exportMovie} from './playback.mjs';
import {createLayerFade} from './toolpath-view.mjs';
import {DEFAULT_PHASE_COLOURS} from '../core/print/phase-colours.mjs';
import {machineCameras} from './studio/machine-session.mjs';
import {machinePalette} from './machine-view.mjs';
import {createViewerRenderer} from './viewer-renderer.mjs';
import {DEFAULT_CAMERA} from './camera.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';
import {createServicePanel} from './service-panel.mjs';
import {createInspectionUI} from './inspection-ui.mjs';
import {createPaathView} from './paath-view.mjs';
import {createExecutionReview} from './execution-review.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const token=$('meta[name="saam-token"]').content;
createServicePanel({token,available:$('meta[name="saam-service"]').content==='on'});
const NO_PRINT='Open a print, import STL or ask your agent to make a part.';
// Title: the server's runtime name ("SAAM Studio 0.3.6" or "SAAM Studio source"), the print, then the port,
// which alone tells every window apart and by which opening SAAM again finds it (studio/raise-window.ps1).
const studioName=document.title,studioTitle=printName=>[studioName,printName,location.port].filter(Boolean).join(' · ');
document.title=studioTitle();
const exportedThisSession=new Set();
const exportKey=()=>printSync.state?.printId+':'+printSync.state?.outputId;
// Page state, one record per owner: the print and its server sync, Studio-run
// work, what the view shows, the orbit camera, playback, and the machine pose.
const printSync={state:undefined,stateTag:null,stateUpdate:0,loadedUpdate:0,polling:false,reconnecting:false,changeTimer:undefined,stateFallbackTimer:undefined,progressFallbackTimer:undefined,progressPolling:false,progressUpdate:0,calculationSelectionVersion:null};
const studioWork={busy:false,generating:false,exporting:false,generationTarget:null,acknowledging:false,presentationPending:null,importElapsedTimer:null,episodeWorking:false,tourUI:undefined};
const viewState={tab:'geometry',selected:null,activePresentation:null,exportNameState:null,machineColors:machinePalette,waveBoundsMoves:null,waveDisplayBounds:null};
const orbitView={...DEFAULT_CAMERA,zoom:1,pan:[0,0],fitBounds:null,drag:null,moved:false};
const playState={playing:false,frame:0,seconds:0,lastFrame:0,playbackEpoch:0,movieController:null,movieUrl:null};
const machinePose={machineSession:null,requestingPose:null,manualValues:null,manualJog:null,manualDescriptor:null};
// What the page's parts read from it and call in each other. Each name is resolved
// when used, so a part may use one made after it.
const ctx={
  get $(){return $;},get $$(){return $$;},get NO_PRINT(){return NO_PRINT;},get acknowledgeDisplayedView(){return acknowledgeDisplayedView;},
  get activity(){return activity;},get agentUI(){return agentUI;},get api(){return api;},get applyInspectionModel(){return applyInspectionModel;},
  get applyProgress(){return applyProgress;},get applyRefreshNavigation(){return applyRefreshNavigation;},get cameras(){return cameras;},get canvas(){return canvas;},
  get captureViewerFrame(){return captureViewerFrame;},get chatUI(){return chatUI;},get clearCalculationProgress(){return clearCalculationProgress;},get clearManual(){return clearManual;},
  get clearProgramView(){return clearProgramView;},get duration(){return duration;},get executionReview(){return executionReview;},get exportKey(){return exportKey;},
  get exportedThisSession(){return exportedThisSession;},get generationPending(){return generationPending;},get inspectionUI(){return inspectionUI;},get label(){return label;},
  get layerFade(){return layerFade;},get machinePose(){return machinePose;},get machineSample(){return machineSample;},get machineTheme(){return machineTheme;},
  get message(){return message;},get orbitView(){return orbitView;},get paathView(){return paathView;},get painted(){return painted;},
  get phasePalette(){return phasePalette;},get playState(){return playState;},get pollPreparation(){return pollPreparation;},get presentedState(){return presentedState;},
  get printSync(){return printSync;},get refresh(){return refresh;},get relay(){return relay;},get render(){return render;},
  get requestDraw(){return requestDraw;},get sampleNames(){return sampleNames;},get saveView(){return saveView;},get showCalculationProgress(){return showCalculationProgress;},
  get stop(){return stop;},get studioTitle(){return studioTitle;},get studioWork(){return studioWork;},get token(){return token;},
  get updateMachineStatus(){return updateMachineStatus;},get updateManualControls(){return updateManualControls;},get viewState(){return viewState;},get viewer(){return viewer;},
  get working(){return working;}
};
const {refresh,acknowledgeDisplayedView,painted,decodeInWorker,loadStudio,scheduleChange,connectStudioUpdates,connectStudioSession,reportOpening}=createPageSync(ctx);
const {api,working,activity,pollPreparation,clearCalculationProgress,showCalculationProgress,applyProgress,generationPending,download,openPrint,chooseSTL}=createPageActions(ctx);
const {label,render,updateMachineStatus,message}=createPanels(ctx);
const {cameraState,useCamera,machineSample,clearManual,updateManualControls,machineTheme,saveView,connectViewPersistence,requestDraw,clearProgramView,presentedState,duration,clock,stop,partBounds,setTab,draw,connectCanvasPointerEvents,fitMachine,fitDisplayedPart,stepLayer,animate,seekTourLayer,captureViewerFrame,applyRefreshNavigation}=createViewControls(ctx);
import {createAgentUI} from './agent-ui.mjs';
const agentUI=initializeAgentInterface();
function initializeAgentInterface(){return createAgentUI({onActivity:active=>studioWork.tourUI?.activity(active),onWork:active=>{studioWork.episodeWorking=active;if(printSync.state)render();},onRequests:requests=>{
  if(!printSync.state?.work)return;
  printSync.state.work.requests=requests;
  if(needsTourToolpath(printSync.state))scheduleChange();
},onPresentation:failure=>acknowledgeDisplayedView(failure).catch(error=>{message(error.message,true);throw error;}),getStage:()=>viewState.tab});}
const canvas=$('#canvas');
// View bursts go to the server for agents; failures never reach the person.
// Material detail drops while the view moves and the measured frame cost is
// high; one full-detail frame follows when motion stops.
// ?motion-quality=N pins a level, still frames included, to inspect or time it.
const pinnedQuality=/^[0-2]$/.test(new URLSearchParams(location.search).get('motion-quality')??'')?Number(new URLSearchParams(location.search).get('motion-quality')):null;
const layerFade=createLayerFade();
const cameras=machineCameras();
const viewer=createViewerRenderer({canvas,pinnedQuality,reportPerformance:burst=>void fetch('/api/view-performance',{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify(burst)}).catch(()=>{})});
const paathView=createPaathView({parent:document.querySelector('aside'),viewer,onChange:()=>{stop();render();requestDraw();},onError:error=>message(error.message,true)});
const inspectionUI=createInspectionUI({viewer,token,typedViews:{paath:async({url,downloadURL,selection})=>{
  const program=await decodeInWorker({valueURL:url,plan:{},machine:null});
  if(printSync.state.inspection?.selectionId!==selection.selectionId)return null;
  await paathView.present(machinePose.machineSession,{program,plan:{},geometry:null,buildPath:true,buildMaterial:true,downloadURL});
  return {program,bounds:paathView.model().bounds};
}},onClose:()=>refresh(false,true)});
const executionReview=createExecutionReview({parent:document.querySelector('aside'),onSeek:seconds=>{clearManual();stop();layerFade.reset();playState.seconds=seconds;$('#scrub').value=seconds;requestDraw();}});
function applyInspectionModel(model){
  if(!printSync.state?.inspection||!model)return;
  printSync.state={...printSync.state,geometry:model.geometry,program:model.program};
  viewState.activePresentation={identity:{printId:null},presentedState:{...printSync.state,plan:{}},program:model.program};
  viewState.tab=model.kind==='paath'?'toolpath':'geometry';
  render();requestDraw();
}
const phasePalette=()=>printSync.state?.phasePalette??DEFAULT_PHASE_COLOURS;
const sampleNames={planar:'Body',curves:'Cladding','vase-wall':'Vase substrate'};
connectViewPersistence();
// A relay-extrusion machine feeds material by external control; it has no filament, bed or fan settings.
const relay=state=>state.machine?.capabilities?.includes('relay-extrusion');



$('#cancel-generation').onclick=async()=>{
  const target=studioWork.generationTarget;if(!target)return;
  $('#cancel-generation').disabled=true;
  try{const result=await(await api('cancel-calculation',{jobId:target.jobId,editRevision:target.editRevision,selectionVersion:target.selectionVersion})).json();
    if(result.cancelled){if(printSync.state&&result.kind==='generation')printSync.state.generationCancelled=true;message(result.kind==='import'?'Cancelling import…':result.kind==='geometry'?'Cancelling geometry calculation…':result.kind==='export'?'Cancelling Export…':'Toolpath calculation cancelled.');}
    else if(result.committing)message('The calculation finished; saving its checked file.');
  }catch(error){message(error.message,true);}finally{$('#cancel-generation').disabled=false;}
};

connectCanvasPointerEvents();
// Display only: zoom per wheel delta unit.
canvas.addEventListener('wheel',e=>{e.preventDefault();viewer.noteMotion('zoom');orbitView.zoom=Math.max(.08,Math.min(4,orbitView.zoom*Math.exp(-e.deltaY*.001)));requestDraw();},{passive:false});
canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;if(e.shiftKey){orbitView.pan[0]+=e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0;orbitView.pan[1]+=e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0;}else{if(e.key==='ArrowLeft')orbitView.yaw-=.1;else if(e.key==='ArrowRight')orbitView.yaw+=.1;else if(e.key==='ArrowUp')orbitView.tilt-=.1;else orbitView.tilt+=.1;}e.preventDefault();viewer.noteMotion(e.shiftKey?'pan':'orbit');requestDraw();};
new ResizeObserver(requestDraw).observe(canvas);
$$('[data-view]').forEach(b=>b.onclick=()=>{const mode=b.dataset.view;if(mode==='iso'){orbitView.yaw=DEFAULT_CAMERA.yaw;orbitView.tilt=DEFAULT_CAMERA.tilt;}if(mode==='side'){orbitView.yaw=0;orbitView.tilt=0;}if(mode==='top'){orbitView.yaw=0;orbitView.tilt=Math.PI/2;}requestDraw();});
$('#machine-view').onchange=()=>{
  clearManual();
  const next=$('#machine-view').checked?'machine':'ghost';
  useCamera(cameras.switch(next,cameraState(),{yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:1,pan:[0,0],fitBounds:fitMachine()}));
  $('#fit-program').hidden=next==='machine';$('#fit-program').textContent=orbitView.fitBounds?.allMoves?'Fit part':'Fit all moves';updateMachineStatus();saveView();requestDraw();
};
$('#reset-view').onclick=()=>{orbitView.zoom=1;orbitView.pan=[0,0];orbitView.yaw=DEFAULT_CAMERA.yaw;orbitView.tilt=DEFAULT_CAMERA.tilt;orbitView.fitBounds=cameras.mode==='machine'?fitMachine():fitDisplayedPart();$('#fit-program').textContent='Fit all moves';requestDraw();};
$('#fit-program').onclick=()=>{
  if(orbitView.fitBounds?.allMoves){orbitView.fitBounds=fitDisplayedPart();$('#fit-program').textContent='Fit all moves';}
  else {
    const part=partBounds();
    orbitView.fitBounds={min:[part.min[0],part.min[1],0],max:[part.max[0],part.max[1],0]};
    const shown=presentedState()??printSync.state;
    for(const move of shown.program.moves)for(const p of [move.from,move.to])for(let i=0;i<3;i++){
      const v=p[i]-(i===0?shown.plan.placement?.xMm??0:i===1?shown.plan.placement?.yMm??0:0);
      orbitView.fitBounds.min[i]=Math.min(orbitView.fitBounds.min[i],v);orbitView.fitBounds.max[i]=Math.max(orbitView.fitBounds.max[i],v);
    }
    orbitView.fitBounds=fitDisplayedPart(orbitView.fitBounds)??orbitView.fitBounds;orbitView.fitBounds.allMoves=true;
    $('#travel').checked=true;$('#fit-program').textContent='Fit part';
  }
  orbitView.zoom=1;orbitView.pan=[0,0];requestDraw();
};
$$('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('#export-name').oninput=event=>{if(!viewState.exportNameState)return;viewState.exportNameState.value=event.target.value;viewState.exportNameState.dirty=event.target.value!==viewState.exportNameState.suggested;};
$('#next').onclick=async()=>{
  if(!printSync.state||$('#next').disabled)return;message('');
  if(printSync.state.programViewError){
    try{await working('Loading your saved toolpath…',async()=>{await refresh();if(printSync.state.program)setTab('toolpath');});}
    catch(e){message(e.message,true);}
    return;
  }
  if(completedOutputState(printSync.state).current||generationPending()){setTab('toolpath');return;}
  try{
    await working('Preparing your toolpath…',async()=>{
      studioWork.generating=true;render();
      try{await api('generate',{development:false});viewState.tab='toolpath';}
      finally{studioWork.generating=false;await refresh();}
    },{stage:'toolpath'});
  }catch(e){message(e.message,true);}
};
$('#confirm').onclick=async()=>{
  if(!printSync.state||$('#confirm').disabled)return;message('');
  studioWork.exporting=true;render();
  try{
    await download();
    if(studioWork.tourUI?.active()){await api('tour',{action:'finish'});await studioWork.tourUI.load();}
  }catch(e){message(e.message,e.message!=='Export cancelled.');}
  finally{studioWork.exporting=false;if(printSync.state)render();}
};

$('#open-print').onclick=async()=>{
  if(studioWork.busy)return;$('#print-picker').showModal();$('#picker-message').textContent='Loading saved prints…';$('#print-list').replaceChildren();
  try{
    const response=await fetch('/api/prints');if(!response.ok)throw new Error('Could not list local prints.');
    const {prints}=await response.json();
    for(const print of prints){const button=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('span');
      name.textContent=print.name;detail.textContent=print.machine;button.append(name,detail);button.title=print.path;button.onclick=()=>openPrint(print.path);$('#print-list').append(button);}
    $('#picker-message').textContent=prints.length?'':'No saved prints found here. Enter a local print folder below.';
  }catch(error){$('#picker-message').textContent=error.message;}
};
$('#close-picker').onclick=()=>$('#print-picker').close();
$('#import-stl').onclick=()=>{if(!studioWork.busy)chooseSTL();};
$('#stl-file').onchange=async()=>{
  const file=$('#stl-file').files[0];if(!file||studioWork.busy)return;
  if(file.size>64*1024*1024){message('Choose an STL file up to 64 MiB.',true);return;}
  try{await working('Importing your STL…',async()=>{
    const query=new URLSearchParams({name:file.name,...(printSync.state?{printId:printSync.state.printId}:{})});
    const target={printId:printSync.state?.printId??null,editRevision:null};studioWork.generationTarget=target;
    let response;
    try{response=await fetch('/api/import-stl?'+query,{method:'POST',headers:{'X-SAAM-Token':token,'Content-Type':'application/octet-stream'},body:file});}
    finally{if(studioWork.generationTarget===target){studioWork.generationTarget=null;$('#cancel-generation').hidden=true;}}
    if(!response.ok){const result=await response.json();throw Object.assign(Error(result.error),{code:result.code});}
    await studioWork.tourUI.load();await refresh(false,true);message('');
  });}catch(error){message(error.message,error.code!=='IMPORT_CANCELLED');await studioWork.tourUI.load();if(printSync.state)await refresh(false,true);}
};
$('#open-path').onsubmit=event=>{event.preventDefault();openPrint($('#print-path').value.trim());};
$('#travel').onchange=requestDraw;
$('#nozzle-clearance').onchange=requestDraw;
$('#follow-plate').onchange=()=>{const fit=mode=>mode==='machine'?fitMachine():fitDisplayedPart();cameras.refit(fit);orbitView.fitBounds=fit(cameras.mode);$('#fit-program').textContent='Fit all moves';saveView();requestDraw();};
$('#playback-speed').oninput=()=>{$('#speed-label').value=$('#playback-speed').value+'×';};
$('#previous-layer-opacity').oninput=()=>{$('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';saveView();requestDraw();};
$('#manual-reset').onclick=()=>{clearManual();requestDraw();};
$('#scrub').oninput=()=>{clearManual();stop();layerFade.reset();playState.seconds=Number($('#scrub').value);requestDraw();};
$('#prev-layer').onclick=()=>stepLayer(-1);
$('#next-layer').onclick=()=>stepLayer(1);
$('#cancel-movie').onclick=()=>playState.movieController?.abort();
$('#export-movie').onclick=async()=>{
  if(studioWork.busy||!printSync.state?.program)return;
  clearManual();
  saveView();stop();requestDraw();studioWork.busy=true;
  const controller=new AbortController();playState.movieController=controller;
  const controls=$$('button,input').filter(element=>element.id!=='cancel-movie');
  const disabled=controls.map(element=>element.disabled);
  controls.forEach(element=>element.disabled=true);canvas.inert=true;
  $('#cancel-movie').hidden=false;$('#movie-progress').hidden=false;$('#movie-progress').value=0;
  $('#movie-download').hidden=true;
  const speed=Number($('#playback-speed').value),width=canvas.clientWidth,height=canvas.clientHeight,ratio=devicePixelRatio||1;
  const target=document.createElement('canvas');target.width=Math.round(width*ratio);target.height=Math.round(height*ratio);
  const fadeState=createLayerFade();
  $('#movie-status').textContent='Rendering movie at '+speed+'× · '+clock(duration()/speed+2)+' · 30 fps. Your viewer stays paused.';
  try{
    const blob=await exportMovie({canvas:target,duration:duration(),speed,signal:controller.signal,
      draw:async frame=>{const machineState=await machinePose.machineSession?.sample(frame.seconds,{signal:controller.signal});controller.signal.throwIfAborted();draw({target,width,height,ratio,position:frame.seconds,now:frame.now,fadeState,updateUI:false,playbackSpeed:speed,machineState});},
      onProgress:value=>{$('#movie-progress').value=value;}});
    if(playState.movieUrl)URL.revokeObjectURL(playState.movieUrl);playState.movieUrl=URL.createObjectURL(blob);
    const link=$('#movie-download');link.href=playState.movieUrl;
    link.download=(printSync.state.printName??'saam').replace(/[^a-zA-Z0-9_-]/g,'-')+'-toolpath-'+speed+'x.webm';
    link.hidden=false;link.click();
    $('#movie-status').textContent='Movie ready · '+clock(duration()/speed+2)+' · '+(blob.size/1024/1024).toFixed(1)+' MB WebM. Includes the final fade.';
  }catch(error){$('#movie-status').textContent=controller.signal.aborted?'Movie export cancelled.':error.message;}
  finally{
    playState.movieController=null;studioWork.busy=false;controls.forEach((element,index)=>element.disabled=disabled[index]);canvas.inert=false;
    $('#cancel-movie').hidden=true;$('#movie-progress').hidden=true;render();
  }
};
$('#play').onclick=()=>{if(studioWork.busy||!(printSync.state?.program&&!printSync.state.programError||printSync.state?.neutralProgram))return;clearManual();if(playState.playing){stop();requestDraw();return;}if(playState.seconds>=duration()){playState.seconds=0;layerFade.reset();}playState.playing=true;void studioWork.tourUI?.playback('play');playState.lastFrame=0;$('#play').textContent='Pause';playState.frame=requestAnimationFrame(animate);};
function createStudioTour(){
  return createTourUI({post:api,refresh,working,setTab,isBusy:()=>studioWork.busy,state:()=>printSync.state,seek:seekTourLayer});
}
const chatUI=initializeChatUI();
function initializeStudio(){
  studioWork.tourUI=createStudioTour();
  working('Opening Studio…',loadStudio).catch(reportOpening);
  connectStudioUpdates();
  connectStudioSession();
}
initializeStudio();
