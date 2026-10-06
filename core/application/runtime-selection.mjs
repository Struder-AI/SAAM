// Invocation selects a code root; only the installed application owns the user surface.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {homePaths} from './home.mjs';
const execute=promisify(execFile);
export const invocationRoot=resolve(fileURLToPath(new URL('../..',import.meta.url)));
// The orchestrator/runtime protocol a code root speaks: package.json saam.contract, which
// the orchestrator reads before starting that code. A packaged release also records it in release.json.
export const orchestratorContract=JSON.parse(readFileSync(resolve(invocationRoot,'package.json'),'utf8')).saam.contract;
// Orchestrator and runtime check each other before any process starts or any request is routed.
// The message names the side to update.
export function contractProblem(orchestrator,runtime){
  if(orchestrator.contract===runtime.contract)return null;
  const runtimeNewer=!(orchestrator.contract>=runtime.contract);
  return Object.assign(Error(runtime.label+' speaks runtime contract '+(runtime.contract??'none')+'; '+orchestrator.label+' speaks '+(orchestrator.contract??'none')+'. '
    +(runtimeNewer?'Update '+orchestrator.label+' first.':'Update '+runtime.label+' (for a checkout, merge the current SAAM source).')),{code:'RUNTIME_CONTRACT'});
}
export async function orchestratorRoot(paths=homePaths()){
  const release=await readFile(resolve(paths.app,'release.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(!release)return invocationRoot;
  // Starting an installed application that cannot run this code would only open its windows on the real home.
  const problem=contractProblem({contract:release.contract,label:'the installed SAAM '+release.version},{contract:orchestratorContract,label:'This SAAM code'});
  if(problem)throw problem;
  return paths.app;
}
// The exact command that reaches a source runtime: its checkout's saam, or the
// development tool when this home is a development instance.
function sourceCommand(root,paths){
  const dev=process.env.SAAM_DATA&&process.env.SAAM_DEV_INSTANCE;
  return dev?'node "'+resolve(root,'scripts/dev-instance.mjs')+'" --home "'+paths.home+'"'+(dev==='visible'?' --visible':''):'node "'+resolve(root,'scripts/saam.mjs')+'"';
}
// studioTitle begins each of the runtime's Studio page titles (studio/app.mjs).
export async function selectRuntime(codeRoot=invocationRoot){
  const root=await realpath(codeRoot),paths=homePaths();
  if(process.platform==='win32'&&root.startsWith('\\\\'))throw Error('SAAM source runtimes must use a local disk.');
  const manifest=await readFile(resolve(root,'package.json'),'utf8').then(JSON.parse);
  if(manifest.name!=='saam')throw Error('The selected runtime is not SAAM.');
  await stat(resolve(root,'packaging/runtime-host.mjs'));
  const installed=resolve(root).toLowerCase()===resolve(paths.app).toLowerCase();
  const release=await readFile(resolve(root,'release.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  const contract=manifest.saam?.contract;
  if(installed)return {id:'installed',codeRoot:root,node:process.execPath,contract,label:'Installed '+(release?.version??'SAAM'),studioTitle:'SAAM Studio '+(release?.version??'installed'),command:'saam'};
  const head=await gitHead(root);
  return {id:'src:'+createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex').slice(0,12),codeRoot:root,node:process.execPath,contract,
    label:'Source '+basename(root)+' @ '+head.slice(0,8),studioTitle:'SAAM Studio source',command:sourceCommand(root,paths)};
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
