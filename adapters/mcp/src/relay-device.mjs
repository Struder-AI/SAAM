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
const RESULT_LIMIT=1_000_000,SESSION_IDLE_MS=10*60_000,HEARTBEAT_MS=30_000,BACKOFF_MS=[1000,30_000];
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
function sessionTransport(reply){
  const transport={onmessage:null,onclose:null,onerror:null,calls:new Map(),
    async start(){},
    async send(message){
      const call=transport.calls.get(message.id);
      if(call===undefined||!('result' in message||'error' in message))return;
      transport.calls.delete(message.id);
      const size=JSON.stringify(message).length;
      reply(call,size>RESULT_LIMIT?rpcError(message.id,-32000,'This result exceeds the relay limit of 1 MB. Ask for less, for example without includeGeometry.'):message);
    },
    async close(){transport.onclose?.();}
  };
  return transport;
}

export function connectRelay({device,runtime,sessionIdleMs=SESSION_IDLE_MS,onStatus=()=>{}}){
  const url=new URL('/device/connect',device.relayUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const link={socket:null,closed:false,backoff:BACKOFF_MS[0],heartbeat:null,retry:null,inbox:Promise.resolve()};
  const sessions=new Map();
  function reply(call,message,status=200){
    if(link.socket?.readyState===WebSocket.OPEN)link.socket.send(JSON.stringify({type:'result',call,status,message}));
    // Otherwise the relay has already failed this call; the work itself is saved locally.
  }
  function lease(session){
    clearTimeout(session.idle);
    session.idle=setTimeout(()=>{if(session.transport.calls.size)lease(session);else void end(session.id);},sessionIdleMs);
    session.idle.unref?.();
  }
  async function open(id){
    for(const other of [...sessions.keys()])await end(other);
    const transport=sessionTransport(reply),adapter=createMcpAdapter({runtime});
    await adapter.server.connect(transport);
    const session={id,transport,adapter,idle:null};sessions.set(id,session);onStatus({session:id,active:true});
    return session;
  }
  async function end(id){
    const session=sessions.get(id);if(!session)return;
    sessions.delete(id);clearTimeout(session.idle);
    await session.adapter.close();onStatus({session:id,active:false});
  }
  async function receive(packet){
    if(packet.type==='session-end')return end(packet.session);
    if(packet.type!=='mcp')return;
    const {call,message}=packet;
    const session=sessions.get(packet.session)??(message.method==='initialize'?await open(packet.session):null);
    if(!session){if(call)reply(call,rpcError(message.id,-32001,'Session not found; initialize a new session.'),404);return;}
    if(call)session.transport.calls.set(message.id,call);
    lease(session);
    session.transport.onmessage?.(message);
  }
  function connect(){
    const socket=new WebSocket(url,{headers:{Authorization:`Bearer ${device.secret}`}});link.socket=socket;
    socket.onopen=()=>{link.backoff=BACKOFF_MS[0];onStatus({connected:true});link.heartbeat=setInterval(()=>socket.send('ping'),HEARTBEAT_MS);};
    // Opening a session awaits the previous one's end; later messages queue behind it.
    socket.onmessage=({data})=>{if(data==='pong')return;link.inbox=link.inbox.then(()=>receive(JSON.parse(data))).catch(error=>console.error('SAAM relay message:',error));};
    socket.onerror=()=>{};
    socket.onclose=({code,reason})=>{
      clearInterval(link.heartbeat);if(link.socket===socket)link.socket=null;
      onStatus({connected:false,code,reason});
      if(link.closed||code===4401)return;
      link.retry=setTimeout(connect,link.backoff);link.backoff=Math.min(link.backoff*2,BACKOFF_MS[1]);
    };
  }
  connect();
  return {
    connected:()=>link.socket?.readyState===WebSocket.OPEN,
    sessions:()=>[...sessions.keys()],
    // Drops the link without ending sessions, as a network loss would.
    disconnect(){link.socket?.close();},
    async close(){
      link.closed=true;clearTimeout(link.retry);clearInterval(link.heartbeat);link.socket?.close(1000,'SAAM stopped.');
      for(const id of [...sessions.keys()])await end(id);
    }
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const relayUrl=process.env.SAAM_RELAY_URL,statePath=process.env.SAAM_RELAY_STATE??resolve(root,'.local','relay-device.json');
  if(!relayUrl){console.error('Set SAAM_RELAY_URL to the relay origin, for example https://relay.example.com.');process.exit(1);}
  const device=await loadDevice(relayUrl,statePath),command=process.argv[2];
  const showCode=async()=>{const {code,expiresAt}=await linkCode(device);console.log(`Connect your chat: add ${relayUrl}/mcp as a custom connector and enter code ${code} (valid until ${new Date(expiresAt).toLocaleTimeString()}).`);};
  if(command==='link')await showCode();
  else if(command==='unpair'){await unpair(device);console.log('This computer is unpaired. Delete',statePath,'to pair again.');}
  else{
    const runtime=createLocalRuntime({printsRoot:process.env.SAAM_PRINTS_ROOT??resolve(root,'Prints')});
    const connection=connectRelay({device,runtime,onStatus:status=>console.error('SAAM relay:',JSON.stringify(status))});
    await showCode();
    const stop=async()=>{await connection.close();await runtime.close();process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }
}
