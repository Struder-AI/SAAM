// Installs a newer SAAM release announced by the relay. SAAM downloads the
// package itself (so it carries no browser download mark), checks it against
// the relay's checksum and the release host fixed into this build, unpacks it
// under the data folder and starts its installer, which waits for this process
// to exit, replaces the application and starts SAAM again.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,rm,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';

// Windows' own bsdtar reads ZIP; a GNU tar earlier on PATH does not.
const TAR=process.platform==='win32'?resolve(process.env.SystemRoot??'C:/Windows','System32','tar.exe'):'tar';
const run=(command,args)=>new Promise((done,fail)=>{
  const child=spawn(command,args,{stdio:'ignore',windowsHide:true});
  child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error(`${command} exited with ${code}.`)));
});

export async function installUpdate({version,url,sha256},{platform,updateHost,data,log}){
  if(!updateHost||new URL(url).origin!==new URL(updateHost).origin)throw Error('This update is not from the release host this SAAM trusts.');
  if(!/^[a-f0-9]{64}$/.test(sha256??''))throw Error('The update names no valid checksum.');
  log(`Downloading SAAM ${version} from ${url}`);
  const response=await fetch(url);if(!response.ok)throw Error(`The download failed (${response.status}).`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('The download does not match its checksum.');
  const folder=resolve(data,'updates',version),top=resolve(folder,`SAAM-${version}-${platform}`);
  await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  await writeFile(resolve(folder,'package.zip'),bytes);
  await run(TAR,['-xf',resolve(folder,'package.zip'),'-C',folder]);
  const windows=platform.startsWith('win');
  const installer=resolve(top,'app','packaging',windows?'windows':'macos',windows?'install.ps1':'install.sh');
  await stat(installer).catch(()=>{throw Error('The downloaded package has no installer.');});
  const child=windows
    ?spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,'-WaitPid',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true})
    :spawn('bash',[installer,'--wait-pid',String(process.pid)],{detached:true,stdio:'ignore'});
  child.unref();
  log(`Installer for SAAM ${version} started; SAAM closes now and opens again when it finishes.`);
  return {updating:true,version};
}
