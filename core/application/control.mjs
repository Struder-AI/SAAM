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
  if(response.statusCode<200||response.statusCode>=300)throw Object.assign(Error(value.error??`SAAM answered ${response.statusCode}.`),{result:value});
  return value;
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
  const child=spawn(node,[resolve(root,'packaging/launch.mjs'),'--no-open'],
    {detached:true,stdio:'ignore',windowsHide:true,env:process.env});
  await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();
  const deadline=Date.now()+30000;
  for(;;){
    const instance=await readInstance();
    if(instance){
      try{await controlRequest(instance,{command:'status'},{waitMs:2000});return instance;}catch{/* Startup publishes only ready records; report a bounded failure. */}
    }
    if(Date.now()>=deadline)throw Error('SAAM did not become ready. Review first-run diagnostics in '+resolve(paths.tmp,'diagnostics')+'.');
    await new Promise(done=>setTimeout(done,200));
  }
}
