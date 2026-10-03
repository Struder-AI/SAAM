// Optional installation connection. Making, viewing and exporting remain local
// whether the alpha release service is activated, unavailable or declined.
const STATUS_POLL_MS=30_000;
const UPDATE_POLL_MS=5*60_000;

const connection={service:'not connected',chat:'not attached',waiting:false,serviceAttention:false,application:'running'};
export function updateApplicationConnection(state){connection.application=state;updateConnectControl();}
export function updateConnectControl({service,chat,waiting,serviceAttention}={}){
  if(service!==undefined)connection.service=service;
  if(chat!==undefined)connection.chat=chat;
  if(waiting!==undefined)connection.waiting=waiting;
  if(serviceAttention!==undefined)connection.serviceAttention=serviceAttention;
  const control=document.getElementById('service-toggle'),serviceLight=document.getElementById('service-light'),chatLight=document.getElementById('chat-light');
  for(const light of [serviceLight,document.getElementById('service-panel-light')]){
    light.classList.toggle('paired',connection.application==='running'&&connection.service==='connected'&&!connection.serviceAttention);
    light.classList.toggle('attention',connection.application==='running'&&connection.serviceAttention);
  }
  for(const light of [chatLight,document.getElementById('chat-panel-light')]){
    light.classList.toggle('paired',connection.application==='running'&&connection.chat.startsWith('attached'));
    light.classList.toggle('waiting',connection.application==='running'&&connection.waiting);
  }
  control.title=connection.application==='running'?'Updates '+connection.service+' · Chat '+connection.chat:connection.application==='stopped'?'SAAM has stopped':'Cannot reach SAAM';
  control.setAttribute('aria-label','Connect: '+control.title);
}
export function createServicePanel({token,available:hasService=true}){
  const $=id=>document.getElementById(id),headers={'X-SAAM-Token':token};
  const view={status:null,loading:false,updating:false,firstPromptShown:false,statusFailure:null,stopping:null};
  const request=async(action,body={})=>{
    const response=await fetch('/api/service/'+action,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error??'The release service did not respond.');
    view.statusFailure=null;return result;
  };
  function message(value){$('service-message').textContent=value??'';}
  function render(){
    if(view.stopping){
      updateApplicationConnection('stopped');
      $('service-status').textContent=view.stopping==='update'?'SAAM is updating and opens again.':'SAAM has stopped. Start SAAM again from its app icon.';
      for(const id of ['service-consent','service-quit','service-invite-row','service-dismiss','service-check','service-update'])$(id).hidden=true;
      message('');return;
    }
    const status=view.status,available=status?.available!==false;
    $('service-toggle').hidden=false;
    $('service-consent').hidden=!available;
    $('service-quit').hidden=!status?.canQuit;
    $('service-invite-row').hidden=!available||Boolean(status?.activated);
    $('service-dismiss').hidden=!status?.firstRunPrompt;
    $('service-check').hidden=!status?.activated;
    const offer=status?.update,button=$('service-update');
    button.hidden=!status?.activated||!offer||Boolean(view.statusFailure);button.disabled=view.updating;
    if(offer&&!view.updating){button.textContent='Update to '+offer.version;button.title='SAAM '+offer.version+' is available.';}
    const failure=view.statusFailure??status?.problem??status?.diagnostics?.lastFailure?.error;
    const serviceState=failure?'needs attention':status?.activated?'connected':available?'not connected':'unavailable';
    updateConnectControl({service:serviceState,serviceAttention:Boolean(failure)});
    $('service-status').textContent=failure?failure+(status?.activated?' Check for updates or ask your agent to inspect diagnostics.':status?' Enter an alpha invite to reconnect.':' Ask your agent to check SAAM.')
      :!status?'Checking connection…'
      :!available?'Updates unavailable. SAAM works locally.'
      :status.activated?`Connected · SAAM ${status.version}`
      :'Enter an alpha invite for updates and diagnostics.';
    if(status?.firstRunPrompt&&!view.firstPromptShown){view.firstPromptShown=true;open();$('service-invite').focus();}
  }
  async function refresh(){
    if(view.stopping)return null;
    try{
      const response=await fetch('/api/service',{headers});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      if(view.stopping)return null;
      view.status=result;view.statusFailure=null;updateApplicationConnection('running');render();return result;
    }catch(error){if(view.stopping)return null;view.statusFailure='Cannot reach SAAM.';updateApplicationConnection('unreachable');render();return null;}
  }
  async function activate(){
    const invite=$('service-invite').value.trim();if(!invite){$('service-invite').focus();return;}
    if(view.loading)return;view.loading=true;$('service-activate').disabled=true;message('Connecting…');
    try{view.status=await request('activate',{invite});$('service-invite').value='';message('Connected. Updates and live diagnostics are enabled.');render();void checkUpdate(false);}
    catch(error){message(error.message+' SAAM still works locally.');await refresh();}
    finally{view.loading=false;$('service-activate').disabled=false;}
  }
  async function dismiss(){
    try{view.status=await request('dismiss');message('You can connect later from this button.');render();close();}
    catch(error){message(error.message);}
  }
  async function checkUpdate(manual=true){
    if(view.stopping)return;
    if(!view.status?.activated)return;
    $('service-check').disabled=true;if(manual)message('Checking for updates…');
    try{
      view.status=await request('check-update');render();
      if(manual){
        const result=view.status.updateStatus;
        message(view.status.update?`SAAM ${view.status.update.version} is ready to install.`
          :result?.state==='current'?'SAAM is up to date.'
          :result?.state==='platform-unavailable'?`SAAM ${result.version} has no release package for ${result.platform??'this platform'} yet. SAAM still works locally.`
          :result?.state==='manual-update-required'?`SAAM ${result.version} is available, but this installation cannot update in place. Use the installation guide.`
          :'No release is available for this installation yet. SAAM still works locally.');
      }
    }
    catch(error){await refresh();if(manual)message(error.message+' SAAM still works locally.');}
    finally{$('service-check').disabled=false;}
  }
  function closeTab(text){
    document.body.replaceChildren(Object.assign(document.createElement('p'),{className:'stopped',textContent:text}));
    window.close();
  }
  async function update(){
    const offer=view.status?.update;if(!offer||view.updating)return;
    if(!confirm(`Update SAAM to ${offer.version}? SAAM closes, updates and opens again. Your prints and local edits stay saved.`))return;
    view.updating=true;const button=$('service-update');button.disabled=true;button.textContent='Installing update…';
    try{
      const result=await request('update');
      if(result.confirmationRequired){
        if(!confirm(result.message+' Continue?')){view.updating=false;render();return;}
        const confirmed=await request('update',{force:true});if(!confirmed.updating)throw Error('SAAM did not start the update.');
      }
      closeTab(`SAAM is updating to ${offer.version} and opens again. You can close this tab.`);}
    catch(error){view.updating=false;render();message(error.message);open();}
  }
  async function quit(){
    if(!confirm('Quit SAAM? Your prints stay saved.'))return;
    try{
      const result=await request('quit');
      if(result.confirmationRequired){
        if(!confirm(result.message))return;
        const confirmed=await request('quit',{force:true});if(!confirmed.quitting)throw Error('SAAM did not quit.');
      }
      closeTab('SAAM has stopped. You can close this tab and start SAAM again from its app icon.');}
    catch(error){message(error.message);open();}
  }
  function open(){$('service-panel').hidden=false;$('service-toggle').setAttribute('aria-expanded','true');}
  function close(){$('service-panel').hidden=true;$('service-toggle').setAttribute('aria-expanded','false');}
  function toggle(){if($('service-panel').hidden)open();else close();}
  $('service-toggle').onclick=toggle;
  addEventListener('saam-studio-update',event=>{if(event.detail.kind==='application-stopping'){view.stopping=event.detail.reason;render();}});
  addEventListener('saam-viewer-connection',event=>{if(!view.stopping&&!event.detail.open)void refresh();});
  $('service-update').onclick=update;
  $('service-quit').onclick=quit;
  $('service-close').onclick=()=>{if(view.status?.firstRunPrompt)void dismiss();else close();};
  $('service-dismiss').onclick=dismiss;
  $('service-activate').onclick=activate;
  $('service-check').onclick=()=>void checkUpdate();
  $('service-invite').addEventListener('keydown',event=>{if(event.key==='Enter')void activate();});
  $('service-panel').addEventListener('keydown',event=>{if(event.key==='Escape'){if(view.status?.firstRunPrompt)void dismiss();else close();$('service-toggle').focus();}});
  document.addEventListener('visibilitychange',()=>{if(hasService&&document.visibilityState==='visible')void refresh();});
  setInterval(()=>{if(hasService&&document.visibilityState==='visible')void refresh();},STATUS_POLL_MS);
  setInterval(()=>{if(document.visibilityState==='visible')void checkUpdate(false);},UPDATE_POLL_MS);
  if(hasService)void refresh().then(status=>{if(status?.activated)void checkUpdate(false);});
  else{view.status={available:false};render();}
  return {open,close,refresh};
}
