import {updateConnectControl} from './service-panel.mjs';
// Studio reflects the application's chat attachment.
export function initializeChatUI(){
  const elements={name:document.getElementById('chat-name'),state:document.getElementById('chat-state'),
    clients:document.getElementById('chat-clients')};
  const ui={status:null,refreshing:false,stopped:null};
  function render(status){
    ui.status=status;
    const attached=status.attachment;
    const currentClient=attached?.client==='codex'?'Codex':attached?.client==='claude'?'Claude Code':null;
    const connectedName=attached?[currentClient,attached.name].filter(Boolean).join(' · '):null;
    elements.name.textContent=attached?connectedName:'No chat attached';
    elements.name.title=attached?.ownerId??'';elements.state.textContent=ui.stopped==='update'?'SAAM is updating':ui.stopped?'SAAM has stopped':'';
    updateConnectControl({chat:attached?'attached to '+connectedName:'not attached'});
    elements.clients.textContent=ui.stopped==='update'?'SAAM is updating and opens again.':ui.stopped?'SAAM has stopped. Start SAAM again from its app icon.':attached?'':'Mention SAAM in your chat client.';
  }
  async function refresh(){
    if(ui.stopped||ui.refreshing)return;ui.refreshing=true;
    try{const response=await fetch('/api/chat');if(response.ok)render(await response.json());}
    catch{}finally{ui.refreshing=false;}
  }
  function update(event){
    if(event.detail.kind==='application-stopping'){ui.stopped=event.detail.reason;if(ui.status)render(ui.status);}
    else if(event.detail.kind==='state'&&event.detail.kinds?.includes('chat'))void refresh();
  }
  function visible(){if(document.visibilityState==='visible')void refresh();}
  addEventListener('saam-studio-update',update);addEventListener('saam-viewer-connection',refresh);
  document.addEventListener('visibilitychange',visible);void refresh();
  return {reflect(){if(ui.status)render(ui.status);}};
}
