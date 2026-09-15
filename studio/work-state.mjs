// Visible work is separate from the agent's request bookkeeping. A newer,
// presented result can be ready before the agent sends its final acknowledgement.
export function hasPresentedResult(request,snapshot){
  if(request.kind==='guidance'||!request.baseline||!snapshot)return false;
  if(request.presented)return true;
  if(request.target)return request.target.inputKey===snapshot.inputKey
    &&(request.target.stage==='geometry'||snapshot.stage==='toolpath')
    &&(request.baseline.inputKey!==snapshot.inputKey||request.baseline.generationKey!==snapshot.generationKey);
  if(request.requiresTarget)return false;
  return request.baseline.inputKey!==snapshot.inputKey;
}

export function agentIndicator(requests,{now=Date.now(),closedOwners=new Set(),view}={}){
  const records=requests.filter(r=>!view?.printId||r.printId===view.printId).map(r=>{
    if(r.presented||view?.ready&&hasPresentedResult(r,view.snapshot))return {...r,status:'completed',timedOut:false,connectionClosed:false};
    if(!['queued','working'].includes(r.status))return r;
    if(closedOwners.has(r.ownerId))return {...r,status:'failed',connectionClosed:true,updatedAt:now};
    return r.expiresAt<=now?{...r,status:'failed',timedOut:true}:r;
  });
  const active=Boolean(view?.loading)||records.some(r=>{
    if(r.presented||view?.ready&&hasPresentedResult(r,view.snapshot))return false;
    if(view?.errorAt&&r.updatedAt<=view.errorAt)return false;
    if(r.status==='working')return true;
    // An early agent acknowledgement must not hide a result still being loaded.
    return r.status==='completed'&&r.result&&hasPresentedResult(r,r.result)&&Boolean(view);
  });
  const latest=[...records].sort((a,b)=>Math.max(a.updatedAt,a.timedOut?a.expiresAt:0)-Math.max(b.updatedAt,b.timedOut?b.expiresAt:0)).at(-1);
  return {active,message:active?'':latest?.connectionClosed?'(connection closed)':latest?.timedOut?'(request timed out)':''};
}
