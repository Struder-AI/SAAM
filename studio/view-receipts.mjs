// Receipts of what the page drew. A drawn view of the saved revision presents
// the requests whose results it shows; a retained inspection reports its own.
import {TOUR_LESSONS as L} from './tour-catalog.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';
import {recipeSkills} from '../core/print/summary.mjs';

export function createViewReceipts(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {chat,instanceId,note,session,workIdFor}=ctx;
  // Receipts of what the page showed: retained inspections and drawn views, which present request results.
  async function receiptRoute(url,data,progress,current,send){
    if(url.pathname==='/api/inspection-close'){
      if(!session.inspection||data.selectionId!==session.inspection.selectionId)throw Error('The retained inspection changed.');
      ctx.changeReview(null);ctx.lifetime.notify('studio-update',{kind:'state',kinds:['review']});send({ok:true});return true;
    }
    if(url.pathname==='/api/inspection-ready'){
      if(!session.inspection||data.selectionId!==session.inspection.selectionId||data.valueId!==session.inspection.valueId)throw Error('The retained inspection changed.');
      const receipt={selectionId:session.inspection.selectionId,observationId:session.inspection.observationId,valueId:session.inspection.valueId,
        inputRevision:session.inspection.inputRevision,status:data.renderError?'unavailable':'displayed',renderError:typeof data.renderError==='string'?data.renderError:null};
      note('inspection-presented',receipt);send({inspectionReady:receipt});return true;
    }
    if(url.pathname==='/api/view-ready'){
      if(session.inspection)throw Error('Retained inspections use their own ready receipt.');
      let presentedRequests=[];
      const stage=data.stage??(progress.step===L.geometry?'geometry':'toolpath');
      if(!['geometry','toolpath'].includes(stage))throw Error('Unknown displayed stage.');
      const requests=await chat.current.binding.requestsFor(session.dir,instanceId),observedRequests=Object.fromEntries(requests.map(record=>[record.id,record.updatedAt]));
      const renderError=typeof data.renderError==='string'?data.renderError:null;
      if(renderError){
        // A failed draw receipts the attempt, including a geometry fallback
        // or empty viewport. It grants neither delivery nor a tour gate and
        // needs no successful geometry/program load to finish hand-back.
        const target=requests.find(record=>record.inspectionTarget?.revision===data.revision)?.inspectionTarget;
        if(target)presentedRequests=await chat.current.binding.presented(session.dir,{...target,stage,studioInstanceId:instanceId,observedRequests,deliverable:false,renderError});
        note('view-failed',{error:renderError,stage,revision:data.revision,presentedRequestIds:presentedRequests.map(record=>record.id)});
        send({...progress,presentedRequests});return true;
      }
      const state=(await current.loadBundleSnapshot(session.dir,{program:stage!=='geometry'})).state;
      const receiptable=stage==='geometry'||completedOutputState(state,{generating:ctx.outputGenerating()}).receipt;
      const inspectable=stage==='geometry'||completedOutputState(state,{generating:ctx.outputGenerating()}).inspectable;
      if(data.revision===state.revision&&inspectable&&(stage==='geometry'||data.outputId===state.outputId)){
        presentedRequests=await chat.current.binding.presented(session.dir,{...state.workEvidence,stage,studioInstanceId:instanceId,observedRequests,deliverable:receiptable});
        if(stage==='toolpath'&&session.normalReviewPending){session.normalReviewPending=false;ctx.lifetime.notify('studio-update',{kind:'state',kinds:['review']});}
        note('view-presented',{stage,revision:state.revision,outputId:stage==='toolpath'?state.outputId??null:null,presentedRequestIds:presentedRequests.map(record=>record.id)});
        for(const record of presentedRequests)if(!record.inspectionFailed)note('request-presented',{requestId:record.id,requestKind:record.kind,stage});
        const advisory=state.program?.shortTravel;
        if(stage==='toolpath'&&advisory?.count&&workIdFor(session.dir))
          await chat.current.binding.ask({directory:session.dir,kind:'advisory',studioInstanceId:instanceId,
            key:`short-travel:${session.dir}:${state.outputId}`,
            evidence:{outputId:state.outputId,editRevision:state.editRevision,skills:recipeSkills(state.plan),shortTravel:advisory},
            instruction:`Toolpath quality advisory for export ${state.outputId}: ${advisory.message}\n`+
              `Affected recipe skills: ${recipeSkills(state.plan).join(', ')}. This notification preserves source locations and operation counts in evidence.shortTravel. `+
              'Mention this finding to the person in your next reply, then acknowledge this advisory as completed and continue the current user task; no repair or new approval is required.'});
      }
      const guide=receiptable?await chat.current.tour.acknowledgeView(session.dir,data,state):await chat.current.tour.info();
      send({...guide,presentedRequests});return true;
    }
    return false;
  }
  return {receiptRoute};
}
