// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
let viewer;
function connect(){viewer?.close();viewer=new EventSource('/api/viewer?token='+encodeURIComponent(token));}
connect();
addEventListener('pagehide',()=>viewer?.close());
addEventListener('pageshow',event=>{if(event.persisted)connect();});
