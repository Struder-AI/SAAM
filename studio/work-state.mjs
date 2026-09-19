// One request lifecycle for the viewport, persisted presentation and tour gates.
// A target describes saved inputs; presentation describes a result actually drawn.
const edits=request=>!['guidance','advisory'].includes(request.kind);
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

export function requestReceiptState(request,{now=Date.now(),closedOwners=new Set(),view,state,stage,requiresToolpath=false}={}){
  if(state){
    const geometryReady=stage==='geometry'&&Boolean(state.geometry);
    const toolpathReady=stage==='toolpath'&&!requiresToolpath&&!state.generationError&&!state.programError&&Boolean(state.program);
    const ready=Boolean(state.work?.snapshot)&&(geometryReady||toolpathReady);
    view={printId:state.work?.printId,snapshot:state.work?.snapshot?{...state.work.snapshot,stage}:null,ready,
      awaitingConfirmation:false};
  }
  const relevant=Boolean(request&&edits(request)&&(!view?.printId||request.printId===view.printId));
  const receipt=Boolean(relevant&&(request.presented||view?.ready&&matchesReceipt(request,view.snapshot)));
  const awaitingConfirmation=Boolean(relevant&&!receipt&&view?.ready&&view.awaitingConfirmation
    &&request.target?.stage==='toolpath'&&request.target.inputKey===view.snapshot?.inputKey);
  if(!request)return {activity:'idle',receipt:Boolean(view?.ready),awaitingConfirmation:Boolean(view?.awaitingConfirmation)};
  if(!relevant)return {activity:'idle',receipt:false,awaitingConfirmation:false};
  if(receipt)return {activity:'presented',receipt:true,awaitingConfirmation:false};
  if(['waiting','cancelled'].includes(request.status))return {activity:request.status,receipt:false,awaitingConfirmation};
  if(request.status==='failed')return {activity:request.connectionClosed?'disconnected':request.timedOut?'expired':'failed',receipt:false,awaitingConfirmation};
  const pendingResult=request.status==='completed'&&request.result
    &&matchesReceipt(request,{...request.result,stage:request.target?.stage??'toolpath'});
  let activity;
  if(request.status==='completed'&&!pendingResult)activity='completed';
  else if(closedOwners.has(request.ownerId))activity='disconnected';
  else if(request.expiresAt<=now)activity='expired';
  else if(request.status==='queued')activity='queued';
  else if(view?.errorAt&&request.updatedAt<=view.errorAt)activity='failed';
  else if(awaitingConfirmation)activity='waiting';
  else activity=request.status==='working'||pendingResult?'working':'idle';
  return {activity,receipt:false,awaitingConfirmation};
}

export function hasUnpreparedEdit(requests=[],snapshot){
  return requests.some(request=>requestReceiptState(request).activity==='working'
    &&!request.presented&&request.target?.inputKey!==snapshot?.inputKey);
}

// Which pane the active work is regenerating, so only that pane dims: 'toolpath'
// when every active edit and any load target the toolpath, 'all' when something
// broader (a geometry edit, a full reload) is in flight, or null when idle. A
// toolpath-only result lets the geometry pane stay crisp while it computes.
export function activeEditStage(requests=[],{now=Date.now(),closedOwners=new Set(),view}={}){
  const records=requests.filter(r=>edits(r)&&(!view?.printId||r.printId===view.printId));
  const context={now,closedOwners,view};
  const working=records.filter(r=>requestReceiptState(r,context).activity==='working');
  const loadingScope=view?.loading?(view.loadingStage??'all'):null;
  const requestScope=working.length?(working.every(r=>r.target?.stage==='toolpath')?'toolpath':'all'):null;
  if(loadingScope&&requestScope)return loadingScope==='toolpath'&&requestScope==='toolpath'?'toolpath':'all';
  return loadingScope??requestScope??null;
}

export function agentIndicator(requests,{now=Date.now(),closedOwners=new Set(),view}={}){
  const records=requests.filter(r=>edits(r)&&(!view?.printId||r.printId===view.printId));
  const context={now,closedOwners,view};
  const active=Boolean(view?.loading)||records.some(r=>requestReceiptState(r,context).activity==='working');
  const latest=[...records].sort((a,b)=>Math.max(a.updatedAt,a.timedOut?a.expiresAt:0)-Math.max(b.updatedAt,b.timedOut?b.expiresAt:0)).at(-1);
  const status=latest&&requestReceiptState(latest,context).activity;
  return {active,message:active?'':status==='disconnected'?'(connection closed)':status==='expired'?'(lost contact)':''};
}
