import {updateConnectControl} from './service-panel.mjs';
// Pairing is window state; the application owns launch and client setup.
export function initializeChatUI({getBundleId=()=>null}={}){
  const token=document.querySelector('meta[name="saam-token"]').content;
  const elements={name:document.getElementById('chat-name'),state:document.getElementById('chat-state'),
    message:document.getElementById('chat-message'),clients:document.getElementById('chat-clients'),
    codex:document.getElementById('chat-codex'),claude:document.getElementById('chat-claude')};
  const ui={busy:false,status:null,refreshing:false};
  function render(status){
    ui.status=status;
    const attached=status.attachment,waiting=Boolean(status.waitingClient);
    const currentClient=status.clients?.find(item=>item.id===attached?.client)?.name
      ??(attached?.client==='codex'?'Codex':attached?.client==='claude'?'Claude Code':null);
    const connectedName=attached?[currentClient,attached.name].filter(Boolean).join(' · '):null;
    elements.name.textContent=attached?connectedName:waiting?'Waiting for agent':'No chat attached';
    elements.name.title=attached?.ownerId??'';elements.state.textContent='';
    updateConnectControl({chat:attached?'attached to '+connectedName:waiting?'waiting for agent':'not attached',waiting});
    elements.message.hidden=Boolean(attached);
    const reasons=[];
    for(const client of ['codex','claude']){
      const button=elements[client],available=status.clients?.find(item=>item.id===client);
      button.textContent=client==='codex'?'Launch Codex':'Launch Claude Code';
      button.hidden=Boolean(attached);
      button.title=available?.ready?(available.version??''):available?.reason??'Client availability is unknown.';
      button.disabled=ui.busy||available?.ready!==true;
      if(!attached&&available?.ready!==true)reasons.push(available?.reason??'Checking '+(client==='codex'?'Codex':'Claude Code')+' availability…');
    }
    const bundleId=getBundleId();
    const bundleFlag=bundleId?" --bundle-id '"+bundleId.replaceAll("'","''")+"'":'';
    const existingChat=!attached?' From an existing chat: saam call maker_onboarding'+bundleFlag:'';
    const action=waiting?'Send the startup prompt to attach.':!attached?'Launch a client to attach.':'';
    elements.clients.textContent=[action,[...new Set(reasons)].join(' '),existingChat.trim()].filter(Boolean).join(' ');
  }
  async function refresh(){
    if(ui.refreshing)return;ui.refreshing=true;
    try{const response=await fetch('/api/chat');if(response.ok)render(await response.json());}
    catch{}finally{ui.refreshing=false;}
  }
  async function launch(client){
    if(ui.busy||ui.status?.attachment||ui.status?.clients?.find(item=>item.id===client)?.ready!==true)return;
    ui.busy=true;elements.message.textContent='';render(ui.status);
    try{
      const response=await fetch('/api/chat/start',{method:'POST',headers:{'Content-Type':'application/json','X-SAAM-Token':token},body:JSON.stringify({client})});
      const result=await response.json();if(!response.ok)throw Error(result.error??'Could not open the client.');
      elements.message.textContent=result.message??'Send the startup prompt in the client to attach this window.';
      await refresh();
    }catch(error){elements.message.textContent=error.message;}
    finally{ui.busy=false;if(ui.status)render(ui.status);}
  }
  function openCodex(){void launch('codex');}
  function openClaude(){void launch('claude');}
  function update(event){if(event.detail.kind==='state'&&event.detail.kinds?.includes('chat'))void refresh();}
  function visible(){if(document.visibilityState==='visible')void refresh();}
  elements.codex.addEventListener('click',openCodex);elements.claude.addEventListener('click',openClaude);
  addEventListener('saam-studio-update',update);addEventListener('saam-viewer-connection',refresh);
  document.addEventListener('visibilitychange',visible);void refresh();
  return {reflect(){if(ui.status)render(ui.status);}};
}
