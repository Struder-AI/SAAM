import {mkdir,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonical} from '../core/print/plan.mjs';
import {hasPresentedResult} from './work-state.mjs';

export function workSnapshot({plan,machine,review}){
  const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
  const generated=review?.history?.findLast(event=>event.event==='generated');
  return {inputKey:hash({plan,machine}),generationKey:generated?hash(generated):null};
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
  const file=id=>{if(!/^[a-f0-9-]{32,64}$/.test(id))throw Error('Invalid agent request id.');return resolve(folder,id+'.json');};
  async function save(record){await mkdir(folder,{recursive:true});const path=file(record.id),temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(record)+'\n');await rename(temp,path);return record;}
  async function get(id){return JSON.parse(await readFile(file(id),'utf8'));}
  function printId(directory,{optional=false}={}){const name=relative(root,resolve(directory)).split('\\').join('/');if(!name||name==='..'||name.startsWith('../')||isAbsolute(name)){if(optional)return null;throw Error('Agent requests must refer to a print in this library.');}return name;}
  async function list(){let names;try{names=await readdir(folder);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const records=await Promise.all(names.filter(n=>n.endsWith('.json')).map(n=>get(n.slice(0,-5))));
    return records.map(r=>r.kind!=='advisory'&&!r.presented&&['queued','working'].includes(r.status)&&r.expiresAt<=now()?{...r,status:'failed',timedOut:true,error:'The agent did not respond. Retry the request or return to chat.'}:r).sort((a,b)=>a.createdAt-b.createdAt);
  }
  return {list,printId,
    async begin({directory,instruction,source='agent',key,kind='edit',evidence}){
      if(disconnected)throw Error('Agent connection closed.');
      if(typeof instruction!=='string'||!instruction.trim()||instruction.length>8000)throw Error('Describe the requested agent work.');
      const id=key?createHash('sha256').update(key).digest('hex'):randomUUID();
      if(key)try{return await get(id);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!['edit','guidance','advisory'].includes(kind))throw Error('Unknown Studio work kind.');
      const currentId=printId(directory),overlapping=kind==='edit'?(await list()).filter(r=>r.printId===currentId&&!['guidance','advisory'].includes(r.kind)&&!r.presented&&['queued','working','waiting'].includes(r.status)):[];
      for(const record of overlapping)await save({...await get(record.id),requiresTarget:true});
      return save({id,printId:currentId,instruction,source,kind,...(kind==='advisory'?{evidence}:{}),baseline:await snapshot(directory),requiresTarget:overlapping.length>0,ownerId,status:source==='studio'?'queued':'working',createdAt:now(),updatedAt:now(),expiresAt:now()+600000});
    },
    async update(id,{status='completed',message='',resultStage}={}){
      if(disconnected)throw Error('Agent connection closed.');
      if(!['working','waiting','completed','failed','cancelled'].includes(status))throw Error('Invalid agent response status.');
      const record=await get(id);if(['completed','cancelled'].includes(record.status))return record;
      const resuming=status==='working'&&record.status!=='working';
      const baseline=resuming?await snapshot(resolve(root,record.printId)):record.baseline;
      const result=resuming?undefined:status==='completed'?await snapshot(resolve(root,record.printId)):record.result;
      if(resultStage&&!['geometry','toolpath'].includes(resultStage))throw Error('Unknown result stage.');
      const target=resultStage?{...await snapshot(resolve(root,record.printId)),stage:resultStage}:resuming?undefined:record.target
        ??(status==='completed'&&result?{...result,stage:result.generationKey!==baseline?.generationKey?'toolpath':'geometry'}:undefined);
      return save({...record,baseline,result,target,presented:resultStage||resuming?false:record.presented,ownerId:ownerId??record.ownerId,status,connectionClosed:false,timedOut:false,message:String(message).slice(0,8000),updatedAt:now(),expiresAt:now()+600000});
    },
    async presented(directory,shown){
      const id=printId(directory,{optional:true});if(!id)return;
      for(const record of await list())if(record.printId===id&&['working','completed'].includes(record.status)&&!record.presented&&hasPresentedResult(record,shown))
        await save({...await get(record.id),presented:true});
    },
    async disconnect(){
      disconnected=true;if(!ownerId)return;
      for(const record of await list())if(!record.presented&&record.ownerId===ownerId&&['queued','working'].includes(record.status))
        await save({...record,status:'failed',connectionClosed:true,updatedAt:now()});
    },
    async wait({after=[],waitMs=25000,claim=false}={}){const deadline=now()+Math.min(25000,Math.max(0,waitMs));for(;;){const requests=(await list()).filter(r=>r.status==='queued'&&!after.includes(r.id));if(requests.length||now()>=deadline||disconnected)return {requests:claim?await Promise.all(requests.map(request=>this.update(request.id,{status:'working'}))):requests};await new Promise(r=>setTimeout(r,75));}},
    async cancelFor(directory){const id=printId(directory);for(const r of await list())if(r.printId===id&&['queued','working','waiting'].includes(r.status))await this.update(r.id,{status:'cancelled'});}
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
