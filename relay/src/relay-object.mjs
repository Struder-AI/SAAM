// The one shared relay object: paired devices, single-use link codes and the
// calls in flight to each device's outbound WebSocket. It stores no print data.
// A device has at most one chat session; its socket attachment records which,
// so a call for any other session is answered 404 at once and the chat starts a
// new one. The device owns session lifetime and reports every change.
import {DurableObject} from 'cloudflare:workers';

const LINK_CODE_MS=2*60_000,CALL_LIMIT_MS=15*60_000,FAILURES_PER_MINUTE=30,KEEPALIVE_MS=20_000,MESSAGE_LIMIT=1_000_000;
// The device-relay message protocol. A device speaking another version is
// told to update rather than left connected and unusable.
const PROTOCOL='1';
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function sha256(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function token(bytes){const value=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function newLinkCode(){const value=crypto.getRandomValues(new Uint8Array(8));const code=[...value].map(b=>ALPHABET[b&31]).join('');return code.slice(0,4)+'-'+code.slice(4);}
const normalizedCode=code=>String(code??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const encoder=new TextEncoder();

export class RelayObject extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    this.sql=ctx.storage.sql;
    // Calls awaiting a device result; they exist only while the object is awake.
    this.pending=new Map();
    ctx.blockConcurrencyWhile(async()=>{
      this.sql.exec(`CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,secret_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS link_codes(code_hash TEXT PRIMARY KEY,device_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS failures(minute INTEGER PRIMARY KEY,count INTEGER NOT NULL);`);
    });
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  // MAX_PAIRED_DEVICES caps the computers that can pair at all; unpairing frees a slot.
  async registerDevice(){
    const limit=Number(this.env.MAX_PAIRED_DEVICES??0);// Unset closes pairing.
    if(this.sql.exec('SELECT COUNT(*) AS count FROM devices').one().count>=limit)
      return {error:`The SAAM relay is full: ${limit} computers are paired. Ask the operator for a slot.`};
    const id=crypto.randomUUID(),secret=token(32);
    this.sql.exec('INSERT INTO devices(id,secret_hash,created_at) VALUES(?,?,?)',id,await sha256(secret),Date.now());
    return {deviceId:id,secret};
  }
  async deviceFor(secret){
    if(!secret)return null;
    return this.sql.exec('SELECT id FROM devices WHERE secret_hash=?',await sha256(secret)).toArray()[0]?.id??null;
  }
  deviceExists(id){return this.sql.exec('SELECT 1 FROM devices WHERE id=?',id).toArray().length>0;}
  async linkCode(secret){
    const deviceId=await this.deviceFor(secret);if(!deviceId)return null;
    const code=newLinkCode(),expiresAt=Date.now()+LINK_CODE_MS;
    this.sql.exec('DELETE FROM link_codes WHERE device_id=? OR expires_at<?',deviceId,Date.now());
    this.sql.exec('INSERT INTO link_codes(code_hash,device_id,expires_at) VALUES(?,?,?)',await sha256(normalizedCode(code)),deviceId,expiresAt);
    return {code,expiresAt};
  }
  // Single use; failures are counted per minute across all codes to bound guessing.
  async redeemLinkCode(code){
    const minute=Math.floor(Date.now()/60_000);
    this.sql.exec('DELETE FROM failures WHERE minute<?',minute);
    if((this.sql.exec('SELECT count FROM failures WHERE minute=?',minute).toArray()[0]?.count??0)>=FAILURES_PER_MINUTE)
      return {error:'Too many attempts. Wait a minute and try again.'};
    const hash=await sha256(normalizedCode(code));
    const row=this.sql.exec('SELECT device_id,expires_at FROM link_codes WHERE code_hash=?',hash).toArray()[0];
    if(!row||row.expires_at<Date.now()){
      this.sql.exec('INSERT INTO failures(minute,count) VALUES(?,1) ON CONFLICT(minute) DO UPDATE SET count=count+1',minute);
      return {error:'That code is not valid. Create a new code in SAAM and enter it within two minutes.'};
    }
    this.sql.exec('DELETE FROM link_codes WHERE code_hash=?',hash);
    return {deviceId:row.device_id};
  }
  async unpair(secret){
    const deviceId=await this.deviceFor(secret);if(!deviceId)return null;
    this.sql.exec('DELETE FROM link_codes WHERE device_id=?',deviceId);
    this.sql.exec('DELETE FROM devices WHERE id=?',deviceId);
    for(const socket of this.ctx.getWebSockets(deviceId))socket.close(4401,'This computer was unpaired.');
    return deviceId;
  }
  // Reached only through the Worker: the device's socket, or /mcp with the
  // device id the Worker took from the verified token.
  fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/device/connect')return this.connect(request);
    if(path==='/mcp')return this.mcp(request,request.headers.get('X-SAAM-Device'));
    return new Response(null,{status:404});
  }
  // A newer connection replaces an older one.
  async connect(request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected a WebSocket upgrade.',{status:426});
    const deviceId=await this.deviceFor(/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1]);
    if(!deviceId)return new Response('Unknown device credential.',{status:401});
    if(request.headers.get('X-SAAM-Protocol')!==PROTOCOL){
      const [client,server]=Object.values(new WebSocketPair());server.accept();
      server.close(4426,'SAAM on this computer does not match the relay. Install the current SAAM release.');
      return new Response(null,{status:101,webSocket:client});
    }
    for(const socket of this.ctx.getWebSockets(deviceId))socket.close(4000,'Replaced by a newer connection.');
    const [client,server]=Object.values(new WebSocketPair()),connection=crypto.randomUUID();
    this.ctx.acceptWebSocket(server,[deviceId]);
    server.serializeAttachment({deviceId,connection,session:null});
    // Deploying a new LATEST_RELEASE restarts this object and every device
    // reconnects, so each learns of the release without any other push.
    server.send(JSON.stringify({type:'release',release:this.latestRelease()}));
    return new Response(null,{status:101,webSocket:client});
  }
  // {version, assets:{<platform>:{url, sha256}}} from configuration, or null.
  latestRelease(){try{return JSON.parse(this.env.LATEST_RELEASE||'null');}catch{return null;}}
  socketFor(deviceId){
    return this.ctx.getWebSockets(deviceId).find(socket=>socket.readyState===WebSocket.OPEN)??null;
  }
  // Streamable HTTP. Long calls stream their one result as server-sent events,
  // with comment keepalives so no proxy sees an idle response.
  async mcp(request,deviceId){
    const session=request.headers.get('Mcp-Session-Id');
    if(request.method==='DELETE'){const socket=this.socketFor(deviceId);if(socket&&session===socket.deserializeAttachment().session)socket.send(JSON.stringify({type:'session-end',session}));return new Response(null,{status:204});}
    if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST, DELETE'}});
    // The body itself is measured: a request without Content-Length is not exempt.
    const body=await request.text();
    if(encoder.encode(body).length>MESSAGE_LIMIT){
      console.warn(JSON.stringify({event:'request-too-large',deviceId,bytes:encoder.encode(body).length}));
      return json(rpcError(null,-32600,'This request exceeds the relay limit of 1 MB. Send less at once, for example a smaller mesh or fewer changes per call.'),413);
    }
    let message;
    try{message=JSON.parse(body);}catch{return json(rpcError(null,-32700,'Parse error.'),400);}
    if(!message||typeof message!=='object'||Array.isArray(message))return json(rpcError(null,-32600,'Send one JSON-RPC message per request.'),400);
    if(!this.deviceExists(deviceId))return json(rpcError(message.id,-32001,'This computer was unpaired. Reconnect SAAM in your chat connector settings.'),403);
    const socket=this.socketFor(deviceId),initialize=message.method==='initialize';
    const awaitsResult=message.id!==undefined&&typeof message.method==='string';
    if(!socket)return awaitsResult?json(rpcError(message.id,-32000,'SAAM is not running on your computer, or it is offline. Start SAAM and try again.')):new Response(null,{status:202});
    const attachment=socket.deserializeAttachment();
    if(!initialize&&(!session||session!==attachment.session))return json(rpcError(message.id,-32001,'Session not found; initialize a new session.'),session?404:400);
    const routed=initialize?`${deviceId}.${token(18)}`:session;
    if(initialize)socket.serializeAttachment({...attachment,session:routed});
    if(!awaitsResult){try{socket.send(JSON.stringify({type:'mcp',session:routed,message}));}catch(error){console.error(JSON.stringify({event:'device-send-failed',deviceId,error:error.message}));}return new Response(null,{status:202});}
    const result=this.call(socket,routed,message);
    if(initialize||!/text\/event-stream/.test(request.headers.get('Accept')??'')){
      const {status,message:answer}=await result;
      return json(answer,status,initialize&&status===200?{'Mcp-Session-Id':routed}:{});
    }
    const {readable,writable}=new TransformStream(),writer=writable.getWriter();
    const keepalive=setInterval(()=>{writer.write(encoder.encode(': keepalive\n\n')).catch(()=>{});},KEEPALIVE_MS);
    void result.then(({message:answer})=>writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(answer)}\n\n`)))
      .catch(()=>{/* The chat went away; the call's work is saved locally. */})
      .finally(()=>{clearInterval(keepalive);writer.close().catch(()=>{});});
    return new Response(readable,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
  }
  call(socket,session,message){
    const {connection}=socket.deserializeAttachment(),call=crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.settle(call,{status:200,message:rpcError(message.id,-32000,'Your computer did not answer in time. Check the print before retrying.')}),CALL_LIMIT_MS);
      this.pending.set(call,{connection,id:message.id,resolve,timer});
      try{socket.send(JSON.stringify({type:'mcp',call,session,message}));}
      catch(error){
        console.error(JSON.stringify({event:'device-send-failed',tool:message.params?.name??message.method,error:error.message}));
        this.settle(call,{status:200,message:rpcError(message.id,-32000,'The relay could not pass this call to your computer: '+error.message)});
      }
    });
  }
  settle(call,result){
    const waiting=this.pending.get(call);if(!waiting)return;
    this.pending.delete(call);clearTimeout(waiting.timer);waiting.resolve(result);
  }
  webSocketMessage(socket,data){
    if(typeof data!=='string')return;
    const packet=JSON.parse(data);
    if(packet.type==='result')this.settle(packet.call,{status:packet.status===404?404:200,message:packet.message});
    else if(packet.type==='session')socket.serializeAttachment({...socket.deserializeAttachment(),session:packet.session??null});
  }
  // Link loss fails the calls on that connection at once; nothing is retried.
  dropped(socket){
    const {connection}=socket.deserializeAttachment()??{};
    const lost=[...this.pending].filter(([,waiting])=>waiting.connection===connection);
    if(lost.length)console.warn(JSON.stringify({event:'calls-dropped',count:lost.length}));
    for(const [call,waiting] of lost)
      this.settle(call,{status:200,message:rpcError(waiting.id,-32000,'The connection to your computer dropped during this call. Check the print before retrying.')});
  }
  webSocketClose(socket,code,reason){
    if(code!==1000&&code!==4000)console.warn(JSON.stringify({event:'device-link-closed',deviceId:socket.deserializeAttachment()?.deviceId,code,reason}));
    this.dropped(socket);try{socket.close(code,reason);}catch{/* already closed */}
  }
  webSocketError(socket,error){console.error(JSON.stringify({event:'device-link-error',deviceId:socket.deserializeAttachment()?.deviceId,error:String(error?.message??error)}));this.dropped(socket);}
}
