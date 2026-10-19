// Native client evidence and acknowledged Studio delivery. Bundle work remains
// exclusively in chat-requests; this module owns transport order, never work state.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {replaceFile} from '../file-write.mjs';
import {studioWakeEvent} from './chat-events.mjs';

export function contactIncludes(contact,work){
  if(!contact||!work)return true;
  return contact.epoch>work.epoch||contact.epoch===work.epoch&&contact.turn>=work.turn&&contact.cursor>work.cursor;
}

export async function createClientLifecycle({folder,handBack}){
  await mkdir(folder,{recursive:true});
  const file=resolve(folder,'lifecycle.json');
  const state=await readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {schema:1,cursor:0,connections:{},sessions:{},received:{},contacts:{}};throw error;});
  if(state.schema!==1)throw Error('Unknown client lifecycle state.');
  const queue={tail:Promise.resolve(),closing:false};
  function serial(action){const task=queue.tail.then(action);queue.tail=task.catch(()=>{});return task;}
  const save=()=>replaceFile(file,JSON.stringify(state)+'\n');
  const key=(client,sessionId)=>client+':'+sessionId;
  function session(client,sessionId){return state.sessions[key(client,sessionId)]??={client,sessionId,epoch:0,connectionId:null,turns:{},nextTurn:0,context:null,events:[]};}
  const inflight=new Map();
  async function flush(){
    if(queue.closing)return;
    for(const [id,contact] of Object.entries(state.contacts))if(!inflight.has(id)){
      const task=handBack(contact.sessionId,contact.reason,contact.context).then(()=>serial(async()=>{delete state.contacts[id];await save();}));
      inflight.set(id,task);
      void task.catch(()=>{/* Keep accepted contact for runtime recovery. */}).finally(()=>inflight.delete(id));
    }
    await Promise.allSettled([...inflight.values()]);
  }
  async function event(event){
    if(!event||!['codex','claude'].includes(event.client)||typeof event.id!=='string'||typeof event.connectionId!=='string')throw Error('Invalid native lifecycle event.');
    if(event.sequence!==undefined&&(!Number.isSafeInteger(event.sequence)||event.sequence<1))throw Error('Invalid native lifecycle sequence.');
    if(event.turnNumber!==undefined&&(!Number.isSafeInteger(event.turnNumber)||event.turnNumber<0))throw Error('Invalid native lifecycle turn.');
    await serial(async()=>{
      const ordered=Number.isSafeInteger(event.sequence)&&event.sequence>0;
      if(!ordered&&state.received[event.id])return;
      if(!['owner','connected','started','message','contact','closed','disconnected'].includes(event.kind))throw Error('Unknown native lifecycle event.');
      const connection=state.connections[event.connectionId]??={client:event.client,pid:null,closed:false};
      if(connection.client!==event.client)throw Error('Connection belongs to another client.');
      if(ordered){
        connection.cursor??=0;connection.pending??=[];
        if(event.sequence<=connection.cursor||connection.pending.includes(event.sequence))return;
      }
      if(event.kind==='owner'){
        if(!Number.isSafeInteger(event.pid)||event.pid<1)throw Error('Invalid client process.');
        connection.pid=event.pid;
      }else{
        if(typeof event.sessionId!=='string'||!event.sessionId)throw Error('Native event needs a session.');
        const current=session(event.client,event.sessionId);
        if(!current.connections)current.connections={};
        if(!current.connections[event.connectionId])current.connections[event.connectionId]=++current.epoch;
        const epoch=current.connections[event.connectionId];
        const turnKey=event.connectionId+':'+(event.turnId??'');
        const numbered=Number.isSafeInteger(event.turnNumber)&&event.turnNumber>=0;
        if(!numbered&&event.turnId&&!current.turns[turnKey])current.turns[turnKey]=++current.nextTurn;
        const turn=numbered?event.turnNumber:event.turnId?current.turns[turnKey]:current.nextTurn;
        const context={epoch,turn,cursor:ordered?event.sequence:(state.cursor=Math.max(state.cursor,current.context?.cursor??0)+1)};
        if(!current.context||contactIncludes(context,current.context)){
          current.connectionId=event.connectionId;current.closed=event.kind==='closed';current.context=context;
        }
        if(['message','contact','closed'].includes(event.kind)){
          const reason=event.kind==='message'?'message':event.kind==='closed'?'closed':['turn','interrupt','failed'].includes(event.reason)?event.reason:'input';
          state.contacts[event.id]={sessionId:event.sessionId,reason,context};
          if(!current.lastContact||contactIncludes(context,current.lastContact.context))current.lastContact={sessionId:event.sessionId,reason,context};
        }
      }
      if(ordered){
        const pending=new Set(connection.pending);pending.add(event.sequence);
        while(pending.delete(connection.cursor+1))connection.cursor++;
        connection.pending=[...pending].sort((a,b)=>a-b);
      }else state.received[event.id]=true;
      await save();
    });
    void flush();return {accepted:true};
  }
  // Every observation uses this pipe. A delivered kind carries all held kinds.
  function record({client,sessionId,event}){return serial(async()=>{
    if(!['codex','claude'].includes(client))return;
    const current=session(client,sessionId);
    if(!current.events.some(value=>value.id===event.id))current.events.push(event);
    await save();
  });}
  function messageFor(client,sessionId,includeHeld){
    const events=state.sessions[key(client,sessionId)]?.events??[];
    if(!events.length||!includeHeld&&!events.some(event=>event.delivery==='delivered'))return null;
    const change=studioWakeEvent(events);
    return {id:events[0].id,ids:events.map(event=>event.id),...(includeHeld&&{events:structuredClone(events),wake:change?{id:change.id,text:'SAAM: file changed. Read the current Studio events.'}:null}),text:'SAAM Studio events (application notifications, not a human message). Event IDs are stable; ignore IDs already handled. Use the current Studio selection/version before editing; original work stays with its bundle.\n'+JSON.stringify(events)};
  }
  async function inbox({client,sessionId,sessionIds,includeHeld=false}){
    await queue.tail;
    if(sessionIds!==undefined){
      if(!Array.isArray(sessionIds)||sessionIds.some(id=>typeof id!=='string'))throw Error('Inbox needs native session IDs.');
      return {messages:sessionIds.flatMap(sessionId=>{const message=messageFor(client,sessionId,includeHeld);return message?[{sessionId,message}]:[];})};
    }
    return {message:messageFor(client,sessionId,includeHeld)};
  }
  function acknowledge({client,sessionId,eventIds}){return serial(async()=>{
    if(!Array.isArray(eventIds))throw Error('Acknowledgement needs event IDs.');
    const current=state.sessions[key(client,sessionId)];
    if(current){const ids=new Set(eventIds);current.events=current.events.filter(event=>!ids.has(event.id));await save();}
    return {acknowledged:true};
  });}
  async function context(client,sessionId){
    await queue.tail;const current=state.sessions[key(client,sessionId)];
    return current?.context?{...current.context,closed:current.closed===true}:null;
  }
  async function lastContact(client,sessionId){await queue.tail;return structuredClone(state.sessions[key(client,sessionId)]?.lastContact??null);}
  async function contacts(){await queue.tail;return Object.values(state.sessions).flatMap(current=>current.lastContact?[structuredClone(current.lastContact)]:[]);}
  const timer=setInterval(async()=>{
    if(queue.closing)return;
    for(const [connectionId,connection] of Object.entries(state.connections))if(connection.pid&&!connection.closed){
      try{process.kill(connection.pid,0);}catch(error){
        if(error.code!=='ESRCH')continue;
        connection.closed=true;
        for(const current of Object.values(state.sessions))if(current.connectionId===connectionId&&!current.closed)
          // Runtime observations must not consume a producer sequence that an
          // unfinished native outbox can still replay.
          await event({id:randomUUID(),client:connection.client,sessionId:current.sessionId,connectionId,kind:'closed',
            turnNumber:current.context?.turn??0}).catch(()=>{});
      }
    }
    void flush();
  },1000);timer.unref();
  return {event,record,inbox,acknowledge,context,lastContact,contacts,flush,
    async close(){queue.closing=true;clearInterval(timer);await queue.tail;}};
}
