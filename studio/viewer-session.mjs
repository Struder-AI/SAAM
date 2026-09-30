// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
let viewer,connected=false;
export const viewerConnected=()=>connected;
function connect(){
  viewer?.close();connected=false;viewer=new EventSource('/api/viewer?token='+encodeURIComponent(token));
  viewer.addEventListener('studio-update',event=>dispatchEvent(new CustomEvent('saam-studio-update',{detail:JSON.parse(event.data)})));
  // Changes can be missed while the stream is down; a restarted server also
  // rejects this token. Either way the page must check its revision.
  const changed=open=>dispatchEvent(new CustomEvent('saam-viewer-connection',{detail:{open}}));
  viewer.addEventListener('error',()=>{connected=false;changed(false);});
  viewer.addEventListener('open',()=>{connected=true;changed(true);});
  viewer.addEventListener('agent-connection-closed',event=>dispatchEvent(new CustomEvent('saam-agent-connection-closed',{detail:JSON.parse(event.data)})));
}
connect();
addEventListener('pagehide',()=>{connected=false;viewer?.close();});
addEventListener('pageshow',event=>{if(event.persisted)connect();});
