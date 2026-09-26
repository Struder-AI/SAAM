// One lifetime per Studio server, never shared between agents/adapter processes.
// Opening the first viewer has no deadline. Closing the last page releases the
// listener after a grace period long enough for switching between tasks.
export const DEFAULT_DISCONNECT_MS=30*60*1000;
export function viewerLifetime(server,{disconnectMs=DEFAULT_DISCONNECT_MS,onShutdown=async()=>{},onViewers=()=>{},onClosing=()=>{}}={}) {
  const viewers=new Set(),sockets=new Map();
  let timer,closing=false,finished;
  server.on('connection',socket=>{
    sockets.set(socket,0);
    socket.once('close',()=>sockets.delete(socket));
  });
  server.prependListener('request',(req,res)=>{
    const socket=req.socket;
    sockets.set(socket,(sockets.get(socket)??0)+1);
    let released=false;
    const release=()=>{
      if(released)return;released=true;
      const active=Math.max(0,(sockets.get(socket)??1)-1);
      if(sockets.has(socket))sockets.set(socket,active);
      if(closing&&!active)socket.end();
    };
    res.once('finish',release);res.once('close',release);
  });
  function arm(ms){clearTimeout(timer);timer=setTimeout(()=>void shutdown().catch(error=>server.emit('error',error)),ms);timer.unref();}
  function shutdown(){
    if(finished)return finished;
    closing=true;clearTimeout(timer);onClosing();
    for(const res of viewers)res.end();
    viewers.clear();
    // Stop accepting requests; let an already accepted write finish so closing
    // the page cannot interrupt a bundle update. Also close speculative browser
    // connections which have not sent a request (closeIdleConnections misses them).
    finished=new Promise(done=>server.close(done)).then(onShutdown);
    for(const [socket,active] of sockets)if(!active)socket.end();
    return finished;
  }
  server.once('close',()=>{closing=true;clearTimeout(timer);});
  return {shutdown,viewers:()=>viewers.size,notify(event,data){for(const res of viewers)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);},attach(res){
    if(closing){res.writeHead(503);res.end('Studio is closing. Start a new viewer.');return;}
    clearTimeout(timer);viewers.add(res);onViewers(viewers.size);
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
    res.write(': viewer connected\n\n');
    const pulse=setInterval(()=>res.write(': connected\n\n'),15_000);pulse.unref();
    res.once('close',()=>{
      clearInterval(pulse);viewers.delete(res);onViewers(viewers.size);
      if(!closing&&!viewers.size)arm(disconnectMs);
    });
  }};
}
