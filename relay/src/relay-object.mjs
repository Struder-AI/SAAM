// The one shared relay object: paired devices, single-use link codes and the
// calls in flight to each device's outbound WebSocket. It stores no print data.
// A session id carries its device id, so sessions need no storage; the device
// owns their lifetime.
import {DurableObject} from 'cloudflare:workers';

const LINK_CODE_MS=2*60_000,CALL_LIMIT_MS=15*60_000,FAILURES_PER_MINUTE=30;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const encoder=new TextEncoder();

async function sha256(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function token(bytes){const value=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function newLinkCode(){const value=crypto.getRandomValues(new Uint8Array(8));const code=[...value].map(b=>ALPHABET[b&31]).join('');return code.slice(0,4)+'-'+code.slice(4);}
const normalizedCode=code=>String(code??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});

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
  // The device's outbound connection. A newer connection replaces an older one.
  async fetch(request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected a WebSocket upgrade.',{status:426});
    const deviceId=await this.deviceFor(/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1]);
    if(!deviceId)return new Response('Unknown device credential.',{status:401});
    for(const socket of this.ctx.getWebSockets(deviceId))socket.close(4000,'Replaced by a newer connection.');
    const [client,server]=Object.values(new WebSocketPair()),connection=crypto.randomUUID();
    this.ctx.acceptWebSocket(server,[deviceId]);
    server.serializeAttachment({deviceId,connection});
    return new Response(null,{status:101,webSocket:client});
  }
  socketFor(deviceId){
    return this.ctx.getWebSockets(deviceId).find(socket=>socket.readyState===WebSocket.OPEN)??null;
  }
  // One chat MCP message for a device: {status, session?, message?}.
  async forward(deviceId,session,message){
    if(!this.deviceExists(deviceId))return {status:403,message:rpcError(message.id,-32001,'This computer was unpaired. Reconnect SAAM in your chat connector settings.')};
    const initialize=message.method==='initialize';
    if(initialize)session=`${deviceId}.${token(18)}`;
    else if(!session)return {status:400,message:rpcError(message.id,-32600,'Missing Mcp-Session-Id; initialize first.')};
    else if(!session.startsWith(deviceId+'.'))return {status:404,message:rpcError(message.id,-32001,'Session not found; initialize a new session.')};
    const socket=this.socketFor(deviceId);
    const request=message.id!==undefined&&typeof message.method==='string';
    if(!socket)return request?{status:200,message:rpcError(message.id,-32000,'SAAM is not running on your computer, or it is offline. Start SAAM and try again.')}:{status:202};
    if(!request){socket.send(JSON.stringify({type:'mcp',session,message}));return {status:202};}
    const {connection}=socket.deserializeAttachment(),call=crypto.randomUUID();
    const result=await new Promise(resolve=>{
      const timer=setTimeout(()=>this.settle(call,{status:200,message:rpcError(message.id,-32000,'Your computer did not answer in time. Check the print before retrying.')}),CALL_LIMIT_MS);
      this.pending.set(call,{connection,id:message.id,resolve,timer});
      socket.send(JSON.stringify({type:'mcp',call,session,message}));
    });
    return initialize&&result.status===200?{...result,session}:result;
  }
  settle(call,result){
    const waiting=this.pending.get(call);if(!waiting)return;
    this.pending.delete(call);clearTimeout(waiting.timer);waiting.resolve(result);
  }
  endSession(deviceId,session){
    if(session?.startsWith(deviceId+'.'))this.socketFor(deviceId)?.send(JSON.stringify({type:'session-end',session}));
  }
  webSocketMessage(socket,data){
    if(typeof data!=='string')return;
    const packet=JSON.parse(data);
    if(packet.type==='result')this.settle(packet.call,{status:packet.status===404?404:200,message:packet.message});
  }
  // Link loss fails the calls on that connection at once; nothing is retried.
  dropped(socket){
    const {connection}=socket.deserializeAttachment()??{};
    for(const [call,waiting] of this.pending)if(waiting.connection===connection)
      this.settle(call,{status:200,message:rpcError(waiting.id,-32000,'The connection to your computer dropped during this call. Check the print before retrying.')});
  }
  webSocketClose(socket,code,reason){this.dropped(socket);try{socket.close(code,reason);}catch{/* already closed */}}
  webSocketError(socket){this.dropped(socket);}
}
