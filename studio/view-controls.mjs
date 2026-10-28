// View controls: the person's and the agent's gestures over what is drawn (tab,
// camera, fit and saved view, playback time and layer, manual machine pose and the
// agent's captured frame) and the requests to draw it.
import {machinePalette,machineFitBounds,boundsCorners} from './machine-view.mjs';
import {point,invert} from '../core/geom/frame.mjs';
import {layerEndSeconds,stepLayerIndex,layerIndexAt,representativeLayer} from './toolpath-view.mjs';
import {advancePlayback} from './playback.mjs';
import {captureActive} from './viewer-session.mjs';
import {DEFAULT_CAMERA} from './camera.mjs';

export function createViewControls(ctx){
  // The page's records and values this part uses; ctx.NAME marks another part.
  const {$,$$,machinePose,orbitView,playState,printSync,studioWork,viewState}=ctx;
  const cameraState=()=>({yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:[...orbitView.pan],fitBounds:orbitView.fitBounds});
  function useCamera(c){if(c)({yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:orbitView.pan,fitBounds:orbitView.fitBounds}=c);}
  function machineSample(t=playState.seconds){return machinePose.machineSession?.current(t,{manual:machinePose.manualValues,jog:machinePose.manualJog})??null;}
  function machineDisplay(t=playState.seconds){const sample=machineSample(t);return machinePose.manualValues&&sample?.snapshot?.status!=='ready'?(machinePose.machineSession?.held(t)??sample):sample;}
  function clearManual(){machinePose.manualValues=null;machinePose.manualJog=null;machinePose.requestingPose=null;}
  function updateManualControls(sample){
    const descriptor=machinePose.machineSession?.scene?.descriptor,controls=descriptor?.controls??[];
    $('#manual-position').hidden=viewState.tab!=='toolpath'||ctx.cameras.mode!=='machine'||!controls.length;
    if(descriptor!==machinePose.manualDescriptor){
      machinePose.manualDescriptor=descriptor;$('#manual-sliders').replaceChildren();
      controls.forEach((c,i)=>{
        const row=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input'),output=document.createElement('output');
        row.className='manual-axis';input.id='manual-axis-'+i;input.type='range';input.step=c.step;input.min=c.min;input.max=c.max;
        label.htmlFor=input.id;label.textContent=c.label;output.htmlFor=input.id;
        input.oninput=()=>{
          const values=machinePose.machineSession?.held(playState.seconds)?.snapshot?.controlValues;if(!values?.length)return;
          stop();machinePose.manualValues=[...values];machinePose.manualValues[i]=Number(input.value);machinePose.manualJog={axis:i,from:[...values]};machinePose.requestingPose=null;requestDraw();
        };
        row.append(label,output,input);$('#manual-sliders').append(row);
      });
    }
    const values=sample?.snapshot?.controlValues??machinePose.manualValues;
    $$('#manual-sliders input').forEach((input,i)=>{
      input.disabled=studioWork.busy||!values?.length||!machinePose.machineSession?.held(playState.seconds);
      if(!values?.length)return;
      input.min=Math.min(controls[i].min,values[i]);input.max=Math.max(controls[i].max,values[i]);input.value=values[i];
      input.previousElementSibling.value=(Math.abs(values[i])<(0.1/2)?0:values[i]).toFixed(1)+' '+controls[i].unit;
    });
    $('#manual-reset').disabled=studioWork.busy||!machinePose.manualValues;
    $('#manual-status').textContent=machinePose.manualValues?(machinePose.machineSession?.error||sample?.snapshot?.diagnostics.map(d=>d.message).join(' · ')||(sample?'Manual pose · playback paused':'Solving pose…')):'';
  }
  function machineTheme(){const style=getComputedStyle(ctx.canvas);return Object.fromEntries(Object.keys(machinePalette).map(role=>[role,style.getPropertyValue('--machine-'+role).trim()||machinePalette[role]]));}
  function requestMachinePose(){
    const key=JSON.stringify([playState.seconds,machinePose.manualValues,machinePose.manualJog]);
    if(viewState.tab!=='toolpath'||!machinePose.machineSession?.scene||machineSample()||machinePose.requestingPose?.key===key)return;
    const session=machinePose.machineSession,t=playState.seconds;
    const promise=session.sample(t,{manual:machinePose.manualValues,jog:machinePose.manualJog}).then(()=>{if(machinePose.machineSession===session&&playState.seconds===t)requestDraw();}).catch(error=>{if(error.name!=='AbortError')ctx.message(error.message,true);})
      .finally(()=>{if(machinePose.requestingPose?.promise===promise)machinePose.requestingPose=null;});
    machinePose.requestingPose={key,promise};
  }
  const viewStorageKey=()=> 'saam-view:'+printSync.state?.printId;
  function saveView(){
    if(!printSync.state||printSync.state.inspection||playState.movieController)return;
    try{sessionStorage.setItem(viewStorageKey(),JSON.stringify({outputId:printSync.state.outputId,yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:orbitView.pan,fitBounds:orbitView.fitBounds,seconds:playState.seconds,tab:viewState.tab,
      speed:Number($('#playback-speed').value),previousLayerOpacity:Number($('#previous-layer-opacity').value),travel:$('#travel').checked,nozzleClearance:$('#nozzle-clearance').checked,followPlate:$('#follow-plate').checked,machineCameras:ctx.cameras.snapshot(cameraState())}));}catch{}
  }
  function restoreView(restoreTab=true){
    try{
      const saved=JSON.parse(sessionStorage.getItem(viewStorageKey()));if(!saved)return;
      if([saved.yaw,saved.tilt,saved.zoom].every(Number.isFinite)){orbitView.yaw=saved.yaw;orbitView.tilt=saved.tilt;orbitView.zoom=saved.zoom;}
      if(Array.isArray(saved.pan)&&saved.pan.length===2&&saved.pan.every(Number.isFinite))orbitView.pan=saved.pan;
      if(Number.isFinite(saved.speed))$('#playback-speed').value=saved.speed;
      $('#speed-label').value=$('#playback-speed').value+'×';
      if(Number.isFinite(saved.previousLayerOpacity))$('#previous-layer-opacity').value=saved.previousLayerOpacity;
      $('#previous-layer-opacity-label').value=$('#previous-layer-opacity').value+'%';
      $('#travel').checked=saved.travel===true;$('#nozzle-clearance').checked=saved.nozzleClearance===true;$('#follow-plate').checked=saved.followPlate!==false;
      if(saved.outputId===printSync.state.outputId){
        if(Number.isFinite(saved.seconds))playState.seconds=Math.max(0,Math.min(duration(),saved.seconds));
        if(saved.fitBounds?.min?.length===3&&saved.fitBounds?.max?.length===3&&[...saved.fitBounds.min,...saved.fitBounds.max].every(Number.isFinite))orbitView.fitBounds=saved.fitBounds;
        if(restoreTab&&['geometry','toolpath'].includes(saved.tab)&&(saved.tab!=='toolpath'||printSync.state.program||printSync.state.neutralProgram))viewState.tab=saved.tab;
        if(machinePose.machineSession?.scene)useCamera(ctx.cameras.restore(saved.machineCameras));
      }
      $('#fit-program').textContent=orbitView.fitBounds?.allMoves?'Fit part':'Fit all moves';
    }catch{}
  }
  function connectViewPersistence(){window.addEventListener('pagehide',saveView);}
  function requestDraw(){
    ctx.viewer.requestDraw(readViewerSnapshot,applyViewerAnnotations);
  }
  function clearProgramView(){
    clearManual();
    ctx.paathView.clear();
    ctx.executionReview.clear();
    if(ctx.cameras.mode==='machine')useCamera(ctx.cameras.switch('ghost',cameraState()));
    ctx.cameras.reset();
    ctx.viewer.clearProgram();
    machinePose.machineSession?.dispose();machinePose.machineSession=null;
  }
  const presentedState=()=>viewState.activePresentation?.presentedState??printSync.state;
  // The toolpath pane never goes empty. Without a current program it shows a faded
  // placeholder — the previous toolpath when one exists, otherwise the part
  // being sliced — through first generation, regeneration, reload and failure.
  const showingGeometry=()=>viewState.tab!=='toolpath'||!presentedState()?.program;
  const duration=()=>presentedState()?.program?.summary.motionSeconds??0;
  const clock=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
  function stop(){if(playState.playing)void studioWork.tourUI?.playback('pause');playState.playing=false;playState.playbackEpoch++;playState.lastFrame=0;cancelAnimationFrame(playState.frame);$('#play').textContent='Play';}
  // Part bounds come from the display proxy both packages write, so the camera
  // and the bed grid do not need to know which shape produced them.
  function partBounds() {
    if(viewState.tab==='toolpath'&&ctx.paathView.model().frame)return ctx.paathView.model().bounds;
    if(printSync.state?.inspection)return ctx.inspectionUI.model()?.bounds??{min:[0,0,0],max:[1,1,1]};
    const shown=viewState.tab==='toolpath'?(presentedState()??printSync.state):printSync.state;
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const point of [...(shown.geometry?.vertices??[]),...(shown.geometry?.curves??[]).filter(c=>c.visible!==false).flatMap(c=>c.points??[]),...(shown.geometry?.points??[]).filter(p=>p.visible!==false).map(p=>p.point),...(shown.geometry?.boundsMm?[shown.geometry.boundsMm.min,shown.geometry.boundsMm.max]:[])])for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
    if(viewState.tab==='toolpath'&&shown.program){
      if(viewState.waveBoundsMoves!==shown.program.moves){
        viewState.waveBoundsMoves=shown.program.moves;viewState.waveDisplayBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
        for(const move of viewState.waveBoundsMoves)if(move.extruding&&move.phase!=='prime')for(const p of [move.from,move.to])for(let i=0;i<3;i++){
          const v=p[i]-(i===0?shown.plan.placement?.xMm??0:i===1?shown.plan.placement?.yMm??0:0);
          viewState.waveDisplayBounds.min[i]=Math.min(viewState.waveDisplayBounds.min[i],v);viewState.waveDisplayBounds.max[i]=Math.max(viewState.waveDisplayBounds.max[i],v);
        }
      }
      for(let i=0;i<3;i++){min[i]=Math.min(min[i],viewState.waveDisplayBounds.min[i]);max[i]=Math.max(max[i],viewState.waveDisplayBounds.max[i]);}
    }
    return {min,max};
  }
  function applyRefreshNavigation(decision){
    if(decision.resetExport){stop();playState.seconds=decision.seconds;if(ctx.cameras.mode==='machine')useCamera(ctx.cameras.switch('ghost',cameraState()));ctx.cameras.reset();orbitView.fitBounds=null;}
    if(decision.resetView) {
      stop();viewState.selected=null;orbitView.fitBounds=null;orbitView.zoom=1;orbitView.pan=[0,0];playState.seconds=decision.seconds;
      ctx.cameras.reset();$('#follow-plate').checked=true;
    }
    viewState.tab=decision.tab;
    if(decision.notice)ctx.message(decision.notice);
    if(decision.restoreSavedView)restoreView(decision.restoreSavedTab);
    if(decision.resetSelection)selectFeature(null);
  }
  function selectFeature(id){viewState.selected=id;$('#selection').textContent=id?ctx.label(id):'Click a surface or edge to see its name';requestDraw();}
  function setTab(next){
    if(!printSync.state)return;
    clearManual();if(next!=='toolpath'&&ctx.cameras.mode==='machine')useCamera(ctx.cameras.switch('ghost',cameraState()));
    viewState.tab=next;stop();ctx.layerFade.reset();ctx.render();
    void ctx.acknowledgeDisplayedView().catch(error=>ctx.message(error.message,true));
  }
  function readViewerSnapshot(options={}) {
    if(!printSync.state)return {state:null,target:options.target??ctx.canvas,updateUI:options.updateUI??true};
    const position=options.position??playState.seconds,updateUI=options.updateUI??true,shown=viewState.tab==='toolpath'?(presentedState()??printSync.state):printSync.state;
    return {target:options.target??ctx.canvas,width:options.width??ctx.canvas.clientWidth,height:options.height??ctx.canvas.clientHeight,
      ratio:options.ratio??(devicePixelRatio||1),position,frameNow:options.now??performance.now(),fadeState:options.fadeState??ctx.layerFade,updateUI,
      playbackSpeed:options.playbackSpeed??(playState.playing?Number($('#playback-speed').value):0),machineState:printSync.state.inspection?null:options.machineState??machineDisplay(position),
      sourceSelection:ctx.paathView.model().sourceSelection,sourceSample:ctx.paathView.model().sourceSample,
      state:printSync.state,shown,tab:viewState.tab,selected:viewState.selected,selectionLabel:viewState.selected?ctx.label(viewState.selected):'',showGeometry:showingGeometry(),
      camera:{yaw:orbitView.yaw,tilt:orbitView.tilt,zoom:orbitView.zoom,pan:[...orbitView.pan],fitBounds:orbitView.fitBounds},bounds:partBounds(),phaseColours:ctx.phasePalette(),cameraMode:ctx.cameras.mode,machineColors:viewState.machineColors,
      settings:{showTravel:$('#travel').checked,showNozzleClearance:$('#nozzle-clearance').checked,followPlate:$('#follow-plate').checked,previousLayerOpacity:Number($('#previous-layer-opacity').value)/100},
      playing:playState.playing,manualPose:Boolean(machinePose.manualValues),duration:duration(),interaction:orbitView.drag?(orbitView.drag.pan?'pan':'orbit'):null,
      performanceContext:{tab:viewState.tab,view:ctx.cameras.mode,solid:viewState.tab==='toolpath'&&ctx.viewer.sceneState().solid,moves:printSync.state?.program?.moves.length??0,canvasCss:[ctx.canvas.clientWidth,ctx.canvas.clientHeight],
        devicePixelRatio:+(devicePixelRatio||1).toFixed(3),userAgent:navigator.userAgent}};
  }
  function applyViewerAnnotations(annotations) {
    if(!printSync.state)return;
    if(!printSync.state.inspection&&!playState.playing&&!playState.movieController)requestMachinePose();
    ctx.updateMachineStatus();
    if(annotations.selectionText!==null)$('#selection').textContent=annotations.selectionText;
    if(annotations.layerText!==null)$('#layer-label').textContent=annotations.layerText;
    if(annotations.detailText!==null)$('#viewer-detail').textContent=annotations.detailText;
    if(annotations.timeText!==null)$('#time-label').textContent=annotations.timeText;
    if(annotations.fadeContinuation||annotations.redraw)requestDraw();
  }
  function draw(options={}) {
    const snapshot=readViewerSnapshot(options),annotations=ctx.viewer.draw(snapshot);
    if(snapshot.updateUI)applyViewerAnnotations(annotations);
    return annotations;
  }
  function planCanvasDrag(current,point){
    const dx=point.x-current.drag.x,dy=point.y-current.drag.y;
    return {drag:{...current.drag,x:point.x,y:point.y},
      moved:current.moved||Math.hypot(point.x-current.drag.startX,point.y-current.drag.startY)>2,
      pan:current.drag.pan?[current.pan[0]+dx,current.pan[1]+dy]:[...current.pan],
      // Display only: orbit radians per dragged pixel.
      yaw:current.drag.pan?current.yaw:current.yaw+dx*.008,
      tilt:current.drag.pan?current.tilt:Math.max(-1.5,Math.min(1.5,current.tilt+dy*.008))};
  }
  function readCanvasDrag(){
    return {drag:{...orbitView.drag},moved:orbitView.moved,yaw:orbitView.yaw,tilt:orbitView.tilt,pan:[...orbitView.pan]};
  }
  function applyCanvasDrag(next){
    orbitView.drag.x=next.drag.x;orbitView.drag.y=next.drag.y;orbitView.moved=next.moved;
    orbitView.pan[0]=next.pan[0];orbitView.pan[1]=next.pan[1];orbitView.yaw=next.yaw;orbitView.tilt=next.tilt;
    ctx.viewer.noteMotion(orbitView.drag.pan?'pan':'orbit');requestDraw();
  }
  function beginCanvasDrag(e){
    if(e.button>2)return;
    e.preventDefault();ctx.canvas.focus();ctx.canvas.setPointerCapture(e.pointerId);
    orbitView.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,pan:e.shiftKey||e.button===1||e.button===2};orbitView.moved=false;
  }
  function moveCanvasDrag(e){
    if(!orbitView.drag)return;
    const current=readCanvasDrag();
    const next=planCanvasDrag(current,{x:e.clientX,y:e.clientY});
    applyCanvasDrag(next);
  }
  function endCanvasDrag(e){
    const select=orbitView.drag&&!orbitView.drag.pan&&!orbitView.moved;orbitView.drag=null;ctx.viewer.flushPerformance();
    if(select&&viewState.tab!=='toolpath'){const rect=ctx.canvas.getBoundingClientRect();selectFeature(ctx.viewer.pick({x:e.clientX-rect.left,y:e.clientY-rect.top}));}
  }
  function cancelCanvasDrag(){orbitView.drag=null;}
  function suppressCanvasContextMenu(e){e.preventDefault();}
  function connectCanvasPointerEvents(){
    ctx.canvas.onpointerdown=beginCanvasDrag;ctx.canvas.onpointermove=moveCanvasDrag;ctx.canvas.onpointerup=endCanvasDrag;
    ctx.canvas.onpointercancel=ctx.canvas.onlostpointercapture=cancelCanvasDrag;
    ctx.canvas.oncontextmenu=suppressCanvasContextMenu;
  }
  function worldToDisplay(p,pose=machineSample()?.pose){const plan=(presentedState()??printSync.state).plan,q=$('#follow-plate').checked&&pose?point(invert(pose.part),p):p;return [q[0]-(plan.placement?.xMm??0),q[1]-(plan.placement?.yMm??0),q[2]];}
  function fitMachine(){return machinePose.machineSession?.scene?machineFitBounds(machinePose.machineSession.scene,machineSample()?.pose,p=>worldToDisplay(p)):null;}
  function fitDisplayedPart(bounds=partBounds()){
    const pose=machineSample()?.pose;if(!pose||$('#follow-plate').checked)return null;
    const {xMm,yMm}=(presentedState()??printSync.state).plan.placement??{xMm:0,yMm:0},points=boundsCorners(bounds).map(p=>worldToDisplay(point(pose.part,[p[0]+xMm,p[1]+yMm,p[2]]),pose));
    return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
  }
  function stepLayer(direction){
    const pathView=ctx.viewer.sceneState().pathView;
    if(studioWork.busy||!pathView||!pathView.groups.length)return;
    clearManual();stop();ctx.layerFade.reset();
    playState.seconds=layerEndSeconds(pathView,stepLayerIndex(pathView,playState.seconds,direction));
    $('#scrub').value=playState.seconds;requestDraw();
  }
  async function animate(now){
    if(!playState.playing)return;
    const epoch=playState.playbackEpoch,next=playState.lastFrame?advancePlayback(playState.seconds,now-playState.lastFrame,Number($('#playback-speed').value),duration()):playState.seconds;
    playState.lastFrame=now;
    try{await machinePose.machineSession?.sample(next);}catch(error){if(error.name!=='AbortError')ctx.message(error.message,true);}
    if(!playState.playing||epoch!==playState.playbackEpoch)return;
    playState.seconds=next;$('#scrub').value=playState.seconds;draw();
    if(playState.seconds>=duration()){stop();requestDraw();return;}playState.frame=requestAnimationFrame(animate);
  }
  function seekTourLayer(startAt,feature='contour'){
    const pathView=ctx.viewer.sceneState().pathView;
    if(!pathView)throw Error('The toolpath is still loading.');
    const selected=startAt?(()=>{
      if(!Number.isInteger(startAt.layer)||startAt.layer<1)throw Error('Choose a deposited layer after the first.');
      const move=pathView.moves.find(candidate=>candidate.extruding&&candidate.layer===startAt.layer);
      if(!move)throw Error('That deposited layer is not in this toolpath.');
      return {seconds:move.startSeconds,layer:move.layer,index:layerIndexAt(pathView,move.startSeconds)};
    })():representativeLayer(pathView,{feature});
    if(!selected)throw Error('This toolpath has no deposited layers to show.');
    stop();playState.seconds=selected.seconds;$('#scrub').value=playState.seconds;ctx.layerFade.reset();requestDraw();
    return selected;
  }
  async function captureViewerFrame(request){
    if(!captureActive(request))return;
    const reply={id:request.id,bundleId:request.bundleId,target:request.target,stage:request.stage};
    try{
      while(studioWork.busy||printSync.polling){await ctx.painted();if(!captureActive(request))return;}
      if(!captureActive(request))return;
      await ctx.working('Preparing visual check…',async()=>{
        if(!captureActive(request))return;
        await ctx.refresh(true);
        if(!captureActive(request))return;
        const evidence=printSync.state.work?.snapshot;
        if(printSync.state.work?.printId!==request.bundleId
          ||['revision','inputKey','geometryKey','generationKey'].some(key=>(evidence?.[key]??null)!==(request.target[key]??null)))
          throw Error('Studio is displaying different saved inputs.');
        if(request.stage==='toolpath'&&!(presentedState()??printSync.state).program)throw Error('Studio has no toolpath to display.');
        stop();viewState.tab=request.stage;viewState.selected=null;
        Object.assign(orbitView,DEFAULT_CAMERA,{zoom:1,pan:[0,0],fitBounds:null});
        if(request.stage==='toolpath'){playState.seconds=duration();ctx.layerFade.reset();}
        ctx.render();draw({updateUI:false});
        if(!captureActive(request))return;
        reply.target=evidence;reply.png=ctx.canvas.toDataURL('image/png');
        if(request.stage==='toolpath')reply.phases=ctx.phasePalette();
      },{preview:false});
    }catch(error){if(!captureActive(request))return;reply.error=error.message;ctx.message(error.message,true);}
    if(!captureActive(request))return;
    try{await ctx.api('visual-check',reply);}catch(error){if(captureActive(request))ctx.message('Visual check unavailable: '+error.message,true);}
  }
  return {cameraState,useCamera,machineSample,machineDisplay,clearManual,updateManualControls,machineTheme,requestMachinePose,viewStorageKey,saveView,restoreView,connectViewPersistence,requestDraw,clearProgramView,presentedState,showingGeometry,duration,clock,stop,partBounds,selectFeature,setTab,readViewerSnapshot,applyViewerAnnotations,draw,planCanvasDrag,readCanvasDrag,applyCanvasDrag,beginCanvasDrag,moveCanvasDrag,endCanvasDrag,cancelCanvasDrag,suppressCanvasContextMenu,connectCanvasPointerEvents,worldToDisplay,fitMachine,fitDisplayedPart,stepLayer,animate,seekTourLayer,captureViewerFrame,applyRefreshNavigation};
}
