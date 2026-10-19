import {randomUUID} from 'node:crypto';

// Observe both directions of the SAME connection used by the desktop.
// This module never approves a request or changes client/server traffic.
export function createCodexWire(connectionId,emit){
  const state={roots:new Set(),children:new Set(),pending:new Map(),turns:new Map(),turnNumbers:new Map(),active:new Set(),starting:new Map(),waiting:new Map()};
  function publish(sessionId,kind,extra={}){
    const turnId=extra.turnId??state.turns.get(sessionId)??null;
    const prior=state.turnNumbers.get(sessionId)??{id:null,number:0};
    if(kind==='started'&&turnId!==prior.id)state.turnNumbers.set(sessionId,{id:turnId,number:prior.number+1});
    const current=state.turnNumbers.get(sessionId)??prior;
    const event={id:randomUUID(),client:'codex',sessionId,connectionId,kind,turnId,...extra,
      turnNumber:!turnId||turnId===current.id?current.number:0};
    if(state.children.has(sessionId))return;
    if(!state.roots.has(sessionId)){
      const queue=state.waiting.get(sessionId)??[];queue.push(event);state.waiting.set(sessionId,queue);return;
    }
    emit(event);
  }
  function classify(thread){
    if(!thread?.id)return;
    const id=thread.id,child=Boolean(thread.source?.subAgent||thread.parentThreadId);
    if(child){state.children.add(id);state.roots.delete(id);state.waiting.delete(id);return;}
    if(state.roots.has(id))return;
    state.roots.add(id);if(thread.status?.type==='active')state.active.add(id);emit({id:randomUUID(),client:'codex',sessionId:id,connectionId,kind:'connected'});
    for(const event of state.waiting.get(id)??[])emit(event);
    state.waiting.delete(id);
  }
  function client(message){
    if(!message.method)return;
    const p=message.params??{};
    if(message.id!==undefined&&['thread/start','thread/read','thread/resume','thread/fork','turn/start','turn/steer','turn/interrupt'].includes(message.method))state.pending.set(String(message.id),{method:message.method,threadId:p.threadId,turnId:p.expectedTurnId??p.turnId});
    if(message.method==='turn/start'&&p.threadId)state.starting.set(p.threadId,String(message.id));
    if(['turn/start','turn/steer'].includes(message.method)&&p.threadId)publish(p.threadId,'message',{turnId:p.expectedTurnId??state.turns.get(p.threadId)??null,source:'desktop-input'});
    if(message.method==='turn/interrupt'&&p.threadId)publish(p.threadId,'contact',{turnId:p.turnId,reason:'interrupt'});
  }
  function server(message){
    const p=message.params??{};
    if(!message.method&&message.id!==undefined){
      const request=state.pending.get(String(message.id));state.pending.delete(String(message.id));
      if(request?.method==='turn/start'&&state.starting.get(request.threadId)===String(message.id))state.starting.delete(request.threadId);
      if(request&&!message.error){
        if(message.result?.thread)classify(message.result.thread);
        if(request.method==='turn/start'&&message.result?.turn){state.turns.set(request.threadId,message.result.turn.id);state.active.add(request.threadId);publish(request.threadId,'started',{turnId:message.result.turn.id});}
      }
      return;
    }
    if(message.method==='thread/started'){classify(p.thread);return;}
    const id=p.threadId;if(!id)return;
    if(message.method==='turn/started'){state.turns.set(id,p.turn.id);state.active.add(id);publish(id,'started',{turnId:p.turn.id});}
    else if(message.method==='turn/completed'){if(state.turns.get(id)===p.turn.id)state.active.delete(id);publish(id,'contact',{turnId:p.turn.id,reason:p.turn.status==='interrupted'?'interrupt':p.turn.status==='failed'?'failed':'turn'});}
    else if(['thread/closed','thread/deleted','thread/archived'].includes(message.method)){
      publish(id,'closed');state.roots.delete(id);state.active.delete(id);state.turns.delete(id);
    }
    else if(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','execCommandApproval','applyPatchApproval'].includes(message.method))publish(id,'contact',{turnId:p.turnId??null,reason:'approval',requestId:String(message.id)});
    else if(['item/tool/requestUserInput','tool/requestUserInput'].includes(message.method))publish(id,'contact',{turnId:p.turnId??null,reason:'question',requestId:String(message.id)});
    else if(message.method==='mcpServer/elicitation/request')publish(id,'contact',{turnId:p.turnId??null,reason:'elicitation',requestId:String(message.id)});
    // Thread idle snapshots intentionally do not finish work: turn events own it.
  }
  function ended(confirmed){for(const id of state.roots)publish(id,confirmed?'closed':'disconnected',{turnId:null});}
  return {client,server,ended,roots:()=>[...state.roots],idle:id=>state.roots.has(id)&&!state.active.has(id)&&!state.starting.has(id)};
}
