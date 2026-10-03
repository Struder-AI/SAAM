// One ready local application owns commands, Studios, jobs and release services.
import {mkdir,writeFile,unlink,readFile,appendFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {z} from 'zod';
import {homePaths} from '../core/application/home.mjs';
import {createLocalRuntime,instructions} from '../core/application/runtime.mjs';
import {applicationPort,readInstance,controlRequest} from '../core/application/control.mjs';
import {createReleaseService,releaseConfiguration} from './release-service.mjs';
import {installUpdate} from './update.mjs';
import {startTray} from './tray.mjs';
import {clientStatus,setupClients,writeHomeGuidance} from './client-setup.mjs';
import {replaceFile} from '../core/file-write.mjs';
import {openBrowser} from '../studio/browser.mjs';

async function jsonBody(request){
  const chunks=[],size={bytes:0};
  for await(const chunk of request){size.bytes+=chunk.length;if(size.bytes>128*1024*1024)throw Error('SAAM command input exceeds 128 MiB.');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a command object.');
  return value;
}
function respond(response,value,status=200){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
export async function startApplication({autoOpen=true,openOnStart=true,tray=true}={}){
  const paths=homePaths();
  await Promise.all([paths.prints,paths.extensions,resolve(paths.state,'logs')].map(path=>mkdir(path,{recursive:true})));
  const log=async(...parts)=>appendFile(resolve(paths.state,'logs','saam.log'),new Date().toISOString()+' '+parts.join(' ')+'\n');
  const previous=await readInstance();
  if(previous){try{return {existing:true,...await controlRequest(previous,{command:openOnStart?'open':'status'},{waitMs:3000})};}catch{/* Binding the installation's OS endpoint decides ownership. */}}
  const state={runtime:null,services:null,tray:null,control:null,stopping:null,clients:null},token=randomBytes(24).toString('hex');
  const instanceFile=resolve(paths.state,'instance.json');
  async function stop(){return state.stopping??=(async()=>{
    state.tray?.stop();state.services?.close();await state.runtime?.close();
    if(state.control?.listening){const closed=new Promise(done=>state.control.close(done));state.control.closeAllConnections();await closed;}
    const current=JSON.parse(await readFile(instanceFile,'utf8').catch(()=>'{}'));
    if(current.token===token)await unlink(instanceFile).catch(()=>{});
    await log('SAAM stopped.');
  })();}
  const later=()=>{setTimeout(()=>void stop().catch(error=>log('Stop failed:',error.message)),250);};
  async function quit(force=false){
    const jobs=await state.runtime.runningJobs();
    if(jobs.length&&!force)return {confirmationRequired:true,jobs,message:'SAAM has running jobs. Quit and cancel them?'};
    state.runtime.notifyStopping('quit');later();return {quitting:true};
  }
  async function retryClients(){state.clients=await setupClients({home:paths.home});return state.clients;}
  async function startClient(instanceId,client){
    state.clients=await retryClients();
    const selected=state.clients.clients.find(value=>value.id===client);
    if(!selected?.ready)throw Error(selected?.reason??'Choose Codex or Claude Code.');
    await state.runtime.detachStudio(instanceId);
    if(client==='codex'){
      const prompt='Read AGENTS.md in this SAAM home, then run saam call maker_onboarding and connect to the waiting Studio. Guide me through the open part or tour.';
      const link=new URL('codex://threads/new');link.searchParams.set('path',paths.home);link.searchParams.set('prompt',prompt);
      if(!await openBrowser(link.href))throw Error('Codex could not be opened. Retry after installing or updating it.');
      return {waiting:true,client,firstSend:true,message:'Press Send in Codex to connect.',setupErrors:state.clients.errors};
    }
    if(client!=='claude')throw Error('Choose Codex or Claude Code.');
    const child=spawn(selected.command,['--desktop'],{cwd:paths.home,stdio:'ignore',windowsHide:true,shell:process.platform==='win32'&&selected.command.toLowerCase().endsWith('.cmd')});
    await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();
    return {waiting:true,client,firstSend:true,message:'In Claude Code, ask the agent to read AGENTS.md and run saam call maker_onboarding.',setupErrors:state.clients.errors};
  }
  try{
    // The OS listener is the exclusive application lease, including during startup.
    state.control=createServer(async(request,response)=>{
      if(request.method!=='POST'||request.url!=='/control'||request.headers['x-saam-control']!==token||request.headers.origin){respond(response,{ok:false,error:'Invalid local control request.'},403);return;}
      try{respond(response,await command(await jsonBody(request)));}
      catch(error){respond(response,{ok:false,error:error.message,code:error.code??null,...(error.workRequest?{workRequest:error.workRequest}:{})},400);}
    });
    try{await new Promise((done,fail)=>{state.control.once('error',fail);state.control.listen(applicationPort(paths.home),'127.0.0.1',done);});}
    catch(error){
      if(error.code!=='EADDRINUSE')throw error;
      const deadline=Date.now()+30000;
      for(;;){
        const running=await readInstance();
        if(running){try{return {existing:true,...await controlRequest(running,{command:openOnStart?'open':'status'},{waitMs:2000})};}catch{/* Wait for the owner to publish readiness. */}}
        if(Date.now()>=deadline)throw Error('The SAAM control port is occupied but no ready application answered. Quit the existing SAAM or resolve the port conflict.');
        await new Promise(done=>setTimeout(done,200));
      }
    }
    await writeHomeGuidance(paths.home);
    const config=await releaseConfiguration(),instanceId=randomBytes(16).toString('hex');
    state.services=await createReleaseService({...config,instanceId,statePath:resolve(paths.state,'release-service.json'),watchState:true,
      update:config.platform&&config.updateHost?async(offered,{force=false}={})=>{
        const jobs=await state.runtime.runningJobs();
        if(jobs.length&&!force)return {confirmationRequired:true,jobs,message:'Updating SAAM cancels running jobs.'};
        const result=await installUpdate(offered,{...config,data:paths.state,log});state.runtime.notifyStopping('update');later();return result;
      }:null,
      quit:({force=false}={})=>quit(force)});
    state.runtime=createLocalRuntime({printsRoot:paths.prints,stateRoot:paths.state,autoOpen,relay:state.services,
      application:{startClient,detach:instanceId=>state.runtime.detachStudio(instanceId),clientStatus,retryClients}});
    state.services.observeRuntime(state.runtime);
    async function command(message){
      if(message.command==='diagnostics')return {ok:true,receipt:await state.services.flushDiagnostics(),service:state.services.status()};
      if(message.command==='status')return {ok:true,pid:process.pid,instanceId,version:config.version,home:paths.home,jobs:await state.runtime.runningJobs(),studios:state.runtime.studios(),service:state.services.status()};
      if(message.command==='open')return {ok:true,...await state.runtime.openStudio({studioInstanceId:message.studioInstanceId})};
      if(message.command==='new-instance')return {ok:true,...await state.runtime.openStudio({newInstance:true})};
      if(message.command==='quit')return {ok:true,...await quit(message.force===true)};
      if(message.command==='update')return {ok:true,...await state.services.update({force:message.force===true})};
      if(message.command==='help'){
        const operation=message.operation?state.runtime.operations.find(value=>value.name===message.operation):null;
        if(message.operation&&!operation)throw Error('Unknown SAAM operation '+message.operation+'.');
        return {ok:true,instructions,commands:['open','help [OP]','call OP --input FILE|--stdin|--flags','wait','start-tour','status','update','quit'],
          operations:(operation?[operation]:state.runtime.operations).map(value=>({name:value.name,description:value.description,readOnly:value.readOnly,
            ...(operation?{input:z.toJSONSchema(value.schema,{target:'draft-7',io:'input'})}:{})}))};
      }
      const operationName=message.command==='wait'?'wait_for_studio_request':message.command==='start-tour'?'start_tour':message.command==='call'?message.operation:null;
      const definition=state.runtime.operations.find(value=>value.name===operationName);
      if(!definition)throw Error('Use saam help to choose a command or operation.');
      definition.schema.parse(message.args??{});
      const chat=await state.runtime.connectChat({id:message.chatId,name:message.chatName??(message.client?message.client+' '+message.chatId.slice(0,8):message.chatId),client:message.client,bundleId:message.operation==='capture_bundle'?undefined:message.bundleId});
      if(message.command==='wait')return {ok:true,result:await chat.invoke('wait_for_studio_request',message.args??{})};
      if(message.command==='start-tour')return {ok:true,result:await chat.invoke('start_tour',message.args??{})};
      if(message.command!=='call'||typeof message.operation!=='string')throw Error('Use saam help, call, wait, start-tour, open, status, update or quit.');
      return {ok:true,result:await chat.invoke(message.operation,message.args??{})};
    }
    const record={instanceId,pid:process.pid,port:state.control.address().port,token,version:config.version};
    if(tray)state.tray=await startTray(record);
    await replaceFile(instanceFile,JSON.stringify(record)+'\n');
    await log('SAAM ready:',config.version,'home:',paths.home);
    if(openOnStart)await state.runtime.openStudio();
    return {existing:false,record,runtime:state.runtime,services:state.services,stop};
  }catch(error){await stop().catch(()=>{});await log('Startup failed:',error.stack??error.message);throw error;}
}
