import {spawn} from 'node:child_process';
import {Transform} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,open,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCodexWire} from './codex-wire.mjs';
import {control} from './transport.mjs';
import {codexBackend} from './codex-backend.mjs';
import {deliverCodexContext} from './codex-context.mjs';

const folder=dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await readFile(join(folder,'client.json'),'utf8'));
const args=process.argv.slice(2),connectionId=randomUUID();
if(args.includes('--saam-context-hook')){
  try{await deliverCodexContext(config);}catch(error){process.stderr.write('SAAM context delivery deferred: '+error.message+'\n');}
}else{
const backend=await codexBackend(config);
if(!args.includes('app-server')){
  const native=spawn(backend,args,{env:{...process.env,CODEX_CLI_PATH:backend},windowsHide:true,stdio:'inherit'});
  native.on('error',error=>{process.stderr.write(error.message+'\n');process.exit(1);});
  native.on('exit',code=>process.exit(code??1));
  await new Promise(()=>{});
}
const outbox=join(config.home,'state','clients','codex-outbox');
await mkdir(outbox,{recursive:true});
const spool=await open(join(outbox,connectionId+'.jsonl'),'a');
const state={pending:[],tail:Promise.resolve(),retry:null,delivery:null,ending:false,waking:false,wakeRequests:new Map(),wakeCounter:0,offset:0,notified:new Set(),sequence:0,lifecycleSequence:0};
// Replay unfinished native evidence from earlier backend processes. Receiver IDs
// make concurrent replay harmless; acknowledged spools are compacted on exit.
for(const name of await readdir(outbox))if(name.endsWith('.jsonl')&&name!==connectionId+'.jsonl'){
  const acknowledged=await readFile(join(outbox,name+'.ack'),'utf8').then(Number).catch(()=>0);
  const lines=(await readFile(join(outbox,name),'utf8')).split('\n').filter(Boolean);
  for(const [index,line] of lines.entries())if(index>=acknowledged)try{state.pending.push({event:JSON.parse(line),file:name,offset:index+1});}catch{/* An interrupted final append is not an accepted event. */}
}
function drain(){return state.delivery??=(async()=>{
  try{
    while(state.pending.length){
      const pending=state.pending[0];
      if(pending.event.kind==='acknowledged')await control(config,{command:'client-ack',client:'codex',sessionId:pending.event.sessionId,eventIds:[pending.event.eventId]});
      else await control(config,{command:'client-lifecycle',event:pending.event});
      state.pending.shift();
      const file=pending.local?connectionId+'.jsonl':pending.file,offset=pending.local?++state.offset:pending.offset;
      const acknowledged=await readFile(join(outbox,file+'.ack'),'utf8').then(Number).catch(()=>0);
      if(offset>acknowledged){const temporary=join(outbox,file+'.'+randomUUID()+'.tmp');await writeFile(temporary,String(offset));await rename(temporary,join(outbox,file+'.ack'));}
    }
  }catch{
    if(!state.retry)state.retry=setTimeout(()=>{state.retry=null;void drain();},500);
  }
})().finally(()=>{state.delivery=null;});}
function record(event){
  state.sequence++;
  const numbered=event.kind==='acknowledged'?event:{...event,sequence:++state.lifecycleSequence};
  state.tail=state.tail.then(async()=>{await spool.write(JSON.stringify(numbered)+'\n');await spool.sync();state.pending.push({event:numbered,local:true});void drain();});
  state.tail.catch(error=>process.stderr.write('SAAM lifecycle evidence write failed: '+error.code+'\n'));
}
const wire=createCodexWire(connectionId,record);
function tap(direction){
  const decoder=new StringDecoder('utf8'),buffer={text:''};
  async function observe(text,stream){
    buffer.text+=text;
    for(;;){const boundary=buffer.text.indexOf('\n');if(boundary<0)break;
      const line=buffer.text.slice(0,boundary);buffer.text=buffer.text.slice(boundary+1);
      const forwarding={enabled:true};
      if(line.trim())try{const message=JSON.parse(line);if(direction==='client')wire.client(message);else if(!message.method&&state.wakeRequests.has(String(message.id))){
        const wake=state.wakeRequests.get(String(message.id));state.wakeRequests.delete(String(message.id));forwarding.enabled=false;
        // A wake is only a nudge. Context delivery still owns acknowledgement.
        if(!message.error)for(const eventId of wake.ids)state.notified.add(eventId);
        if(!message.error&&message.result?.turn)wire.server({method:'turn/started',params:{threadId:wake.sessionId,turn:message.result.turn}});
      }else wire.server(message);}catch(error){process.stderr.write('SAAM lifecycle frame could not be observed; original traffic forwarded.\n');}
      // Establish native evidence before its next tool can reach SAAM. An
      // unavailable SAAM leaves durable evidence and never prevents chat use.
      await state.tail;await drain();
      if(forwarding.enabled)stream.push(line+'\n');
    }
  }
  return new Transform({transform(chunk,encoding,done){void observe(decoder.write(chunk),this).then(()=>done(),done);},flush(done){void observe(decoder.end(),this).then(()=>{if(buffer.text)this.push(buffer.text);done();},done);}});
}
// Preserve all arguments and permissions supplied by the actual desktop.
const child=spawn(backend,args,{env:{...process.env,CODEX_CLI_PATH:backend},cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});
if(child.pid)record({id:randomUUID(),kind:'owner',client:'codex',connectionId,pid:child.pid});
process.stdin.pipe(tap('client')).pipe(child.stdin);
child.stdout.pipe(tap('server')).pipe(process.stdout);
child.stderr.pipe(process.stderr);
async function wake(){
  if(state.waking||state.ending)return;state.waking=true;
  try{
    const sessionIds=wire.roots().filter(sessionId=>wire.idle(sessionId)&&![...state.wakeRequests.values()].some(w=>w.sessionId===sessionId));
    if(!sessionIds.length)return;
    const {messages}=await control(config,{command:'client-inbox',client:'codex',sessionIds,includeHeld:true});
    for(const {sessionId,message} of messages){
    // Recheck after the inbox read: a real user may have started work meanwhile.
    if(!wire.idle(sessionId))continue;
    if(!message.wake||state.notified.has(message.wake.id))continue;
    const id='saam_'+connectionId+'_'+(++state.wakeCounter);
    state.wakeRequests.set(id,{sessionId,ids:[message.wake.id]});
    child.stdin.write(JSON.stringify({id,method:'turn/start',params:{threadId:sessionId,clientUserMessageId:message.wake.id,turnTrigger:'saam_studio',input:[{type:'text',text:message.wake.text}]}})+'\n');
  }}catch{}finally{state.waking=false;}
}
const wakeTimer=setInterval(()=>{void wake();},250);
child.stdin.on('error',()=>{});process.stdout.on('error',()=>{wire.ended(false);});
child.on('error',error=>{process.stderr.write('Codex backend could not start: '+error.code+'\n');process.exitCode=1;});
child.on('close',async(code,signal)=>{
  state.ending=true;clearInterval(wakeTimer);wire.ended(true);await state.tail;await drain();
  // The durable outbox is recovered by the receiver even if it is offline here.
  clearTimeout(state.retry);await spool.close();
  if(state.offset===state.sequence){
    await rm(join(outbox,connectionId+'.jsonl'),{force:true});
    await rm(join(outbox,connectionId+'.jsonl.ack'),{force:true});
  }
  process.exitCode=code??1;process.stdin.destroy();
});
}
