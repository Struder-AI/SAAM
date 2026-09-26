#!/usr/bin/env node
// The installed SAAM launcher. Prints, the pairing credential and logs live in
// a per-user data folder outside the application, so reinstalling, updating
// or uninstalling the application never touches them. One SAAM runs per user:
// launching again asks the running one to show Studio.
import {readFile,writeFile,mkdir,unlink,appendFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openBrowser} from '../studio/browser.mjs';
import {installUpdate} from './update.mjs';

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export function dataFolder(){
  if(process.env.SAAM_DATA)return resolve(process.env.SAAM_DATA);
  if(process.platform==='win32')return resolve(process.env.LOCALAPPDATA??resolve(homedir(),'AppData/Local'),'SAAM');
  if(process.platform==='darwin')return resolve(homedir(),'Library/Application Support/SAAM');
  return resolve(process.env.XDG_DATA_HOME??resolve(homedir(),'.local/share'),'saam');
}

// release.json is written by the packager: the version, the relay this build
// pairs with, its platform and the host its updates may come from.
async function release(){
  const saved=JSON.parse(await readFile(resolve(appRoot,'release.json'),'utf8').catch(()=>'{}'));
  return {version:saved.version??'development',relayUrl:process.env.SAAM_RELAY_URL??saved.relayUrl,platform:saved.platform??null,updateHost:saved.updateHost??null};
}

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

const logFile=()=>resolve(dataFolder(),'logs','saam.log');
const log=(...parts)=>{const line=`${new Date().toISOString()} ${parts.join(' ')}`;console.log(line);return appendFile(logFile(),line+'\n').catch(()=>{});};

async function main(){
  const data=dataFolder(),{version,relayUrl,platform,updateHost}=await release();
  await mkdir(resolve(data,'logs'),{recursive:true});
  if(!relayUrl)throw Error('This build names no relay. Set SAAM_RELAY_URL or reinstall a release build.');
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
  log(`SAAM ${version} starting. Data: ${data}. Relay: ${relayUrl}`);
  // Closing the window and updating both end with stop(); it needs the SAAM they belong to.
  const app={saam:null,stopping:null};
  const stop=()=>app.stopping??=(async()=>{
    control.close();await app.saam?.stop().catch(error=>log('stop failed',error.message));
    await unlink(instanceFile).catch(()=>{});await log('SAAM stopped.');process.exit(0);
  })();
  const later=result=>{setTimeout(()=>void stop(),500);return result;};
  const installed={version,platform,
    update:platform&&updateHost?async offered=>later(await installUpdate(offered,{platform,updateHost,data,log})):null};
  const {runPairedSaam}=await import('../adapters/mcp/src/relay-device.mjs');
  app.saam=await runPairedSaam({relayUrl,statePath:resolve(data,'relay-device.json'),printsRoot:resolve(data,'Prints'),installed,
    onStatus:status=>log('relay',JSON.stringify(status)),onCall:call=>log('call',JSON.stringify(call))});
  const saam=app.saam;
  control.on('request',async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/open'||req.headers['x-saam-launch']!==token){res.writeHead(404);res.end();return;}
    try{const shown=await saam.runtime.openStudio();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(shown));}
    catch(error){res.writeHead(500);res.end(error.message);}
  });
  log(`SAAM Studio: ${saam.studio.url}. Keep this window open while you use SAAM; close it to stop.`);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
}

// Started without a window, a failure would be invisible: log it and show the log.
main().catch(async error=>{
  console.error('SAAM could not start:',error.message);process.exitCode=1;
  await mkdir(dirname(logFile()),{recursive:true}).catch(()=>{});
  await log('SAAM could not start:',error.stack??error.message);
  await openBrowser(pathToFileURL(logFile()).href);
});
