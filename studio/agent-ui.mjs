import {agentIndicator,requestReceiptState,activeEditStage} from './work-state.mjs';
export {agentIndicator} from './work-state.mjs';
export function createAgentUI({onActivity=()=>{},onRequests=()=>{},onPresentation=()=>{},getStage=()=>null}={}){
  const indicator=document.getElementById('agent-status'),dots=indicator.querySelector('.typing-dots'),notice=document.getElementById('agent-timeout');
  let running=false,refreshAgain=false,requests=[],view={},lastActivity,askedPresentation;const closedOwners=new Set(),retired=new Map();
  function merge(records,snapshot){
    const merged=new Map(requests.map(r=>[r.id,r]));let changed=false;
    for(const record of records){const previous=merged.get(record.id);
      if(!previous&&record.updatedAt<=(retired.get(record.id)??-Infinity))continue;
      if(!previous||previous.updatedAt<record.updatedAt||previous.updatedAt===record.updatedAt&&record.presented&&!previous.presented){merged.set(record.id,record);changed=true;}
    }
    if(snapshot){const included=new Set(records.map(r=>r.id));
      for(const [id,record] of merged)if(!included.has(id)&&snapshot.get(id)===record){
        retired.set(id,record.updatedAt);merged.delete(id);changed=true;
      }
    }
    if(changed){requests=[...merged.values()];onRequests(requests);}
  }
  function fadeActive(){
    const {active}=agentIndicator(requests,{closedOwners,view});
    // The pane being regenerated dims; an unrelated stage stays crisp. A toolpath
    // (re)generation therefore leaves the geometry pane sharp while it runs, so
    // the person can step back to the shape without losing the faded preview.
    return active&&(activeEditStage(requests,{closedOwners,view})!=='toolpath'||getStage()!=='geometry');
  }
  function reflectFade(){document.getElementById('canvas').classList.toggle('work-faded',fadeActive());}
  function render(){
    const {active,message}=agentIndicator(requests,{closedOwners,view});
    reflectFade();
    indicator.hidden=!active&&!message;dots.hidden=!active;notice.hidden=!message;notice.textContent=message;
    indicator.setAttribute('aria-label',active?'Updating preview':message);
    if(active!==lastActivity){lastActivity=active;onActivity(active);}
    // The server decides whether a drawn view actually receipts a request, and
    // may decline. Ask again only when the displayed view or the records moved,
    // so a declined acknowledgement cannot become a standing retry.
    const receipting=requests.filter(r=>!r.presented&&['working','completed'].includes(r.status)&&requestReceiptState(r,{view}).receipt);
    const asking=view.ready&&!view.loading&&receipting.length
      ?JSON.stringify([view.printId,view.snapshot,receipting.map(r=>r.id+':'+r.updatedAt)]):null;
    if(asking&&asking!==askedPresentation){askedPresentation=asking;onPresentation();}
    else if(!asking)askedPresentation=null;
  }
  addEventListener('saam-agent-connection-closed',event=>{
    closedOwners.add(event.detail.ownerId);
    if(event.detail.requests)merge(event.detail.requests);
    render();
  });
  async function refresh(){
    if(running){refreshAgain=true;return running;}
    running=(async()=>{do{
      refreshAgain=false;
      const snapshot=new Map(requests.map(r=>[r.id,r]));
      try{const response=await fetch('/api/agent-requests');if(response.ok)merge((await response.json()).requests,snapshot);}catch{}
      render();
    }while(refreshAgain);})();
    try{await running;}finally{running=false;}
  }
  // Record changes arrive as pushes, like the revision read: the local timer
  // only re-evaluates expiry and the lost-contact message, while a reopened
  // viewer stream, the page becoming visible and a slow heartbeat recover a
  // push that was missed. Reading every render turned an idle page into a
  // continuous request poll.
  addEventListener('saam-studio-change',event=>{if(event.detail.kinds.includes('requests'))void refresh();});
  addEventListener('saam-viewer-connection',()=>{void refresh();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  void refresh();setInterval(render,750);setInterval(()=>{void refresh();},15_000);
  function present(work){if(!work)return;view={...view,printId:work.printId,snapshot:work.snapshot,ready:true,errorAt:null,awaitingConfirmation:work.awaitingConfirmation===true};render();}
  return {refresh,reflectFade,
    generating(){return activeEditStage(requests,{closedOwners,view})==='toolpath';},
    updated(records){merge(records);render();},
    loading(stage){view={...view,loading:true,loadingStage:stage??null,ready:false,errorAt:null};render();},
    received(work){
      if(!work)return;
      view={...view,printId:work.printId,snapshot:work.snapshot,ready:false,awaitingConfirmation:false};
      merge(work.requests);render();
    },
    present,
    presentState(state,stage,options){
      const receipt=requestReceiptState(null,{state,stage,...options});
      if(!receipt.receipt)return false;
      present({...state.work,snapshot:{...state.work.snapshot,stage},awaitingConfirmation:receipt.awaitingConfirmation});return true;
    },
    settled(error){view={...view,loading:false,...(error?{ready:false,errorAt:Date.now()}: {})};render();}
  };
}
