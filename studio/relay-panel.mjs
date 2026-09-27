// "Connect": how to reach this computer from a web chat through the SAAM relay.
// Two lights show whether this computer holds its relay link and whether a chat
// is connected. The connector URL and a link code are needed only to add a
// chat app, so once one is authorized they wait behind "Connect another chat
// app". Studio includes it only when it runs with a relay (see createStudio's
// relay option).
const STATUS_POLL_MS=5000;
const clock=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
// Each light's state (on, off or problem) and sentence for one relay status.
export function describeRelay(status){
  const chats=status?.chats??[];
  const link=!status?{state:'off',text:'Checking the relay…'}
    :status.problem?{state:'problem',text:'The relay refused this computer: '+status.problem}
    :status.connected?{state:'on',text:'Paired with the SAAM relay.'}
    :{state:'problem',text:'Not reaching the SAAM relay. Reconnecting; check the network if this persists.'};
  const chat=status?.session?{state:'on',text:'Chat connected: '+(status.session.client??'unnamed')+'.'}
    :{state:'off',text:chats.length?'No chat connected right now. It connects when you use SAAM from your chat.':'No chat connected.'};
  return {link,chat};
}
// Connection action is needed when the relay refuses this computer, or when it
// is paired and no chat app is authorized yet. Unknown until the relay says.
export function relayActionNeeded(status){
  if(status?.problem)return true;
  return Boolean(status?.connected)&&Array.isArray(status.chats)?status.chats.length===0:null;
}
export function createRelayPanel({token}){
  const $=id=>document.getElementById(id);
  // wantOpen: open as soon as the status shows action is needed; another: the
  // person asked to connect another chat app.
  const view={status:null,code:null,expiresAt:0,countdown:null,requesting:false,copied:null,updating:false,wantOpen:false,another:false};
  const headers={'X-SAAM-Token':token};
  function renderUpdate(){
    const offer=view.status?.update,button=$('relay-update');
    button.hidden=!offer;if(!offer||view.updating)return;
    button.textContent='Update to '+offer.version;button.title='SAAM '+offer.version+' is available. Your prints are kept.';
  }
  // The update closes SAAM; the installer replaces it and starts it again.
  async function update(){
    const offer=view.status?.update;if(!offer||view.updating)return;
    if(!confirm(`Update SAAM to ${offer.version}? SAAM closes, updates and opens again. Your prints and chat connection are kept.`))return;
    view.updating=true;const button=$('relay-update');button.disabled=true;button.classList.remove('flash');button.textContent='Downloading update…';
    try{
      const response=await fetch('/api/relay/update',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      button.textContent='Restarting SAAM…';
    }catch(error){view.updating=false;button.disabled=false;button.classList.add('flash');alert(error.message);renderUpdate();}
  }
  // Quitting stops SAAM on this computer; its prints stay saved.
  async function quit(){
    if(!confirm('Quit SAAM? Chats cannot reach this computer until you start SAAM again. Your prints are saved.'))return;
    try{
      const response=await fetch('/api/relay/quit',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      document.body.replaceChildren(Object.assign(document.createElement('p'),{className:'stopped',textContent:'SAAM has stopped. You can close this tab; start SAAM again from its shortcut.'}));
    }catch(error){alert(error.message);}
  }
  function renderStatus(){
    renderUpdate();
    $('relay-quit').hidden=!view.status?.canQuit;
    const {link,chat}=describeRelay(view.status),chats=view.status?.chats??[];
    for(const [name,light] of [['link',link],['chat',chat]]){
      $('relay-light-'+name).dataset.state=light.state;$('relay-row-'+name).dataset.state=light.state;$('relay-text-'+name).textContent=light.text;
    }
    $('relay-toggle').title=link.text+' '+chat.text;
    $('relay-chats').hidden=!chats.length;
    $('relay-chats').textContent='Authorized chat apps: '+[...new Set(chats.map(item=>item.client))].join(', ')+'.';
    // The setup stays open while a code is on screen, even as its chat connects;
    // a computer the relay refuses has nothing to set up until it is fixed.
    const refused=Boolean(view.status?.problem),setup=!refused&&(!chats.length||view.another||Boolean(view.code));
    $('relay-setup').hidden=!setup;$('relay-another').hidden=setup||refused;
    $('relay-another').setAttribute('aria-expanded',String(setup));
    if(view.wantOpen){const needed=relayActionNeeded(view.status);if(needed!==null){view.wantOpen=false;if(needed)open();}}
    if(view.status?.connectorUrl&&$('relay-url').value!==view.status.connectorUrl)$('relay-url').value=view.status.connectorUrl;
  }
  function renderCode(){
    const remaining=view.expiresAt-Date.now(),live=Boolean(view.code)&&remaining>0;
    $('relay-code-box').hidden=!view.code;$('relay-code-box').classList.toggle('expired',Boolean(view.code)&&!live);
    $('relay-code').value=view.code??'';
    $('relay-expiry').textContent=!view.code?'':live?'Expires in '+clock(remaining):'Expired. Get a new code.';
    $('relay-show-code').hidden=live;$('relay-show-code').disabled=view.requesting;
    $('relay-show-code').textContent=view.code?'New code':'Show code';
    if(!live){clearInterval(view.countdown);view.countdown=null;}
  }
  async function refresh(){
    try{
      const response=await fetch('/api/relay',{headers});if(!response.ok)throw Error((await response.json()).error);
      const next=await response.json(),chatStarted=next.session&&!view.status?.session;
      view.status=next;
      // A chat that connects has used the code on screen.
      if(chatStarted&&view.code){view.code=null;view.another=false;renderCode();}
    }catch{view.status={...view.status,connected:false,session:null};}
    renderStatus();
  }
  async function showCode(){
    view.requesting=true;$('relay-message').textContent='';renderCode();
    try{
      const response=await fetch('/api/relay/link-code',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      view.code=result.code;view.expiresAt=result.expiresAt;
      clearInterval(view.countdown);view.countdown=setInterval(renderCode,1000);
    }catch(error){$('relay-message').textContent=error.message;}
    finally{view.requesting=false;renderCode();}
  }
  async function copyUrl(){
    const input=$('relay-url');
    try{await navigator.clipboard.writeText(input.value);$('relay-copy').textContent='Copied';}
    catch{input.select();$('relay-copy').textContent='Press Ctrl+C';}
    clearTimeout(view.copied);view.copied=setTimeout(()=>{$('relay-copy').textContent='Copy';},1600);
  }
  function open(){$('relay-panel').hidden=false;$('relay-toggle').setAttribute('aria-expanded','true');void refresh();}
  function close(){view.wantOpen=false;view.another=false;$('relay-panel').hidden=true;$('relay-toggle').setAttribute('aria-expanded','false');renderStatus();}
  // Opens the panel only if connecting needs the person, now or once the relay
  // has answered; the header lights and the Connect button stay either way.
  function openIfNeeded(){view.wantOpen=true;renderStatus();}
  function connectAnother(){view.another=true;renderStatus();$('relay-copy').focus();}
  function toggle(){if($('relay-panel').hidden)open();else close();}
  $('relay-toggle').hidden=false;
  $('relay-toggle').onclick=toggle;
  $('relay-update').onclick=update;
  $('relay-quit').onclick=quit;
  $('relay-close').onclick=close;
  $('relay-show-code').onclick=showCode;
  $('relay-copy').onclick=copyUrl;
  $('relay-another').onclick=connectAnother;
  $('relay-panel').addEventListener('keydown',event=>{if(event.key==='Escape'){close();$('relay-toggle').focus();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  setInterval(()=>{if(document.visibilityState==='visible')void refresh();},STATUS_POLL_MS);
  renderStatus();renderCode();void refresh();
  return {open,openIfNeeded,close,refresh};
}
