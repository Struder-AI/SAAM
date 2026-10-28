// Settings owns remembered setups. Callers supply captured values; no callback
// runs under this owner's store lock and no live profile is consulted here.
import {readFile,mkdir,open,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {requireThat} from '../private/settings/numeric.mjs';
import {replaceFile} from '../private/settings/file-write.mjs';

function setupFor(machineSetups,machineId){
  requireThat(typeof machineId==='string'&&machineId.length>0&&!/[\\/:]/.test(machineId)&&!['.','..'].includes(machineId),'Supply a machine identity for remembered settings.');
  return resolve(machineSetups,machineId+'.json');
}

// Queries never create the store. Unsupported/corrupt records leave defaults
// available; filesystem failures other than absence remain explicit failures.
export async function readRememberedSetup(machineId,{machineSetups}={}){
  const text=machineSetups?await readFile(setupFor(machineSetups,machineId),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}):null;
  if(text===null)return {saved:null,unreadable:false};
  try{
    const saved=JSON.parse(text);
    if(saved?.schema==='saam-machine-setup/1'&&saved.machineId===machineId)return {saved,unreadable:false};
  }catch(error){if(!(error instanceof SyntaxError))throw error;}
  return {saved:null,unreadable:true};
}

async function lockStore(file){
  const lock=file+'.export.lock',writer={handle:null,unreadable:0};
  await mkdir(dirname(lock),{recursive:true});
  for(;;){
    try{writer.handle=await open(lock,'wx');break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const busy=Error('Machine setup has an interrupted export writer. Inspect '+lock+' before recovery.');
      const holder=await readFile(lock,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;});
      if(!(Number.isInteger(holder?.pid)&&holder.pid>0)&&++writer.unreadable>40)throw busy;
      if(Number.isInteger(holder?.pid)&&holder.pid>0){
        try{process.kill(holder.pid,0);}catch(error){if(error.code==='ESRCH')throw busy;throw error;}
      }
      await new Promise(function waitForWriter(done){setTimeout(done,25);});
    }
  }
  try{await writer.handle.writeFile(JSON.stringify({pid:process.pid,time:new Date().toISOString()}));}
  catch(error){try{await writer.handle.close();}finally{await rm(lock);}throw error;}
  return async()=>{try{await writer.handle.close();}finally{await rm(lock);}};
}

// Retained source API for callers seeding setup data. The write itself now owns
// serialization; callers cannot inject work into its critical section.
export async function saveSetup(machine,setup,{machineSetups,source='Last successful export',exportReceipt}={}){
  requireThat(machine&&setup&&machineSetups,'Choose a machine, setup and setup store before remembering settings.');
  const machineId=machine.id,file=setupFor(machineSetups,machineId);
  const captured=structuredClone({setup,source,...(exportReceipt?{exportReceipt}:{})});
  const release=await lockStore(file);
  try{
    await replaceFile(file,JSON.stringify({schema:'saam-machine-setup/1',machineId,...captured,updatedAt:new Date().toISOString()},null,2)+'\n');
    return file;
  }finally{await release();}
}

// One data-only command after complete program preparation. Failure reports the
// unfinished memory step; it has no authority over the caller's artifact.
export async function rememberPreparedSetup({machineId,setup,receipt},{machineSetups}={}){
  try{
    requireThat(receipt&&typeof receipt.directory==='string'&&typeof receipt.outputId==='string'&&typeof receipt.preparedAt==='string','Remembering setup requires its exact prepared-output receipt.');
    const file=await saveSetup({id:machineId},setup,{machineSetups,exportReceipt:receipt});
    return {status:'completed',machineId,file};
  }catch(error){return {status:'failed',machineId,message:error.message};}
}
