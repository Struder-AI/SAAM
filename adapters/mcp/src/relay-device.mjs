#!/usr/bin/env node
// Connects this computer's local runtime to the SAAM relay over one outbound
// WebSocket. Each chat session is an MCP session of the ordinary adapter over
// that socket; nothing on this computer listens publicly. A session ends when
// the chat ends it, a newer chat starts, or it stays idle past its lease.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
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
export const RELAY_GUIDANCE='This SAAM session reaches the person’s own computer through the SAAM relay. You cannot run commands or read files there: skip every step that needs command access and read missing context with read_guidance, starting with "makers". SAAM Studio is open on that computer; the person imports files and confirms output there. Keep listening: after each reply, call wait_for_studio_request again without waiting for a chat message, and omit waitMs. A wait that returns no requests is normal; call it again.';
const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});

async function post(relayUrl,path,secret){
  const response=await fetch(new URL(path,relayUrl),{method:'POST',headers:secret?{Authorization:`Bearer ${secret}`}:{}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error??`Relay answered ${response.status} for ${path}.`);
  return body;
}
// The device credential is this computer's pairing; it never leaves the state file.
export async function loadDevice(relayUrl,statePath){
  try{const saved=JSON.parse(await readFile(statePath,'utf8'));if(saved.relayUrl===relayUrl)return saved;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const device={relayUrl,...await post(relayUrl,'/device/register')};
  await mkdir(dirname(statePath),{recursive:true});
  await writeFile(statePath,JSON.stringify(device,null,2)+'\n',{mode:0o600});
  return device;
}
export const linkCode=device=>post(device.relayUrl,'/device/link-code',device.secret);
export const unpair=device=>post(device.relayUrl,'/device/unpair',device.secret);

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

// onCall receives one record per answered chat call (see callRecord).
export function connectRelay({device,runtime,sessionIdleMs=SESSION_IDLE_MS,onStatus=()=>{},onCall=()=>{}}){
  const url=new URL('/device/connect',device.relayUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  // problem: why the relay refused this computer (unpaired, or an outdated SAAM); no retry follows.
  const link={socket:null,closed:false,backoff:BACKOFF_MS[0],heartbeat:null,retry:null,inbox:Promise.resolve(),problem:null,release:null};
  const sessions=new Map();
  const current=()=>[...sessions.keys()][0]??null;
  function report(){if(link.socket?.readyState===WebSocket.OPEN)link.socket.send(JSON.stringify({type:'session',session:current()}));}
  function reply(call,message,status=200){
    if(link.socket?.readyState===WebSocket.OPEN)link.socket.send(JSON.stringify({type:'result',call,status,message}));
    // Otherwise the relay has already failed this call; the work itself is saved locally.
  }
  function lease(session){
    clearTimeout(session.idle);
    session.idle=setTimeout(()=>{if(session.transport.calls.size)lease(session);else void end(session.id);},sessionIdleMs);
    session.idle.unref?.();
  }
  async function open(id,clientName){
    for(const other of [...sessions.keys()])await end(other);
    const transport=sessionTransport(reply,onCall),adapter=createMcpAdapter({runtime,listen:listenFor(clientName),remote:true,guidance:RELAY_GUIDANCE});
    await adapter.server.connect(transport);
    const session={id,transport,adapter,idle:null,client:clientName??null};sessions.set(id,session);report();onStatus({session:id,active:true,client:clientName});
    return session;
  }
  async function end(id){
    const session=sessions.get(id);if(!session)return;
    sessions.delete(id);clearTimeout(session.idle);report();
    await session.adapter.close();onStatus({session:id,active:false});
  }
  async function receive(packet){
    if(packet.type==='session-end')return end(packet.session);
    if(packet.type==='release'){link.release=packet.release??null;return;}
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
    socket.onopen=()=>{link.backoff=BACKOFF_MS[0];report();onStatus({connected:true});link.heartbeat=setInterval(()=>socket.send('ping'),HEARTBEAT_MS);};
    // Opening a session awaits the previous one's end; later messages queue behind it.
    socket.onmessage=({data})=>{if(data==='pong')return;link.inbox=link.inbox.then(()=>receive(JSON.parse(data))).catch(error=>console.error('SAAM relay message:',error));};
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
    status:()=>({relayUrl:device.relayUrl,connected:link.socket?.readyState===WebSocket.OPEN,problem:link.problem,release:link.release,session:current()?{client:sessions.get(current()).client}:null}),
    // Drops the link without ending sessions, as a network loss would.
    disconnect(){link.socket?.close();},
    async close(){
      link.closed=true;clearTimeout(link.retry);clearInterval(link.heartbeat);link.socket?.close(1000,'SAAM stopped.');
      for(const id of [...sessions.keys()])await end(id);
    }
  };
}

// major.minor.patch comparison; a pre-release suffix is ignored.
const releaseParts=version=>String(version).split('-')[0].split('.').map(Number);
export function newerRelease(candidate,current){
  const a=releaseParts(candidate),b=releaseParts(current);
  for(let i=0;i<3;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);
  return false;
}
// What Studio's Connect chat panel reads. The runtime, and so every Studio it
// opens, exists before the connection that needs the runtime; the provider
// answers "not connected" until attach() hands it that connection. With an
// installed build's version, platform and update hook it also offers a newer
// release the relay announced.
export function relayProvider(device,{version=null,platform=null,update=null}={}){
  const link={connection:null};
  const offer=status=>{
    const release=status.release,asset=release?.assets?.[platform];
    return update&&version&&asset&&newerRelease(release.version,version)?{version:release.version,...asset}:null;
  };
  const current=()=>link.connection?.status()??{relayUrl:device.relayUrl,connected:false,session:null,release:null};
  return {
    status:()=>{const {release,...status}=current(),offered=offer({release});return {...status,version,update:offered?{version:offered.version}:null};},
    linkCode:()=>linkCode(device),
    update:()=>{const offered=offer(current());if(!offered)throw Error('No newer SAAM release is available.');return update(offered);},
    attach(connection){link.connection=connection;return connection;}
  };
}

// SAAM on a paired computer: the runtime, its relay link and one Studio at
// launch with no print. Its Connect chat panel issues codes, and request_review
// later shows the chat's prints in it. The CLI and the installed launcher use this.
// installed: {version, platform, update(release)} for an installed build that can update itself.
export async function runPairedSaam({relayUrl,statePath,printsRoot,onStatus=()=>{},onCall=()=>{},installed={}}){
  const device=await loadDevice(relayUrl,statePath);
  const relay=relayProvider(device,installed),runtime=createLocalRuntime({printsRoot,relay});
  const connection=relay.attach(connectRelay({device,runtime,onStatus,onCall}));
  const studio=await runtime.openStudio();
  return {device,runtime,connection,studio,stop:async()=>{await connection.close();await runtime.close();}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const relayUrl=process.env.SAAM_RELAY_URL,statePath=process.env.SAAM_RELAY_STATE??resolve(root,'.local','relay-device.json');
  if(!relayUrl){console.error('Set SAAM_RELAY_URL to the relay origin, for example https://relay.example.com.');process.exit(1);}
  const command=process.argv[2];
  if(command==='link'||command==='unpair'){
    const device=await loadDevice(relayUrl,statePath);
    if(command==='link'){const {code,expiresAt}=await linkCode(device);console.log(`Connect your chat: add ${relayUrl}/mcp as a custom connector and enter code ${code} (valid until ${new Date(expiresAt).toLocaleTimeString()}).`);}
    else{await unpair(device);console.log('This computer is unpaired. Delete',statePath,'to pair again.');}
  }else{
    const saam=await runPairedSaam({relayUrl,statePath,printsRoot:process.env.SAAM_PRINTS_ROOT??resolve(root,'Prints'),onStatus:status=>console.error('SAAM relay:',JSON.stringify(status)),onCall:call=>console.error('SAAM call:',JSON.stringify(call))});
    console.log(`SAAM Studio: ${saam.studio.url}${saam.studio.browserOpenRequested?'':' (open it in your browser)'}. Connect a chat from its Connect chat panel.`);
    const stop=async()=>{await saam.stop();process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }
}
