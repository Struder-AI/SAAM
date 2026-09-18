// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
let viewer,opened=false;
function connect(){
  viewer?.close();viewer=new EventSource('/api/viewer?token='+encodeURIComponent(token));
  viewer.addEventListener('studio-change',event=>dispatchEvent(new CustomEvent('saam-studio-change',{detail:JSON.parse(event.data)})));
  // Changes can be missed while the stream is down; a restarted server also
  // rejects this token. Either way the page must check its revision.
  const changed=open=>dispatchEvent(new CustomEvent('saam-viewer-connection',{detail:{open}}));
  viewer.addEventListener('error',()=>changed(false));
  viewer.addEventListener('open',()=>{if(opened)changed(true);opened=true;});
  viewer.addEventListener('agent-connection-closed',event=>dispatchEvent(new CustomEvent('saam-agent-connection-closed',{detail:JSON.parse(event.data)})));
}
connect();
addEventListener('pagehide',()=>viewer?.close());
addEventListener('pageshow',event=>{if(event.persisted)connect();});
