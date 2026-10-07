// The application owns server lifetime. Viewer transports never close it.
export function viewerLifetime(server,{onShutdown=async()=>{},onViewers=()=>{},onClosing=()=>{}}={}){
  const viewers=new Set(),sockets=new Map(),lifetime={closing:false,finished:null};
  server.on('connection',socket=>{
    sockets.set(socket,0);socket.once('close',()=>sockets.delete(socket));
  });
  server.prependListener('request',(req,res)=>{
    const socket=req.socket,request={released:false};
    sockets.set(socket,(sockets.get(socket)??0)+1);
    function release(){
      if(request.released)return;request.released=true;
      const active=Math.max(0,(sockets.get(socket)??1)-1);
      if(sockets.has(socket))sockets.set(socket,active);
      if(lifetime.closing&&!active)socket.end();
    }
    res.once('finish',release);res.once('close',release);
  });
  function shutdown(){
    if(lifetime.finished)return lifetime.finished;
    lifetime.closing=true;onClosing();
    for(const res of viewers)res.end();viewers.clear();
    lifetime.finished=new Promise(done=>server.close(done)).then(onShutdown);
    for(const [socket,active] of sockets)if(!active)socket.end();
    return lifetime.finished;
  }
  server.once('close',()=>{lifetime.closing=true;});
  return {shutdown,viewers:()=>viewers.size,
    notify(event,data){for(const res of viewers)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);},
    attach(res){
      if(lifetime.closing){res.writeHead(503);res.end('Studio is closing.');return;}
      viewers.add(res);onViewers(viewers.size);
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write(': viewer connected\n\n');
      const pulse=setInterval(()=>res.write(': connected\n\n'),15_000);pulse.unref();
      res.once('close',()=>{clearInterval(pulse);viewers.delete(res);onViewers(viewers.size);});
    }};
}
