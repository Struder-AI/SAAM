// Invocation selects a code root; only the installed application owns the user surface.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {homePaths} from './home.mjs';
const execute=promisify(execFile);
export const invocationRoot=resolve(fileURLToPath(new URL('../..',import.meta.url)));
// The orchestrator/runtime protocol this code speaks; a packaged release records it in release.json.
export const orchestratorContract=1;
export async function orchestratorRoot(paths=homePaths()){
  const release=await readFile(resolve(paths.app,'release.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(!release)return invocationRoot;
  // Starting an installed application that cannot run this code would only open its windows on the real home.
  if(release.contract!==orchestratorContract)throw Error('Update the installed SAAM '+release.version+' first: this code requires orchestrator contract '+orchestratorContract+'.');
  return paths.app;
}
// The exact command that reaches a source runtime: its checkout's saam, or the
// development tool when this home is a background development instance.
function sourceCommand(root,paths){
  return process.env.SAAM_BACKGROUND==='1'&&process.env.SAAM_DATA?'node "'+resolve(root,'scripts/dev-instance.mjs')+'" --home "'+paths.home+'"':'node "'+resolve(root,'scripts/saam.mjs')+'"';
}
export async function selectRuntime(codeRoot=invocationRoot){
  const root=await realpath(codeRoot),paths=homePaths();
  if(process.platform==='win32'&&root.startsWith('\\\\'))throw Error('SAAM source runtimes must use a local disk.');
  if((await readFile(resolve(root,'package.json'),'utf8').then(JSON.parse)).name!=='saam')throw Error('The selected runtime is not SAAM.');
  await stat(resolve(root,'packaging/runtime-host.mjs'));
  const installed=resolve(root).toLowerCase()===resolve(paths.app).toLowerCase();
  const release=await readFile(resolve(root,'release.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(installed)return {id:'installed',codeRoot:root,node:process.execPath,label:'Installed '+(release?.version??'SAAM'),command:'saam'};
  const head=await gitHead(root);
  return {id:'src:'+createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex').slice(0,12),codeRoot:root,node:process.execPath,
    label:'Source '+basename(root)+' @ '+head.slice(0,8),command:sourceCommand(root,paths)};
}
const gitHead=root=>execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true}).then(result=>result.stdout.trim());
// A cheap identity of the code at root: the release version, or a checkout's commit and newest
// source modification. A runtime keeps the code it started with until an explicit reload;
// comparing stamps only tells Studio that newer code is available.
export async function codeStamp(root=invocationRoot){
  const release=await readFile(resolve(root,'release.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(release)return 'release:'+release.version;
  let newest=0;
  for(const folder of ['adapters','core','extensions','machines','packaging','scripts','skills','studio','workspaces']){
    const entries=await readdir(resolve(root,folder),{recursive:true,withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const entry of entries)if(entry.isFile())newest=Math.max(newest,(await stat(join(entry.parentPath,entry.name))).mtimeMs);
  }
  return (await gitHead(root))+':'+newest;
}
