import {replaceFile} from '../core/private/studio/file-write.mjs';
import {canonical} from '../core/private/studio/hash.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {requestReceiptState,isEditRequest} from './work-state.mjs';
import {createRequestIndex} from './request-index.mjs';
import {revisionOf} from '../core/print/revisions.mjs';


export function workSnapshot({plan,machine,review,editRevision,revision}){
  const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
  const generated=review?.history?.findLast(event=>event.event==='generated');
  return {revision,inputKey:hash({plan,machine}),geometryKey:hash(plan?.geometry??null),generationKey:generated?hash(generated):null,
    ...(editRevision?{editRevision}:{})};
}
async function snapshot(directory){
  try{
    const document=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));
    const {bundle,...plan}=document;
    const [machine,review]=bundle?[bundle.machine,bundle.review]:await Promise.all(['machine.json','review.json']
      .map(async name=>JSON.parse(await readFile(resolve(directory,name),'utf8'))));
    return workSnapshot({plan,machine,review,revision:revisionOf(document)});
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// One record per request: completing one request cannot clear another's dots.
export function createAgentRequests(libraryRoot,{now=Date.now,ownerId,events,folder:requestFolder}={}){
  // A session is one agent connection to this owner; the store outlives it.
  const lifetime={closed:false,session:0};
  let workTail=Promise.resolve();
  const transition=action=>{const run=workTail.then(action);workTail=run.catch(()=>{});return run;};
  const root=resolve(libraryRoot),folder=resolve(requestFolder??resolve(root,'.studio-requests'));
  const records=new Map(),byPrint=new Map(),pending=new Map(),latest=new Map(),listeners=new Set(),waiters=new Set(),emitted=new Map();let changeVersion=0;
  const latestKey=r=>`${r.printId}\0${r.ownerId??''}`;
  // A Studio instance is heard only by its owning agent. An owner sees its own
  // and ownerless records; an ownerless store never sees Studio-bound work
  // live, and reads it only as explicit diagnostic history.
  const visible=(r,history)=>ownerId?(!r.ownerId||r.ownerId===ownerId):history||!r.studioInstanceId;
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
    records.delete(id);pending.delete(id);byPrint.get(previous?.printId)?.delete(id);
    if(record){records.set(id,record);if(!byPrint.has(record.printId))byPrint.set(record.printId,new Map());byPrint.get(record.printId).set(id,record);if(unfinished(record))pending.set(id,record);}
    for(const sample of [record,previous])if(sample){
      const affected=latestKey(sample),last=latest.get(affected),candidate=record&&latestKey(record)===affected&&isEditRequest(record)?record:null;
      if(candidate&&(!last||candidate.updatedAt>=last.updatedAt))latest.set(affected,candidate);
      else if(last?.id===id){
        const next=[...byPrint.get(sample.printId)?.values()??[]].filter(value=>isEditRequest(value)&&latestKey(value)===affected).reduce((a,b)=>!a||b.updatedAt>a.updatedAt?b:a,null);
        if(next)latest.set(affected,next);else latest.delete(affected);
      }
    }
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
  function printId(directory,{optional=false}={}){const name=relative(root,resolve(directory)).split('\\').join('/');if(!name||name==='..'||name.startsWith('../')||isAbsolute(name)){if(optional)return null;throw Error('Agent requests must refer to a print in this library.');}return name;}
  // `anyOwner` is a history read only: the durable record of what happened to a
  // print, for a reader that must not lose it when the owner changes between
  // Studio runs. It never reaches a live claim, update or wait path.
  async function query({printId,status,since=0,history=false,anyOwner=false}={}){
    await index.refresh({force:history});
    let selected=history?(printId?byPrint.get(printId)?.values()??[]:records.values()):status==='queued'?pending.values():new Map([...pending,...[...latest.values()].map(r=>[r.id,r])]).values();
    return [...selected].filter(r=>(history&&anyOwner||visible(r,history))&&(!printId||r.printId===printId)&&(!status||r.status===status)&&r.createdAt>=since
      &&(history||unfinished(r)||latest.get(latestKey(r))?.id===r.id)).sort((a,b)=>a.createdAt-b.createdAt).map(r=>structuredClone(r));
  }
  const list=options=>query({...options,history:true});
  return {list,query,get,printId,ownerId,events,folder,snapshot,
    startWork({directory,requestIds=[],studioInstanceId,instruction}){return transition(async()=>{
      let chosen=[];
      for(const id of requestIds){
        const record=await get(id);
        if(record.printId!==printId(directory))throw Error('That request belongs to another print.');
        if(record.ownerId&&record.ownerId!==ownerId)throw Error('That Studio request belongs to another agent.');
        if(record.studioInstanceId&&studioInstanceId&&record.studioInstanceId!==studioInstanceId)throw Error('That request belongs to another Studio instance.');
        if(['queued','working'].includes(record.status)&&!record.handbackPending&&(!record.episode||record.workActive))chosen.push(record);
      }
      if(!chosen.length&&!requestIds.length)chosen=(await query({printId:printId(directory)})).filter(r=>r.status==='working'&&!r.handbackPending&&(!r.episode||r.workActive)&&r.kind!=='advisory'&&(!r.studioInstanceId||r.studioInstanceId===studioInstanceId)).slice(-1);
      if(chosen[0]?.episodeId){const group=(await query({printId:printId(directory)})).filter(r=>r.episodeId===chosen[0].episodeId&&r.workActive);chosen=[...new Map([...group,...chosen].map(r=>[r.id,r])).values()];}
      if(!chosen.length)chosen=[await this.begin({directory,instruction,studioInstanceId})];
      const result=[],episodeId=chosen[0].episodeId??chosen[0].id,episodeStartedAt=chosen[0].episodeStartedAt??[...records.values()].reduce((latest,r)=>Math.max(latest,(r.episodeStartedAt??0)+1),now());
      for(const record of chosen)result.push(await save({...record,episodeId,episodeStartedAt,status:'working',episode:true,workActive:true,ownerId,updatedAt:Math.max(now(),record.updatedAt+1)}));
      return result;
    });},
    async savedWork(id,saved){return transition(async()=>{const record=await get(id);return save({...record,lastSaved:saved,updatedAt:Math.max(now(),record.updatedAt+1)});});},
    startHandback(id,response){return transition(async()=>{
      const record=await get(id);
      if(record.ownerId&&record.ownerId!==ownerId)throw Error('That Studio request belongs to another agent.');
      if(!record.episode)return null;
      if(record.handbackPending||!record.workActive)return record;
      const members=(await query({printId:record.printId})).filter(r=>r.episodeId===(record.episodeId??record.id)&&r.workActive);
      const group=members.length?members:[record],handbackIds=group.map(r=>r.id);
      const saved=[];for(const member of group)saved.push(await save({...member,...response,handbackIds,workActive:false,handbackPending:true,inspectionPresented:false,inspectionFailed:null,updatedAt:Math.max(now(),member.updatedAt+1)}));
      return {...saved.find(r=>r.id===id)??saved[0],handbackIds:saved.map(r=>r.id)};
    });},
    async finishHandback(id,response,target){
      const record=await get(id);
      if(!record.handbackPending)return record;
      const stage=response.resultStage;
      const result=target===undefined?record.lastSaved??null:target;
      return save({...record,...response,result,target:result?{...result,stage:stage??(result.geometryKey!==record.baseline?.geometryKey&&result.generationKey===(record.baseline?.generationKey??null)?'geometry':'toolpath')}:record.target,
        inspectionTarget:result?{...result,...(stage?{stage}:{})}:null,handbackPending:false,
        inspectionPresented:!result,updatedAt:Math.max(now(),record.updatedAt+1)});
    },
    async reassignStudio(studioInstanceId,nextOwnerId){
      for(const record of await list({anyOwner:true}))if(record.studioInstanceId===studioInstanceId&&record.ownerId===ownerId)
        await save({...record,ownerId:nextOwnerId,updatedAt:Math.max(now(),record.updatedAt+1)});
    },
    subscribe(listener){
      if(typeof listener!=='function')throw Error('Request listener must be a function.');
      listeners.add(listener);const release=index.retain();
      void mkdir(folder,{recursive:true}).then(()=>index.refresh()).catch(()=>{});
      const unsubscribe=()=>{listeners.delete(listener);release();};
      return unsubscribe;
    },
    close(){lifetime.closed=true;wake();listeners.clear();index.close();},
    async activity(id,{directory}={}){
      if(lifetime.closed)throw Error('Request service closed.');
      const record=await get(id);
      if(directory&&record.printId!==printId(directory))throw Error('That activity belongs to another print.');
      if(record.studioInstanceId&&record.ownerId&&record.ownerId!==ownerId)throw Error('That Studio request belongs to another agent.');
      if(ownerId&&record.ownerId!==ownerId)throw Error('Claim this request before reporting activity.');
      // Activity is evidence of contact, never a claim/resume/result operation.
      if(record.status!=='working'||record.presented)return record;
      return save({...record,updatedAt:Math.max(now(),record.updatedAt+1)});
    },
    async begin({directory,instruction,source='agent',key,kind='edit',evidence,scope,studioInstanceId,bundleState}){
      if(lifetime.closed)throw Error('Request service closed.');
      if(typeof instruction!=='string'||!instruction.trim())throw Error('Describe the requested agent work.');
      const id=key?createHash('sha256').update(key).digest('hex'):randomUUID();
      if(key)try{return await get(id);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!['edit','guidance','advisory'].includes(kind))throw Error('Unknown Studio work kind.');
      const currentId=printId(directory);
      return save({id,printId:currentId,instruction,source,kind,scope,...(studioInstanceId?{studioInstanceId}:{}),...(kind==='advisory'?{evidence}:{}),baseline:bundleState?workSnapshot(bundleState):await snapshot(directory),ownerId,status:source==='studio'?'queued':'working',createdAt:now(),updatedAt:now()});
    },
    async update(id,{status='completed',message='',resultStage}={}){
      if(lifetime.closed)throw Error('Request service closed.');
      if(!['working','waiting','completed','failed','cancelled'].includes(status))throw Error('Invalid agent response status.');
      const record=await get(id);
      if(record.studioInstanceId&&record.ownerId&&record.ownerId!==ownerId)throw Error('That Studio request belongs to another agent.');
      if(status==='working'&&record.episode&&!record.workActive)return this.begin({directory:resolve(root,record.printId),instruction:record.instruction,studioInstanceId:record.studioInstanceId,kind:record.kind});
      if(record.status==='cancelled'||record.status==='completed')return record;
      const resuming=status==='working'&&record.status!=='working';
      // Pausing does not create a different request or discard an already saved
      // result. In particular, waiting for input must preserve its target.
      const baseline=record.baseline;
      const result=resuming?undefined:status==='completed'?await snapshot(resolve(root,record.printId)):record.result;
      if(resultStage&&!['geometry','toolpath'].includes(resultStage))throw Error('Unknown result stage.');
      const target=resultStage?{...await snapshot(resolve(root,record.printId)),stage:resultStage}:record.target
        ??(status==='completed'&&result?{...result,stage:result.geometryKey!==baseline?.geometryKey&&result.generationKey===baseline?.generationKey?'geometry':'toolpath'}:undefined);
      return save({...record,baseline,result,target,presented:resultStage?false:record.presented,ownerId:ownerId??record.ownerId,status,message:String(message),updatedAt:Math.max(now(),record.updatedAt+1)});
    },
    async presented(directory,shown){
      const id=printId(directory,{optional:true}),updated=[];if(!id)return updated;
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
    // A transport wait may end; the chat and its work keep their identity.
    async endSession(){lifetime.session++;wake();},
    async disconnect(){await this.endSession();},
    async selectQueued(candidates,{after=[],claim=false,studioInstanceId}={}){
      const requests=candidates.filter(request=>!after.includes(request.id)&&(!studioInstanceId||request.studioInstanceId===studioInstanceId));
      return claim?Promise.all(requests.map(request=>this.update(request.id,{status:'working'}))):requests;
    },
    async wait({after=[],waitMs=25000,claim=false,studioInstanceId}={}){
      const deadline=Date.now()+Math.max(0,waitMs);
      await mkdir(folder,{recursive:true});const release=index.retain(),session=lifetime.session;
      try{for(;;){
        if(lifetime.session!==session)return {requests:[],...(events?{events:[]}:{})};
        const observed=changeVersion;
        const requests=await this.selectQueued(await query({status:'queued'}),{after,claim,studioInstanceId});
        const remaining=deadline-Date.now();
        // A delivered Studio event ends the wait too, carrying every held event.
        if(requests.length||remaining<=0||lifetime.closed||events?.pendingDelivery())return {requests,...(events?{events:events.drain()}:{})};
        if(changeVersion!==observed)continue;
        await new Promise(resolve=>{
          const waiter={timer:null,stopEvents:null,resolve},done=()=>settleWaiter(waiter);
          waiters.add(waiter);waiter.stopEvents=events?.subscribe(done);waiter.timer=setTimeout(done,remaining);waiter.timer.unref?.();
        });
      }}finally{release();}
    },
    async cancelScope(scope){for(const r of await query())if(r.scope?.runId===scope.runId&&(!scope.lessonId||r.scope.lessonId===scope.lessonId)&&['queued','working','waiting'].includes(r.status))await this.update(r.id,{status:'cancelled'});},
    async cancelFor(directory){const id=printId(directory);for(const r of await query({printId:id}))if(['queued','working','waiting'].includes(r.status))await this.update(r.id,{status:'cancelled'});}
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action='list',library='Prints',id,value,message]=process.argv.slice(2),requests=createAgentRequests(library);
  let result;
  if(action==='begin-active'||action==='begin-active-guidance'){const progress=JSON.parse(await readFile(resolve(library,'.tour-progress.json'),'utf8'));if(!progress.active||!progress.selected)throw Error('No active tour print; use begin with a print ID.');result=await requests.begin({directory:resolve(library,'tour',progress.selected),instruction:id,kind:action.endsWith('guidance')?'guidance':'edit'});}
  else result=action==='begin'||action==='begin-guidance'?await requests.begin({directory:resolve(library,id),instruction:value,kind:action.endsWith('guidance')?'guidance':'edit'}):action==='claim'?await requests.update(id,{status:'working'}):action==='target'?await requests.update(id,{status:'working',resultStage:value}):action==='respond'?await requests.update(id,{status:value,message}):action==='wait'?await requests.wait():await requests.list();
  if(action==='wait'&&id==='--claim')result.requests=await Promise.all(result.requests.map(request=>requests.update(request.id,{status:'working'})));
  console.log(JSON.stringify(result,null,2));
}
