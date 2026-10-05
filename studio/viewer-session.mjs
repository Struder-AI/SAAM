// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
const stream={events:null,connected:false,stopping:false};
export const viewerConnected=()=>stream.connected;
function connect(){
  if(stream.stopping)return;
  stream.events?.close();stream.connected=false;
  const viewer=stream.events=new EventSource('/api/viewer?token='+encodeURIComponent(token));
  viewer.addEventListener('runtime-code',event=>{const code=JSON.parse(event.data).fingerprint;if(code&&code!==decodeURIComponent(document.querySelector('meta[name="saam-runtime"]')?.content??''))location.reload();});
  viewer.addEventListener('studio-update',event=>{
    const detail=JSON.parse(event.data);
    if(detail.kind==='application-stopping'){stream.connected=false;if(detail.reason==='quit'||detail.reason==='update'){stream.stopping=true;stream.events.close();}}
    dispatchEvent(new CustomEvent('saam-studio-update',{detail}));
  });
  // Changes can be missed while the stream is down; a restarted server also
  // rejects this token. Either way the page must check its revision.
  const changed=open=>dispatchEvent(new CustomEvent('saam-viewer-connection',{detail:{open}}));
  // A browser retries a dropped stream itself but abandons it (readyState 2,
  // CLOSED) after any other answer, such as the window's 503 while its runtime
  // restarts. Retry at the browser's pace so this page still learns of the new
  // code and stays counted as the window's viewer instead of a new window opening.
  viewer.addEventListener('error',()=>{stream.connected=false;changed(false);if(viewer.readyState===2)setTimeout(()=>{if(stream.events===viewer)connect();},3000);});
  viewer.addEventListener('open',()=>{stream.connected=true;changed(true);});
}
connect();
addEventListener('pagehide',()=>{stream.connected=false;stream.events?.close();stream.events=null;});
addEventListener('pageshow',event=>{if(event.persisted)connect();});
// Focus is reported to this window's address: opening SAAM again brings forward the
// window focused last (packaging/studio-windows.mjs).
const focused=()=>navigator.sendBeacon('/window/focus');
addEventListener('focus',focused);if(document.hasFocus())focused();
