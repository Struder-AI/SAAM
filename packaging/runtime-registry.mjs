// One orchestrator supervises every selected code root, without importing its operations.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createStudioWindows} from './studio-windows.mjs';
import {selectRuntime,orchestratorContract} from '../core/application/runtime-selection.mjs';

export async function createRuntimeRegistry({paths,autoOpen,services,retryClients,codeRoot}){
  const windows=await createStudioWindows(paths.state,{autoOpen}),runtimes=new Map(),selection={tail:Promise.resolve(),closing:false};
  const operationObservers=new Set(),eventObservers=new Set();
  async function service(args){
    if(args.method==='status')return services.status();
    if(args.method==='activate')return services.activate(args.invite);
    if(args.method==='dismiss')return services.dismissFirstRun();
    if(args.method==='check-update'){await services.checkUpdate();return services.status();}
    if(args.method==='update')return services.update(args.options);
    if(args.method==='quit')return services.quit(args.options);
    throw Error('Unknown release service request.');
  }
  async function incoming(runtime,message){
    if(message.type==='window')return windows.register(runtime.id,message.args);
    if(message.type==='show')return windows.show(message.args.url);
    if(message.type==='clients')return retryClients();
    if(message.type==='service')return service(message.args);
    throw Error('Unknown runtime request.');
  }
  function rpc(runtime,type,args={}){
    if(!runtime.child.connected)return Promise.reject(Error('Cannot reach runtime '+runtime.label+'.'));
    const id=String(++runtime.sequence);
    return new Promise((done,fail)=>{runtime.pending.set(id,{done,fail});runtime.child.send({id,type,args},error=>{if(error){runtime.pending.delete(id);fail(error);}});});
  }
  async function launch(selected){
    const child=spawn(selected.node,[resolve(selected.codeRoot,'packaging/runtime-host.mjs')],{cwd:selected.codeRoot,windowsHide:true,
      stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,SAAM_DATA:paths.home,SAAM_BACKGROUND:'1'}});
    const runtime={...selected,child,pending:new Map(),sequence:0,active:0,stderr:''};runtimes.set(runtime.id,runtime);
    child.stdout.on('data',()=>{});child.stderr.on('data',bytes=>{runtime.stderr=(runtime.stderr+bytes.toString()).slice(-8192);});
    child.on('message',message=>{
      if(message.reply){const waiter=runtime.pending.get(message.id);if(!waiter)return;runtime.pending.delete(message.id);if(message.ok)waiter.done(message.result);else waiter.fail(Object.assign(Error(message.error),message.detail));return;}
      if(message.type==='operation'){for(const observer of operationObservers)observer({...message.event,runtimeId:runtime.id});return;}
      if(message.type==='event'){for(const observer of eventObservers)observer({...message.event,runtimeId:runtime.id});return;}
      void incoming(runtime,message).then(result=>child.connected&&child.send({reply:true,id:message.id,ok:true,result}),error=>child.connected&&child.send({reply:true,id:message.id,ok:false,error:error.message}));
    });
    function failed(error){windows.detach(runtime.id);for(const waiter of runtime.pending.values())waiter.fail(error);runtime.pending.clear();if(runtimes.get(runtime.id)===runtime)runtimes.delete(runtime.id);}
    child.once('error',failed);child.once('exit',code=>failed(Error('Runtime '+runtime.label+' exited ('+code+'). '+runtime.stderr)));
    try{await rpc(runtime,'start',{contract:orchestratorContract,runtimeId:runtime.id,label:runtime.label,fingerprint:runtime.fingerprint,autoOpen,service:services.status(),
      stateRoot:resolve(paths.state,'runtimes',runtime.id.replace(':','-')),windows:windows.restore(runtime.id)});return runtime;}
    catch(error){child.kill();throw error;}
  }
  const fallback=await selectRuntime(codeRoot);
  async function ensure(requested){
    if(selection.closing)throw Error('SAAM is stopping.');
    const selected=requested?await selectRuntime(requested.codeRoot):fallback;
    // Runtime roots are validated locally; the client cannot supply a stale fingerprint or executable.
    const running=runtimes.get(selected.id);
    if(!running)return launch(selected);
    if(running.fingerprint===selected.fingerprint)return running;
    const current=await rpc(running,'status');await windows.sync(running.id,current.studios);
    if(running.active||current.active||current.jobs.length)throw Object.assign(Error('Source changed while '+running.label+' has active work. Finish or cancel it before reloading.'),{code:'RUNTIME_CODE_CHANGED',jobs:current.jobs});
    await rpc(running,'stopping',{reason:'restart'});await rpc(running,'close');running.child.disconnect();windows.detach(running.id);runtimes.delete(running.id);
    return launch(selected);
  }
  async function selected(message){
    const task=selection.tail.then(()=>ensure(message.runtime));selection.tail=task.then(()=>{},()=>{});return task;
  }
  async function sync(runtime){const status=await rpc(runtime,'status');await windows.sync(runtime.id,status.studios);return status;}
  async function command(message){
    const target=message.runtimeId??(message.studioInstanceId?windows.runtimeFor(message.studioInstanceId):null);
    const candidate=target?runtimes.get(target):null;
    const runtime=target?(candidate?await selected({runtime:{codeRoot:candidate.codeRoot}}):null):await selected(message);
    if(!runtime)throw Error('The selected runtime stopped. Reconnect from its checkout.');
    runtime.active++;
    try{
      if(message.operation==='capture_bundle'&&message.bundleId){
        for(const other of runtimes.values())if(other!==runtime){
          const status=await sync(other),studio=status.studios.find(item=>item.printId===message.bundleId);
          if(studio){await rpc(other,'release',{studioInstanceId:studio.instanceId});await sync(other);}
        }
      }
      if(message.command==='open'||message.command==='new-instance')return {ok:true,...await rpc(runtime,'open',{studioInstanceId:message.studioInstanceId??message.args?.studioInstanceId,newInstance:message.command==='new-instance'})};
      return await rpc(runtime,'command',message);
    }finally{runtime.active--;if(runtime.child.connected)await sync(runtime);}
  }
  async function status(){
    const states=await Promise.all([...runtimes.values()].map(async runtime=>({runtime,status:await sync(runtime)})));
    return {runtimes:states.map(({runtime})=>({id:runtime.id,label:runtime.label,codeRoot:runtime.codeRoot,pid:runtime.child.pid})),
      jobs:states.flatMap(({runtime,status})=>status.jobs.map(job=>({...job,runtimeId:runtime.id,runtimeLabel:runtime.label}))),
      studios:states.flatMap(({runtime,status})=>status.studios.map(studio=>({...studio,runtimeId:runtime.id,runtimeLabel:runtime.label})))};
  }
  async function notifyStopping(reason){await Promise.all([...runtimes.values()].map(runtime=>rpc(runtime,'stopping',{reason})));}
  async function stopRuntime(message){
    const identity=message.runtimeId?null:await selectRuntime(message.runtime?.codeRoot??codeRoot);
    const runtime=runtimes.get(message.runtimeId??identity.id);
    if(!runtime)return {stopped:false};
    const current=await sync(runtime);
    if((current.jobs.length||runtime.active||current.active)&&!message.force)return {confirmationRequired:true,jobs:current.jobs,message:'Stopping this runtime cancels active work.'};
    await rpc(runtime,'stopping',{reason:'runtime-stop'});await rpc(runtime,'close');runtime.child.disconnect();windows.detach(runtime.id);runtimes.delete(runtime.id);return {stopped:true,runtimeId:runtime.id};
  }
  async function close(){selection.closing=true;await selection.tail;await Promise.all([...runtimes.values()].map(async runtime=>{try{await rpc(runtime,'close');}finally{if(runtime.child.connected)runtime.child.disconnect();}}));await windows.close();runtimes.clear();}
  return {command,status,stopRuntime,notifyStopping,close,runningJobs:async()=>(await status()).jobs,
    observeEvents(observer){eventObservers.add(observer);return()=>eventObservers.delete(observer);},
    observeOperations(observer){operationObservers.add(observer);return()=>operationObservers.delete(observer);}};
}
