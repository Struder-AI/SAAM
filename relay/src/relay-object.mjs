// Shared durable state for optional alpha activation and received diagnostics.
// Existing SQLite tables and the Durable Object class name are retained so
// deployed invites, credentials and received records survive this conversion.
import {DurableObject} from 'cloudflare:workers';

const DAY_MS=86_400_000,PRUNE_EVERY_MS=60*60_000,PAGE_ROWS=500,PAGE_CHARS=8_000_000;
const INVITE_DAYS=14,INVITE_FAILURES_PER_ADDRESS=10;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const encoder=new TextEncoder();
const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const token=bytes=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const newCode=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(byte=>ALPHABET[byte&31]).join('').match(/.{4}/g).join('-');
const normalizedCode=code=>String(code??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const sensitiveKey=/(?:secret|token|password|credential|authorization|cookie|invite|transcript|reasoning|prompt|instruction|query|content|chat|conversation|messages|url|uri|path|filename|directory|filecontent|sourcecode)/i;

function safeText(value){
  return value.slice(0,2048)
    .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi,'[url]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g,'[path]')
    .replace(/\/(?:Users|home|tmp|var|etc|mnt|Volumes|private)\/[^\s"'<>]+/g,'[path]');
}

// Refuse sensitive fields regardless of what an activated client sends. Large
// arrays and encoded blobs become counts; diagnostic facts remain inspectable.
export function compact(value,depth=0){
  if(depth>8)return '[depth limit]';
  if(Array.isArray(value)){
    const numeric=item=>typeof item==='number'||Array.isArray(item)&&item.every(number=>typeof number==='number');
    if(value.length>32&&value.every(numeric))return {elided:'numbers',length:value.length};
    const kept=value.slice(0,32).map(item=>compact(item,depth+1));
    if(value.length>32)kept.push({elided:'items',length:value.length-32});
    return kept;
  }
  if(value&&typeof value==='object'){
    const entries=Object.entries(value).slice(0,64).map(([key,item])=>[key,sensitiveKey.test(key)?'[redacted]':compact(item,depth+1)]);
    if(Object.keys(value).length>64)entries.push(['_elidedKeys',Object.keys(value).length-64]);
    return Object.fromEntries(entries);
  }
  if(typeof value==='string')return value.length>4096&&/^[A-Za-z0-9+/=_-]+$/.test(value)?{elided:'encoded',length:value.length}:safeText(value);
  return typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||value===null?value:null;
}

export const recordDaysFor=env=>{const days=Number(env.RECORD_DAYS??30);return Number.isFinite(days)&&days>0?days:0;};

// Stops reading when a request crosses its size cap, even without Content-Length.
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
  const joined=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  return {body:new TextDecoder().decode(joined),bytes};
}

export class RelayObject extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);this.sql=ctx.storage.sql;this.pruned=0;
    ctx.blockConcurrencyWhile(async()=>{
      this.sql.exec(`CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,secret_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,used_at INTEGER,device_id TEXT);
        CREATE TABLE IF NOT EXISTS limits(key TEXT NOT NULL,start INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(key,start));
        CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,device TEXT,session TEXT,call TEXT,
          kind TEXT NOT NULL,name TEXT,ms INTEGER,bytes INTEGER,error TEXT,body TEXT);
        CREATE INDEX IF NOT EXISTS records_at ON records(at);
        CREATE INDEX IF NOT EXISTS records_device ON records(device,id);`);
      const columns=new Set(this.sql.exec('PRAGMA table_info(devices)').toArray().map(column=>column.name));
      for(const [name,type] of [['label','TEXT'],['invite_id','TEXT']])if(!columns.has(name))this.sql.exec(`ALTER TABLE devices ADD COLUMN ${name} ${type}`);
    });
  }
  recordDays(){return recordDaysFor(this.env);}
  pruneRecords(){
    if(Date.now()-this.pruned<=PRUNE_EVERY_MS)return;
    this.pruned=Date.now();
    const days=this.recordDays();
    this.sql.exec('DELETE FROM records WHERE at<?',days?Date.now()-days*DAY_MS:Date.now()+1);
  }
  record({device,kind,name=null,body=null,error=null,bytes=null}){
    if(!this.recordDays())return true;
    try{
      this.pruneRecords();
      this.sql.exec('INSERT INTO records(at,device,kind,name,bytes,error,body) VALUES(?,?,?,?,?,?,?)',
        Date.now(),device,kind,name,bytes,error,body===null?null:JSON.stringify(compact(body)));
      return true;
    }catch(problem){console.error(JSON.stringify({event:'record-failed',kind,error:problem.message}));return false;}
  }
  readRecords({device=null,since=0,until=null,after=0}={}){
    this.pruneRecords();
    const where=['id>?','at>=?','at<=?'],values=[after,since,until??Number.MAX_SAFE_INTEGER];
    if(device){where.push('device=?');values.push(device);}
    const records=[];let chars=0;
    for(const row of this.sql.exec(`SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,...values,PAGE_ROWS)){
      records.push({...row,body:row.body===null?null:JSON.parse(row.body)});chars+=row.body?.length??0;
      if(chars>PAGE_CHARS)break;
    }
    return {records,next:records.length&&(records.length===PAGE_ROWS||chars>PAGE_CHARS)?records.at(-1).id:null};
  }
  listDevices(){
    this.pruneRecords();
    const devices=this.sql.exec(`SELECT d.id,d.label,d.created_at AS activated,
      (SELECT MAX(at) FROM records WHERE device=d.id) AS lastSeen
      FROM devices d ORDER BY d.created_at`).toArray();
    return {devices,limit:this.deviceLimit(),recordDays:this.recordDays(),databaseBytes:this.sql.databaseSize};
  }
  deviceLimit(){return Number(this.env.MAX_PAIRED_DEVICES??0);}
  overLimit(key,max,windowMs,{count=true}={}){
    const now=Date.now(),start=Math.floor(now/windowMs)*windowMs;
    this.sql.exec('DELETE FROM limits WHERE start<?',now-DAY_MS);
    const seen=this.sql.exec('SELECT count FROM limits WHERE key=? AND start=?',key,start).toArray()[0]?.count??0;
    if(seen>=max)return true;
    if(count)this.sql.exec('INSERT INTO limits(key,start,count) VALUES(?,?,1) ON CONFLICT(key,start) DO UPDATE SET count=count+1',key,start);
    return false;
  }
  async registerDevice({invite,address}={}){
    if(!invite)return {error:'Activation needs an invite code. SAAM still works without one.'};
    if(this.overLimit('invite:'+address,INVITE_FAILURES_PER_ADDRESS,60*60_000,{count:false}))return {error:'Too many invite attempts. Wait an hour and try again.'};
    const now=Date.now(),row=this.sql.exec('SELECT id,label,expires_at,used_at FROM invites WHERE code_hash=?',await sha256(normalizedCode(invite))).toArray()[0];
    if(!row||row.used_at||row.expires_at<now){
      this.overLimit('invite:'+address,Infinity,60*60_000);
      return {error:row?.used_at?'That invite has already been used. Ask for a new one.':row?'That invite has expired. Ask for a new one.':'That invite code is not valid. Check that it was pasted whole.'};
    }
    const limit=this.deviceLimit();
    if(this.sql.exec('SELECT COUNT(*) AS count FROM devices').one().count>=limit)
      return {error:`The SAAM alpha service is full: ${limit} installations are activated. Ask the operator for a slot.`};
    const id=crypto.randomUUID(),secret=token(32);
    this.sql.exec('INSERT INTO devices(id,secret_hash,created_at,label,invite_id) VALUES(?,?,?,?,?)',id,await sha256(secret),now,row.label,row.id);
    this.sql.exec('UPDATE invites SET used_at=?,device_id=? WHERE id=?',now,id,row.id);
    this.record({device:id,kind:'activation',name:'registered',body:{invite:row.id,label:row.label}});
    return {deviceId:id,secret};
  }
  async createInvite({label,days=INVITE_DAYS}){
    if(!label?.trim())return {error:'Name who the invite is for.'};
    const code=newCode(),id=token(6),now=Date.now(),expiresAt=now+Math.max(1,Number(days)||INVITE_DAYS)*DAY_MS;
    this.sql.exec('INSERT INTO invites(id,code_hash,label,created_at,expires_at) VALUES(?,?,?,?,?)',id,await sha256(normalizedCode(code)),label.trim().slice(0,200),now,expiresAt);
    return {id,code,label:label.trim(),expiresAt};
  }
  listInvites(){
    return this.sql.exec('SELECT id,label,created_at AS created,expires_at AS expires,used_at AS used,device_id AS device FROM invites ORDER BY created_at').toArray()
      .map(invite=>({...invite,state:invite.used?'used':invite.expires<Date.now()?'expired':'open'}));
  }
  revokeInvite(id){return this.sql.exec('DELETE FROM invites WHERE id=? AND used_at IS NULL',id).rowsWritten>0;}
  removeDevice(id){
    if(this.sql.exec('DELETE FROM devices WHERE id=?',id).rowsWritten===0)return false;
    this.record({device:id,kind:'activation',name:'removed'});return true;
  }
  async deviceFor(secret){
    if(!secret)return null;
    return this.sql.exec('SELECT id FROM devices WHERE secret_hash=?',await sha256(secret)).toArray()[0]?.id??null;
  }
  async receiveEvent({secret,event,about}){
    const device=await this.deviceFor(secret);
    if(!device)return {error:'Unknown device credential.'};
    const name=typeof event.kind==='string'?event.kind:typeof event.name==='string'?event.name:null;
    if(!this.record({device,kind:'diagnostic',name:name?safeText(name).slice(0,100):null,
      bytes:encoder.encode(JSON.stringify({event,about})).length,body:{event,about}}))return {error:'Diagnostic storage unavailable.'};
    return {received:true};
  }
}
