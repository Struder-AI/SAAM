// One operation owns its workspace and releases it after its workers stop.
// Crash cleanup trusts recorded process liveness, never age or a name prefix.
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homePaths} from './home.mjs';
import {replaceFile} from '../file-write.mjs';
const SCHEMA='saam-temporary-workspace/1';
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const ownerFile=directory=>resolve(directory,'.saam-workspace.json');
async function workspaceRoot(){
  const paths=homePaths(),root=resolve(paths.tmp,'jobs');
  for(const directory of [paths.home,paths.tmp,root]){
    await mkdir(directory,{recursive:true});const info=await lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||!samePath(await realpath(directory),directory))throw Error('Temporary data folder must be an ordinary directory: '+directory);
  }
  return root;
}
async function workspacePath(directory){
  const target=resolve(directory),root=await workspaceRoot(),info=await lstat(target);
  if(!samePath(dirname(target),root)||!info.isDirectory()||info.isSymbolicLink()||!samePath(await realpath(target),target))
    throw Error('Temporary workspace changed; cleanup refused: '+target);
  return target;
}
function validOwner(owner){
  return owner?.schema===SCHEMA&&typeof owner.token==='string'&&/^[a-f0-9-]{36}$/.test(owner.token)
    &&Number.isInteger(owner.pid)&&owner.pid>0&&(owner.child===null||owner.child?.starting===true||Number.isInteger(owner.child?.pid)&&owner.child.pid>0);
}
async function readOwner(directory){
  const file=ownerFile(directory),info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid temporary workspace ownership: '+directory);
  const owner=JSON.parse(await readFile(file,'utf8'));
  if(!validOwner(owner))throw Error('Invalid temporary workspace ownership: '+directory);return owner;
}
function gone(pid){try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}}
async function changeChild(directory,token,child){
  await workspacePath(directory);const owner=await readOwner(directory);
  if(owner.token!==token)throw Error('Temporary workspace ownership changed: '+directory);
  await replaceFile(ownerFile(directory),JSON.stringify({...owner,child})+'\n');
}
export async function createTemporaryWorkspace(kind){
  if(typeof kind!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(kind))throw Error('Invalid temporary workspace kind.');
  const root=await workspaceRoot(),directory=await mkdtemp(resolve(root,kind+'-')),token=randomUUID();
  try{await writeFile(ownerFile(directory),JSON.stringify({schema:SCHEMA,token,pid:process.pid,child:null})+'\n',{flag:'wx'});}
  catch(error){await rm(directory,{recursive:true,force:true});throw error;}
  const owned={released:false};
  return {directory,token,
    async prepareChild(){await changeChild(directory,token,{starting:true});},
    async childStarted(pid){if(!Number.isInteger(pid)||pid<1)throw Error('Invalid temporary child process.');await changeChild(directory,token,{pid});},
    async childEnded(){await completeTemporaryHandoff(directory,token);},
    async release(){
      if(owned.released)return;await workspacePath(directory);const owner=await readOwner(directory);
      if(owner.token!==token||owner.pid!==process.pid)throw Error('Temporary workspace ownership changed: '+directory);
      if(owner.child&&(owner.child.starting||!gone(owner.child.pid)))throw Error('Temporary workspace still has a live or unknown child: '+directory);
      await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});owned.released=true;
    }
  };
}
// A detached installer claims its actual PID, rather than its launcher shell.
export async function claimTemporaryHandoff(directory,token,pid){
  if(!Number.isInteger(pid)||pid<1)throw Error('Invalid temporary child process.');
  await changeChild(directory,token,{pid});
}
// The installer acknowledges completion after its last use of the extraction.
export async function completeTemporaryHandoff(directory,token){await changeChild(directory,token,null);}
export async function cleanupTemporaryWorkspaces(){
  const root=await workspaceRoot(),removed=[],retained=[];
  // Earlier builds kept downloads in tmp/cache; nothing reads it now.
  await rm(resolve(dirname(root),'cache'),{recursive:true,force:true,maxRetries:4,retryDelay:100});
  for(const entry of await readdir(root,{withFileTypes:true})){
    const directory=resolve(root,entry.name);
    try{
      await workspacePath(directory);const owner=await readOwner(directory);
      if(!gone(owner.pid)||owner.child&&(owner.child.starting||!gone(owner.child.pid))){retained.push(directory);continue;}
      const current=await readOwner(directory);
      if(JSON.stringify(current)!==JSON.stringify(owner)){retained.push(directory);continue;}
      await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});removed.push(directory);
    }catch(error){retained.push({directory,reason:error.message});}
  }
  return {removed,retained};
}
