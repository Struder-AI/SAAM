// The one shared relay object: invites, paired devices, chat sign-ins and
// single-use link codes, per-address limits, the calls in flight to each
// device's outbound WebSocket and the alpha records.
// A device has at most one chat session; its socket attachment records which,
// so a call for any other session is answered 404 at once and the chat starts a
// new one. The device owns session lifetime and reports every change.
import {DurableObject} from 'cloudflare:workers';

const LINK_CODE_MS=2*60_000,CALL_LIMIT_MS=15*60_000,KEEPALIVE_MS=20_000,MESSAGE_LIMIT=1_000_000;
const DAY_MS=86_400_000,PRUNE_EVERY_MS=60*60_000,PAGE_ROWS=500,PAGE_CHARS=8_000_000;
// A sign-in lives as long as the OAuth library's consent transaction (600 s).
// Wrong link codes are limited per sign-in and per network address, so no one
// can lock out anyone else; a registered computer that never connects within
// a day gives its slot back. CALLS_IN_FLIGHT bounds one computer's share of
// the shared object.
const SIGN_IN_MS=10*60_000,CODE_TRIES_PER_SIGN_IN=5,CODE_FAILURES_PER_ADDRESS=20,INVITE_FAILURES_PER_ADDRESS=10;
const UNCONNECTED_MS=DAY_MS,CALLS_IN_FLIGHT=8,INVITE_DAYS=14;
// A chat's SAAM panel (adapters/mcp/src/panel.html) says hello within
// PANEL_HELLO_MS; a session keeps its newest PANELS_PER_SESSION panels, and an
// address opens at most PANEL_OPENS_PER_ADDRESS in ten minutes.
const PANEL_HELLO_MS=10_000,PANELS_PER_SESSION=4,PANEL_OPENS_PER_ADDRESS=120,PANEL_KEY_LIMIT=256;
// Close codes the panel reads: 4001 its session ended, 4403 its key was refused
// (neither retried), 4503 the computer is offline (retried).
const SESSION_ENDED='This chat’s SAAM session ended. Ask the chat to call maker_onboarding to show the SAAM panel again.';
const OFFLINE='SAAM is not running on your computer, or it is offline.';
// The device-relay message protocol. A device speaking another version is
// told to update rather than left connected and unusable.
const PROTOCOL='1';
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function sha256(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function token(bytes){const value=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
// Groups of four letters and digits: two for a link code (typed, two minutes),
// four for an invite (pasted, single use, 80 bits).
function newCode(groups){const value=crypto.getRandomValues(new Uint8Array(groups*4));const code=[...value].map(b=>ALPHABET[b&31]).join('');return code.match(/.{4}/g).join('-');}
const normalizedCode=code=>String(code??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const encoder=new TextEncoder();
// A request body read no further than limit bytes; bytes over limit means refused.
export async function boundedText(request,limit){
  const declared=Number(request.headers.get('Content-Length'));
  if(declared>limit){request.body?.cancel().catch(()=>{});return {body:'',bytes:declared};}
  if(!request.body)return {body:'',bytes:0};
  const reader=request.body.getReader(),chunks=[];let bytes=0;
  for(;;){
    const {done,value}=await reader.read();if(done)break;
    bytes+=value.length;
    if(bytes>limit){reader.cancel().catch(()=>{});return {body:'',bytes};}
    chunks.push(value);
  }
  const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  return {body:new TextDecoder().decode(joined),bytes};
}

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
    // A panel key admits a panel to its session; the records keep none.
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='saam/panel'&&item&&typeof item==='object'?{...item,key:'[redacted]'}:compact(item)]));
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
        DROP TABLE IF EXISTS failures;
        CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,used_at INTEGER,device_id TEXT);
        CREATE TABLE IF NOT EXISTS sign_ins(handle_hash TEXT PRIMARY KEY,client_id TEXT,client_name TEXT,redirect_uri TEXT,expires_at INTEGER NOT NULL,failures INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS limits(key TEXT NOT NULL,start INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key,start));
        CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,device TEXT,session TEXT,call TEXT,
          kind TEXT NOT NULL,name TEXT,ms INTEGER,bytes INTEGER,error TEXT,body TEXT);
        CREATE INDEX IF NOT EXISTS records_at ON records(at);
        CREATE INDEX IF NOT EXISTS records_session ON records(session,id);
        CREATE INDEX IF NOT EXISTS records_device ON records(device,id);`);
      // Invited computers carry their invite's label and when they last connected.
      const columns=new Set(this.sql.exec('PRAGMA table_info(devices)').toArray().map(column=>column.name));
      for(const [name,type] of [['label','TEXT'],['invite_id','TEXT'],['connected_at','INTEGER']])
        if(!columns.has(name))this.sql.exec(`ALTER TABLE devices ADD COLUMN ${name} ${type}`);
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
  // The paired computers, for the operator: whose invite, when paired, last
  // connected and seen, online now and the SAAM version they last reported.
  listDevices(){
    const devices=this.sql.exec(`SELECT d.id,d.label,d.created_at AS paired,d.connected_at AS connected,
        (SELECT MAX(at) FROM records WHERE device=d.id) AS lastSeen,
        (SELECT body FROM records WHERE device=d.id AND kind='device-hello' ORDER BY id DESC LIMIT 1) AS hello
      FROM devices d ORDER BY d.created_at`).toArray()
      .map(({hello,...device})=>({...device,online:Boolean(this.socketFor(device.id)),saam:hello?JSON.parse(hello):null}));
    return {devices,limit:this.deviceLimit(),recordDays:this.recordDays(),databaseBytes:this.sql.databaseSize};
  }
  // MAX_PAIRED_DEVICES caps the computers that can pair at all, a backstop
  // behind invites; unset closes pairing.
  deviceLimit(){return Number(this.env.MAX_PAIRED_DEVICES??0);}
  // Counts one event under key in the current window and says whether the
  // window already held max; with max Infinity it only counts.
  overLimit(key,max,windowMs,{count=true}={}){
    const now=Date.now(),start=Math.floor(now/windowMs)*windowMs;
    this.sql.exec('DELETE FROM limits WHERE start<?',now-DAY_MS);
    const seen=this.sql.exec('SELECT count FROM limits WHERE key=? AND start=?',key,start).toArray()[0]?.count??0;
    if(seen>=max)return true;
    if(count)this.sql.exec('INSERT INTO limits(key,start,count) VALUES(?,?,1) ON CONFLICT(key,start) DO UPDATE SET count=count+1',key,start);
    return false;
  }
  // Registration spends one unused invite. address: the caller's IP, to bound invite guessing.
  async registerDevice({invite,address}={}){
    if(!invite)return {error:'Pairing needs an invite code. Install the current SAAM release and paste your invite in Studio\'s Connect panel.'};
    if(this.overLimit('invite:'+address,INVITE_FAILURES_PER_ADDRESS,60*60_000,{count:false}))return {error:'Too many invite attempts. Wait an hour and try again.'};
    const now=Date.now(),row=this.sql.exec('SELECT id,label,expires_at,used_at FROM invites WHERE code_hash=?',await sha256(normalizedCode(invite))).toArray()[0];
    if(!row||row.used_at||row.expires_at<now){
      this.overLimit('invite:'+address,Infinity,60*60_000);
      return {error:row?.used_at?'That invite has already been used. Ask for a new one.':row?'That invite has expired. Ask for a new one.':'That invite code is not valid. Check that it was pasted whole.'};
    }
    // Registered computers that never connected give their slot back.
    for(const {id} of this.sql.exec('SELECT id FROM devices WHERE connected_at IS NULL AND created_at<?',now-UNCONNECTED_MS).toArray())this.forgetDevice(id);
    const limit=this.deviceLimit();
    if(this.sql.exec('SELECT COUNT(*) AS count FROM devices').one().count>=limit)
      return {error:`The SAAM relay is full: ${limit} computers are paired. Ask the operator for a slot.`};
    const id=crypto.randomUUID(),secret=token(32);
    this.sql.exec('INSERT INTO devices(id,secret_hash,created_at,label,invite_id) VALUES(?,?,?,?,?)',id,await sha256(secret),now,row.label,row.id);
    this.sql.exec('UPDATE invites SET used_at=?,device_id=? WHERE id=?',now,id,row.id);
    this.record({device:id,kind:'link',name:'registered',body:{invite:row.id,label:row.label}});
    return {deviceId:id,secret};
  }
  // Invites for the operator: the code is shown once, only its hash is kept.
  async createInvite({label,days=INVITE_DAYS}){
    if(!label?.trim())return {error:'Name who the invite is for.'};
    const code=newCode(4),id=token(6),now=Date.now(),expiresAt=now+Math.max(1,Number(days)||INVITE_DAYS)*DAY_MS;
    this.sql.exec('INSERT INTO invites(id,code_hash,label,created_at,expires_at) VALUES(?,?,?,?,?)',id,await sha256(normalizedCode(code)),label.trim().slice(0,200),now,expiresAt);
    return {id,code,label:label.trim(),expiresAt};
  }
  listInvites(){
    return this.sql.exec('SELECT id,label,created_at AS created,expires_at AS expires,used_at AS used,device_id AS device FROM invites ORDER BY created_at').toArray()
      .map(invite=>({...invite,state:invite.used?'used':invite.expires<Date.now()?'expired':'open'}));
  }
  revokeInvite(id){
    return this.sql.exec('DELETE FROM invites WHERE id=? AND used_at IS NULL',id).rowsWritten>0;
  }
  // Removing a computer: its credential, codes and socket. The Worker revokes its chat grants.
  removeDevice(id){
    if(!this.deviceExists(id))return false;
    this.forgetDevice(id);
    this.record({device:id,kind:'link',name:'removed'});
    return true;
  }
  forgetDevice(id){
    this.sql.exec('DELETE FROM link_codes WHERE device_id=?',id);
    this.sql.exec('DELETE FROM devices WHERE id=?',id);
    for(const socket of this.ctx.getWebSockets(id))socket.close(4401,'This computer was unpaired.');
  }
  async deviceFor(secret){
    if(!secret)return null;
    return this.sql.exec('SELECT id FROM devices WHERE secret_hash=?',await sha256(secret)).toArray()[0]?.id??null;
  }
  deviceExists(id){return this.sql.exec('SELECT 1 FROM devices WHERE id=?',id).toArray().length>0;}
  async linkCode(secret){
    const deviceId=await this.deviceFor(secret);if(!deviceId)return null;
    const code=newCode(2),expiresAt=Date.now()+LINK_CODE_MS;
    this.sql.exec('DELETE FROM link_codes WHERE device_id=? OR expires_at<?',deviceId,Date.now());
    this.sql.exec('INSERT INTO link_codes(code_hash,device_id,expires_at) VALUES(?,?,?)',await sha256(normalizedCode(code)),deviceId,expiresAt);
    return {code,expiresAt};
  }
  // A consent page shown to someone (Worker's /authorize GET): only a sign-in
  // started here may try a code, and the retry page shows the same client and
  // destination as the first.
  async beginSignIn({handle,clientId,clientName,redirectUri}){
    const now=Date.now();
    this.sql.exec('DELETE FROM sign_ins WHERE expires_at<?',now);
    this.sql.exec('INSERT INTO sign_ins(handle_hash,client_id,client_name,redirect_uri,expires_at) VALUES(?,?,?,?,?)',await sha256(handle),clientId,clientName,redirectUri,now+SIGN_IN_MS);
  }
  // Checks the sign-in before the code, then the code; single use. A wrong
  // code counts against this sign-in and the caller's address, never globally.
  async redeemLinkCode({handle,code,address}){
    const handleHash=await sha256(String(handle??''));
    const signIn=this.sql.exec('SELECT client_id AS clientId,client_name AS clientName,redirect_uri AS redirectUri,expires_at,failures FROM sign_ins WHERE handle_hash=?',handleHash).toArray()[0];
    if(!signIn||signIn.expires_at<Date.now())return {expired:true,error:'This sign-in has expired. Start connecting again from your chat app.'};
    const {expires_at,failures,...client}=signIn;
    if(failures>=CODE_TRIES_PER_SIGN_IN)return {client,expired:true,error:'Too many wrong codes for this sign-in. Start connecting again from your chat app.'};
    if(this.overLimit('code:'+address,CODE_FAILURES_PER_ADDRESS,10*60_000,{count:false}))return {client,error:'Too many attempts from this network. Wait ten minutes and try again.'};
    const hash=await sha256(normalizedCode(code));
    const row=this.sql.exec('SELECT device_id,expires_at FROM link_codes WHERE code_hash=?',hash).toArray()[0];
    if(!row||row.expires_at<Date.now()){
      this.sql.exec('UPDATE sign_ins SET failures=failures+1 WHERE handle_hash=?',handleHash);
      this.overLimit('code:'+address,Infinity,10*60_000);
      return {client,error:'That code is not valid. Create a new code in SAAM and enter it within two minutes.'};
    }
    this.sql.exec('DELETE FROM link_codes WHERE code_hash=?',hash);
    this.sql.exec('DELETE FROM sign_ins WHERE handle_hash=?',handleHash);
    return {client,deviceId:row.device_id};
  }
  // How often an address may start a sign-in or register an OAuth client,
  // each of which writes to OAuth storage (free-plan KV allows 1,000 writes a day).
  admit(kind,address){
    const [max,windowMs]={authorize:[30,60*60_000],register:[10,60*60_000]}[kind];
    return !this.overLimit(`${kind}:${address}`,max,windowMs);
  }
  async unpair(secret){
    const deviceId=await this.deviceFor(secret);if(!deviceId)return null;
    this.forgetDevice(deviceId);
    return deviceId;
  }
  // Reached only through the Worker: the device's socket, or /mcp with the
  // device id the Worker took from the verified token.
  fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/device/connect')return this.connect(request);
    if(path==='/mcp')return this.mcp(request,request.headers.get('X-SAAM-Device'));
    if(path==='/panel')return this.openPanel(request);
    return new Response(null,{status:404});
  }
  // A newer connection replaces an older one.
  async connect(request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected a WebSocket upgrade.',{status:426});
    const deviceId=await this.deviceFor(/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1]);
    // Refusals are close codes the device can read: 4401 forgets the pairing, 4426 asks for an update.
    const refuse=(code,reason)=>{const [client,server]=Object.values(new WebSocketPair());server.accept();server.close(code,reason);return new Response(null,{status:101,webSocket:client});};
    if(!deviceId)return refuse(4401,'This computer was unpaired.');
    if(request.headers.get('X-SAAM-Protocol')!==PROTOCOL)return refuse(4426,'SAAM on this computer does not match the relay. Install the current SAAM release.');
    for(const socket of this.ctx.getWebSockets(deviceId))socket.close(4000,'Replaced by a newer connection.');
    const [client,server]=Object.values(new WebSocketPair()),connection=crypto.randomUUID();
    this.sql.exec('UPDATE devices SET connected_at=? WHERE id=?',Date.now(),deviceId);
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
  // A chat's SAAM panel: admitted by its hello, a key the device minted for its
  // current session, and sent that session's status while it stays connected.
  openPanel(request){
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected a WebSocket upgrade.',{status:426});
    if(this.overLimit('panel:'+(request.headers.get('CF-Connecting-IP')??'local'),PANEL_OPENS_PER_ADDRESS,10*60_000))return new Response('Too many SAAM panels from this network.',{status:429});
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server,['panel']);
    server.serializeAttachment({panel:true,deviceId:null,session:null,opened:Date.now()});
    setTimeout(()=>{if(server.readyState===WebSocket.OPEN&&!server.deserializeAttachment()?.session)server.close(4403,'The SAAM panel did not identify itself.');},PANEL_HELLO_MS);
    return new Response(null,{status:101,webSocket:client});
  }
  panelsFor(deviceId,session=null){
    return this.ctx.getWebSockets('panel').filter(socket=>{const attachment=socket.deserializeAttachment();return attachment?.deviceId===deviceId&&(!session||attachment.session===session);});
  }
  // Tells the device whether its session has a panel, which then keeps the session and hears its status.
  panelPresence(deviceId,session,connected=this.panelsFor(deviceId,session).length>0){
    try{this.socketFor(deviceId)?.send(JSON.stringify({type:'panel',session,connected}));}catch{/* The device reconnects and reports again. */}
  }
  async panelHello(socket,packet){
    const key=typeof packet.key==='string'&&packet.key.length<=PANEL_KEY_LIMIT?packet.key:'';
    const session=key.slice(0,Math.max(0,key.lastIndexOf('.'))),deviceId=session.split('.')[0];
    if(!session||!deviceId)return socket.close(4403,'This SAAM panel’s key is not valid.');
    const device=this.socketFor(deviceId);
    if(!device)return socket.close(4503,OFFLINE);
    const current=device.deserializeAttachment();
    if(current.session!==session)return socket.close(4001,SESSION_ENDED);
    if(!current.panelHash||current.panelHash!==await sha256(key))return socket.close(4403,'This SAAM panel’s key is not valid.');
    socket.serializeAttachment({panel:true,deviceId,session,opened:Date.now()});
    const panels=this.panelsFor(deviceId,session).sort((a,b)=>a.deserializeAttachment().opened-b.deserializeAttachment().opened);
    for(const older of panels.slice(0,-PANELS_PER_SESSION))older.close(4001,'A newer SAAM panel replaced this one.');
    this.record({device:deviceId,session,kind:'panel',name:'open'});
    this.panelPresence(deviceId,session,true);
  }
  // A status for the device's panels: of one session, or of all of them.
  panelStatus(deviceId,session,status){
    const packet=JSON.stringify({type:'status',...status});
    for(const panel of this.panelsFor(deviceId,session))try{panel.send(packet);}catch{/* Closing; its close is handled. */}
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
    // Stops reading at the limit: a declared length over it is refused unread,
    // and a request without Content-Length is measured as it arrives.
    const {body,bytes}=await boundedText(request,MESSAGE_LIMIT),call=crypto.randomUUID();
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
    if(awaitsResult&&[...this.pending.values()].filter(waiting=>waiting.device===deviceId).length>=CALLS_IN_FLIGHT)
      return refuse(rpcError(message.id,-32000,`SAAM is already working on ${CALLS_IN_FLIGHT} calls from this chat. Wait for one to finish, then try again.`),200);
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
    const attachment=socket.deserializeAttachment();
    if(attachment?.panel){
      let packet=null;try{packet=JSON.parse(data);}catch{/* Ignored below. */}
      if(!attachment.session&&packet?.type==='hello')return this.panelHello(socket,packet);
      return;
    }
    const packet=JSON.parse(data),device=attachment.deviceId;
    if(packet.type==='result')this.settle(packet.call,{status:packet.status===404?404:200,message:packet.message,origin:'device',bytes:encoder.encode(data).length});
    else if(packet.type==='session'){
      const session=packet.session??null;
      socket.serializeAttachment({...attachment,session,panelHash:typeof packet.panel==='string'?packet.panel:null});
      this.record({device,session,kind:'device-session',name:session?'active':'none'});
      for(const panel of this.panelsFor(device))if(panel.deserializeAttachment().session!==session)panel.close(4001,SESSION_ENDED);
      if(session&&this.panelsFor(device,session).length)this.panelPresence(device,session,true);
    }
    else if(packet.type==='panel-status'&&packet.session&&packet.session===attachment.session&&packet.status)this.panelStatus(device,packet.session,packet.status);
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
  // A panel's end: the device hears when its session has none left.
  panelClosed(socket,attachment){
    try{socket.close();}catch{/* already closed */}
    if(!attachment.session)return;
    this.record({device:attachment.deviceId,session:attachment.session,kind:'panel',name:'closed'});
    this.panelPresence(attachment.deviceId,attachment.session);
  }
  webSocketClose(socket,code,reason){
    const attachment=socket.deserializeAttachment();
    if(attachment?.panel)return this.panelClosed(socket,attachment);
    const {deviceId,connection}=attachment??{};
    if(code!==1000&&code!==4000)console.warn(JSON.stringify({event:'device-link-closed',deviceId,code,reason}));
    this.record({device:deviceId??null,kind:'link',name:'closed',error:code===1000||code===4000?null:`${code} ${reason}`.trim(),body:{connection,code,reason}});
    this.dropped(socket);try{socket.close(code,reason);}catch{/* already closed */}
    // A replaced connection already has its successor; only a lost one leaves the panels offline.
    if(deviceId&&!this.socketFor(deviceId))this.panelStatus(deviceId,null,{state:'error',text:OFFLINE+' The light returns when SAAM reconnects.'});
  }
  webSocketError(socket,error){
    const attachment=socket.deserializeAttachment();
    if(attachment?.panel)return this.panelClosed(socket,attachment);
    const deviceId=attachment?.deviceId??null,problem=String(error?.message??error);
    console.error(JSON.stringify({event:'device-link-error',deviceId,error:problem}));
    this.record({device:deviceId,kind:'link',name:'error',error:problem});
    this.dropped(socket);
  }
}
