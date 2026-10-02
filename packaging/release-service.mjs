// Optional installed-app connection to alpha releases and live diagnostics.
// State is installation data, outside replaceable application files.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {watch} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {releaseUrl} from './update.mjs';

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export {saamHome as dataFolder} from '../core/application/home.mjs';
import {saamHome as dataFolder,homePaths} from '../core/application/home.mjs';
// release.json is written by the packager. Its relayUrl field currently names
// the optional release service for existing package manifests.
export async function releaseConfiguration(){
  const saved=JSON.parse(await readFile(resolve(appRoot,'release.json'),'utf8').catch(()=>'{}'));
  const revision=spawnSync('git',['rev-parse','--short','HEAD'],{cwd:appRoot,encoding:'utf8',windowsHide:true});
  const changes=spawnSync('git',['status','--porcelain'],{cwd:appRoot,encoding:'utf8',windowsHide:true});
  const development='development ('+(revision.status===0?revision.stdout.trim():'unknown')+(changes.stdout?.trim()?', dirty':'')+')';
  return {version:saved.version??development,serviceUrl:process.env.SAAM_RELEASE_SERVICE_URL??saved.serviceUrl??process.env.SAAM_RELAY_URL??saved.relayUrl??'https://saam-relay.remettub.workers.dev',
    platform:saved.platform??null,updateHost:saved.updateHost??null};
}
export async function createInstalledReleaseService(options={}){
  const config=await releaseConfiguration();
  if(!config.serviceUrl)return null;
  return createReleaseService({...config,statePath:resolve(homePaths().state,'release-service.json'),watchState:true,...options});
}

const VERSION=/^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const sensitive=/(?:secret|token|password|credential|authorization|cookie|invite|transcript|reasoning|prompt|instruction|query|content|chat|conversation|messages|url|uri|path|filename|directory|filecontent|sourcecode)/i;
const newer=(candidate,current)=>{
  if(!VERSION.test(String(candidate))||!VERSION.test(String(current)))return false;
  const a=candidate.split('.').map(Number),b=current.split('.').map(Number);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];
  return false;
};
const scrubText=value=>value.slice(0,2048).replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
  .replace(/https?:\/\/[^\s"'<>]+/gi,'[url]')
  .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g,'[path]')
  .replace(/\/(?:Users|home|tmp|var|etc|mnt|Volumes|private)\/[^\s"'<>]+/g,'[path]');
function diagnostic(value,depth=0){
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
const errorMessage=error=>String(error?.message??error);
const studioEvent=event=>{
  const keys=['kind','seq','at','delivery','studioInstanceId','workspaceInstanceId','extensionId','extensionDigest','printId','jobId','generationHash','exportHash','stage','phase','elapsedMs','durationMs','error','cancelled'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(event,key)).map(key=>[key,event[key]]));
};
function serviceOrigin(value){
  if(!value)return null;
  const url=new URL(value);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
    throw Error('The release service must use HTTPS or local loopback.');
  return url.origin;
}
const savedDevice=(saved,url)=>url&&saved?.serviceUrl===url&&typeof saved.deviceId==='string'&&saved.deviceId
  &&typeof saved.secret==='string'&&saved.secret?{deviceId:saved.deviceId,secret:saved.secret}:null;
async function save(file,value){
  await mkdir(dirname(file),{recursive:true});
  const temporary=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  await writeFile(temporary,JSON.stringify(value)+'\n',{mode:0o600});
  await rename(temporary,file);
}
async function request(fetchImpl,url,path,{secret,body}={}){
  const response=await fetchImpl(new URL(path,url),{method:'POST',headers:{...(secret?{Authorization:`Bearer ${secret}`}:{"Content-Type":"application/json"}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let result;try{result=await response.json();}catch{throw Object.assign(Error(`The release service answered ${response.status} without JSON.`),{status:response.status});}
  if(!response.ok)throw Object.assign(Error(result?.error??`The release service answered ${response.status}.`),{status:response.status});
  return result;
}

// Async because remembered activation and first-run dismissal are read once.
export async function createReleaseService({serviceUrl,statePath,version='development',platform=null,updateHost=null,update=null,quit=null,fetchImpl=fetch,watchState=false,instanceId=null}={}){
  if(!statePath)throw Error('Release service state needs an installation data path.');
  const url=serviceOrigin(serviceUrl),file=resolve(statePath),diagnostics={lastReceipt:null,lastOperationReceipt:null,lastFailure:null,pending:new Set()};
  let stored={},stateProblem=null;
  try{stored=JSON.parse(await readFile(file,'utf8'));}
  catch(error){if(error.code!=='ENOENT')stateProblem='Saved service connection could not be read. Enter an invite again.';}
  let state={firstRunDismissed:stored.firstRunDismissed===true,device:savedDevice(stored,url)};
  let offer=null,updateStatus=null,problem=stateProblem,runtime=null,unobserve=[],stateWatcher=null,closed=false,refreshQueue=Promise.resolve(),saveQueue=Promise.resolve();
  const persist=(next,currentOnly=false)=>{
    const value={serviceUrl:url,firstRunDismissed:next.firstRunDismissed,...next.device};
    const pending=saveQueue.then(()=>{if(!currentOnly||state===next)return save(file,value);});saveQueue=pending.catch(()=>{});return pending;
  };
  const status=()=>({available:Boolean(url),activated:Boolean(state.device),firstRunPrompt:Boolean(url&&!state.firstRunDismissed&&!state.device),
    version,update:offer?{version:offer.version}:null,updateStatus,problem,canQuit:Boolean(quit),diagnostics:{lastReceipt:diagnostics.lastReceipt,lastOperationReceipt:diagnostics.lastOperationReceipt,lastFailure:diagnostics.lastFailure}});
  const rejectDevice=async(error,device)=>{
    if(error.status!==401||state.device!==device)return;
    stopObserving();state={firstRunDismissed:true,device:null};offer=null;updateStatus=null;
    problem='This service connection is no longer valid. Enter a fresh invite to reconnect. SAAM still works locally.';
    const rejected=state;
    try{await persist(rejected,true);}catch{if(state===rejected)problem+=' The invalid connection could not be cleared from disk.';}
  };
  const emit=(event,about={})=>{
    if(closed||!url||!state.device)return;
    const device=state.device;
    const body={event:diagnostic(event),about:diagnostic({version,platform,instanceId,...about})};
    const sent=request(fetchImpl,url,'/device/events',{secret:device.secret,body}).then(receipt=>{
      if(receipt.received===true){
        const acknowledged={received:true,at:new Date().toISOString(),instanceId,kind:event.kind,source:about.source??null,...(event.name?{operation:event.name}:{})};
        diagnostics.lastReceipt=acknowledged;diagnostics.lastFailure=null;
        if(event.kind==='operation')diagnostics.lastOperationReceipt=acknowledged;
      }
      return receipt;
    }).catch(error=>{diagnostics.lastFailure={at:new Date().toISOString(),kind:event.kind,error:scrubText(errorMessage(error))};return rejectDevice(error,device);});
    diagnostics.pending.add(sent);void sent.finally(()=>diagnostics.pending.delete(sent));return sent;
  };
  const subscribe=()=>{
    if(!runtime||!state.device||unobserve.length)return;
    unobserve=[runtime.observeEvents(event=>emit(studioEvent(event),{source:'studio'})),
      runtime.observeOperations?.(event=>emit(event,{source:'agent-operation'}))].filter(Boolean);
  };
  const stopObserving=()=>{for(const stop of unobserve)stop();unobserve=[];};
  const refresh=async()=>{
    let saved;
    try{saved=JSON.parse(await readFile(file,'utf8'));}catch{saved=null;}
    if(closed)return;
    const device=savedDevice(saved,url);
    if(state.device?.deviceId===device?.deviceId&&state.device?.secret===device?.secret)return;
    stopObserving();state={firstRunDismissed:saved?.firstRunDismissed===true,device};offer=null;updateStatus=null;
    subscribe();
  };
  if(watchState&&url){
    await mkdir(dirname(file),{recursive:true});
    stateWatcher=watch(dirname(file),{persistent:false},(_,name)=>{
      if(!name||String(name)===file.split(/[\\/]/).at(-1))refreshQueue=refreshQueue.then(refresh,refresh).catch(()=>{});
    });
    stateWatcher.on('error',()=>{stateWatcher?.close();stateWatcher=null;});
  }
  const checkUpdate=async()=>{
    if(!url||!state.device){offer=null;updateStatus=null;return {update:null};}
    const device=state.device;
    try{
      const {release}=await request(fetchImpl,url,'/device/release',{secret:device.secret});
      if(state.device!==device)return {update:null};
      const asset=release?.assets?.[platform];
      offer=null;
      if(!release)updateStatus={state:'no-release'};
      else if(!platform||!asset)updateStatus={state:'platform-unavailable',platform,version:release.version};
      else if(!newer(release.version,version))updateStatus={state:'current'};
      else if(!update||!updateHost)updateStatus={state:'manual-update-required',version:release.version};
      else if(asset.url!==releaseUrl({updateHost,version:release.version,platform}))throw Error('The release asset does not match this installation’s trusted update source.');
      else{offer={version:release.version,...asset};updateStatus={state:'available',version:release.version};}
      problem=null;return {update:offer?{version:offer.version}:null,updateStatus};
    }catch(error){if(state.device===device){offer=null;updateStatus=null;problem=errorMessage(error);}await rejectDevice(error,device);throw error;}
  };
  return {
    status,
    async flushDiagnostics(){await Promise.all([...diagnostics.pending]);return diagnostics.lastReceipt;},
    async activate(invite){
      if(!url)throw Error('This installation names no release service. SAAM still works locally.');
      const entered=String(invite??'').trim();if(!entered)throw Error('Enter an alpha invite code.');
      try{
        const {deviceId,secret}=await request(fetchImpl,url,'/device/register',{body:{invite:entered}});
        if(typeof deviceId!=='string'||typeof secret!=='string'||!deviceId||!secret)throw Error('The release service returned no installation credential.');
        const next={firstRunDismissed:true,device:{deviceId,secret}};await persist(next);stopObserving();state=next;offer=null;updateStatus=null;problem=null;subscribe();
        emit({kind:'activation',result:'connected'});return status();
      }catch(error){problem=errorMessage(error);throw error;}
    },
    async dismissFirstRun(){const next={...state,firstRunDismissed:true};await persist(next);state=next;return status();},
    checkUpdate,
    async update(options={}){
      await checkUpdate();
      if(!offer)throw Error('No newer trusted SAAM release is available for this installation.');
      const selected=offer;emit({kind:'update-started',version:selected.version});
      try{return await update(selected,options);}catch(error){emit({kind:'update-failed',version:selected.version,error:errorMessage(error)});throw error;}
    },
    quit:(options={})=>{if(!quit)throw Error('This SAAM stops from its terminal.');return quit(options);},
    observeRuntime(next){stopObserving();runtime=next;subscribe();},
    recordOperation:event=>emit(event,{source:'agent-operation'}),
    recordStudioEvent:event=>emit(studioEvent(event),{source:'studio'}),
    close(){closed=true;stateWatcher?.close();stateWatcher=null;stopObserving();runtime=null;}
  };
}
