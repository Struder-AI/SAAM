// Move the installed runtime's existing private state without losing queued requests.
import {lstat,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function migrateRuntimeState(stateRoot){
  const target=resolve(stateRoot,'runtimes','installed'),entries=[];
  for(const name of ['.studio-requests','setup-check.json']){
    const from=resolve(stateRoot,name),to=resolve(target,name),source=await exists(from);
    if(!source)continue;
    if(source.isSymbolicLink()||await exists(to))throw Error('Runtime state migration would overwrite or move linked data: '+from);
    entries.push({from,to});
  }
  const outcome={moved:[]};await mkdir(target,{recursive:true});
  try{for(const entry of entries){await rename(entry.from,entry.to);outcome.moved.push(entry);}return outcome;}
  catch(error){await restoreRuntimeState(outcome);throw error;}
}
export async function restoreRuntimeState(outcome){
  for(const entry of [...outcome.moved].reverse()){
    if(await exists(entry.from))throw Error('Cannot restore runtime state over '+entry.from+'.');
    await rename(entry.to,entry.from);
  }
}
