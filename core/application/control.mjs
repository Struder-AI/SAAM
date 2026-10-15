// Commands discover one ready application; launching a command never owns it.
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homePaths,canonicalHome} from './home.mjs';
import {orchestratorRoot,orchestratorContract} from './runtime-selection.mjs';
import {userInfo} from 'node:os';

// Control probes and shutdown acknowledgements share the existing three-second liveness window.
export const controlProbeMs=3000,controlWaitMs=35000;

export function applicationPort(home=canonicalHome()){
  const identity=process.platform==='win32'?resolve(home).toLowerCase():resolve(home);
  return 49152+createHash('sha256').update(identity).digest().readUInt16BE(0)%16384;
}
export async function readInstance(){
  try{return JSON.parse(await readFile(resolve(homePaths(canonicalHome()).state,'instance.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw Error('The SAAM instance record cannot be read.',{cause:error});}
}
export async function controlRequest(instance,body,{waitMs}={}){
  // A request waits while SAAM works on it (native HTTP has no implicit fetch deadline)
  // and fails when SAAM answers a failure or drops the connection; liveness probes pass waitMs.
  const response=await new Promise((received,failed)=>{
    const command=request({hostname:'127.0.0.1',port:instance.port,path:'/control',method:'POST',agent:false,timeout:0,
      headers:{'Content-Type':'application/json','X-SAAM-Control':instance.token},
      ...(waitMs===undefined?{}:{signal:AbortSignal.timeout(waitMs)})},received);
    command.once('error',failed);command.end(JSON.stringify({...body,contract:orchestratorContract}));
  });
  const chunks=[];for await(const chunk of response)chunks.push(Buffer.from(chunk));
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(response.statusCode<200||response.statusCode>=300)throw Object.assign(Error(value.error??`SAAM answered ${response.statusCode}.`),{result:value,status:response.statusCode});
  return value;
}
// Who holds the home's control port: a SAAM application, ready or still starting,
// answers a request without its token with 403 (saam); none: nothing listens;
// other: another program answered; busy: no answer yet, or the connection dropped.
export async function leaseHolder(port){
  try{
    const response=await new Promise((received,failed)=>{
      const probe=request({hostname:'127.0.0.1',port,path:'/control',method:'POST',agent:false,signal:AbortSignal.timeout(2000)},received);
      probe.once('error',failed);probe.end();
    });
    const chunks=[];for await(const chunk of response)chunks.push(Buffer.from(chunk));
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return response.statusCode===403&&value.error==='Invalid local control request.'?'saam':'other';
  }catch(error){return error.code==='ECONNREFUSED'?'none':error instanceof SyntaxError?'other':'busy';}
}
// The home's application when its record answers; null when none runs (or one is still starting).
export async function runningInstance(){
  const existing=await readInstance();
  if(!existing)return null;
  if(existing.user&&existing.user!==userInfo().username)throw Error('SAAM is running for '+existing.user+'.');
  try{await controlRequest(existing,{command:'ping'},{waitMs:controlProbeMs});return existing;}
  catch(error){if(error.result?.code==='RUNTIME_CONTRACT')throw error;return null;}
}
export async function readyInstance(){
  const running=await runningInstance();
  if(running)return running;
  // The OS control listener decides whether a new application can own this home.
  const paths=homePaths(canonicalHome()),root=await orchestratorRoot();
  await mkdir(paths.state,{recursive:true});
  const node=resolve(root,'runtime',process.platform==='win32'?'node.exe':'node');
  const environment={...process.env};
  for(const name of ['SAAM_DATA','SAAM_BACKGROUND','SAAM_DEV_INSTANCE','SAAM_SESSION_MODE','SAAM_RUNTIME'])delete environment[name];
  // The launched process tells its startup failure over IPC; waiting lasts while it lives.
  const child=spawn(node,[resolve(root,'packaging/launch.mjs'),'--no-open'],
    {detached:true,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:environment});
  const launched={failure:null,exitCode:undefined};
  child.on('message',message=>{if(typeof message?.startupFailure==='string')launched.failure=message.startupFailure;});
  child.once('close',code=>{launched.exitCode=code;});
  await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();child.channel?.unref();
  try{
    for(;;){
      const ended=launched.exitCode!==undefined,instance=await readInstance();
      if(instance){
        try{await controlRequest(instance,{command:'ping'},{waitMs:controlProbeMs});return instance;}catch{/* Startup publishes only ready records. */}
      }
      if(launched.failure)throw Error('SAAM could not start: '+launched.failure);
      if(ended)throw Error('SAAM stopped before it was ready (exit code '+launched.exitCode+').');
      await new Promise(done=>setTimeout(done,200));
    }
  }finally{if(child.connected)child.disconnect();}
}
