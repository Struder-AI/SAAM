// A complete workspace set is published before its predecessor is retired.
import {readFile,readdir,lstat,rm,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {replaceFile} from '../core/file-write.mjs';
import {withBundleWriteLock} from '../core/print/bundle-lock.mjs';
import {bundleInstance} from '../core/print/studio-ownership.mjs';

const safeName=name=>typeof name==='string'&&/^(?:set-|[.]export-)[a-zA-Z0-9_.-]+$/.test(name);
export function workspaceExportPath(directory,name){if(!safeName(name))throw Error('Invalid workspace export identity.');return join(directory,name);}
export async function currentWorkspaceExport(directory,extensionId){
  const pointer=await readFile(join(directory,'current-export.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(pointer){const path=workspaceExportPath(directory,pointer.directory),record=await readFile(join(path,'export.json'),'utf8').then(JSON.parse);if(record.stage!=='complete'||record.workspace!==extensionId)throw Error('Current workspace export is incomplete or belongs to another workspace.');return {directory:path,record};}
  // Existing 0.3.2 sets are history; choose the newest complete set as the predecessor.
  const names=(await readdir(directory)).filter(name=>name.startsWith('set-')).sort().reverse();
  for(const name of names){const path=workspaceExportPath(directory,name),record=await readFile(join(path,'export.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});if(record?.stage==='complete'&&record.workspace===extensionId)return {directory:path,record};}
  return null;
}
export async function lockWorkspaceExport(previous,action,index=0,lease){
  if(!previous||index>=previous.record.bundles.length)return action();
  const entry=previous.record.bundles[index];
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.path)||entry.path!==entry.id)throw Error('Invalid workspace bundle path.');
  const path=join(previous.directory,entry.path),info=await lstat(path);
  if(info.isSymbolicLink()||!info.isDirectory())throw Error('Workspace export contains a linked or missing bundle.');
  return withBundleWriteLock(path,async()=>{
    if(await bundleInstance(path))throw Error('Close the previous exported bundles in Studio before replacing this workspace set.');
    return lockWorkspaceExport(previous,action,index+1,lease);
  },{lease});
}
export async function recoverWorkspaceExport(directory){
  const file=join(directory,'.export-transaction.json');
  const record=await readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(!record)return;
  const stage=workspaceExportPath(directory,record.stage),target=workspaceExportPath(directory,record.target);
  const pointer=await readFile(join(directory,'current-export.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(pointer?.directory===record.target){
    const exported=await readFile(join(target,'export.json'),'utf8').then(JSON.parse);
    if(exported.stage!=='complete')throw Error('Published workspace export is incomplete; prior data retained.');
    if(record.previous){const previousPath=workspaceExportPath(directory,record.previous),old=await readFile(join(previousPath,'export.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
      if(old){
        for(const bundle of old.bundles){
          if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(bundle.path))throw Error('Invalid workspace bundle path.');
          const file=join(previousPath,bundle.path,'.bundle-write.lock');
          const lock=await readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
          if(lock?.exportLease===record.stage)await rm(file);
        }
        const lease={id:record.stage,retain:false};
        await lockWorkspaceExport({directory:previousPath,record:old},async()=>{lease.retain=true;},0,lease);
        await rename(previousPath,stage);
      }}
  }else await rm(target,{recursive:true,force:true});
  await rm(stage,{recursive:true,force:true});await rm(file,{force:true});
}
export async function beginWorkspaceExport(directory,{stage,target,previous}){
  workspaceExportPath(directory,stage);workspaceExportPath(directory,target);
  const record={stage,target,previous:previous?previous.directory.slice(directory.length+1):null};
  if(record.previous)workspaceExportPath(directory,record.previous);
  await replaceFile(join(directory,'.export-transaction.json'),JSON.stringify(record)+'\n');
}
export async function publishWorkspaceExport(directory,{stage,target,previous}){
  const stagePath=workspaceExportPath(directory,stage),targetPath=workspaceExportPath(directory,target),file=join(directory,'.export-transaction.json');
  const record={stage,target,previous:previous?previous.directory.slice(directory.length+1):null};
  await replaceFile(file,JSON.stringify(record)+'\n');
  await rename(stagePath,targetPath);
  await replaceFile(join(directory,'current-export.json'),JSON.stringify({directory:target})+'\n');
  return {directory:targetPath};
}
export async function retireWorkspaceExport(directory,stage,previous){
  if(previous)await rename(previous.directory,workspaceExportPath(directory,stage));
}
export async function finishWorkspaceExport(directory,stage){
  await rm(workspaceExportPath(directory,stage),{recursive:true,force:true});await rm(join(directory,'.export-transaction.json'),{force:true});
}
