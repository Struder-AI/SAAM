import {agentIndicator,hasPresentedResult} from './work-state.mjs';
export {agentIndicator} from './work-state.mjs';
export function createAgentUI({onActivity=()=>{},onRequests=()=>{},onPresentation=()=>{}}={}){
  const indicator=document.getElementById('agent-status'),dots=indicator.querySelector('.typing-dots'),notice=document.getElementById('agent-timeout');
  let running=false,refreshAgain=false,requests=[],view={},lastActivity;const closedOwners=new Set(),retired=new Map();
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
  function render(){
    const {active,message}=agentIndicator(requests,{closedOwners,view});
    document.getElementById('canvas').classList.toggle('work-faded',active);
    indicator.hidden=!active&&!message;dots.hidden=!active;notice.hidden=!message;notice.textContent=message;
    indicator.setAttribute('aria-label',active?'Updating preview':message);
    if(active!==lastActivity){lastActivity=active;onActivity(active);}
    if(view.ready&&!view.loading&&requests.some(r=>r.printId===view.printId&&!r.presented
      &&['working','completed'].includes(r.status)&&hasPresentedResult(r,view.snapshot)))onPresentation();
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
  addEventListener('saam-studio-change',event=>{if(event.detail.kinds.includes('requests'))void refresh();});
  void refresh();setInterval(()=>{render();void refresh();},750);
  return {refresh,
    updated(records){merge(records);render();},
    loading(){view={...view,loading:true,ready:false,errorAt:null};render();},
    received(work){
      if(!work)return;
      view={...view,printId:work.printId,snapshot:work.snapshot,ready:false,awaitingConfirmation:false};
      merge(work.requests);render();
    },
    present(work){if(!work)return;view={...view,printId:work.printId,snapshot:work.snapshot,ready:true,errorAt:null,awaitingConfirmation:work.awaitingConfirmation===true};render();},
    settled(error){view={...view,loading:false,...(error?{ready:false,errorAt:Date.now()}: {})};render();}
  };
}
