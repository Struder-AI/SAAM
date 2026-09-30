#!/usr/bin/env node
// Connects this computer's local runtime to the SAAM relay over one outbound
// WebSocket. Each chat session is an MCP session of the ordinary adapter over
// that socket; nothing on this computer listens publicly. A session ends when
// the chat ends it, a newer chat starts, or it stays idle past its lease.
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {createLocalRuntime} from './runtime.mjs';
import {createMcpAdapter} from './server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
// Must match the relay's PROTOCOL (relay/src/relay-object.mjs).
const RELAY_PROTOCOL='1';
const RESULT_LIMIT=1_000_000,SESSION_IDLE_MS=30*60_000,HEARTBEAT_MS=30_000,BACKOFF_MS=[1000,30_000];
// Per-call deadlines: Claude documents 240 s, so 225 s leaves margin; ChatGPT
// targets one 450 s call (unverified). Clients are told apart by clientInfo.name.
export function listenFor(clientName=''){
  return /openai|chatgpt/i.test(clientName)?{defaultMs:450_000,maxMs:450_000}:{defaultMs:225_000,maxMs:225_000};
}
// A web chat has no command access on this computer and must keep listening
// for Studio itself; the general instructions follow this.
export const RELAY_GUIDANCE='Web agents are makers only. Core skills belong to developers; builders author guidance using existing capabilities. Reading their documentation does not grant either role or command access. This SAAM session reaches the person’s own computer through the SAAM relay. You cannot run commands or read files there: skip every step that needs command access. Call maker_onboarding first, once per conversation, and read further context with read_skill and read_guidance. SAAM Studio is open on that computer; the person imports files and confirms output there. Keep listening: after each reply, call wait_for_studio_request again without waiting for a chat message, and omit waitMs. A wait that returns no requests is normal; call it again.';
const sha256=text=>createHash('sha256').update(text).digest('hex');
// Status changes arrive in bursts (a calculation's progress); the panel hears
// at most one per PANEL_STATUS_MS.
const PANEL_STATUS_MS=250;
const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});

async function post(relayUrl,path,secret,fields){
  const headers={...secret?{Authorization:`Bearer ${secret}`}:{},...fields?{'Content-Type':'application/json'}:{}};
  const response=await fetch(new URL(path,relayUrl),{method:'POST',headers,body:fields?JSON.stringify(fields):undefined})
    .catch(()=>{throw Error('SAAM could not reach the relay. Check the internet connection and try again.');});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error??`Relay answered ${response.status} for ${path}.`);
  return body;
}
// The device credential is this computer's pairing; it never leaves the state
// file. null: this computer is not paired with this relay.
export async function savedDevice(relayUrl,statePath){
  try{const saved=JSON.parse(await readFile(statePath,'utf8'));return saved.relayUrl===relayUrl?saved:null;}
  catch(error){if(error.code!=='ENOENT')throw error;return null;}
}
// Pairing spends one invite the relay operator issued.
export async function registerDevice(relayUrl,statePath,invite){
  const device={relayUrl,...await post(relayUrl,'/device/register',null,{invite:String(invite??'').trim()})};
  await mkdir(dirname(statePath),{recursive:true});
  await writeFile(statePath,JSON.stringify(device,null,2)+'\n',{mode:0o600});
  return device;
}
// A computer the relay removed forgets its credential, so it can pair again.
export const forgetDevice=statePath=>rm(statePath,{force:true});
export const linkCode=device=>post(device.relayUrl,'/device/link-code',device.secret);
export const unpair=device=>post(device.relayUrl,'/device/unpair',device.secret);
// The chat apps this computer has authorized: [{client}].
export const chatApps=device=>post(device.relayUrl,'/device/chats',device.secret).then(body=>body.chats);

// An MCP transport for one session: requests arrive from the relay with a call
// id, and the matching response goes back under it. Notifications from SAAM have
// no HTTP stream to ride and are dropped; results carry Studio events anyway.
// What a finished call reports to onCall: method, tool, duration, sizes and
// the failure text, never arguments or results.
function callRecord(pending,message,bytes){
  const failure=message.error?.message??(message.result?.isError?message.result.content?.map(item=>item.text).join(' '):null);
  return {method:pending.method,tool:pending.tool,ms:Date.now()-pending.started,requestBytes:pending.bytes,resultBytes:bytes,...(failure?{error:String(failure).slice(0,500)}:{})};
}
function sessionTransport(reply,onCall){
  const transport={onmessage:null,onclose:null,onerror:null,calls:new Map(),
    async start(){},
    async send(message){
      const pending=transport.calls.get(message.id);
      if(pending===undefined||!('result' in message||'error' in message))return;
      transport.calls.delete(message.id);
      const size=Buffer.byteLength(JSON.stringify(message)),tooLarge=size>RESULT_LIMIT;
      const answer=tooLarge?rpcError(message.id,-32000,'This result exceeds the relay limit of 1 MB. Ask for less, for example without includeGeometry.'):message;
      onCall(callRecord(pending,answer,size));
      reply(pending.call,answer);
    },
    async close(){transport.onclose?.();}
  };
  return transport;
}

// onCall receives one record per answered chat call (see callRecord). about
// names this SAAM ({version, platform}) in the hello the relay records.
export function connectRelay({device,runtime,sessionIdleMs=SESSION_IDLE_MS,onStatus=()=>{},onCall=()=>{},about={}}){
  const url=new URL('/device/connect',device.relayUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  // problem: why the relay refused this computer (unpaired, or an outdated SAAM); no retry follows.
  // outbox: device events awaiting an open link. chats: the chat apps holding
  // a grant for this computer, or null until the relay has said.
  const link={socket:null,closed:false,backoff:BACKOFF_MS[0],heartbeat:null,retry:null,inbox:Promise.resolve(),problem:null,release:null,outbox:[],chats:null};
  const sessions=new Map();
  const current=()=>[...sessions.keys()][0]??null;
  // The relay keeps only the hash of the session's panel key, to admit its panel.
  function report(){if(link.socket?.readyState===WebSocket.OPEN)link.socket.send(JSON.stringify({type:'session',session:current(),panel:sessions.get(current())?.panelHash??null}));}
  function reply(call,message,status=200){
    if(link.socket?.readyState===WebSocket.OPEN)link.socket.send(JSON.stringify({type:'result',call,status,message}));
    // Otherwise the relay has already failed this call; the work itself is saved locally.
  }
  // A device event for the relay's records: what Studio saw or this computer
  // failed at. Sent at once, or held until the link opens again.
  function notify(event){
    const packet=JSON.stringify({type:'event',at:Date.now(),event});
    if(link.socket?.readyState===WebSocket.OPEN)link.socket.send(packet);else link.outbox.push(packet);
  }
  // Read when the link opens and when a chat starts a session, the moment a
  // newly added connector first reaches this computer. Unreadable at first, it
  // counts as none, so Studio offers the connector setup.
  function readChats(){
    chatApps(device).then(chats=>{link.chats=chats;},error=>{console.error('SAAM relay chats:',error.message);link.chats??=[];});
  }
  function lease(session){
    clearTimeout(session.idle);
    // A connected panel keeps its session, so its light stays live between the chat's calls.
    session.idle=setTimeout(()=>{if(session.transport.calls.size||session.watch)lease(session);else void end(session.id);},sessionIdleMs);
    session.idle.unref?.();
  }
  async function open(id,clientName){
    for(const other of [...sessions.keys()])await end(other);
    // Every relay session offers the SAAM panel (server.mjs): a chat client
    // reuses a tool list it read earlier, possibly from a session that did not
    // advertise MCP Apps, so the offer cannot depend on this session's client.
    const panel={relayUrl:device.relayUrl,key:`${id}.${randomBytes(24).toString('base64url')}`};
    const transport=sessionTransport(reply,onCall),adapter=createMcpAdapter({runtime,listen:listenFor(clientName),remote:true,guidance:RELAY_GUIDANCE,panel});
    await adapter.server.connect(transport);
    const session={id,transport,adapter,idle:null,client:clientName??null,panelHash:sha256(panel.key),watch:null};
    sessions.set(id,session);report();onStatus({session:id,active:true,client:clientName});readChats();
    return session;
  }
  // While the relay says a panel of this session is connected, its status goes
  // to the relay at once and on every change.
  function panelConnected(session,connected){
    if(!connected){unwatch(session);lease(session);return;}
    session.watch??={stop:runtime.subscribeStatus(()=>sendStatus(session)),timer:null,last:null};
    session.watch.last=null;sendStatus(session);lease(session);
  }
  function unwatch(session){
    if(!session.watch)return;
    clearTimeout(session.watch.timer);session.watch.stop();session.watch=null;
  }
  function sendStatus(session){
    const watch=session.watch;if(!watch||watch.timer)return;
    watch.timer=setTimeout(async()=>{
      watch.timer=null;if(session.watch!==watch)return;
      const status=await runtime.chatStatus(),text=JSON.stringify(status);
      if(session.watch!==watch||text===watch.last||link.socket?.readyState!==WebSocket.OPEN)return;
      watch.last=text;link.socket.send(JSON.stringify({type:'panel-status',session:session.id,status}));
    },PANEL_STATUS_MS);
    watch.timer.unref?.();
  }
  async function end(id){
    const session=sessions.get(id);if(!session)return;
    sessions.delete(id);clearTimeout(session.idle);unwatch(session);report();
    await session.adapter.close();onStatus({session:id,active:false});
  }
  async function receive(packet){
    if(packet.type==='session-end')return end(packet.session);
    if(packet.type==='release'){link.release=packet.release??null;return;}
    if(packet.type==='panel'){const session=sessions.get(packet.session);if(session)panelConnected(session,Boolean(packet.connected));return;}
    if(packet.type!=='mcp')return;
    const {call,message}=packet;
    const session=sessions.get(packet.session)??(message.method==='initialize'?await open(packet.session,message.params?.clientInfo?.name):null);
    if(!session){if(call)reply(call,rpcError(message.id,-32001,'Session not found; initialize a new session.'),404);return;}
    if(call)session.transport.calls.set(message.id,{call,method:message.method,tool:message.params?.name??null,started:Date.now(),bytes:Buffer.byteLength(JSON.stringify(message))});
    lease(session);
    session.transport.onmessage?.(message);
  }
  function connect(){
    const socket=new WebSocket(url,{headers:{Authorization:`Bearer ${device.secret}`,'X-SAAM-Protocol':RELAY_PROTOCOL}});link.socket=socket;
    socket.onopen=()=>{
      link.backoff=BACKOFF_MS[0];
      socket.send(JSON.stringify({type:'hello',version:about.version??null,platform:about.platform??null,node:process.version,os:process.platform}));
      for(const packet of link.outbox.splice(0))socket.send(packet);
      report();readChats();onStatus({connected:true});link.heartbeat=setInterval(()=>socket.send('ping'),HEARTBEAT_MS);
    };
    // Opening a session awaits the previous one's end; later messages queue behind it.
    socket.onmessage=({data})=>{if(data==='pong')return;link.inbox=link.inbox.then(()=>receive(JSON.parse(data))).catch(error=>{console.error('SAAM relay message:',error);notify({kind:'device-error',error:String(error?.message??error).slice(0,2000)});});};
    socket.onerror=()=>{};
    socket.onclose=({code,reason})=>{
      clearInterval(link.heartbeat);if(link.socket===socket)link.socket=null;
      onStatus({connected:false,code,reason});
      if(code===4401||code===4426)link.problem=reason;
      if(link.closed||link.problem)return;
      link.retry=setTimeout(connect,link.backoff);link.backoff=Math.min(link.backoff*2,BACKOFF_MS[1]);
    };
  }
  connect();
  return {
    connected:()=>link.socket?.readyState===WebSocket.OPEN,
    sessions:()=>[...sessions.keys()],
    // What Studio shows: link state and the chat session, if any.
    status:()=>({relayUrl:device.relayUrl,connected:link.socket?.readyState===WebSocket.OPEN,problem:link.problem,release:link.release,chats:link.chats,session:current()?{client:sessions.get(current()).client}:null}),
    event:notify,
    // Drops the link without ending sessions, as a network loss would.
    disconnect(){link.socket?.close();},
    async close(){
      link.closed=true;clearTimeout(link.retry);clearInterval(link.heartbeat);link.socket?.close(1000,'SAAM stopped.');
      for(const id of [...sessions.keys()])await end(id);
    }
  };
}

// major.minor.patch comparison. An offered version must be exactly that: it
// names a folder and a download path (see packaging/update.mjs).
export const RELEASE_VERSION=/^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const releaseParts=version=>String(version).split('-')[0].split('.').map(Number);
export function newerRelease(candidate,current){
  if(!RELEASE_VERSION.test(String(candidate)))return false;
  const a=releaseParts(candidate),b=releaseParts(current);
  for(let i=0;i<3;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);
  return false;
}
// What Studio's Connect panel reads. The runtime, and so every Studio it
// opens, exists before the connection that needs the runtime; the provider
// answers "not paired" or "not connected" until attach() hands it that
// connection. pair(invite) pairs an unpaired computer (runPairedSaam supplies
// it). With an installed build's version, platform and update hook it also
// offers a newer release the relay announced.
export function relayProvider(relayUrl,{version=null,platform=null,update=null,quit=null,pair=null}={}){
  // notice: why the relay last dropped this computer's pairing, until it pairs again.
  const link={connection:null,notice:null};
  const offer=status=>{
    const release=status.release,asset=release?.assets?.[platform];
    return update&&version&&asset&&newerRelease(release.version,version)?{version:release.version,...asset}:null;
  };
  const current=()=>link.connection?.status()??{relayUrl,connected:false,session:null,release:null,chats:null};
  return {
    status:()=>{const {release,...status}=current(),offered=offer({release});return {...status,paired:Boolean(link.connection),notice:link.notice,version,update:offered?{version:offered.version}:null,canQuit:Boolean(quit)};},
    quit:()=>{if(!quit)throw Error('This SAAM stops from its terminal.');return quit();},
    linkCode:()=>{if(!link.connection)throw Error('Pair this computer with an invite first.');return link.connection.linkCode();},
    pair:async invite=>{
      if(link.connection)throw Error('This computer is already paired.');
      if(!pair)throw Error('This SAAM cannot pair from Studio.');
      await pair(invite);return {paired:true};
    },
    update:()=>{const offered=offer(current());if(!offered)throw Error('No newer SAAM release is available.');return update(offered);},
    attach(connection){link.connection=connection;link.notice=null;return connection;},
    detach(notice){link.connection=null;link.notice=notice??null;}
  };
}

// SAAM on a computer paired with the relay, or waiting to be: the runtime, its
// relay link once paired and one Studio at launch with no print. Its Connect
// panel takes the invite, then issues chat codes, and request_review later
// shows the chat's prints in it. A computer the relay removes forgets its
// pairing and waits for a new invite. The CLI and the installed launcher use this.
// installed: {version, platform, update(release), quit()} for an installed build.
export async function runPairedSaam({relayUrl,statePath,printsRoot,onStatus=()=>{},onCall=()=>{},installed={}}){
  const state={connection:null,unobserve:null};
  const start=device=>{
    const connection=connectRelay({device,runtime,onCall,about:installed,onStatus:status=>{
      onStatus(status);
      if(status.code===4401&&state.connection?.link===connection)void unpaired(status.reason);
    }});
    state.connection=relay.attach({link:connection,status:connection.status,close:connection.close,linkCode:()=>linkCode(device)});
    // Studio's events reach the relay's records; the local folder path stays here.
    state.unobserve?.();state.unobserve=runtime.observeEvents(({directory,...event})=>connection.event(event));
  };
  async function unpaired(reason){
    const connection=state.connection;state.connection=null;relay.detach(reason);
    await connection?.close();await forgetDevice(statePath);
  }
  const relay=relayProvider(relayUrl,{...installed,pair:async invite=>start(await registerDevice(relayUrl,statePath,invite))});
  const runtime=createLocalRuntime({printsRoot,relay});
  const saved=await savedDevice(relayUrl,statePath);if(saved)start(saved);
  const studio=await runtime.openStudio();
  return {runtime,relay,studio,connection:()=>state.connection?.link??null,stop:async()=>{await state.connection?.close();await runtime.close();}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const relayUrl=process.env.SAAM_RELAY_URL,statePath=process.env.SAAM_RELAY_STATE??resolve(root,'.local','relay-device.json');
  if(!relayUrl){console.error('Set SAAM_RELAY_URL to the relay origin, for example https://relay.example.com.');process.exit(1);}
  const command=process.argv[2];
  if(command==='pair'){await registerDevice(relayUrl,statePath,process.argv[3]);console.log('This computer is paired with',relayUrl);}
  else if(command==='link'||command==='unpair'){
    const device=await savedDevice(relayUrl,statePath);
    if(!device){console.error('This computer is not paired: run with "pair INVITE", or paste the invite in Studio\'s Connect panel.');process.exit(1);}
    if(command==='link'){const {code,expiresAt}=await linkCode(device);console.log(`Connect your chat: add ${relayUrl}/mcp as a custom connector and enter code ${code} (valid until ${new Date(expiresAt).toLocaleTimeString()}).`);}
    else{await unpair(device);await forgetDevice(statePath);console.log('This computer is unpaired. Pair again with a new invite.');}
  }else{
    const saam=await runPairedSaam({relayUrl,statePath,printsRoot:process.env.SAAM_PRINTS_ROOT??resolve(root,'Prints'),onStatus:status=>console.error('SAAM relay:',JSON.stringify(status)),onCall:call=>console.error('SAAM call:',JSON.stringify(call))});
    console.log(`SAAM Studio: ${saam.studio.url}${saam.studio.browserOpenRequested?'':' (open it in your browser)'}. Pair and connect a chat from its Connect panel.`);
    const stop=async()=>{await saam.stop();process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }
}
