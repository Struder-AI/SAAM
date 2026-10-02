#!/usr/bin/env node
// The installed SAAM launcher. Prints, the optional service credential and logs live in
// a per-user data folder outside the application, so reinstalling, updating
// or uninstalling the application never touches them. One SAAM runs per user:
// launching again asks the running one to show Studio.
import {readFile,writeFile,mkdir,unlink,appendFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openBrowser} from '../studio/browser.mjs';
import {installUpdate} from './update.mjs';
import {startDesktop} from './desktop.mjs';
import {createReleaseService,dataFolder,releaseConfiguration} from './release-service.mjs';
export {dataFolder} from './release-service.mjs';

const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};

// An instance record names the running SAAM's loopback control port and token.
async function claimInstance(file,record){
  for(;;){
    try{await writeFile(file,JSON.stringify(record),{flag:'wx',mode:0o600});return null;}
    catch(error){if(error.code!=='EEXIST')throw error;}
    const running=JSON.parse(await readFile(file,'utf8').catch(()=>'{}'));
    if(running.pid&&alive(running.pid))return running;
    await unlink(file).catch(()=>{});
  }
}
async function showRunning(running){
  const response=await fetch(`http://127.0.0.1:${running.port}/open`,{method:'POST',headers:{'X-SAAM-Launch':running.token}});
  if(!response.ok)throw Error(`The running SAAM answered ${response.status}.`);
  return response.json();
}

// Closing the last Studio tab stops SAAM at once: the grace period only lets a
// reload or a bfcache return reconnect. Until the first tab connects there is
// no deadline, so a slow browser cannot stop SAAM.
export const TAB_GRACE_MS=3_000;
export function stopWithoutTabs(observeEvents,onNoTabs,graceMs=TAB_GRACE_MS){
  const tabs=new Map(),watch={seen:false,timer:null};
  return observeEvents(event=>{
    if(!['viewer-opened','viewer-closed','workspace-viewer-opened','workspace-viewer-closed'].includes(event.kind))return;
    tabs.set(event.workspaceInstanceId??event.studioInstanceId,event.viewers);
    const open=[...tabs.values()].reduce((sum,count)=>sum+count,0);
    watch.seen||=open>0;clearTimeout(watch.timer);
    if(watch.seen&&!open)watch.timer=setTimeout(onNoTabs,graceMs);
  });
}

const logFile=()=>resolve(dataFolder(),'logs','saam.log');
const log=(...parts)=>{const line=`${new Date().toISOString()} ${parts.join(' ')}`;console.log(line);return appendFile(logFile(),line+'\n').catch(()=>{});};

async function main(){
  const data=dataFolder(),{version,serviceUrl,platform,updateHost}=await releaseConfiguration();
  await mkdir(resolve(data,'logs'),{recursive:true});
  const token=randomBytes(24).toString('hex'),instanceFile=resolve(data,'instance.json');
  // The control server is listening before the record names it.
  const control=createServer();
  await new Promise(done=>control.listen(0,'127.0.0.1',done));
  const record={pid:process.pid,port:control.address().port,token,version};
  const running=await claimInstance(instanceFile,record);
  if(running){
    // A record whose process answers is a running SAAM; one that doesn't (a reused pid) is stale.
    const shown=await showRunning(running).catch(()=>null);
    if(shown){control.close();log(`SAAM ${running.version} is already running. Studio: ${shown.url}`);return;}
    await unlink(instanceFile).catch(()=>{});
    if(await claimInstance(instanceFile,record))throw Error('Another SAAM is starting. Try again in a moment.');
  }
  log(`SAAM ${version} starting. Data: ${data}. Optional release service: ${serviceUrl??'none'}`);
  // Quit in Studio, closing its last tab, updating and a signal (closing a console window) all end
  // with stop(); it needs the SAAM they belong to.
  const app={desktop:null,stopping:null};
  const stop=()=>app.stopping??=(async()=>{
    control.close();await app.desktop?.stop().catch(error=>log('stop failed',error.message));
    await unlink(instanceFile).catch(()=>{});await log('SAAM stopped.');process.exit(0);
  })();
  const later=result=>{setTimeout(()=>void stop(),500);return result;};
  const services=await createReleaseService({serviceUrl,statePath:resolve(data,'release-service.json'),version,platform,updateHost,watchState:true,
    update:platform&&updateHost?async offered=>later(await installUpdate(offered,{platform,updateHost,data,log})):null,
    quit:async()=>{log('Quit requested from Studio.');return later({quitting:true});}});
  app.desktop=await startDesktop({printsRoot:resolve(data,'Prints'),services});
  const desktop=app.desktop;
  control.on('request',async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/open'||req.headers['x-saam-launch']!==token){res.writeHead(404);res.end();return;}
    try{const shown=await desktop.runtime.openStudio();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(shown));}
    catch(error){res.writeHead(500);res.end(error.message);}
  });
  stopWithoutTabs(desktop.runtime.observeEvents,()=>{log('No Studio tab is open.');void stop();});
  log(`SAAM Studio: ${desktop.studio.url}. To stop SAAM, close Studio or click Quit.`);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
}

// Started without a window, a failure would be invisible: log it and show the log.
main().catch(async error=>{
  console.error('SAAM could not start:',error.message);process.exitCode=1;
  await mkdir(dirname(logFile()),{recursive:true}).catch(()=>{});
  await log('SAAM could not start:',error.stack??error.message);
  await openBrowser(pathToFileURL(logFile()).href);
});
