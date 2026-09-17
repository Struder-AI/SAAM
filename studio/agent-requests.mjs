import {readFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonical} from '../core/print/plan.mjs';
import {hasPresentedResult,requestActivity} from './work-state.mjs';
import {createRequestIndex} from './request-index.mjs';
import {replaceFile} from '../core/file-write.mjs';

export function workSnapshot({plan,machine,review}){
  const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
  const generated=review?.history?.findLast(event=>event.event==='generated');
  return {inputKey:hash({plan,machine}),geometryKey:hash(plan?.geometry??null),generationKey:generated?hash(generated):null};
}
async function snapshot(directory){
  try{
    const [plan,machine,review]=await Promise.all(['plan.json','machine.json','review.json'].map(async name=>JSON.parse(await readFile(resolve(directory,name),'utf8'))));
    return workSnapshot({plan,machine,review});
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// One record per request: completing one request cannot clear another's dots.
export function createAgentRequests(libraryRoot,{now=Date.now,ownerId}={}){
  let disconnected=false;
  const root=resolve(libraryRoot),folder=resolve(root,'.studio-requests');
  const records=new Map(),byPrint=new Map(),pending=new Map(),latest=new Map(),listeners=new Set(),waiters=new Set(),emitted=new Map();let changeVersion=0;
  const latestKey=r=>`${r.printId}\0${r.ownerId??''}`;
  const unfinished=r=>['queued','working','waiting'].includes(r.status)||r.status==='completed'&&!r.presented&&r.result&&hasPresentedResult(r,{...r.result,stage:r.target?.stage??'toolpath'});
  const wake=()=>{changeVersion++;for(const done of [...waiters])done();};
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
    const edit=r=>r&&!['guidance','advisory'].includes(r.kind);
    for(const sample of [record,previous])if(sample){
      const affected=latestKey(sample),last=latest.get(affected),candidate=record&&latestKey(record)===affected&&edit(record)?record:null;
      if(candidate&&(!last||candidate.updatedAt>=last.updatedAt))latest.set(affected,candidate);
      else if(last?.id===id){
        const next=[...byPrint.get(sample.printId)?.values()??[]].filter(value=>edit(value)&&latestKey(value)===affected).reduce((a,b)=>!a||b.updatedAt>a.updatedAt?b:a,null);
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
  const normalized=r=>r.kind!=='advisory'&&!r.presented&&(requestActivity(r,{now:now()})==='expired'
      ||r.kind==='guidance'&&['queued','working'].includes(r.status)&&r.expiresAt<=now())
      ?{...r,status:'failed',timedOut:true,error:'Lost contact with the agent. Reconnect or reclaim this request to continue.'}:r;
  async function query({printId,status,since=0,history=false}={}){
    await index.refresh({force:history});
    let selected=history?(printId?byPrint.get(printId)?.values()??[]:records.values()):status==='queued'?pending.values():new Map([...pending,...[...latest.values()].map(r=>[r.id,r])]).values();
    return [...selected].map(normalized).filter(r=>(!ownerId||!r.ownerId||r.ownerId===ownerId)&&(!printId||r.printId===printId)&&(!status||r.status===status)&&r.createdAt>=since
      &&(history||unfinished(r)||latest.get(latestKey(r))?.id===r.id)).sort((a,b)=>a.createdAt-b.createdAt).map(r=>structuredClone(r));
  }
  const list=options=>query({...options,history:true});
  return {list,query,get,printId,ownerId,
    subscribe(listener){
      if(typeof listener!=='function')throw Error('Request listener must be a function.');
      listeners.add(listener);const release=index.retain();
      void mkdir(folder,{recursive:true}).then(()=>index.refresh()).catch(()=>{});
      return()=>{listeners.delete(listener);release();};
    },
    close(){disconnected=true;wake();listeners.clear();index.close();},
    async activity(id,{directory}={}){
      if(disconnected)throw Error('Agent connection closed.');
      const record=await get(id);
      if(directory&&record.printId!==printId(directory))throw Error('That activity belongs to another print.');
      if(ownerId&&record.ownerId!==ownerId)throw Error('Claim this request before reporting activity.');
      // Activity is evidence of contact, never a claim/resume/result operation.
      if(record.status!=='working'||record.presented)return record;
      return save({...record,updatedAt:Math.max(now(),record.updatedAt+1),expiresAt:now()+600000,connectionClosed:false,timedOut:false});
    },
    async begin({directory,instruction,source='agent',key,kind='edit',evidence,scope,studioInstanceId}){
      if(disconnected)throw Error('Agent connection closed.');
      if(typeof instruction!=='string'||!instruction.trim()||instruction.length>8000)throw Error('Describe the requested agent work.');
      const id=key?createHash('sha256').update(key).digest('hex'):randomUUID();
      if(key)try{return await get(id);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!['edit','guidance','advisory'].includes(kind))throw Error('Unknown Studio work kind.');
      const currentId=printId(directory);
      return save({id,printId:currentId,instruction,source,kind,scope,...(studioInstanceId?{studioInstanceId}:{}),...(kind==='advisory'?{evidence}:{}),baseline:await snapshot(directory),requiresTarget:kind==='edit',ownerId,status:source==='studio'?'queued':'working',createdAt:now(),updatedAt:now(),expiresAt:now()+600000});
    },
    async update(id,{status='completed',message='',resultStage}={}){
      if(disconnected)throw Error('Agent connection closed.');
      if(!['working','waiting','completed','failed','cancelled'].includes(status))throw Error('Invalid agent response status.');
      const record=await get(id);
      if(ownerId&&record.ownerId&&record.ownerId!==ownerId&&record.studioInstanceId)throw Error('That Studio request belongs to another agent.');
      if(record.status==='cancelled'||record.status==='completed'&&!(status==='working'&&requestActivity(record,{now:now()})==='expired'))return record;
      const resuming=status==='working'&&record.status!=='working';
      // Pausing does not create a different request or discard an already saved
      // result. In particular, geometry confirmation must preserve its target.
      const baseline=record.baseline;
      const result=resuming?undefined:status==='completed'?await snapshot(resolve(root,record.printId)):record.result;
      if(resultStage&&!['geometry','toolpath'].includes(resultStage))throw Error('Unknown result stage.');
      const target=resultStage?{...await snapshot(resolve(root,record.printId)),stage:resultStage}:record.target
        ??(status==='completed'&&result?{...result,stage:result.geometryKey!==baseline?.geometryKey&&result.generationKey===baseline?.generationKey?'geometry':'toolpath'}:undefined);
      return save({...record,baseline,result,target,presented:resultStage?false:record.presented,ownerId:ownerId??record.ownerId,status,connectionClosed:false,timedOut:false,message:String(message).slice(0,8000),updatedAt:Math.max(now(),record.updatedAt+1),expiresAt:now()+600000});
    },
    async presented(directory,shown){
      const id=printId(directory,{optional:true}),updated=[];if(!id)return updated;
      for(const candidate of await query({printId:id}))if(['working','completed'].includes(candidate.status)
        &&(!candidate.studioInstanceId||candidate.studioInstanceId===shown.studioInstanceId)
        &&!candidate.presented&&hasPresentedResult(candidate,shown)){
        const record=await get(candidate.id);
        if(['working','completed'].includes(record.status)&&!record.presented&&hasPresentedResult(record,shown))
          updated.push(await save({...record,presented:true,updatedAt:Math.max(now(),record.updatedAt+1)}));
      }
      return updated;
    },
    async disconnect(){
      disconnected=true;if(!ownerId){index.close();return;}
      for(const record of await query())if(!record.presented&&record.ownerId===ownerId&&['queued','working'].includes(record.status))
        await save({...record,status:'failed',connectionClosed:true,updatedAt:Math.max(now(),record.updatedAt+1)});
      index.close();
    },
    async wait({after=[],waitMs=25000,claim=false,studioInstanceId}={}){
      const deadline=Date.now()+Math.min(25000,Math.max(0,waitMs));
      await mkdir(folder,{recursive:true});const release=index.retain();
      try{for(;;){
        const observed=changeVersion;
        const requests=(await query({status:'queued'})).filter(r=>!after.includes(r.id)&&(!studioInstanceId||r.studioInstanceId===studioInstanceId));
        const remaining=deadline-Date.now();
        if(requests.length||remaining<=0||disconnected)return {requests:claim?await Promise.all(requests.map(request=>this.update(request.id,{status:'working'}))):requests};
        if(changeVersion!==observed)continue;
        await new Promise(resolve=>{
          let timer;const done=()=>{clearTimeout(timer);waiters.delete(done);resolve();};
          waiters.add(done);timer=setTimeout(done,remaining);timer.unref?.();
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
