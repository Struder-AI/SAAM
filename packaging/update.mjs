// Installs a newer SAAM release announced by the relay. SAAM downloads the
// package itself (so it carries no browser download mark), checks it against
// the relay's checksum and the one release URL this build accepts, unpacks it
// under the data folder and starts its installer, which waits for this process
// to exit, unpacks the package's app.tar in place of the application and starts
// SAAM again. The installer is at app/packaging/<os>/ in every package, the path
// earlier SAAM versions run it from.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,rm,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';

// Windows' own bsdtar reads ZIP; a GNU tar earlier on PATH does not.
const TAR=process.platform==='win32'?resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe'):'tar';
const run=(command,args)=>new Promise((done,fail)=>{
  const child=spawn(command,args,{stdio:'ignore',windowsHide:true});
  child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error(`${command} exited with ${code}.`)));
});

// The one download this build accepts for a version: the release asset under
// the update host fixed into it at build time, e.g.
// https://github.com/Struder-AI/SAAM/releases/download/v0.1.3/SAAM-0.1.3-win-x64.zip.
// The version is plain major.minor.patch, so it cannot leave the updates folder.
export function releaseUrl({updateHost,version,platform}){
  if(!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(version)))throw Error('The update names no valid version.');
  if(!/^[a-z0-9-]+$/.test(String(platform)))throw Error('This SAAM names no valid platform.');
  return `${String(updateHost).replace(/\/+$/,'')}/v${version}/SAAM-${version}-${platform}.zip`;
}

export async function installUpdate({version,url,sha256},{platform,updateHost,data,log}){
  if(!updateHost||url!==releaseUrl({updateHost,version,platform}))throw Error('This update is not the release this SAAM trusts.');
  if(!/^[a-f0-9]{64}$/.test(sha256??''))throw Error('The update names no valid checksum.');
  log(`Downloading SAAM ${version} from ${url}`);
  const response=await fetch(url);if(!response.ok)throw Error(`The download failed (${response.status}).`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('The download does not match its checksum.');
  // Earlier updates' packages are done with by now: keep only this one.
  const updates=resolve(data,'updates'),folder=resolve(updates,version),top=resolve(folder,`SAAM-${version}-${platform}`);
  if(dirname(folder)!==updates)throw Error('The update folder would leave the updates folder.');
  await rm(updates,{recursive:true,force:true}).catch(()=>{});
  await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  const zip=resolve(folder,'package.zip');
  await writeFile(zip,bytes);
  await run(TAR,['-xf',zip,'-C',folder]);
  await rm(zip,{force:true});
  const windows=platform.startsWith('win');
  const installer=resolve(top,'app','packaging',windows?'windows':'macos',windows?'install.ps1':'install.sh');
  await stat(installer).catch(()=>{throw Error('The downloaded package has no installer.');});
  // A detached Windows child has no console, and Windows PowerShell 5.1 then
  // exits 0 without running the script, so conhost gives it a hidden one.
  const child=windows
    ?spawn('conhost.exe',['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',installer,'-WaitPid',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true})
    :spawn('bash',[installer,'--wait-pid',String(process.pid)],{detached:true,stdio:'ignore'});
  await new Promise((started,failed)=>{
    child.once('spawn',started);
    child.once('error',error=>failed(Error(`Could not start the SAAM ${version} installer: ${error.message}. The current SAAM remains open.`,{cause:error})));
  });
  child.unref();
  log(`Installer for SAAM ${version} started; SAAM closes now and opens again when it finishes.`);
  return {updating:true,version};
}
