// One orchestrator supervises every selected code root, without importing its operations.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createStudioWindows} from './studio-windows.mjs';
import {selectRuntime,orchestratorContract,contractProblem} from '../core/application/runtime-selection.mjs';

const elapsed=ms=>ms<60000?Math.max(1,Math.round(ms/1000))+' s':ms<3600000?Math.round(ms/60000)+' min':(ms/3600000).toFixed(1)+' h';
// Quit, Update, Stop and Reload confirmations list each running job: runtime, activity and duration.
export function describeJobs(jobs){
  return jobs.map(job=>{
    const started=job.startedAt?new Date(job.startedAt).getTime():job.job?.startedAt;
    const activity=job.job?(job.extension?.id??'workspace')+' parts: '+job.job.stage:(job.kind??job.status??'working')+(job.printId?' '+job.printId:'');
    return '- '+job.runtimeLabel+': '+activity+(started?' for '+elapsed(Date.now()-started):'');
  }).join('\n');
}
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
    if(args.method==='report')return services.report(args.report);
    throw Error('Unknown release service request.');
  }
  async function incoming(runtime,message){
    if(message.type==='window')return windows.register(runtime,message.args);
    if(message.type==='show')return windows.show(message.args.url);
    if(message.type==='clients')return retryClients();
    if(message.type==='service')return service(message.args);
    if(message.type==='release-bundle')return releaseBundle(runtime,message.args.bundleId);
    if(message.type==='route')return route(runtime,message.args);
    if(message.type==='adopt')return adopt(runtime,message.args);
    throw Error('Unknown runtime request.');
  }
  function rpc(runtime,type,args={}){
    if(!runtime.child.connected)return Promise.reject(Error('Cannot reach runtime '+runtime.label+'.'));
    const id=String(++runtime.sequence);
    return new Promise((done,fail)=>{runtime.pending.set(id,{done,fail});runtime.child.send({id,type,args},error=>{if(error){runtime.pending.delete(id);fail(error);}});});
  }
  const orchestrator=()=>({contract:orchestratorContract,label:'the running SAAM ('+services.status().version+')'});
  // openOnStart:false: the open that starts this runtime shows its own window.
  async function launch(selected,{openOnStart=true}={}){
    const problem=contractProblem(orchestrator(),selected);
    if(problem)throw problem;
    const child=spawn(selected.node,[resolve(selected.codeRoot,'packaging/runtime-host.mjs')],{cwd:selected.codeRoot,windowsHide:true,
      stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,SAAM_DATA:paths.home,SAAM_BACKGROUND:'1',SAAM_RUNTIME:JSON.stringify(identity(selected))}});
    const runtime={...selected,child,pending:new Map(),sequence:0,active:0,stderr:''};runtimes.set(runtime.id,runtime);
    child.stdout.on('data',()=>{});child.stderr.on('data',bytes=>{runtime.stderr=(runtime.stderr+bytes.toString()).slice(-8192);});
    child.on('message',message=>{
      if(message.reply){const waiter=runtime.pending.get(message.id);if(!waiter)return;runtime.pending.delete(message.id);if(message.ok)waiter.done(message.result);else waiter.fail(Object.assign(Error(message.error),message.detail));return;}
      // Consented relay diagnostics name the runtime (label carries checkout and commit). A source runtime
      // reports its operations and failed Studio events: enough to tell which code a person was running.
      const named=event=>({...event,runtimeId:runtime.id,runtimeLabel:runtime.label});
      if(message.type==='operation'){for(const observer of operationObservers)observer(named(message.event));return;}
      if(message.type==='event'){if(runtime.id==='installed'||message.event.error)for(const observer of eventObservers)observer(named(message.event));return;}
      void incoming(runtime,message).then(result=>child.connected&&child.send({reply:true,id:message.id,ok:true,result}),error=>child.connected&&child.send({reply:true,id:message.id,ok:false,error:error.message,detail:{code:error.code}}));
    });
    // A runtime stopped on purpose was already removed; its exit must not detach a successor's windows.
    function failed(error){for(const waiter of runtime.pending.values())waiter.fail(error);runtime.pending.clear();if(runtimes.get(runtime.id)===runtime){runtimes.delete(runtime.id);windows.detach(runtime.id);}}
    child.once('error',failed);child.once('exit',code=>failed(Error('Runtime '+runtime.label+' exited ('+code+'). '+runtime.stderr)));
    try{await rpc(runtime,'start',{orchestrator:orchestrator(),autoOpen,openOnStart,service:services.status(),
      stateRoot:resolve(paths.state,'runtimes',runtime.id.replace(':','-')),windows:windows.restore(runtime.id)});return runtime;}
    catch(error){child.kill();throw error;}
  }
  const fallback=await selectRuntime(codeRoot);
  const identity=({id,label,command,codeRoot})=>({id,label,command,codeRoot});
  // Names the runtime a control message reaches: the running one, else the one it would start.
  async function identify(message){
    const target=message.runtimeId??(message.studioInstanceId?windows.runtimeFor(message.studioInstanceId):null);
    const selected=runtimes.get(target)??(message.runtime?await selectRuntime(message.runtime.codeRoot):fallback);
    const {id,label}=runtimes.get(selected.id)??selected;return {id,label};
  }
  // Starting and stopping runtimes is serial. A running runtime keeps its code until an explicit reload.
  function serial(action){const task=selection.tail.then(action);selection.tail=task.then(()=>{},()=>{});return task;}
  function selected(message,launching={}){
    return serial(async()=>{
      if(selection.closing)throw Error('SAAM is stopping.');
      // Runtime roots are validated locally; the client cannot supply an executable.
      const chosen=message.runtime?await selectRuntime(message.runtime.codeRoot):fallback;
      return runtimes.get(chosen.id)??launch(chosen,launching);
    });
  }
  async function sync(runtime){const status=await rpc(runtime,'status');await windows.sync(runtime.id,status.studios);return status;}
  // An explicit take-over closes other runtimes' Studios showing the print (refused while work runs there).
  async function releaseBundle(caller,bundleId){
    for(const other of runtimes.values())if(other!==caller){
      const studio=(await sync(other)).studios.find(item=>item.printId===bundleId);
      if(studio){await rpc(other,'release',{studioInstanceId:studio.instanceId});await sync(other);}
    }
    return {released:true};
  }
  // Studio opened another runtime's print: start that runtime, then move the window to it.
  // The reply comes first, because closing the Studio waits for its open request to finish.
  async function route(caller,{instanceId,printId,owner}){
    const target=await selected({runtime:{codeRoot:owner.codeRoot??paths.app}});
    if(target.id!==owner.id)throw Error(owner.label+' is no longer at its recorded location.');
    if((await sync(target)).studios.some(studio=>studio.printId===printId))throw Object.assign(Error('This print is open in another Studio window of '+target.label+'. Switch to that window.'),{code:'BUNDLE_INSTANCE_BUSY'});
    setImmediate(()=>void moveWindow(caller,target,instanceId,{printId,routed:true}).catch(error=>console.error('Studio window move failed: '+error.message)));
    return {routed:true,runtime:{id:target.id,label:target.label}};
  }
  // A chat in caller needs a view: take an idle window someone is viewing in another runtime,
  // this chat's previous window first. The caller reopens it under the same identity.
  async function adopt(caller,{chatId}){
    const candidates=windows.present().filter(window=>window.runtimeId!==caller.id&&runtimes.has(window.runtimeId))
      .sort((a,b)=>(b.attachment?.ownerId===chatId)-(a.attachment?.ownerId===chatId));
    for(const window of candidates){
      const from=runtimes.get(window.runtimeId),{instanceId,sessionToken}=windows.record(window.instanceId);
      windows.move(instanceId,caller);
      try{await rpc(from,'release',{studioInstanceId:instanceId,idle:true});}
      catch{windows.move(instanceId,from);continue;}
      await sync(from);return {instanceId,sessionToken};
    }
    return null;
  }
  // The window keeps its address, credentials and chat; its Studio reopens in the target runtime.
  // A target that cannot reopen it gives the window back.
  async function moveWindow(from,to,instanceId,{printId,routed=false}){
    const record=windows.record(instanceId);
    windows.move(instanceId,to);
    try{await rpc(from,'release',{studioInstanceId:instanceId,routed});}
    catch(error){windows.move(instanceId,from);throw error;}
    try{await rpc(to,'restore',{windows:[{...record,printId}]});}
    catch(error){windows.move(instanceId,from);await rpc(from,'restore',{windows:[record]});throw error;}
    finally{await sync(to);await sync(from);}
  }
  // Where an open naming no Studio or runtime goes: the most recently focused window
  // someone views, in any runtime; else the most recent window's runtime, which the
  // open starts if needed (one whose code is gone or incompatible is passed over);
  // else the default runtime.
  async function recentWindow(){
    const windowsByRecency=windows.recent(),shown=windowsByRecency.find(window=>window.shown&&runtimes.has(window.runtimeId));
    if(shown)return {codeRoot:runtimes.get(shown.runtimeId).codeRoot,studioInstanceId:shown.instanceId};
    for(const window of windowsByRecency){
      const chosen=window.codeRoot?await selectRuntime(window.codeRoot).catch(()=>null):null;
      if(chosen&&!contractProblem(orchestrator(),chosen))return {codeRoot:chosen.codeRoot,studioInstanceId:window.closed?undefined:window.instanceId};
    }
    return {};
  }
  // display:'caller' marks the person's own launch or tray click: the answer says how
  // that caller shows the window (studio-windows display), and nothing here opens a browser.
  async function command(message){
    const opening=message.command==='open'||message.command==='new-instance',callerShows=opening&&message.display==='caller';
    const named=message.studioInstanceId||message.args?.studioInstanceId||undefined;
    const recent=opening&&!message.runtimeId&&!named&&!message.runtime?await recentWindow():{};
    const target=message.runtimeId??(message.studioInstanceId?windows.runtimeFor(message.studioInstanceId):null);
    const candidate=target?runtimes.get(target):null;
    const launching={openOnStart:!callerShows};
    const runtime=target?(candidate?await selected({runtime:{codeRoot:candidate.codeRoot}},launching):null)
      :await selected(recent.codeRoot?{runtime:{codeRoot:recent.codeRoot}}:message,launching);
    if(!runtime)throw Error('The selected runtime stopped. Reconnect from its checkout.');
    runtime.active++;
    try{
      if(opening){
        const opened=await rpc(runtime,'open',{studioInstanceId:named??(message.command==='open'?recent.studioInstanceId:undefined),newInstance:message.command==='new-instance',dispatch:!callerShows});
        return {ok:true,...opened,...(callerShows?{display:windows.display(opened.url)}:{})};
      }
      return await rpc(runtime,'command',message);
    }finally{runtime.active--;if(runtime.child.connected)await sync(runtime);}
  }
  async function status(){
    const states=await Promise.all([...runtimes.values()].map(async runtime=>({runtime,status:await sync(runtime)})));
    return {runtimes:states.map(({runtime})=>({id:runtime.id,label:runtime.label,codeRoot:runtime.codeRoot,pid:runtime.child.pid})),
      jobs:states.flatMap(({runtime,status})=>status.jobs.map(job=>({...job,runtimeId:runtime.id,runtimeLabel:runtime.label}))),
      studios:states.flatMap(({runtime,status})=>status.studios.map(studio=>({...studio,runtimeId:runtime.id,runtimeLabel:runtime.label})))};
  }
  // A chat's turn end goes to every running runtime, since any may hold the chat; none is started.
  async function endTurn(chatId){
    const counts=await Promise.all([...runtimes.values()].map(runtime=>rpc(runtime,'turn-ended',{chatId})));
    return {handedBack:counts.reduce((total,count)=>total+count.handedBack,0)};
  }
  async function notifyStopping(reason){await Promise.all([...runtimes.values()].map(runtime=>rpc(runtime,'stopping',{reason})));}
  // Stops the runtime a message names; its windows keep their addresses for the next start.
  // Closing waits for the runtime's Studios, which may themselves be asking to start a runtime.
  async function halt(message,reason){
    const removed=await serial(async()=>{
      const id=message.runtimeId??(await selectRuntime(message.runtime?.codeRoot??codeRoot)).id,runtime=runtimes.get(id);
      if(!runtime)return {stopped:false,runtimeId:id};
      const current=await sync(runtime);
      if((current.jobs.length||runtime.active||current.active)&&!message.force){
        const jobs=current.jobs.map(job=>({...job,runtimeId:runtime.id,runtimeLabel:runtime.label}));
        return {confirmationRequired:true,jobs,message:(reason==='restart'?'Reloading':'Stopping')+' '+runtime.label+' cancels its active work:\n'+(describeJobs(jobs)||'- agent operations in progress')};
      }
      await rpc(runtime,'stopping',{reason});windows.detach(runtime.id);runtimes.delete(runtime.id);
      return {stopped:true,runtime};
    });
    if(!removed.stopped)return removed;
    const {runtime}=removed;
    try{await rpc(runtime,'close');}finally{if(runtime.child.connected)runtime.child.disconnect();}
    return {stopped:true,runtimeId:runtime.id,codeRoot:runtime.codeRoot};
  }
  const stopRuntime=message=>halt(message,'runtime-stop');
  // The only way a running runtime gets newer code; its windows reopen with it.
  async function reloadRuntime(message){
    const halted=await halt(message,'restart');
    if(halted.confirmationRequired)return halted;
    const runtime=await selected({runtime:{codeRoot:halted.codeRoot??message.runtime?.codeRoot??codeRoot}});
    return {reloaded:true,runtime:{id:runtime.id,label:runtime.label}};
  }
  async function close(){selection.closing=true;await selection.tail;await Promise.all([...runtimes.values()].map(async runtime=>{try{await rpc(runtime,'close');}finally{if(runtime.child.connected)runtime.child.disconnect();}}));await windows.close();runtimes.clear();}
  return {command,identify,status,endTurn,stopRuntime,reloadRuntime,notifyStopping,close,runningJobs:async()=>(await status()).jobs,
    observeEvents(observer){eventObservers.add(observer);return()=>eventObservers.delete(observer);},
    observeOperations(observer){operationObservers.add(observer);return()=>operationObservers.delete(observer);}};
}
