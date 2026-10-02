// Commands discover one ready application; launching a command never owns it.
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homePaths} from './home.mjs';

export function applicationPort(home=homePaths().home){
  const identity=process.platform==='win32'?resolve(home).toLowerCase():resolve(home);
  return 49152+createHash('sha256').update(identity).digest().readUInt16BE(0)%16384;
}
export async function readInstance(){
  try{return JSON.parse(await readFile(resolve(homePaths().state,'instance.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw Error('The SAAM instance record cannot be read.',{cause:error});}
}
export async function controlRequest(instance,body,{waitMs=35000}={}){
  const response=await fetch(`http://127.0.0.1:${instance.port}/control`,{method:'POST',
    headers:{'Content-Type':'application/json','X-SAAM-Control':instance.token},body:JSON.stringify(body),...(waitMs===null?{}:{signal:AbortSignal.timeout(waitMs)})});
  const value=await response.json();
  if(!response.ok)throw Object.assign(Error(value.error??`SAAM answered ${response.status}.`),{result:value});
  return value;
}
export async function readyInstance(){
  const paths=homePaths();await mkdir(paths.state,{recursive:true});
  const existing=await readInstance();
  if(existing){
    try{await controlRequest(existing,{command:'status'},{waitMs:3000});return existing;}
    catch{/* The OS control listener decides whether a new application can own this home. */}
  }
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../packaging/launch.mjs',import.meta.url)),'--no-open'],
    {detached:true,stdio:'ignore',windowsHide:true,env:process.env});
  await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();
  const deadline=Date.now()+30000;
  for(;;){
    const instance=await readInstance();
    if(instance){
      try{await controlRequest(instance,{command:'status'},{waitMs:2000});return instance;}catch{/* Startup publishes only ready records; report a bounded failure. */}
    }
    if(Date.now()>=deadline)throw Error(`SAAM did not become ready. See ${resolve(paths.state,'logs','saam.log')}.`);
    await new Promise(done=>setTimeout(done,200));
  }
}
