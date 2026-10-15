// Automatic native client startup. Stable launchers and versioned runtime copies
// live outside app/, so a SAAM update cannot replace a running client's binary.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,copyFile,cp,access,readdir,chmod,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {orchestratorContract} from '../core/application/runtime-selection.mjs';

const source=resolve(dirname(fileURLToPath(import.meta.url)),'../adapters/clients');
const pluginId='saam-lifecycle@saam-local';
async function optional(path){return readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});}
async function write(path,text){if(await optional(path)===text)return false;await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID();await writeFile(temporary,text);await rename(temporary,path);return true;}
function run(binary,args,env=process.env){return new Promise((done,fail)=>{
  const child=spawn(binary,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']}),output={text:'',error:''};
  child.stdout.on('data',bytes=>{output.text+=bytes;});child.stderr.on('data',bytes=>{output.error+=bytes;});child.once('error',fail);
  child.once('close',code=>code===0?done(output.text.trim()):fail(Error(binary+' failed: '+(output.error||output.text).trim())));
});}
async function executable(path){try{await access(path);return path;}catch{return null;}}
async function prepare(home){
  const files=['codex-relay.mjs','codex-wire.mjs','codex-backend.mjs','transport.mjs','owner.mjs','RelayLauncher.cs','claude/hooks/register.js','claude/hooks/hooks.json','claude/.claude-plugin/plugin.json'];
  const contents=await Promise.all(files.map(file=>readFile(join(source,file))));
  const hash=createHash('sha256').update(process.version+process.arch+process.platform);
  for(const bytes of contents)hash.update(bytes);
  const version=hash.digest('hex'),folder=join(home,'state','clients'),release=join(folder,'releases',version);
  await mkdir(release,{recursive:true});
  for(const [index,file] of files.entries()){const target=join(release,file);await mkdir(dirname(target),{recursive:true});if(!await executable(target))await writeFile(target,contents[index]);}
  const runtime=join(folder,'runtimes',process.version+'-'+process.arch);await mkdir(runtime,{recursive:true});
  const node=join(runtime,process.platform==='win32'?'node.exe':'node');
  if(!await executable(node))await copyFile(process.execPath,node);
  if(process.platform!=='win32')await chmod(node,0o755);
  const config={home,contract:orchestratorContract,node,owner:join(release,'owner.mjs')};
  await write(join(release,'claude','client.json'),JSON.stringify(config)+'\n');
  const manifest=JSON.parse(contents.at(-1).toString());manifest.version='1.0.0-'+version;
  await write(join(release,'claude','.claude-plugin','plugin.json'),JSON.stringify(manifest)+'\n');
  return {folder,release,config,version};
}
async function environment(name,value,platform,clientHome){
  if(clientHome!==homedir())return; // Disposable setup never changes login startup.
  if(platform==='win32'){
    // Pass values as environment data, never interpolate paths into shell code.
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Environment]::SetEnvironmentVariable($env:SAAM_VARIABLE,$env:SAAM_VALUE,'User')
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SaamEnvironment { [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window,uint message,UIntPtr word,string value,uint flags,uint timeout,out UIntPtr result); }'
$saamResult=[UIntPtr]::Zero
[void][SaamEnvironment]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,3000,[ref]$saamResult)`],{...process.env,SAAM_VARIABLE:name,SAAM_VALUE:value??''});
  }else if(platform==='darwin'){
    const path=join(clientHome,'Library','LaunchAgents','ai.struder.saam-codex.plist');
    const previous=await optional(path);if(previous&&!previous.includes('<!-- Managed by SAAM -->'))throw Error('Kept a custom launch agent at '+path);
    if(value===null)await run('/bin/launchctl',['unsetenv',name]);else await run('/bin/launchctl',['setenv',name,value]);
    if(value===null)await rm(path,{force:true});else{
      const xml=value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      await write(path,'<?xml version="1.0" encoding="UTF-8"?><!-- Managed by SAAM --><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>ai.struder.saam-codex</string><key>RunAtLoad</key><true/><key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string><string>CODEX_CLI_PATH</string><string>'+xml+'</string></array></dict></plist>\n');
    }
  }
}
async function userOverride(platform,clientHome){
  if(clientHome!==homedir())return null;
  if(platform==='win32')return await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')"])||null;
  if(platform==='darwin')return await run('/bin/launchctl',['getenv','CODEX_CLI_PATH'])||null;
  return process.env.CODEX_CLI_PATH??null;
}
export async function registerCodexAdapter({home,clientHome,platform}){
  const prepared=await prepare(home),{folder,release,config}=prepared;
  const recordFile=join(folder,'codex-startup.json'),previous=await optional(recordFile).then(text=>text?JSON.parse(text):null);
  const launcher=join(folder,platform==='win32'?'saam-codex.exe':'saam-codex');
  const override=await userOverride(platform,clientHome);
  const backend=override&&resolve(override)!==resolve(launcher)?override:previous?.backend??null;
  const bundled=platform==='darwin'?['/Applications/Codex.app/Contents/Resources/codex',join(clientHome,'Applications/Codex.app/Contents/Resources/codex')]:[];
  if(platform==='win32'){
    // Store apps may use the bundled backend before their first backend update.
    const root=join(process.env.ProgramFiles??'C:/Program Files','WindowsApps');
    for(const name of await readdir(root).catch(()=>[]))if(name.startsWith('OpenAI.Codex_'))bundled.unshift(join(root,name,'app','resources','codex.exe'));
    if(!await executable(launcher)){
      const compiler=join(process.env.SystemRoot??'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
      await run(compiler,['/nologo','/target:exe','/out:'+launcher,join(release,'RelayLauncher.cs')]);
    }
  }else{
    const escaped=folder.replaceAll("'","'\\''");
    await write(launcher,"#!/bin/sh\nIFS= read -r saam_node < '"+escaped+"/launcher.txt'\nsaam_relay=$(sed -n '2p' '"+escaped+"/launcher.txt')\nexec \"$saam_node\" \"$saam_relay\" \"$@\"\n");await chmod(launcher,0o755);
  }
  await write(join(release,'client.json'),JSON.stringify({...config,backend,bundled})+'\n');
  const changed=await write(join(folder,'launcher.txt'),config.node+'\n'+join(release,'codex-relay.mjs')+'\n');
  await write(recordFile,JSON.stringify({launcher,backend,previousOverride:override!==launcher?override:previous?.previousOverride??null})+'\n');
  await environment('CODEX_CLI_PATH',launcher,platform,clientHome);
  return {adapter:launcher,transport:'native-app-server',restartRequired:changed||override!==launcher};
}
async function claudeBinary(clientHome,platform){
  const name=platform==='win32'?'claude.exe':'claude';
  return await executable(join(clientHome,'.local','bin',name))??await executable(join('/usr/local/bin',name))??name;
}
export async function registerClaudeAdapter({home,clientHome,platform,directory}){
  const {folder,release,version}=await prepare(home),marketplace=join(folder,'marketplace');
  // The native CLI copies the plugin into its own cache; updates are versioned.
  await cp(join(release,'claude'),join(marketplace,'claude'),{recursive:true});
  await write(join(marketplace,'.claude-plugin','marketplace.json'),JSON.stringify({name:'saam-local',owner:{name:'SAAM'},plugins:[{name:'saam-lifecycle',source:'./claude',version:'1.0.0-'+version}]})+'\n');
  const binary=await claudeBinary(clientHome,platform),env={...process.env,CLAUDE_CONFIG_DIR:directory};delete env.CLAUDECODE;
  const installed=await optional(join(directory,'plugins','installed_plugins.json')).then(text=>text?JSON.parse(text):{});
  const known=await optional(join(directory,'plugins','known_marketplaces.json')).then(text=>text?JSON.parse(text):{});
  if(known['saam-local']?.source?.path&&resolve(known['saam-local'].source.path)!==resolve(marketplace))throw Error('Kept an existing saam-local marketplace from another location: '+known['saam-local'].source.path);
  const entries=installed.plugins?.[pluginId]??[],exists=entries.some(entry=>entry.scope==='user');
  if(exists&&entries.find(entry=>entry.scope==='user').version==='1.0.0-'+version)return {adapter:pluginId,transport:'native-plugin',restartRequired:false};
  if(!known['saam-local'])await run(binary,['plugin','marketplace','add',marketplace,'--scope','user','--json'],env);
  else await run(binary,['plugin','marketplace','update','saam-local','--json'],env);
  await run(binary,['plugin',exists?'update':'install',pluginId,'--scope','user','--json'],env);
  return {adapter:pluginId,transport:'native-plugin',restartRequired:true};
}
export async function unregisterAdapters({home,clientHome,platform,directory}){
  const removed=[],folder=join(home,'state','clients'),recordFile=join(folder,'codex-startup.json');
  const record=await optional(recordFile).then(text=>text?JSON.parse(text):null);
  if(record&&await userOverride(platform,clientHome)===record.launcher){await environment('CODEX_CLI_PATH',record.previousOverride,platform,clientHome);removed.push('CODEX_CLI_PATH');}
  if(platform==='darwin'&&clientHome===homedir()){
    const path=join(clientHome,'Library','LaunchAgents','ai.struder.saam-codex.plist');
    if((await optional(path))?.includes('<!-- Managed by SAAM -->')){await rm(path);removed.push(path);}
  }
  const installed=await optional(join(directory,'plugins','installed_plugins.json')).then(text=>text?JSON.parse(text):{});
  if(installed.plugins?.[pluginId]){
    const env={...process.env,CLAUDE_CONFIG_DIR:directory};delete env.CLAUDECODE;
    await run(await claudeBinary(clientHome,platform),['plugin','uninstall',pluginId,'--scope','user'],env);removed.push(pluginId);
    await run(await claudeBinary(clientHome,platform),['plugin','marketplace','remove','saam-local'],env);
  }
  // Existing client processes retain their code/runtime until they exit.
  return removed;
}
