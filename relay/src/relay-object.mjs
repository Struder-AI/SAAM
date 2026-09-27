// The one shared relay object: paired devices, single-use link codes, the
// calls in flight to each device's outbound WebSocket and the alpha records.
// A device has at most one chat session; its socket attachment records which,
// so a call for any other session is answered 404 at once and the chat starts a
// new one. The device owns session lifetime and reports every change.
import {DurableObject} from 'cloudflare:workers';

const LINK_CODE_MS=2*60_000,CALL_LIMIT_MS=15*60_000,FAILURES_PER_MINUTE=30,KEEPALIVE_MS=20_000,MESSAGE_LIMIT=1_000_000;
const DAY_MS=86_400_000,PRUNE_EVERY_MS=60*60_000,PAGE_ROWS=500,PAGE_CHARS=8_000_000;
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

// Alpha records (D-039): one row per message between a chat and its computer,
// per device event and per link change, kept RECORD_DAYS days (0 records
// nothing). Bodies are kept as sent, except that a tool result's JSON text is
// stored parsed, and long number arrays (meshes, paths) and long encoded
// strings (files) are replaced by their length.
export function compact(value){
  if(Array.isArray(value)){
    const numeric=item=>typeof item==='number'||Array.isArray(item)&&item.every(number=>typeof number==='number');
    return value.length>32&&value.every(numeric)?{elided:'numbers',length:value.length}:value.map(compact);
  }
  if(value&&typeof value==='object'){
    if(value.type==='text'&&typeof value.text==='string'&&/^[[{]/.test(value.text)){
      try{const {text,...rest}=value;return {...compact(rest),json:compact(JSON.parse(text))};}catch{/* Not JSON: kept as text. */}
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,compact(item)]));
  }
  return typeof value==='string'&&value.length>4096&&/^[A-Za-z0-9+/=_-]+$/.test(value)?{elided:'encoded',length:value.length}:value;
}
export const recordDaysFor=env=>{const days=Number(env.RECORD_DAYS??30);return Number.isFinite(days)&&days>0?days:0;};
// The failure a JSON-RPC answer reports, if any.
const failure=message=>message?.error?.message??(message?.result?.isError?(message.result.content??[]).map(item=>item.text).join(' '):null);

export class RelayObject extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    this.sql=ctx.storage.sql;
    // Calls awaiting a device result; they exist only while the object is awake.
    this.pending=new Map();
    this.pruned=0;
    ctx.blockConcurrencyWhile(async()=>{
      this.sql.exec(`CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,secret_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS link_codes(code_hash TEXT PRIMARY KEY,device_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS failures(minute INTEGER PRIMARY KEY,count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,device TEXT,session TEXT,call TEXT,
          kind TEXT NOT NULL,name TEXT,ms INTEGER,bytes INTEGER,error TEXT,body TEXT);
        CREATE INDEX IF NOT EXISTS records_at ON records(at);
        CREATE INDEX IF NOT EXISTS records_session ON records(session,id);
        CREATE INDEX IF NOT EXISTS records_device ON records(device,id);`);
    });
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  recordDays(){return recordDaysFor(this.env);}
  // Adds one record, pruning expired ones at most hourly. Recording never
  // fails the relaying it describes.
  record({at=Date.now(),device=null,session=null,call=null,kind,name=null,ms=null,bytes=null,error=null,body=null}){
    const days=this.recordDays();if(!days)return;
    try{
      if(Date.now()-this.pruned>PRUNE_EVERY_MS){this.pruned=Date.now();this.sql.exec('DELETE FROM records WHERE at<?',Date.now()-days*DAY_MS);}
      this.sql.exec('INSERT INTO records(at,device,session,call,kind,name,ms,bytes,error,body) VALUES(?,?,?,?,?,?,?,?,?,?)',
        at,device,session,call,kind,name,ms,bytes,error===null?null:String(error).slice(0,2000),body===null?null:JSON.stringify(compact(body)));
    }catch(problem){console.error(JSON.stringify({event:'record-failed',kind,error:problem.message}));}
  }
  // Reading the records: the Worker's /records routes, behind RECORDS_TOKEN.
  // A page ends at PAGE_ROWS rows or about PAGE_CHARS of bodies; next continues it.
  readRecords({session=null,device=null,since=0,until=null,after=0}={}){
    const where=['id>?','at>=?','at<=?'],values=[after,since,until??Number.MAX_SAFE_INTEGER];
    if(session){where.push('session=?');values.push(session);}
    if(device){where.push('device=?');values.push(device);}
    const records=[];let chars=0;
    for(const row of this.sql.exec(`SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,...values,PAGE_ROWS)){
      records.push({...row,body:row.body===null?null:JSON.parse(row.body)});chars+=row.body?.length??0;
      if(chars>PAGE_CHARS)break;
    }
    return {records,next:records.length&&(records.length===PAGE_ROWS||chars>PAGE_CHARS)?records.at(-1).id:null};
  }
  recordSessions({since=0}={}){
    return this.sql.exec(`SELECT session,device,MIN(at) AS first,MAX(at) AS last,COUNT(*) AS records,
        SUM(kind='request') AS requests,SUM(error IS NOT NULL) AS errors,
        MAX(CASE WHEN kind='request' AND name='initialize' THEN json_extract(body,'$.params.clientInfo.name') END) AS client
      FROM records WHERE session IS NOT NULL AND at>=? GROUP BY session ORDER BY last DESC`,since).toArray();
  }
  recordDevices(){
    const devices=this.sql.exec(`SELECT d.id,d.created_at AS paired,
        (SELECT MAX(at) FROM records WHERE device=d.id) AS lastSeen,
        (SELECT body FROM records WHERE device=d.id AND kind='device-hello' ORDER BY id DESC LIMIT 1) AS hello
      FROM devices d ORDER BY d.created_at`).toArray().map(({hello,...device})=>({...device,saam:hello?JSON.parse(hello):null}));
    return {devices,recordDays:this.recordDays(),databaseBytes:this.sql.databaseSize};
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
    this.record({device:deviceId,kind:'link',name:'open',body:{connection}});
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
    if(request.method==='DELETE'){
      this.record({device:deviceId,session,kind:'session-end'});
      const socket=this.socketFor(deviceId);if(socket&&session===socket.deserializeAttachment().session)socket.send(JSON.stringify({type:'session-end',session}));return new Response(null,{status:204});
    }
    if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST, DELETE'}});
    // The body itself is measured: a request without Content-Length is not exempt.
    const body=await request.text(),bytes=encoder.encode(body).length,call=crypto.randomUUID();
    let message=null,parsed=false;
    if(bytes<=MESSAGE_LIMIT)try{message=JSON.parse(body);parsed=true;}catch{/* Answered below. */}
    const initialize=message?.method==='initialize',name=message?.params?.name??message?.method??null;
    // A new chat session's id is chosen now, so its opening request is recorded under it.
    const routed=initialize?`${deviceId}.${token(18)}`:session;
    this.record({device:deviceId,session:routed,call,kind:'request',name,bytes,body:bytes>MESSAGE_LIMIT?null:parsed?message:{unparsed:body}});
    // The relay's own answer to a request it does not pass on, recorded as a result.
    const refuse=(answer,status)=>{this.record({device:deviceId,session:routed,call,kind:'relay-result',name,error:failure(answer),body:answer});return json(answer,status);};
    if(bytes>MESSAGE_LIMIT){
      console.warn(JSON.stringify({event:'request-too-large',deviceId,bytes}));
      return refuse(rpcError(null,-32600,'This request exceeds the relay limit of 1 MB. Send less at once, for example a smaller mesh or fewer changes per call.'),413);
    }
    if(!parsed)return refuse(rpcError(null,-32700,'Parse error.'),400);
    if(!message||typeof message!=='object'||Array.isArray(message))return refuse(rpcError(null,-32600,'Send one JSON-RPC message per request.'),400);
    if(!this.deviceExists(deviceId))return refuse(rpcError(message.id,-32001,'This computer was unpaired. Reconnect SAAM in your chat connector settings.'),403);
    const socket=this.socketFor(deviceId);
    const awaitsResult=message.id!==undefined&&typeof message.method==='string';
    if(!socket)return awaitsResult?refuse(rpcError(message.id,-32000,'SAAM is not running on your computer, or it is offline. Start SAAM and try again.'),200):new Response(null,{status:202});
    const attachment=socket.deserializeAttachment();
    if(!initialize&&(!session||session!==attachment.session))return refuse(rpcError(message.id,-32001,'Session not found; initialize a new session.'),session?404:400);
    if(initialize)socket.serializeAttachment({...attachment,session:routed});
    if(!awaitsResult){try{socket.send(JSON.stringify({type:'mcp',session:routed,message}));}catch(error){console.error(JSON.stringify({event:'device-send-failed',deviceId,error:error.message}));}return new Response(null,{status:202});}
    const result=this.call(socket,routed,message,{call,device:deviceId,name});
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
  // origin: 'device' for the computer's answer, else 'relay' (timeout, lost link).
  call(socket,session,message,{call,device,name}){
    const {connection}=socket.deserializeAttachment();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.settle(call,{status:200,origin:'relay',message:rpcError(message.id,-32000,'Your computer did not answer in time. Check the print before retrying.')}),CALL_LIMIT_MS);
      this.pending.set(call,{connection,id:message.id,resolve,timer,device,session,name,started:Date.now()});
      try{socket.send(JSON.stringify({type:'mcp',call,session,message}));}
      catch(error){
        console.error(JSON.stringify({event:'device-send-failed',tool:name,error:error.message}));
        this.settle(call,{status:200,origin:'relay',message:rpcError(message.id,-32000,'The relay could not pass this call to your computer: '+error.message)});
      }
    });
  }
  settle(call,{status,message,origin,bytes=null}){
    const waiting=this.pending.get(call);if(!waiting)return;
    this.pending.delete(call);clearTimeout(waiting.timer);
    this.record({device:waiting.device,session:waiting.session,call,kind:origin==='device'?'result':'relay-result',name:waiting.name,
      ms:Date.now()-waiting.started,bytes,error:failure(message),body:message});
    waiting.resolve({status,message});
  }
  webSocketMessage(socket,data){
    if(typeof data!=='string')return;
    const packet=JSON.parse(data),attachment=socket.deserializeAttachment(),device=attachment.deviceId;
    if(packet.type==='result')this.settle(packet.call,{status:packet.status===404?404:200,message:packet.message,origin:'device',bytes:encoder.encode(data).length});
    else if(packet.type==='session'){
      socket.serializeAttachment({...attachment,session:packet.session??null});
      this.record({device,session:packet.session??null,kind:'device-session',name:packet.session?'active':'none'});
    }
    // Held while offline, an event keeps the time the device saw it.
    else if(packet.type==='event')this.record({at:Number.isFinite(packet.at)?Math.min(packet.at,Date.now()):Date.now(),device,session:attachment.session,kind:'device-event',name:packet.event?.kind??null,error:packet.event?.error??null,body:packet.event});
    else if(packet.type==='hello'){const {type,...hello}=packet;this.record({device,kind:'device-hello',name:hello.version??null,body:hello});}
  }
  // Link loss fails the calls on that connection at once; nothing is retried.
  dropped(socket){
    const {connection}=socket.deserializeAttachment()??{};
    const lost=[...this.pending].filter(([,waiting])=>waiting.connection===connection);
    if(lost.length)console.warn(JSON.stringify({event:'calls-dropped',count:lost.length}));
    for(const [call,waiting] of lost)
      this.settle(call,{status:200,origin:'relay',message:rpcError(waiting.id,-32000,'The connection to your computer dropped during this call. Check the print before retrying.')});
  }
  webSocketClose(socket,code,reason){
    const {deviceId,connection}=socket.deserializeAttachment()??{};
    if(code!==1000&&code!==4000)console.warn(JSON.stringify({event:'device-link-closed',deviceId,code,reason}));
    this.record({device:deviceId??null,kind:'link',name:'closed',error:code===1000||code===4000?null:`${code} ${reason}`.trim(),body:{connection,code,reason}});
    this.dropped(socket);try{socket.close(code,reason);}catch{/* already closed */}
  }
  webSocketError(socket,error){
    const deviceId=socket.deserializeAttachment()?.deviceId??null,problem=String(error?.message??error);
    console.error(JSON.stringify({event:'device-link-error',deviceId,error:problem}));
    this.record({device:deviceId,kind:'link',name:'error',error:problem});
    this.dropped(socket);
  }
}
