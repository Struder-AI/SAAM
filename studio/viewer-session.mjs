// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
let viewer;
function connect(){
  viewer?.close();viewer=new EventSource('/api/viewer?token='+encodeURIComponent(token));
  viewer.addEventListener('studio-change',event=>dispatchEvent(new CustomEvent('saam-studio-change',{detail:JSON.parse(event.data)})));
  viewer.addEventListener('agent-connection-closed',event=>dispatchEvent(new CustomEvent('saam-agent-connection-closed',{detail:JSON.parse(event.data)})));
}
connect();
addEventListener('pagehide',()=>viewer?.close());
addEventListener('pageshow',event=>{if(event.persisted)connect();});
