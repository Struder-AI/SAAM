// Separate from playback: a failed model load must not orphan the server.
const token=document.querySelector('meta[name="saam-token"]').content;
const stream={events:null,connected:false,stopping:false,active:true,ready:false,generation:0};
const captures=new Map();
export const viewerConnected=()=>stream.connected;
export function captureActive(detail){
  const request=captures.get(detail?.id);
  return Boolean(request&&request.detail===detail&&request.generation===stream.generation&&stream.active&&!stream.stopping&&Date.now()<detail.expiresAt);
}
function retireCaptures(){
  stream.generation++;
  for(const request of captures.values())clearTimeout(request.timer);
  captures.clear();
}
function deliverCapture(request){
  if(request.delivered||!captureActive(request.detail))return;
  request.delivered=true;
  dispatchEvent(new CustomEvent('saam-studio-update',{detail:request.detail}));
}
function receiveCapture(detail){
  if(typeof detail.id!=='string'||!Number.isFinite(detail.expiresAt)||detail.expiresAt<=Date.now()||captures.has(detail.id))return;
  const request={detail,delivered:false,generation:stream.generation,timer:null};
  captures.set(detail.id,request);
  request.timer=setTimeout(()=>{if(captures.get(detail.id)===request)captures.delete(detail.id);},detail.expiresAt-Date.now());
  if(stream.ready)deliverCapture(request);
}
// Install the app's actual listener first. Readiness and draining are synchronous.
export function viewerReadyForCaptures(){
  stream.ready=true;
  for(const request of captures.values())deliverCapture(request);
}
function connect(){
  if(stream.stopping||!stream.active)return;
  stream.events?.close();stream.connected=false;
  const viewer=stream.events=new EventSource('/api/viewer?token='+encodeURIComponent(token));
  const current=()=>stream.events===viewer&&stream.active&&!stream.stopping;
  viewer.addEventListener('runtime-code',event=>{if(!current())return;const code=JSON.parse(event.data).fingerprint;if(code&&code!==decodeURIComponent(document.querySelector('meta[name="saam-runtime"]')?.content??'')){stream.active=false;retireCaptures();location.reload();}});
  viewer.addEventListener('studio-update',event=>{
    if(!current())return;
    const detail=JSON.parse(event.data);
    if(detail.kind==='application-stopping'){stream.connected=false;if(detail.reason==='quit'||detail.reason==='update'){stream.stopping=true;retireCaptures();stream.events.close();}}
    if(detail.kind==='visual-check'){receiveCapture(detail);return;}
    dispatchEvent(new CustomEvent('saam-studio-update',{detail}));
  });
  // Changes can be missed while the stream is down; a restarted server also
  // rejects this token. Either way the page must check its revision.
  const changed=open=>dispatchEvent(new CustomEvent('saam-viewer-connection',{detail:{open}}));
  // A browser retries a dropped stream itself but abandons it (readyState 2,
  // CLOSED) after any other answer, such as the window's 503 while its runtime
  // restarts. Retry at the browser's pace so this page still learns of the new
  // code and stays counted as the window's viewer instead of a new window opening.
  viewer.addEventListener('error',()=>{if(!current())return;stream.connected=false;changed(false);if(viewer.readyState===2)setTimeout(()=>{if(stream.events===viewer)connect();},3000);});
  viewer.addEventListener('open',()=>{if(!current())return;stream.connected=true;changed(true);});
}
connect();
addEventListener('pagehide',()=>{stream.active=false;stream.connected=false;retireCaptures();stream.events?.close();stream.events=null;});
addEventListener('pageshow',event=>{if(event.persisted){stream.active=true;connect();}});
