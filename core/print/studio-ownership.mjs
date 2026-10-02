// One Studio instance reserves a bundle when it opens it.
// The process identity is recorded for deliberate recovery after a crash; an
// elapsed clock alone never takes a live instance's bundle away.
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {replaceFile} from '../file-write.mjs';
import {withBundleWriteLock} from './bundle-lock.mjs';

const instanceContext=new AsyncLocalStorage();
const instanceFile=dir=>resolve(dir,'.bundle-studio.json');
const conflict=record=>Object.assign(Error(`This print is already open in another Studio instance (${record.instanceId}). Switch or close that instance before opening it here.`),{code:'BUNDLE_INSTANCE_BUSY'});
const same=(a,b)=>a?.instanceId===b?.instanceId&&a?.ownerId===b?.ownerId&&a?.token===b?.token;

export async function bundleInstance(directory){
  try{return JSON.parse(await readFile(instanceFile(directory),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

export async function claimBundleInstance(directory,{instanceId,ownerId}){
  if(typeof instanceId!=='string'||!instanceId||typeof ownerId!=='string'||!ownerId)throw Error('Bundle reservation requires a Studio instance and agent owner.');
  return withBundleWriteLock(directory,async()=>{
    const current=await bundleInstance(directory);
    if(current)throw conflict(current);
    const record={instanceId,ownerId,pid:process.pid,token:randomUUID(),startedAt:new Date().toISOString()};
    await replaceFile(instanceFile(directory),JSON.stringify(record)+'\n');
    return record;
  },{wait:true});
}

export async function releaseBundleInstance(directory,record){
  return withBundleWriteLock(directory,async()=>{
    const current=await bundleInstance(directory);
    if(!current)return false;
    if(!same(current,record))throw conflict(current);
    await rm(instanceFile(directory));
    return true;
  },{wait:true});
}

// Re-pairing changes the chat, never the Studio's reservation or revision.
export async function reassignBundleInstance(directory,record,ownerId){
  if(typeof ownerId!=='string'||!ownerId)throw Error('Choose an agent owner for this Studio.');
  return withBundleWriteLock(directory,async()=>{
    const current=await bundleInstance(directory);
    if(!same(current,record))throw conflict(current);
    const assigned={...current,ownerId};
    await replaceFile(instanceFile(directory),JSON.stringify(assigned)+'\n');
    return assigned;
  },{wait:true});
}

export function withBundleInstance(directory,record,action){
  if(!record?.token)throw Error('A Studio write needs its Bundle instance reservation.');
  return instanceContext.run({directory:resolve(directory),record},action);
}

export async function requireBundleInstance(directory){
  const current=await bundleInstance(directory);
  const context=instanceContext.getStore();
  if(!current){if(context)throw Error('The Studio reservation was released. Reload before editing again.');return;}
  if(context?.directory!==resolve(directory)||!same(current,context.record))throw conflict(current);
}

export async function recoverBundleInstance(directory){
  return withBundleWriteLock(directory,async()=>{
    const current=await bundleInstance(directory);
    if(!current)return {recovered:false};
    if(!Number.isInteger(current.pid)||current.pid<1)throw Error('Bundle Studio record is damaged. Inspect it before recovery.');
    try{process.kill(current.pid,0);}catch(error){if(error.code!=='ESRCH')throw error;
      await rm(instanceFile(directory));return {recovered:true,instanceId:current.instanceId};
    }
    throw Error('The Studio instance is still running. Close it before recovery.');
  });
}
