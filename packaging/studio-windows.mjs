// Stable loopback addresses outlive runtime processes for this orchestrator's lifetime.
// Nothing is saved: each start of SAAM begins with no windows and no runtimes.
import {createServer,request} from 'node:http';
import {openBrowser} from '../studio/browser.mjs';

export function createStudioWindows({autoOpen=true}={}){
  const windows=new Map(),lifetime={closing:false};
  async function listener(record){
    const window={...record,upstream:null,viewers:0,closed:false,server:null};
    window.server=createServer((req,res)=>{
      const origin='http://127.0.0.1:'+window.port;
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Invalid local window request.');return;}
      if(!window.upstream){res.writeHead(503,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<p>Cannot reach this SAAM runtime. Ask your agent to reconnect, or open SAAM again.</p><script>setTimeout(()=>location.reload(),2000)</script>');return;}
      const target=new URL(window.upstream),headers={...req.headers,host:target.host};
      if(req.headers.origin)headers.origin=target.origin;
      const upstream=request({hostname:'127.0.0.1',port:target.port,path:req.url,method:req.method,headers,agent:false},answer=>{
        res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);
        if(req.url.startsWith('/api/viewer')&&answer.statusCode===200){window.viewers++;res.once('close',()=>window.viewers--);}
        answer.once('error',()=>res.destroy());
      });
      upstream.once('error',()=>{if(!res.headersSent){res.writeHead(503);res.end('Cannot reach this SAAM runtime.');}else res.destroy();});
      res.once('close',()=>upstream.destroy());req.pipe(upstream);
    });
    await new Promise((done,fail)=>{window.server.once('error',fail);window.server.listen(0,'127.0.0.1',done);});
    if(lifetime.closing){window.server.closeAllConnections();await new Promise(done=>window.server.close(done));throw Error('SAAM is stopping.');}
    window.port=window.server.address().port;windows.set(window.instanceId,window);return window;
  }
  // A window keeps its runtime's code root: after that runtime exits unexpectedly, opening the window starts it again.
  async function register(runtime,record){
    if(lifetime.closing)throw Error('SAAM is stopping.');
    const window=windows.get(record.instanceId)??await listener({...record,runtimeId:runtime.id});
    if(window.runtimeId!==runtime.id)throw Error('Studio window belongs to another runtime.');
    window.codeRoot=runtime.codeRoot;window.runtimeLabel=runtime.label;window.visibility=record.visibility??window.visibility??'visible';window.chatVisibility=record.chatVisibility??window.chatVisibility??window.visibility;window.upstream=record.upstreamUrl;window.sessionToken=record.sessionToken;window.closed=false;
    return {url:'http://127.0.0.1:'+window.port};
  }
  function reconcile(runtimeId,studios){
    for(const studio of studios){const window=windows.get(studio.instanceId);if(window&&window.runtimeId===runtimeId){window.printId=studio.printId;window.attachment=studio.attachment;window.visibility=studio.visibility??'visible';window.chatVisibility=studio.chatVisibility??window.visibility;}}
    for(const window of windows.values())if(window.runtimeId===runtimeId&&!studios.some(studio=>studio.instanceId===window.instanceId)){window.upstream=null;window.closed=true;}
  }
  const record=instanceId=>{const {server,upstream,upstreamUrl,viewers,...saved}=windows.get(instanceId)??{};if(!saved.instanceId||saved.closed)throw Error('That Studio window is closed.');return saved;};
  // A viewer of a window whose Studio is replaced reconnects to it: the window stays present meanwhile.
  const reconnecting=window=>{if(window.viewers>0)window.dispatchedAt=Date.now();};
  function move(instanceId,runtime){const window=windows.get(instanceId);reconnecting(window);window.runtimeId=runtime.id;window.codeRoot=runtime.codeRoot;window.runtimeLabel=runtime.label;}
  function detach(runtimeId){for(const window of windows.values())if(window.runtimeId===runtimeId){reconnecting(window);window.upstream=null;}}
  function restore(runtimeId){return [...windows.values()].filter(window=>window.runtimeId===runtimeId&&!window.closed).map(({server,upstream,upstreamUrl,viewers,...record})=>record);}
  // A window opened for a viewer counts as present while the browser starts, so no second tab opens.
  const present=window=>!window.closed&&Boolean(window.upstream)&&(window.viewers>0||Date.now()-(window.dispatchedAt??0)<60000);
  function find(url){
    const target=new URL(url);
    if(target.protocol!=='http:'||target.hostname!=='127.0.0.1')throw Error('Runtime windows must use local SAAM addresses.');
    return [...windows.values()].find(item=>String(item.port)===target.port);
  }
  // How the person's own launch or tray click shows url; that caller, not this
  // process, takes the foreground. raise: someone views the window; opening: its
  // tab was dispatched within the minute; open: the caller opens it now, marked so
  // a concurrent open waits for that tab.
  function display(url){
    const window=find(url);
    if(!autoOpen)return null;
    if(window)window.visibility='visible';
    if(window?.viewers>0)return 'raise';
    if(window&&present(window))return 'opening';
    if(window)window.dispatchedAt=Date.now();
    return 'open';
  }
  // Agents' views: the window opens unless present, and is never raised.
  async function show(url,{visibility}={}){
    const window=find(url);
    if(window&&visibility!==undefined){if(!['hidden','visible'].includes(visibility))throw Error('Invalid Studio visibility.');window.visibility=visibility;}
    if(!autoOpen||window&&(window.visibility==='hidden'||present(window)))return false;
    // Marked before dispatch so a concurrent request waits for this tab; cleared if none opened.
    if(window)window.dispatchedAt=Date.now();
    const opened=await openBrowser(url).catch(()=>false);
    if(!opened&&window)window.dispatchedAt=0;
    return opened;
  }
  const retained=()=>[...windows.values()].filter(window=>!window.closed).map(window=>({...record(window.instanceId),url:'http://127.0.0.1:'+window.port}));
  function retire(instanceId){const window=windows.get(instanceId);if(!window||window.closed)throw Error('That Studio window is closed.');window.closed=true;window.upstream=null;return {stopped:true,studioInstanceId:instanceId};}
  // A runtime stopped on purpose takes its windows with it: nothing lists or reopens them.
  function retireRuntime(runtimeId){for(const window of windows.values())if(window.runtimeId===runtimeId){window.closed=true;window.upstream=null;}}
  async function close(){lifetime.closing=true;await Promise.all([...windows.values()].map(async window=>{if(window.server.listening){const done=new Promise(resolve=>window.server.close(resolve));window.server.closeAllConnections();await done;}}));windows.clear();}
  return {register,reconcile,detach,restore,show,display,retained,retire,retireRuntime,close,record,move,present:()=>[...windows.values()].filter(present),runtimeFor:instanceId=>{const window=windows.get(instanceId);return window&&!window.closed?window.runtimeId:undefined;}};
}
