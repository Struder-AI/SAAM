// Commands discover one ready application; launching a command never owns it.
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homePaths} from './home.mjs';
import {orchestratorRoot} from './runtime-selection.mjs';
import {userInfo} from 'node:os';

export function applicationPort(home=homePaths().home){
  const identity=process.platform==='win32'?resolve(home).toLowerCase():resolve(home);
  return 49152+createHash('sha256').update(identity).digest().readUInt16BE(0)%16384;
}
export async function readInstance(){
  try{return JSON.parse(await readFile(resolve(homePaths().state,'instance.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw Error('The SAAM instance record cannot be read.',{cause:error});}
}
export async function controlRequest(instance,body,{waitMs=35000}={}){
  // Native HTTP has no implicit five-minute fetch header/body deadline.
  // Operation waits own their duration; bounded control commands retain theirs.
  const response=await new Promise((received,failed)=>{
    const command=request({hostname:'127.0.0.1',port:instance.port,path:'/control',method:'POST',agent:false,timeout:0,
      headers:{'Content-Type':'application/json','X-SAAM-Control':instance.token},
      ...(waitMs===null?{}:{signal:AbortSignal.timeout(waitMs)})},received);
    command.once('error',failed);command.end(JSON.stringify(body));
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
export async function readyInstance(){
  const paths=homePaths();await mkdir(paths.state,{recursive:true});
  const existing=await readInstance();
  if(existing){
    if(existing.user&&existing.user!==userInfo().username)throw Error('SAAM is running for '+existing.user+'.');
    try{await controlRequest(existing,{command:'status'},{waitMs:3000});return existing;}
    catch{/* The OS control listener decides whether a new application can own this home. */}
  }
  const root=await orchestratorRoot(paths);
  const node=root===paths.app?resolve(root,'runtime',process.platform==='win32'?'node.exe':'node'):process.execPath;
  // The launched process tells its startup failure over IPC; waiting lasts while it lives.
  const child=spawn(node,[resolve(root,'packaging/launch.mjs'),'--no-open'],
    {detached:true,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:process.env});
  const launched={failure:null,exitCode:undefined};
  child.on('message',message=>{if(typeof message?.startupFailure==='string')launched.failure=message.startupFailure;});
  child.once('close',code=>{launched.exitCode=code;});
  await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();child.channel?.unref();
  try{
    for(;;){
      const ended=launched.exitCode!==undefined,instance=await readInstance();
      if(instance){
        try{await controlRequest(instance,{command:'status'},{waitMs:2000});return instance;}catch{/* Startup publishes only ready records. */}
      }
      if(launched.failure)throw Error('SAAM could not start: '+launched.failure);
      if(ended)throw Error('SAAM stopped before it was ready (exit code '+launched.exitCode+').');
      await new Promise(done=>setTimeout(done,200));
    }
  }finally{if(child.connected)child.disconnect();}
}
