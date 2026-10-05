// Invocation selects a code root; only the installed application owns the user surface.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
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
export async function selectRuntime(codeRoot=invocationRoot){
  const root=await realpath(codeRoot),paths=homePaths();
  if(process.platform==='win32'&&root.startsWith('\\\\'))throw Error('SAAM source runtimes must use a local disk.');
  if((await readFile(resolve(root,'package.json'),'utf8').then(JSON.parse)).name!=='saam')throw Error('The selected runtime is not SAAM.');
  await stat(resolve(root,'packaging/runtime-host.mjs'));
  const installed=resolve(root).toLowerCase()===resolve(paths.app).toLowerCase();
  const release=await readFile(resolve(root,'release.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(installed)return {id:'installed',codeRoot:root,node:process.execPath,fingerprint:release?.version??'source',label:'Installed '+(release?.version??'SAAM')};
  const head=await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true}).then(result=>result.stdout.trim());
  const diff=await execute('git',['diff','HEAD','--binary','--','core','studio','skills','workspaces','scripts','packaging','adapters','machines'],{cwd:root,windowsHide:true,maxBuffer:32*1024*1024}).then(result=>result.stdout);
  const untracked=await execute('git',['ls-files','--others','--exclude-standard','--','core','studio','skills','workspaces','scripts','packaging','adapters','machines'],{cwd:root,windowsHide:true}).then(result=>result.stdout.trim().split('\n').filter(Boolean));
  const hash=createHash('sha256').update(head).update(diff);
  for(const name of untracked){hash.update(name);hash.update(await readFile(resolve(root,name)));}
  return {id:'src:'+createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex').slice(0,12),codeRoot:root,node:process.execPath,
    fingerprint:hash.digest('hex'),label:'Source '+basename(root)+' @ '+head.slice(0,8)+(diff||untracked.length?' (modified)':'')};
}
