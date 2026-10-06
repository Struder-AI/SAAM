import {replaceFile} from '../private/studio/file-write.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

import {requestReceiptState,isEditRequest} from '../../studio/work-state.mjs';
import {createRequestIndex} from './chat-request-index.mjs';
import {createChatEvents} from './chat-events.mjs';
import {bundleFor,readStableBundle} from '../../studio/adapter-resolution.mjs';

// A request's print: its library-relative folder name.
export function requestPrintId(libraryRoot,directory,{optional=false}={}){
  const name=relative(resolve(libraryRoot),resolve(directory)).split('\\').join('/');
  if(!name||name==='..'||name.startsWith('../')||isAbsolute(name)){if(optional)return null;throw Error('Agent requests must refer to a print in this library.');}
  return name;
}
// A print's current work evidence (Bundle snapshot), or null before it exists.
export async function workEvidence(directory){
  const adapter=await bundleFor(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!adapter)return null;
  return {...(await readStableBundle(adapter,directory,{program:false})).state.workEvidence};
}
// Old requests retain their authored baseline. An explicit new work episode
// captures the current output before editing; the old event hash cannot prove bytes.
function currentBaseline(baseline,current){
  return baseline?.schema==='saam-work-evidence/1'||!baseline||!current?baseline:
    {...current,revision:baseline.revision,inputKey:baseline.inputKey,geometryKey:baseline.geometryKey};
}

// One chat's request ledger, owned by the Application. One record per request:
// completing one request cannot clear another's dots. A record belongs to the chat
// attached to its Studio instance (ownerOf), else to the chat that wrote it; records
// are never rewritten when a Studio changes chat.
export function createChatRequests(libraryRoot,{now=Date.now,ownerId,events,folder:requestFolder,ownerOf=record=>record.ownerId}){
  const lifetime={closed:false};
  let workTail=Promise.resolve();
  const transition=action=>{const run=workTail.then(action);workTail=run.catch(()=>{});return run;};
  const root=resolve(libraryRoot),folder=resolve(requestFolder??resolve(root,'.studio-requests'));
  const records=new Map(),byPrint=new Map(),listeners=new Set(),waiters=new Set(),emitted=new Map(),operations=new Set();let changeVersion=0;
  const owner=record=>ownerOf(record)??null;
  const visible=record=>!owner(record)||owner(record)===ownerId;
  const foreign=record=>owner(record)&&owner(record)!==ownerId;
  const unfinished=r=>r.episode&&(r.workActive||r.handbackPending||r.inspectionTarget&&!r.inspectionPresented&&!r.inspectionFailed)||['queued','working','waiting'].includes(r.status)||r.status==='completed'&&!r.presented&&r.result
    &&requestReceiptState(r,{view:{ready:true,snapshot:{...r.result,stage:r.target?.stage??'toolpath'}}}).receipt;
  // One record per pending wait owns that wait's timer, event subscription and
  // resolver, so waking a waiter is a named step rather than a stored callback.
  const wake=()=>{changeVersion++;for(const waiter of [...waiters])settleWaiter(waiter);};
  function settleWaiter(waiter){clearTimeout(waiter.timer);waiters.delete(waiter);waiter.stopEvents?.();waiter.resolve();}
  const notify=record=>{
    if(!record)return;
    const key=[record.updatedAt,record.status,record.presented,record.connectionClosed].join(':');
    if(emitted.get(record.id)===key)return;
    emitted.set(record.id,key);for(const listener of listeners)listener(structuredClone(record));
  };
  function accept(id,record){
    const previous=records.get(id);
    records.delete(id);byPrint.get(previous?.printId)?.delete(id);
    if(record){records.set(id,record);if(!byPrint.has(record.printId))byPrint.set(record.printId,new Map());byPrint.get(record.printId).set(id,record);}
    notify(record);wake();
  }
  let refreshingHint=false;
  const index=createRequestIndex(folder,{onChange:accept,onHint(){
    wake();
    if(listeners.size&&!refreshingHint){refreshingHint=true;void index.refresh().catch(()=>{}).finally(()=>{refreshingHint=false;});}
  }});
  const file=id=>{if(!/^[a-f0-9-]{32,64}$/.test(id))throw Error('Invalid agent request id.');return resolve(folder,id+'.json');};
  async function save(record){await replaceFile(file(record.id),JSON.stringify(record)+'\n');accept(record.id,record);index.changed(record.id);return structuredClone(record);}
  async function get(id){return JSON.parse(await readFile(file(id),'utf8'));}
  const printId=directory=>requestPrintId(root,directory);
  // Live reads return this chat's unfinished records plus the latest edit outcome
  // per print. `anyOwner` is a history read only: the durable record of what
  // happened to a print, which never reaches a live claim, update or wait path.
  async function query({printId,status,since=0,history=false,anyOwner=false}={}){
    await index.refresh({force:history});
    const pool=[...(printId?byPrint.get(printId)?.values()??[]:records.values())].filter(r=>history&&anyOwner||visible(r));
    const latest=new Map();
    if(!history)for(const r of pool)if(isEditRequest(r)){const key=r.printId+'\0'+(owner(r)??''),last=latest.get(key);if(!last||r.updatedAt>=last.updatedAt)latest.set(key,r);}
    return pool.filter(r=>(!status||r.status===status)&&r.createdAt>=since&&(history||unfinished(r)||latest.get(r.printId+'\0'+(owner(r)??''))===r))
      .sort((a,b)=>a.createdAt-b.createdAt).map(r=>structuredClone(r));
  }
  const list=options=>query({...options,history:true});
  async function begin({directory,instruction,source='agent',key,kind='edit',evidence,scope,studioInstanceId,bundleState}){
    if(lifetime.closed)throw Error('Request service closed.');
    if(typeof instruction!=='string'||!instruction.trim())throw Error('Describe the requested agent work.');
    const id=key?createHash('sha256').update(key).digest('hex'):randomUUID();
    if(key)try{return await get(id);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!['edit','guidance','advisory'].includes(kind))throw Error('Unknown Studio work kind.');
    const currentId=printId(directory);
    return save({id,printId:currentId,instruction,source,kind,scope,...(studioInstanceId?{studioInstanceId}:{}),...(kind==='advisory'?{evidence}:{}),baseline:bundleState?{...bundleState.workEvidence}:await workEvidence(directory),ownerId,status:source==='studio'?'queued':'working',createdAt:now(),updatedAt:now()});
  }
  async function update(id,{status='completed',message='',resultStage}={}){
    if(lifetime.closed)throw Error('Request service closed.');
    if(!['working','waiting','completed','failed','cancelled'].includes(status))throw Error('Invalid agent response status.');
    const record=await get(id);
    if(record.studioInstanceId&&foreign(record))throw Error('That Studio request belongs to another agent.');
    if(status==='working'&&record.episode&&!record.workActive)return begin({directory:resolve(root,record.printId),instruction:record.instruction,studioInstanceId:record.studioInstanceId,kind:record.kind});
    if(record.status==='cancelled'||record.status==='completed')return record;
    const resuming=status==='working'&&record.status!=='working';
    // Pausing does not create a different request or discard an already saved
    // result. In particular, waiting for input must preserve its target.
    const baseline=status==='working'&&record.baseline&&record.baseline.schema!=='saam-work-evidence/1'?currentBaseline(record.baseline,await workEvidence(resolve(root,record.printId))):record.baseline;
    const result=resuming?undefined:status==='completed'?await workEvidence(resolve(root,record.printId)):record.result;
    if(resultStage&&!['geometry','toolpath'].includes(resultStage))throw Error('Unknown result stage.');
    const target=resultStage?{...(result??await workEvidence(resolve(root,record.printId))),stage:resultStage}:record.target
      ??(status==='completed'&&result?{...result,stage:result.geometryKey!==baseline?.geometryKey&&result.generationKey===baseline?.generationKey?'geometry':'toolpath'}:undefined);
    return save({...record,baseline,result,target,presented:resultStage?false:record.presented,ownerId,status,message:String(message),updatedAt:Math.max(now(),record.updatedAt+1)});
  }
  // A work episode joins the named requests, else this chat's working request on the
  // print, else begins one.
  function startWork({directory,requestIds=[],studioInstanceId,instruction}){return transition(async()=>{
    let chosen=[];
    for(const id of requestIds){
      const record=await get(id);
      if(record.printId!==printId(directory))throw Error('That request belongs to another print.');
      if(foreign(record))throw Error('That Studio request belongs to another agent.');
      if(record.studioInstanceId&&studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');
      if(['queued','working'].includes(record.status)&&!record.handbackPending&&(!record.episode||record.workActive))chosen.push(record);
    }
    if(!chosen.length&&!requestIds.length)chosen=(await query({printId:printId(directory)})).filter(r=>r.status==='working'&&!r.handbackPending&&(!r.episode||r.workActive)&&r.kind!=='advisory'&&(!r.studioInstanceId||r.studioInstanceId===studioInstanceId)).slice(-1);
    if(chosen[0]?.episodeId){const group=(await query({printId:printId(directory)})).filter(r=>r.episodeId===chosen[0].episodeId&&r.workActive);chosen=[...new Map([...group,...chosen].map(r=>[r.id,r])).values()];}
    if(!chosen.length)chosen=[await begin({directory,instruction,studioInstanceId})];
    const current=chosen.some(record=>record.baseline&&record.baseline.schema!=='saam-work-evidence/1')?await workEvidence(directory):null;
    const result=[],episodeId=chosen[0].episodeId??chosen[0].id,episodeStartedAt=chosen[0].episodeStartedAt??[...records.values()].reduce((latest,r)=>Math.max(latest,(r.episodeStartedAt??0)+1),now());
    for(const record of chosen)result.push(await save({...record,baseline:currentBaseline(record.baseline,current),episodeId,episodeStartedAt,status:'working',episode:true,workActive:true,ownerId,updatedAt:Math.max(now(),record.updatedAt+1)}));
    return result;
  });}
  // Hand-back first marks the episode pending (Studio stays dimmed), waits for the
  // operations underway on the request, then publishes the last saved result.
  function startHandback(id,response){return transition(async()=>{
    const record=await get(id);
    if(foreign(record))throw Error('That Studio request belongs to another agent.');
    if(!record.episode)return null;
    if(record.handbackPending||!record.workActive)return record;
    const members=(await query({printId:record.printId})).filter(r=>r.episodeId===(record.episodeId??record.id)&&r.workActive);
    const group=members.length?members:[record],handbackIds=group.map(r=>r.id);
    const saved=[];for(const member of group)saved.push(await save({...member,...response,handbackIds,workActive:false,handbackPending:true,inspectionPresented:false,inspectionFailed:null,updatedAt:Math.max(now(),member.updatedAt+1)}));
    return {...saved.find(r=>r.id===id)??saved[0],handbackIds:saved.map(r=>r.id)};
  });}
  async function finishHandback(id,response,target){
    const record=await get(id);
    if(!record.handbackPending)return record;
    const stage=response.resultStage;
    const result=target===undefined?record.lastSaved??null:target;
    return save({...record,...response,result,target:result?{...result,stage:stage??(result.geometryKey!==record.baseline?.geometryKey&&result.generationKey===(record.baseline?.generationKey??null)?'geometry':'toolpath')}:record.target,
      inspectionTarget:result?{...result,...(stage?{stage}:{})}:null,handbackPending:false,
      inspectionPresented:!result,updatedAt:Math.max(now(),record.updatedAt+1)});
  }
  const underway=requestId=>[...operations].filter(op=>op.requestIds.includes(requestId)).map(op=>op.settled.promise);
  async function handBack(requestId,response){
    if(response.status==='working')return update(requestId,response);
    const running=underway(requestId);
    const pending=await startHandback(requestId,response);
    if(!pending)return update(requestId,response);
    if(!pending.handbackPending)return pending;
    const completed=await Promise.all([...new Set([...running,...underway(requestId)])]),last=completed.at(-1);
    if(last?.error)response={...response,status:response.status==='cancelled'?'cancelled':'failed',message:last.error.message};
    const handed=[];for(const id of pending.handbackIds??[requestId])handed.push(await finishHandback(id,response,last?last.snapshot:pending.lastSaved));
    return handed.find(r=>r.id===requestId)??handed[0];
  }
  async function cancelScope(scope){for(const r of await query())if(r.scope?.runId===scope.runId&&(!scope.lessonId||r.scope.lessonId===scope.lessonId)&&['queued','working','waiting'].includes(r.status))await update(r.id,{status:'cancelled'});}
  async function cancelFor(directory){const id=printId(directory);for(const r of await query({printId:id}))if(['queued','working','waiting'].includes(r.status))await update(r.id,{status:'cancelled'});}
  return {list,query,get,ownerId,printIdOf:directory=>requestPrintId(root,directory,{optional:true}),begin,update,handBack,cancelScope,cancelFor,
    // One result-changing operation of this chat: it joins or begins the work
    // episode and reports its last saved evidence when it settles.
    async beginOperation(work){
      const started=await startWork(work);
      const op={requestIds:started.map(r=>r.id),records:started,saved:started[0]?.lastSaved??null,settled:Promise.withResolvers()};
      operations.add(op);return op;
    },
    async saved(op,evidence){
      op.saved=evidence;
      for(const id of op.requestIds)await transition(async()=>{const record=await get(id);return save({...record,lastSaved:op.saved,updatedAt:Math.max(now(),record.updatedAt+1)});});
    },
    settle(op,{error}={}){operations.delete(op);op.settled.resolve({snapshot:op.saved,error});},
    // The person asked for help in this Studio: its active episode hands back as waiting.
    async interrupt(directory,studioInstanceId){
      const active=(await query({printId:printId(directory)})).filter(r=>r.workActive&&(!r.studioInstanceId||r.studioInstanceId===studioInstanceId));
      await Promise.all([...new Set(active.map(r=>r.episodeId??r.id))].map(id=>handBack(id,{status:'waiting',message:'The person requested help in Studio.'})));
    },
    subscribe(listener){
      listeners.add(listener);const release=index.retain();
      void mkdir(folder,{recursive:true}).then(()=>index.refresh()).catch(()=>{});
      return()=>{listeners.delete(listener);release();};
    },
    close(){lifetime.closed=true;wake();listeners.clear();index.close();},
    async activity(id,{directory}={}){
      if(lifetime.closed)throw Error('Request service closed.');
      const record=await get(id);
      if(directory&&record.printId!==printId(directory))throw Error('That activity belongs to another print.');
      if(record.studioInstanceId&&foreign(record))throw Error('That Studio request belongs to another agent.');
      if(owner(record)!==ownerId)throw Error('Claim this request before reporting activity.');
      // Activity is evidence of contact, never a claim/resume/result operation.
      if(record.status!=='working'||record.presented)return record;
      return save({...record,updatedAt:Math.max(now(),record.updatedAt+1)});
    },
    async presented(directory,shown){
      const id=requestPrintId(root,directory,{optional:true}),updated=[];if(!id)return updated;
      for(const candidate of await query({printId:id})){
        if(candidate.episode&&!candidate.handbackPending&&!candidate.inspectionPresented&&candidate.inspectionTarget
          &&(!candidate.studioInstanceId||candidate.studioInstanceId===shown.studioInstanceId)
          &&candidate.inspectionTarget.revision===shown.revision&&(!candidate.inspectionTarget.stage||candidate.inspectionTarget.stage===shown.stage)){
          const record=await get(candidate.id);
          if(!record.handbackPending&&record.inspectionTarget?.revision===shown.revision)updated.push(await save({...record,...(shown.renderError?{inspectionFailed:shown.renderError}:{inspectionPresented:true}),updatedAt:Math.max(now(),record.updatedAt+1)}));
        }
        if(!shown.renderError&&shown.deliverable!==false&&['working','completed'].includes(candidate.status)
        &&(!candidate.studioInstanceId||candidate.studioInstanceId===shown.studioInstanceId)
        &&!candidate.presented&&requestReceiptState(candidate,{view:{ready:true,snapshot:shown}}).receipt){
          const record=await get(candidate.id);
          if(['working','completed'].includes(record.status)&&!record.presented&&requestReceiptState(record,{view:{ready:true,snapshot:shown}}).receipt)
            updated.push(await save({...record,presented:true,updatedAt:Math.max(now(),record.updatedAt+1)}));
        }
      }
      return updated;
    },
    async wait({after=[],waitMs=25000,studioInstanceId}={}){
      const deadline=Date.now()+Math.max(0,waitMs);
      await mkdir(folder,{recursive:true});const release=index.retain();
      try{for(;;){
        const observed=changeVersion;
        const requests=(await query({status:'queued'})).filter(request=>!after.includes(request.id)&&(!studioInstanceId||request.studioInstanceId===studioInstanceId));
        const remaining=deadline-Date.now();
        // A delivered Studio event ends the wait too, carrying every held event.
        if(requests.length||remaining<=0||lifetime.closed||events.pendingDelivery())return {requests,events:events.drain()};
        if(changeVersion!==observed)continue;
        await new Promise(resolve=>{
          const waiter={timer:null,stopEvents:null,resolve},done=()=>settleWaiter(waiter);
          waiters.add(waiter);waiter.stopEvents=events.subscribe(done);waiter.timer=setTimeout(done,remaining);waiter.timer.unref?.();
        });
      }}finally{release();}
    }
  };
}

// One chat's channel: its ledger, its event log and Studio's binding to them. attachment
// is null for the lobby (no chat attached).
export function createChatChannel(libraryRoot,{ownerId,folder,ownerOf,attachment=null}){
  const events=createChatEvents(),requests=createChatRequests(libraryRoot,{ownerId,events,folder,ownerOf});
  return {requests,events,binding:chatBinding({requests,events,attachment})};
}
// Studio's whole view of one chat.
function chatBinding({requests,events,attachment}){
  return Object.freeze({ownerId:requests.ownerId,attachment,
    note:(kind,detail)=>events.record(kind,detail),
    async ask({directory,studioInstanceId,interrupt=false,...request}){
      if(interrupt)void requests.interrupt(directory,studioInstanceId).catch(error=>events.record('handback-failed',{studioInstanceId,directory,message:error.message}));
      return requests.begin({...request,directory,studioInstanceId,source:'studio'});
    },
    withdraw:({scope,directory})=>scope?requests.cancelScope(scope):requests.cancelFor(directory),
    presented:(directory,shown)=>requests.presented(directory,shown),
    // Live: this chat's records for the print in that Studio; history: every record of the print.
    async requestsFor(directory,studioInstanceId,{history=false}={}){
      const printId=directory&&requests.printIdOf(directory);if(!printId)return [];
      if(history)return requests.list({printId,anyOwner:true});
      return (await requests.query({printId})).filter(r=>!studioInstanceId||!r.studioInstanceId||r.studioInstanceId===studioInstanceId);
    },
    watch:onChange=>requests.subscribe(onChange)});
}
