// Optional installation connection. Making, viewing and exporting remain local
// whether the alpha release service is activated, unavailable or declined.
const STATUS_POLL_MS=30_000;
const UPDATE_POLL_MS=5*60_000;

export function createServicePanel({token}){
  const $=id=>document.getElementById(id),headers={'X-SAAM-Token':token};
  const view={status:null,loading:false,updating:false,firstPromptShown:false};
  const request=async(action,body={})=>{
    const response=await fetch('/api/service/'+action,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error??'The release service did not respond.');
    return result;
  };
  function message(value){$('service-message').textContent=value??'';}
  function render(){
    const status=view.status,available=status?.available!==false;
    $('service-toggle').hidden=!available;
    $('service-quit').hidden=!status?.canQuit;
    $('service-invite-row').hidden=Boolean(status?.activated);
    $('service-dismiss').hidden=!status?.firstRunPrompt;
    $('service-check').hidden=!status?.activated;
    const offer=status?.update,button=$('service-update');
    button.hidden=!offer;button.disabled=view.updating;
    if(offer&&!view.updating){button.textContent='Update to '+offer.version;button.title='SAAM '+offer.version+' is available.';}
    $('service-toggle').textContent=status?.activated?'Connected':'Connect';
    $('service-status').textContent=!status?'Checking release service status…'
      :!available?'This installation has no release service. SAAM works locally.'
      :status.activated?`Connected for alpha updates and diagnostics · SAAM ${status.version}`
      :`SAAM ${status.version} works without a code. Connect later whenever you want updates.`;
    if(status?.problem)$('service-status').textContent+=' '+status.problem;
    if(status?.firstRunPrompt&&!view.firstPromptShown){view.firstPromptShown=true;open();$('service-invite').focus();}
  }
  async function refresh(){
    try{
      const response=await fetch('/api/service',{headers});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      view.status=result;render();return result;
    }catch(error){message('Release service status is unavailable. SAAM still works locally.');render();return null;}
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
    if(!view.status?.activated)return;
    $('service-check').disabled=true;if(manual)message('Checking for updates…');
    try{view.status=await request('check-update');render();if(manual)message(view.status.update?`SAAM ${view.status.update.version} is ready to install.`:'SAAM is up to date.');}
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
    try{await request('update');closeTab(`SAAM is updating to ${offer.version} and opens again. You can close this tab.`);}
    catch(error){view.updating=false;render();message(error.message);open();}
  }
  async function quit(){
    if(!confirm('Quit SAAM? Your prints stay saved.'))return;
    try{await request('quit');closeTab('SAAM has stopped. You can close this tab and start SAAM again from its app icon.');}
    catch(error){message(error.message);open();}
  }
  function open(){$('service-panel').hidden=false;$('service-toggle').setAttribute('aria-expanded','true');}
  function close(){$('service-panel').hidden=true;$('service-toggle').setAttribute('aria-expanded','false');}
  function toggle(){if($('service-panel').hidden)open();else close();}
  $('service-toggle').onclick=toggle;
  $('service-update').onclick=update;
  $('service-quit').onclick=quit;
  $('service-close').onclick=()=>{if(view.status?.firstRunPrompt)void dismiss();else close();};
  $('service-dismiss').onclick=dismiss;
  $('service-activate').onclick=activate;
  $('service-check').onclick=()=>void checkUpdate();
  $('service-invite').addEventListener('keydown',event=>{if(event.key==='Enter')void activate();});
  $('service-panel').addEventListener('keydown',event=>{if(event.key==='Escape'){if(view.status?.firstRunPrompt)void dismiss();else close();$('service-toggle').focus();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  setInterval(()=>{if(document.visibilityState==='visible')void refresh();},STATUS_POLL_MS);
  setInterval(()=>{if(document.visibilityState==='visible')void checkUpdate(false);},UPDATE_POLL_MS);
  void refresh().then(status=>{if(status?.activated)void checkUpdate(false);});
  return {open,close,refresh};
}
