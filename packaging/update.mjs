// Installs a newer SAAM release announced by the relay. SAAM downloads the
// package itself (so it carries no browser download mark), checks it against
// the relay's checksum and the one release URL this build accepts, unpacks it
// in a home tmp workspace and starts its installer, which claims that workspace,
// waits for this process to exit, unpacks the package's app.tar in place of the
// application and starts SAAM again. The installer is at app/packaging/<os>/
// in every package, the path earlier SAAM versions run it from.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {rm,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createTemporaryWorkspace} from '../core/application/temporary-workspace.mjs';

// Windows' own bsdtar reads ZIP; a GNU tar earlier on PATH does not.
const TAR=process.platform==='win32'?resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe'):'tar';
const run=(command,args)=>new Promise((done,fail)=>{
  const child=spawn(command,args,{stdio:'ignore',windowsHide:true});
  child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error(`${command} exited with ${code}.`)));
});

// The one download this build accepts for a version: the release asset under
// the update host fixed into it at build time, e.g.
// https://github.com/Struder-AI/SAAM/releases/download/v0.1.3/SAAM-0.1.3-win-x64.zip.
export function releaseUrl({updateHost,version,platform}){
  if(!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(version)))throw Error('The update names no valid version.');
  if(!/^[a-z0-9-]+$/.test(String(platform)))throw Error('This SAAM names no valid platform.');
  return `${String(updateHost).replace(/\/+$/,'')}/v${version}/SAAM-${version}-${platform}.zip`;
}

export async function installUpdate({version,url,sha256},{platform,updateHost,report=async()=>{}}){
  if(!updateHost||url!==releaseUrl({updateHost,version,platform}))throw Error('This update is not the release this SAAM trusts.');
  if(!/^[a-f0-9]{64}$/.test(sha256??''))throw Error('The update names no valid checksum.');
  await report({kind:'update-download-started',version});
  let workspace=null,handedOff=false;
  try{
  const response=await fetch(url);if(!response.ok)throw Error(`The download failed (${response.status}).`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('The download does not match its checksum.');
  workspace=await createTemporaryWorkspace('update');
  const folder=workspace.directory,top=resolve(folder,`SAAM-${version}-${platform}`);
  const zip=resolve(folder,'package.zip');
  await writeFile(zip,bytes);
  await run(TAR,['-xf',zip,'-C',folder]);
  await rm(zip,{force:true});
  const windows=platform.startsWith('win');
  const installer=resolve(top,'app','packaging',windows?'windows':'macos',windows?'install.ps1':'install.sh');
  await stat(installer).catch(()=>{throw Error('The downloaded package has no installer.');});
  // A detached Windows child has no console, and Windows PowerShell 5.1 then
  // exits 0 without running the script, so conhost gives it a hidden one. The
  // launcher's PID is not the installer's: the installer claims the workspace itself.
  await workspace.prepareChild();
  const child=windows
    ?spawn('conhost.exe',['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',installer,'-WaitPid',String(process.pid),'-Workspace',folder,'-WorkspaceToken',workspace.token],{detached:true,stdio:'ignore',windowsHide:true})
    :spawn('bash',[installer,'--wait-pid',String(process.pid),'--workspace',folder,'--workspace-token',workspace.token],{detached:true,stdio:'ignore'});
  await new Promise((started,failed)=>{
    child.once('spawn',started);
    child.once('error',error=>failed(Error(`Could not start the SAAM ${version} installer: ${error.message}. The current SAAM remains open.`,{cause:error})));
  });
  handedOff=true;child.unref();
  await report({kind:'update-installer-launcher-started',version});
  return {updating:true,version};
  }catch(error){
    if(workspace&&!handedOff)await workspace.childEnded().then(()=>workspace.release()).catch(()=>{});
    await report({kind:'update-failed',version,error:error.message},{error});throw error;
  }
}
