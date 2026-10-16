// Native in-process observers. No command hooks or permission decisions.
const observer={connectionId:crypto.randomUUID(),sequence:0,polling:false,sessions:{},turns:{},active:{},notified:{},configuration:null};
async function configuration($){return observer.configuration??=JSON.parse(await $.fs.read($.plugin.root+'/client.json'));}
async function control($,message){
  const config=await configuration($),instance=JSON.parse(await $.fs.read(config.home+'/state/instance.json'));
  const result=await $.http.fetch('http://127.0.0.1:'+instance.port+'/control',{method:'POST',headers:{'content-type':'application/json','x-saam-control':instance.token},body:JSON.stringify({...message,contract:config.contract})});
  if(!result.ok)throw Error('SAAM lifecycle delivery: '+result.status);
  const value=JSON.parse(result.text);if(value.ok===false)throw Error(value.error);return value;
}
async function send($,event){await control($,{command:'client-lifecycle',event});}
async function report($,kind,e,extra={}){
  if(e.agentId||e.agent_id)return;
  const sessionId=e.sessionId||await $.session.id();
  await $.env.set('CLAUDE_CODE_SESSION_ID',sessionId);
  if(kind==='started')observer.turns[sessionId]=e.turnId;
  const event={id:observer.connectionId+':'+(++observer.sequence),client:'claude',sessionId,connectionId:observer.connectionId,kind,turnId:e.turnId||observer.turns[sessionId]||null,...extra};
  await $.store.set(event.id,event);
  if(!observer.sessions[sessionId]&&kind!=='connected'){
    const connected={...event,id:event.id+':connect',kind:'connected'};
    await $.store.set(connected.id,connected);
    try{await send($,connected);await $.store.delete(connected.id);}catch{return;}
  }
  try{await send($,event);await $.store.delete(event.id);observer.sessions[sessionId]=true;}catch{}
}
async function inbox($,sessionId){return control($,{command:'client-inbox',client:'claude',sessionId,includeHeld:true});}
async function acknowledge($,sessionId,message){await control($,{command:'client-ack',client:'claude',sessionId,eventIds:message.ids});}
export function register(on){
  on('session.start',async($,e,next)=>{
    try{
      const config=await configuration($),owner=await $.process.run([config.node,config.owner]);
      const pid=Number(owner.stdout.trim());
      if(owner.exitCode!==0||!Number.isSafeInteger(pid)||pid<1)throw Error('Cannot identify Claude process.');
      const event={id:observer.connectionId+':owner',client:'claude',connectionId:observer.connectionId,kind:'owner',pid};
      await $.store.set(event.id,event);
      try{await send($,event);await $.store.delete(event.id);}catch{}
    }catch{/* The next native observation still runs if process discovery fails. */}
    await report($,'connected',e);
    $.clock.every(250,async()=>{
      if(observer.polling)return;observer.polling=true;
      try{
        for(const key of await $.store.keys()){
          const pending=await $.store.get(key);
          if(pending?.client==='claude'){await send($,pending);await $.store.delete(key);}
        }
        const sessionId=await $.session.id();
        if(!observer.sessions[sessionId])await report($,'connected',{sessionId});
        if(observer.active[sessionId])return;
        const {message}=await inbox($,sessionId);
        if(observer.active[sessionId]||!message?.wake||observer.notified[sessionId]===message.wake.id)return;
        await $.prompt.submit({text:message.wake.text});
        observer.notified[sessionId]=message.wake.id;
      }catch{/* Durable evidence and unacknowledged Studio events retry. */}finally{observer.polling=false;}
    });
    return next(e);
  });
  on('prompt.submit',async($,e,next)=>{if(['composer','bridge','sdk'].includes(e.origin.kind))await report($,'message',e);return next(e);});
  on('session.append',{door:'prompt'},async($,e,next)=>{
    if(['composer','bridge','sdk'].includes(e.origin.kind))await report($,'message',e);
    const result=await next(e);
    if(!e.agentId)try{
      const sessionId=await $.session.id(),{message}=await inbox($,sessionId);
      if(message){
        // The prompt is stored, but its model request has not been prepared.
        // Native append creates an isMeta context row, not a composer prompt.
        await $.session.append({message:{type:'user',content:[{type:'text',text:message.text}]}});
        await acknowledge($,sessionId,message);
      }
    }catch{/* Keep the inbox for the next native tool-result boundary. */}
    return result;
  });
  on('session.append',{door:'tool-result'},async($,e,next)=>{
    if(e.agentId)return next(e);
    const delivery={sessionId:null,message:null,content:null};
    try{
      const sessionId=await $.session.id(),{message}=await inbox($,sessionId);if(!message)return next(e);
      const first=e.message.content.findIndex(block=>block.type==='tool_result');if(first<0)return next(e);
      delivery.sessionId=sessionId;delivery.message=message;
      delivery.content=e.message.content.map((block,index)=>index!==first?block:{...block,content:[...(Array.isArray(block.content)?block.content:[{type:'text',text:block.content??''}]),{type:'text',text:message.text}]});
    }catch{return next(e);}
    const result=await next({...e,message:{...e.message,content:delivery.content}});
    try{await acknowledge($,delivery.sessionId,delivery.message);}catch{/* Stored context may repeat after reconnect; IDs remain stable. */}
    return result;
  });
  on('turn.start',async($,e,next)=>{if(!e.agentId)observer.active[e.sessionId||await $.session.id()]=e.turnId;await report($,'started',e);return next(e);});
  on('turn.complete',async($,e,next)=>{if(!e.agentId)delete observer.active[e.sessionId||await $.session.id()];await report($,'contact',e,{reason:e.isAborted?'interrupt':e.reason==='error'?'failed':'turn'});return next(e);});
  on('classic.PermissionRequest',async($,e,next)=>{if(e.permission_mode!=='dontAsk')await report($,'contact',e,{reason:'approval'});return next(e);});
  on('tool.call',{tool:['AskUserQuestion','ExitPlanMode']},async($,e,next)=>{await report($,'contact',e,{reason:e.tool==='ExitPlanMode'?'plan':'question'});return next(e);});
  on('classic.Elicitation',async($,e,next)=>{await report($,'contact',e,{reason:'elicitation'});return next(e);});
  on('classic.StopFailure',async($,e,next)=>{await report($,'contact',e,{reason:'failed'});return next(e);});
  on('session.end',async($,e,next)=>{await report($,'closed',e);return next(e);});
}
