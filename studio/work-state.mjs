// One request lifecycle for the viewport, persisted presentation and tour gates.
// A target describes saved inputs; presentation describes a result actually drawn.
const edits=request=>!['guidance','advisory'].includes(request.kind);
export function hasPresentedResult(request,snapshot){
  if(!edits(request)||!request.baseline||!snapshot)return false;
  if(request.presented)return true;
  if(request.target)return request.target.inputKey===snapshot.inputKey
    &&(request.target.stage==='geometry'||snapshot.stage==='toolpath')
    &&(request.baseline.inputKey!==snapshot.inputKey||request.baseline.generationKey!==snapshot.generationKey);
  if(request.requiresTarget)return false;
  // Compatibility for old single-request records. A settings change cannot be
  // delivered by drawing unchanged geometry. New edits always publish a target.
  return request.baseline.inputKey!==snapshot.inputKey
    &&(snapshot.stage==='toolpath'||request.baseline.geometryKey&&snapshot.geometryKey
      &&request.baseline.geometryKey!==snapshot.geometryKey);
}

export function requestActivity(request,{now=Date.now(),closedOwners=new Set(),view}={}){
  if(!edits(request)||view?.printId&&request.printId!==view.printId)return 'idle';
  if(request.presented||view?.ready&&hasPresentedResult(request,view.snapshot))return 'presented';
  if(['waiting','cancelled'].includes(request.status))return request.status;
  if(request.status==='failed')return request.connectionClosed?'disconnected':request.timedOut?'expired':'failed';
  const pendingResult=request.status==='completed'&&request.result
    &&hasPresentedResult(request,{...request.result,stage:request.target?.stage??'toolpath'});
  if(request.status==='completed'&&!pendingResult)return 'completed';
  if(closedOwners.has(request.ownerId))return 'disconnected';
  if(request.expiresAt<=now)return 'expired';
  if(request.status==='queued')return 'queued';
  if(view?.errorAt&&request.updatedAt<=view.errorAt)return 'failed';
  // Only a bound toolpath request for these exact inputs waits on approval.
  // Unrelated or unfinished edits remain active while that shape is shown.
  if(view?.ready&&view.awaitingConfirmation&&request.target?.stage==='toolpath'
    &&request.target.inputKey===view.snapshot?.inputKey)return 'waiting';
  return request.status==='working'||pendingResult?'working':'idle';
}

export function hasUnpreparedEdit(requests=[],snapshot){
  return requests.some(request=>requestActivity(request)==='working'
    &&!request.presented&&request.target?.inputKey!==snapshot?.inputKey);
}

export function agentIndicator(requests,{now=Date.now(),closedOwners=new Set(),view}={}){
  const records=requests.filter(r=>edits(r)&&(!view?.printId||r.printId===view.printId));
  const context={now,closedOwners,view};
  const active=Boolean(view?.loading)||records.some(r=>requestActivity(r,context)==='working');
  const latest=[...records].sort((a,b)=>Math.max(a.updatedAt,a.timedOut?a.expiresAt:0)-Math.max(b.updatedAt,b.timedOut?b.expiresAt:0)).at(-1);
  const status=latest&&requestActivity(latest,context);
  return {active,message:active?'':status==='disconnected'?'(connection closed)':status==='expired'?'(lost contact)':''};
}
