// A child runtime owns operations and Studios; the orchestrator owns its visible windows.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {createLocalRuntime,instructions} from '../core/application/runtime.mjs';
import {homePaths} from '../core/application/home.mjs';
import {orchestratorContract,codeStamp,contractProblem} from '../core/application/runtime-selection.mjs';
import {processRuntime} from '../core/print/bundle-runtime.mjs';
import {replaceFile} from '../core/file-write.mjs';
import {checkSetup} from '../scripts/setup-check.mjs';

const pending=new Map(),host={runtime:null,sequence:0,closing:null};
function send(message){if(process.connected)process.send(message);}
function request(type,args={}){
  const id='child:'+ ++host.sequence;
  return new Promise((done,fail)=>{pending.set(id,{done,fail});send({id,type,args});});
}
// This runtime keeps the code it started with; Studio may offer a reload when the checkout changes.
const code={started:null,checked:0,newer:false};
async function newerCode(){
  if(Date.now()-code.checked>10000){code.checked=Date.now();code.newer=await codeStamp().then(stamp=>stamp!==code.started,()=>false);}
  return code.newer;
}
const relay={
  status:async()=>({...await request('service',{method:'status'}),runtime:{label:processRuntime().label,newerCode:await newerCode()}}),
  activate:async invite=>request('service',{method:'activate',invite}),
  dismissFirstRun:async()=>request('service',{method:'dismiss'}),
  checkUpdate:async()=>request('service',{method:'check-update'}),
  update:async options=>request('service',{method:'update',options}),
  quit:async options=>request('service',{method:'quit',options})
};
async function command(message){
  const runtime=host.runtime;
  if(message.command==='help'){
    const operation=message.operation?runtime.operations.find(value=>value.name===message.operation):null;
    if(message.operation&&!operation)throw Error('Unknown SAAM operation '+message.operation+'.');
    return {ok:true,instructions,commands:['open','help [OP]','call OP --input FILE|--stdin|--flags','wait','start-tour','status','reload-runtime','stop-runtime','update','quit'],
      operations:(operation?[operation]:runtime.operations).map(value=>({name:value.name,description:value.description,readOnly:value.readOnly,
        ...(operation?{input:z.toJSONSchema(value.schema,{target:'draft-7',io:'input'})}:{})}))};
  }
  const operationName=message.command==='wait'?'wait_for_studio_request':message.command==='start-tour'?'start_tour':message.command==='call'?message.operation:null;
  const definition=runtime.operations.find(value=>value.name===operationName);
  if(!definition)throw Error('Use saam help to choose a command or operation.');
  definition.schema.parse(message.args??{});
  const chat=await runtime.connectChat({id:message.chatId,name:message.chatName??(message.client?message.client+' '+message.chatId.slice(0,8):message.chatId),client:message.client,
    bundleId:message.operation==='capture_bundle'?undefined:message.bundleId,operation:operationName,args:message.args??{}});
  return {ok:true,result:await chat.invoke(operationName,message.args??{})};
}
async function start(args){
  const paths=homePaths(),stateRoot=args.stateRoot,runtime=processRuntime();
  // Orchestrators before this description sent only their contract.
  const problem=contractProblem(args.orchestrator??{contract:args.contract,label:'the running SAAM'},{contract:orchestratorContract,label:runtime.label});
  if(problem)throw problem;
  await mkdir(stateRoot,{recursive:true});
  const setupFile=resolve(stateRoot,'setup-check.json'),setup={problem:null};
  code.started=await codeStamp();code.checked=Date.now();
  if((await readFile(setupFile,'utf8').then(JSON.parse).catch(()=>({}))).passed!==code.started){
    try{await checkSetup({log:()=>{}});await replaceFile(setupFile,JSON.stringify({passed:code.started})+'\n');}
    catch(error){setup.problem={version:runtime.label,error:error.message,effect:'SAAM failed its setup check. Tell the person; reinstalling or repairing this runtime usually fixes it.'};}
  }
  host.runtime=createLocalRuntime({paths,stateRoot,autoOpen:args.autoOpen,relay,
    application:{setupProblem:setup.problem,runtime,fingerprint:code.started,
      retryClients:async()=>request('clients'),
      registerStudio:async window=>request('window',window),
      showStudio:async url=>request('show',{url}),
      releaseBundle:async bundleId=>request('release-bundle',{bundleId}),
      routeWindow:async args=>request('route',args),
      adoptWindow:async args=>request('adopt',args)}});
  host.runtime.observeOperations(event=>send({type:'operation',event}));
  host.runtime.observeEvents(event=>send({type:'event',event}));
  await host.runtime.restoreStudios(args.windows??[]);
  if(args.autoOpen&&!args.windows?.length)await host.runtime.openStudio();
  return {contract:orchestratorContract};
}
async function handle(message){
  if(message.type==='start')return start(message.args);
  if(!host.runtime)throw Error('Runtime is not ready.');
  if(message.type==='command')return command(message.args);
  if(message.type==='status')return {jobs:await host.runtime.runningJobs(),active:host.runtime.activeCount(),studios:host.runtime.studios()};
  if(message.type==='open')return host.runtime.openStudio(message.args);
  if(message.type==='restore')return host.runtime.restoreStudios(message.args.windows);
  if(message.type==='release')return host.runtime.releaseStudio(message.args.studioInstanceId,message.args);
  if(message.type==='stopping'){host.runtime.notifyStopping(message.args.reason);return {completed:true};}
  if(message.type==='close'){await close();return {completed:true};}
  throw Error('Unknown runtime control message.');
}
function close(){return host.closing??=(async()=>{await host.runtime?.close();})();}
process.on('message',message=>{
  if(message.reply){const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);if(message.ok)waiter.done(message.result);else waiter.fail(Object.assign(Error(message.error),message.detail));return;}
  void handle(message).then(result=>send({reply:true,id:message.id,ok:true,result}),error=>send({reply:true,id:message.id,ok:false,error:error.message,
    detail:{code:error.code,bundleRuntime:error.bundleRuntime,currentStudio:error.currentStudio,expectedStudio:error.expectedStudio,workRequest:error.workRequest,importDiagnostic:error.importDiagnostic}}));
});
process.on('disconnect',()=>{for(const waiter of pending.values())waiter.fail(Error('SAAM orchestrator stopped.'));pending.clear();void close().finally(()=>process.exit());});
