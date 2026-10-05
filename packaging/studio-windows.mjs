// Stable loopback addresses outlive runtime processes and restore after orchestrator restart.
import {createServer,request} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {replaceFile} from '../core/file-write.mjs';
import {openBrowser} from '../studio/browser.mjs';

export async function createStudioWindows(stateRoot,{autoOpen=true}={}){
  const file=resolve(stateRoot,'studio-windows.json'),windows=new Map();
  const saved=await readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return [];});
  const writes={tail:Promise.resolve()};
  async function persist(){
    const records=[...windows.values()].filter(window=>!window.closed).map(({server,upstream,upstreamUrl,viewers,...record})=>record);
    writes.tail=writes.tail.then(()=>replaceFile(file,JSON.stringify(records)+'\n'));await writes.tail;
  }
  async function listener(record){
    const window={...record,upstream:null,viewers:0,closed:false,server:null};
    window.server=createServer((req,res)=>{
      const origin='http://127.0.0.1:'+window.port;
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Invalid local window request.');return;}
      // The page reports focus here (studio/viewer-session.mjs): an untargeted open goes to the window focused last.
      if(req.method==='POST'&&req.url==='/window/focus'){window.activeAt=Date.now();res.writeHead(204);res.end();return;}
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
    await new Promise((done,fail)=>{window.server.once('error',fail);window.server.listen(record.port??0,'127.0.0.1',done);});
    window.port=window.server.address().port;windows.set(window.instanceId,window);return window;
  }
  try{for(const record of saved)await listener(record);}catch(error){await close();throw Error('A saved Studio window address is unavailable. Resolve its port conflict before starting SAAM.',{cause:error});}
  // A window keeps its runtime's code root, so an open can start that runtime again.
  async function register(runtime,record){
    const window=windows.get(record.instanceId)??await listener({...record,runtimeId:runtime.id});
    if(window.runtimeId!==runtime.id)throw Error('Studio window belongs to another runtime.');
    window.codeRoot=runtime.codeRoot;window.upstream=record.upstreamUrl;window.sessionToken=record.sessionToken;window.closed=false;
    await persist();return {url:'http://127.0.0.1:'+window.port};
  }
  async function sync(runtimeId,studios){
    for(const studio of studios){const window=windows.get(studio.instanceId);if(window&&window.runtimeId===runtimeId){window.printId=studio.printId;window.attachment=studio.attachment;}}
    for(const window of windows.values())if(window.runtimeId===runtimeId&&!studios.some(studio=>studio.instanceId===window.instanceId)){window.upstream=null;window.closed=true;}
    await persist();
  }
  const record=instanceId=>{const {server,upstream,upstreamUrl,viewers,...saved}=windows.get(instanceId)??{};if(!saved.instanceId)throw Error('That Studio window is closed.');return saved;};
  // A viewer of a window whose Studio is replaced reconnects to it: the window stays present meanwhile.
  const reconnecting=window=>{if(window.viewers>0)window.dispatchedAt=Date.now();};
  function move(instanceId,runtime){const window=windows.get(instanceId);reconnecting(window);window.runtimeId=runtime.id;window.codeRoot=runtime.codeRoot;}
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
    if(window?.viewers>0)return 'raise';
    if(window&&present(window))return 'opening';
    if(window)window.dispatchedAt=Date.now();
    return 'open';
  }
  // Every window, most recently focused first, then newest; shown when someone views it.
  const recent=()=>[...windows.values()].reverse().sort((a,b)=>(b.activeAt??0)-(a.activeAt??0))
    .map(({instanceId,runtimeId,codeRoot,closed,viewers})=>({instanceId,runtimeId,codeRoot,closed,shown:!closed&&viewers>0}));
  // Agents' views: the window opens unless present, and is never raised.
  async function show(url){
    const window=find(url);
    if(!autoOpen||window&&present(window))return false;
    // Marked before dispatch so a concurrent request waits for this tab; cleared if none opened.
    if(window)window.dispatchedAt=Date.now();
    const opened=await openBrowser(url).catch(()=>false);
    if(!opened&&window)window.dispatchedAt=0;
    return opened;
  }
  async function close(){await writes.tail.catch(()=>{});await Promise.all([...windows.values()].map(async window=>{if(window.server.listening){const done=new Promise(resolve=>window.server.close(resolve));window.server.closeAllConnections();await done;}}));windows.clear();}
  return {register,sync,detach,restore,show,display,recent,close,record,move,present:()=>[...windows.values()].filter(present),runtimeFor:instanceId=>windows.get(instanceId)?.runtimeId};
}
