// One request lifecycle for the viewport, persisted presentation and tour gates.
// A target describes saved inputs; presentation describes a result actually drawn.
// Guidance is visually quiet until the agent publishes an actual edit target.
export const isEditRequest=request=>Boolean(request&&request.kind!=='advisory'
  &&(request.kind!=='guidance'||request.target));
function matchesReceipt(request,snapshot){
  if(!request?.baseline||!snapshot)return false;
  if(request.studioInstanceId&&snapshot.studioInstanceId&&request.studioInstanceId!==snapshot.studioInstanceId)return false;
  // An edit is delivered only by drawing its published target. A settings change
  // cannot be delivered by drawing unchanged geometry.
  if(!request.target)return false;
  return request.target.inputKey===snapshot.inputKey
    &&(request.target.stage==='geometry'||snapshot.stage==='toolpath')
    &&(request.baseline.inputKey!==snapshot.inputKey||request.baseline.generationKey!==snapshot.generationKey);
}

export function requestReceiptState(request,{view:displayedView,state,stage,requiresToolpath=false}={}){
  const display={view:displayedView};
  if(state){
    const geometryReady=stage==='geometry'&&Boolean(state.geometry);
    const toolpathReady=stage==='toolpath'&&!requiresToolpath&&!state.generationError&&!state.programError&&Boolean(state.program);
    const ready=Boolean(state.work?.snapshot)&&(geometryReady||toolpathReady);
    display.view={printId:state.work?.printId,snapshot:state.work?.snapshot?{...state.work.snapshot,stage}:null,ready,
      awaitingConfirmation:false};
  }
  const view=display.view;
  const relevant=Boolean(isEditRequest(request)&&(!view?.printId||request.printId===view.printId));
  const receipt=Boolean(relevant&&(request.presented||view?.ready&&matchesReceipt(request,view.snapshot)));
  const awaitingConfirmation=Boolean(relevant&&!receipt&&view?.ready&&view.awaitingConfirmation
    &&request.target?.stage==='toolpath'&&request.target.inputKey===view.snapshot?.inputKey);
  if(!request)return {activity:'idle',receipt:Boolean(view?.ready),awaitingConfirmation:Boolean(view?.awaitingConfirmation)};
  if(!relevant)return {activity:'idle',receipt:false,awaitingConfirmation:false};
  if(receipt)return {activity:'presented',receipt:true,awaitingConfirmation:false};
  if(['waiting','cancelled'].includes(request.status))return {activity:request.status,receipt:false,awaitingConfirmation};
  if(request.status==='failed')return {activity:'failed',receipt:false,awaitingConfirmation};
  const pendingResult=request.status==='completed'&&request.result
    &&matchesReceipt(request,{...request.result,stage:request.target?.stage??'toolpath'});
  const activity=receiptActivity(request,pendingResult,view,awaitingConfirmation);
  return {activity,receipt:false,awaitingConfirmation};
}

function receiptActivity(request,pendingResult,view,awaitingConfirmation){
  if(request.status==='completed'&&!pendingResult)return 'completed';
  if(request.status==='queued')return 'queued';
  if(view?.errorAt&&request.updatedAt<=view.errorAt)return 'failed';
  if(awaitingConfirmation)return 'waiting';
  return request.status==='working'||pendingResult?'working':'idle';
}

export function hasUnpreparedEdit(requests=[],snapshot){
  return requests.some(request=>['queued','working'].includes(requestReceiptState(request).activity)
    &&!request.presented&&request.target?.inputKey!==snapshot?.inputKey);
}

// Which pane the active work is regenerating, so only that pane dims: 'toolpath'
// when every active edit and any load target the toolpath, 'all' when something
// broader (a geometry edit, a full reload) is in flight, or null when idle. A
// toolpath-only result lets the geometry pane stay crisp while it computes.
export function summarizeWork(requests=[],{view}={}){
  const work={working:false,allToolpath:true};
  for(const request of requests){
    if(!isEditRequest(request)||view?.printId&&request.printId!==view.printId)continue;
    if(['queued','working'].includes(requestReceiptState(request,{view}).activity)){
      work.working=true;if(request.target?.stage!=='toolpath')work.allToolpath=false;
    }
  }
  const loadingScope=view?.loading?(view.loadingStage??'all'):null;
  const requestScope=work.working?(work.allToolpath?'toolpath':'all'):null;
  const stage=loadingScope&&requestScope
    ?loadingScope==='toolpath'&&requestScope==='toolpath'?'toolpath':'all'
    :loadingScope??requestScope??null;
  const active=Boolean(view?.loading)||work.working;
  return {active,message:'',stage};
}
