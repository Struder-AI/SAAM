// "Connect chat": how to reach this computer from a web chat through the SAAM
// relay. Shows the connector URL, a fresh link code with its expiry, and whether
// this computer holds its relay link and a chat session. Studio includes it
// only when it runs with a relay (see createStudio's relay option).
const STATUS_POLL_MS=5000;
const clock=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
// What the status line says for one relay status.
export function describeRelay(status){
  if(!status)return {link:'offline',title:'Checking the relay…',detail:''};
  if(!status.connected)return {link:'offline',title:'This computer is not connected to the relay.',detail:'Reconnecting. Check the network if this persists.'};
  if(status.session)return {link:'chat',title:'A chat is connected.',detail:'Client: '+(status.session.client??'unnamed')};
  return {link:'linked',title:'This computer is connected to the relay.',detail:'No chat is connected yet.'};
}
export function createRelayPanel({token}){
  const $=id=>document.getElementById(id);
  const view={status:null,code:null,expiresAt:0,countdown:null,requesting:false,copied:null};
  const headers={'X-SAAM-Token':token};
  function renderStatus(){
    const {link,title,detail}=describeRelay(view.status),status=$('relay-status');
    $('relay-dot').dataset.link=link;$('relay-toggle').title=title;
    status.replaceChildren(title);
    if(detail){const line=document.createElement('span');line.textContent=detail;status.append(line);}
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
      if(chatStarted&&view.code){view.code=null;renderCode();}
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
  function close(){$('relay-panel').hidden=true;$('relay-toggle').setAttribute('aria-expanded','false');}
  function toggle(){if($('relay-panel').hidden)open();else close();}
  $('relay-toggle').hidden=false;
  $('relay-toggle').onclick=toggle;
  $('relay-close').onclick=close;
  $('relay-show-code').onclick=showCode;
  $('relay-copy').onclick=copyUrl;
  $('relay-panel').addEventListener('keydown',event=>{if(event.key==='Escape'){close();$('relay-toggle').focus();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  setInterval(()=>{if(document.visibilityState==='visible')void refresh();},STATUS_POLL_MS);
  renderStatus();renderCode();void refresh();
  return {open,close,refresh};
}
