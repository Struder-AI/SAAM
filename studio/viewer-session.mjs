// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
const stream={events:null,connected:false,stopping:false};
export const viewerConnected=()=>stream.connected;
function connect(){
  if(stream.stopping)return;
  stream.events?.close();stream.connected=false;
  const viewer=stream.events=new EventSource('/api/viewer?token='+encodeURIComponent(token));
  viewer.addEventListener('studio-update',event=>{
    const detail=JSON.parse(event.data);
    if(detail.kind==='application-stopping'){stream.stopping=true;stream.connected=false;stream.events.close();}
    dispatchEvent(new CustomEvent('saam-studio-update',{detail}));
  });
  // Changes can be missed while the stream is down; a restarted server also
  // rejects this token. Either way the page must check its revision.
  const changed=open=>dispatchEvent(new CustomEvent('saam-viewer-connection',{detail:{open}}));
  viewer.addEventListener('error',()=>{stream.connected=false;changed(false);});
  viewer.addEventListener('open',()=>{stream.connected=true;changed(true);});
}
connect();
addEventListener('pagehide',()=>{stream.connected=false;stream.events?.close();});
addEventListener('pageshow',event=>{if(event.persisted)connect();});
