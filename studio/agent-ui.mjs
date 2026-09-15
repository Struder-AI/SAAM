import {agentIndicator} from './work-state.mjs';
export {agentIndicator} from './work-state.mjs';
export function createAgentUI(){
  const indicator=document.getElementById('agent-status'),dots=indicator.querySelector('.typing-dots'),notice=document.getElementById('agent-timeout');
  let running=false,refreshAgain=false,requests=[],view={};const closedOwners=new Set();
  function render(){
    const {active,message}=agentIndicator(requests,{closedOwners,view});
    document.getElementById('canvas').classList.toggle('work-faded',active);
    indicator.hidden=!active&&!message;dots.hidden=!active;notice.hidden=!message;notice.textContent=message;
    indicator.setAttribute('aria-label',active?'Working on your print':message);
  }
  addEventListener('saam-agent-connection-closed',event=>{
    closedOwners.add(event.detail.ownerId);
    if(event.detail.requests)requests=event.detail.requests;
    render();
  });
  async function refresh(){
    if(running){refreshAgain=true;return running;}
    running=(async()=>{do{
      refreshAgain=false;
      try{const response=await fetch('/api/agent-requests');if(response.ok)requests=(await response.json()).requests;}catch{}
      render();
    }while(refreshAgain);})();
    try{await running;}finally{running=false;}
  }
  addEventListener('saam-studio-change',event=>{if(event.detail.kinds.includes('requests'))void refresh();});
  void refresh();setInterval(()=>{render();void refresh();},750);
  return {refresh,
    loading(){view={...view,loading:true,ready:false,errorAt:null};render();},
    received(work){
      if(!work)return;
      view={...view,printId:work.printId,snapshot:work.snapshot,ready:false};
      const merged=new Map(requests.map(r=>[r.id,r]));
      for(const record of work.requests)if(!merged.has(record.id)||merged.get(record.id).updatedAt<record.updatedAt)merged.set(record.id,record);
      requests=[...merged.values()];render();
    },
    present(work){if(!work)return;view={...view,printId:work.printId,snapshot:work.snapshot,ready:true,errorAt:null};render();},
    settled(error){view={...view,loading:false,...(error?{ready:false,errorAt:Date.now()}: {})};render();}
  };
}
