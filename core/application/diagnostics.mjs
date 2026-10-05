// Only first-run evidence and the latest transport issue survive disconnection.
import {mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homePaths} from './home.mjs';
import {replaceFile} from '../file-write.mjs';
const sensitive=/(?:secret|token|password|credential|authorization|cookie|invite|transcript|reasoning|prompt|instruction|query|content|chat|conversation|messages|url|uri|path|filename|directory|filecontent|sourcecode)/i;
const scrubText=value=>value.slice(0,2048).replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
  .replace(/https?:\/\/[^\s"'<>]+/gi,'[url]')
  .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g,'[path]')
  .replace(/\/(?:Users|home|tmp|var|etc|mnt|Volumes|private)\/[^\s"'<>]+/g,'[path]');
export function diagnostic(value,depth=0){
  if(depth>7)return '[depth limit]';
  if(Array.isArray(value)){
    if(value.length>32&&value.every(item=>typeof item==='number'))return {elided:'numbers',length:value.length};
    const kept=value.slice(0,32).map(item=>diagnostic(item,depth+1));
    if(value.length>32)kept.push({elided:'items',length:value.length-32});
    return kept;
  }
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,64)
    .map(([key,item])=>[key,sensitive.test(key)?'[redacted]':diagnostic(item,depth+1)]));
  if(typeof value==='string')return scrubText(value);
  return typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||value===null?value:null;
}

const transportCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ENETDOWN','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
export function isNetworkFailure(error){
  for(let current=error;current;current=current.cause){
    if(transportCodes.has(current.code)||current instanceof TypeError&&/^(fetch failed|Failed to fetch|NetworkError when attempting to fetch resource\.)$/.test(current.message))return true;
  }
  return false;
}
const queues=new Map();
export function createDiagnosticReports({home=homePaths().home,statePath=resolve(homePaths(home).state,'release-service.json')}={}){
  const directory=resolve(homePaths(home).tmp,'diagnostics');
  const serial=action=>{
    const result=(queues.get(directory)??Promise.resolve()).then(action);
    const settled=result.catch(()=>{});queues.set(directory,settled);
    void settled.then(()=>{if(queues.get(directory)===settled)queues.delete(directory);});return result;
  };
  const records=async(kind)=>{
    const names=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    const values=[];
    for(const name of names){
      if(!new RegExp('^'+kind+'\\.[a-f0-9-]{36}\\.json$').test(name))continue;
      try{values.push({name,value:JSON.parse(await readFile(resolve(directory,name),'utf8'))});}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return values.sort((a,b)=>b.value.order-a.value.order||b.name.localeCompare(a.name));
  };
  const latest=async(kind)=>(await records(kind))[0]??null;
  async function retain(kind,value){
    const id=randomUUID(),name=kind+'.'+id+'.json';
    await mkdir(directory,{recursive:true});
    await replaceFile(resolve(directory,name),JSON.stringify({...value,id,order:performance.timeOrigin+performance.now()})+'\n');
    const all=await records(kind);
    // Immutable record names make an acknowledgement incapable of deleting a newer issue.
    await Promise.all(all.slice(1).map(({name})=>rm(resolve(directory,name),{force:true})));
  }
  const upload={pending:null};
  return {
    firstRun(event,{complete=false}={}){return serial(async()=>{
      const saved=JSON.parse(await readFile(statePath,'utf8').catch(error=>{if(error.code==='ENOENT')return '{}';throw error;}));
      if(saved.firstRelayConnected===true||saved.deviceId&&saved.secret)return;
      const previous=(await latest('first-run'))?.value;if(previous?.complete)return;
      await retain('first-run',{kind:'first-run',events:[...(previous?.events??[]),diagnostic(event)],complete});
    });},
    networkIssue(event,error){if(!isNetworkFailure(error))return Promise.resolve();return serial(()=>retain('latest-network',{kind:'latest-network',event:diagnostic(event)}));},
    flush(send){return upload.pending??=(async()=>{
      for(const kind of ['first-run','latest-network']){
        const record=await serial(()=>latest(kind));if(!record)continue;
        const receipt=await send(record.value);
        if(receipt?.received===true)await serial(()=>rm(resolve(directory,record.name),{force:true}));
      }
    })().finally(()=>{upload.pending=null;});}
  };
}
