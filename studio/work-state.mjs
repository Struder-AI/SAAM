import {completedOutputState} from '../core/print/review-state.mjs';

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
    const toolpathReady=stage==='toolpath'&&!requiresToolpath&&!state.generationError&&completedOutputState(state).receipt;
    const ready=Boolean(state.work?.snapshot)&&(geometryReady||toolpathReady);
    display.view={printId:state.work?.printId,snapshot:state.work?.snapshot?{...state.work.snapshot,stage}:null,ready,
      awaitingConfirmation:false};
  }
  const view=display.view;
  const relevant=Boolean(isEditRequest(request)&&(!view?.printId||request.printId===view.printId));
  const receipt=Boolean(relevant&&(request.presented||view?.ready&&matchesReceipt(request,view.snapshot)));
  const awaitingConfirmation=Boolean(relevant&&!receipt&&view?.ready&&view.awaitingConfirmation
    &&request.target?.stage==='toolpath'&&request.target.inputKey===view.snapshot?.inputKey);
  if(!request)return {activity:'idle',receipt:Boolean(view?.ready||state&&stage==='toolpath'&&completedOutputState(state).available&&state.work?.snapshot),awaitingConfirmation:Boolean(view?.awaitingConfirmation)};
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

export function inspectionReceipt(request,view){
  return Boolean(request?.episode&&!request.workActive&&!request.handbackPending&&!request.inspectionPresented&&!request.inspectionFailed
    &&view?.ready&&!view.loading&&request.printId===view.printId&&request.inspectionTarget
    &&request.inspectionTarget.revision===view.snapshot?.revision
    &&(!request.inspectionTarget.stage||request.inspectionTarget.stage===view.snapshot?.stage));
}
export function inspectionFailure(request,view){
  return Boolean(request?.episode&&!request.workActive&&!request.handbackPending&&!request.inspectionPresented&&!request.inspectionFailed
    &&request.inspectionTarget&&view?.errorAt&&request.printId===view.printId
    &&request.inspectionTarget.revision===view.snapshot?.revision
    &&(!request.inspectionTarget.stage||request.inspectionTarget.stage===view.errorStage));
}
export function summarizeWork(requests=[],{view}={}){
  const scoped=requests.filter(r=>r.episode&&(!view?.printId||r.printId===view.printId));
  const latest=scoped.reduce((value,r)=>Math.max(value,r.episodeStartedAt??r.createdAt),0);
  const relevant=scoped.filter(r=>(r.episodeStartedAt??r.createdAt)===latest);
  const active=relevant.some(r=>r.workActive||r.handbackPending||r.inspectionTarget&&!r.inspectionPresented&&!r.inspectionFailed&&!inspectionReceipt(r,view)&&!inspectionFailure(r,view));
  const failure=relevant.findLast(r=>['failed','cancelled'].includes(r.status)&&!r.workActive);
  return {active:Boolean(view?.loading||active),message:relevant.findLast(r=>r.inspectionFailed)?.inspectionFailed??failure?.message??'',stage:active?'all':view?.loading?(view.loadingStage??'all'):null};
}
