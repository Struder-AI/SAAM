// One orchestrator supervises every selected code root, without importing its operations.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {controlProbeMs} from '../core/application/control.mjs';
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
  const windows=createStudioWindows({autoOpen}),runtimes=new Map(),selection={tail:Promise.resolve(),closing:false};
  const operationObservers=new Set(),eventObservers=new Set();
  async function service(runtime,args){
    if(args.method==='status')return {...services.status(),quitScope:quitScope()};
    if(args.method==='activate')return services.activate(args.invite);
    if(args.method==='dismiss')return services.dismissFirstRun();
    if(args.method==='check-update'){await services.checkUpdate();return services.status();}
    if(args.method==='update')return services.update(args.options);
    if(args.method==='quit')return quitFrom(runtime,args.options);
    if(args.method==='report')return services.report(args.report);
    throw Error('Unknown release service request.');
  }
  async function incoming(runtime,message){
    if(selection.closing&&['window','show','route','adopt'].includes(message.type))throw Error('SAAM is stopping.');
    if(message.type==='window')return windows.register(runtime,message.args);
    if(message.type==='show')return windows.show(message.args.url,{visibility:message.args.visibility});
    if(message.type==='clients')return retryClients();
    if(message.type==='service')return service(runtime,message.args);
    if(message.type==='release-bundle')return releaseBundle(runtime,message.args.bundleId);
    if(message.type==='route')return route(runtime,message.args);
    if(message.type==='adopt')return adopt(runtime,message.args);
    throw Error('Unknown runtime request.');
  }
  function rpc(runtime,type,args={},waitMs){
    if(!runtime.child.connected)return Promise.reject(Error('Cannot reach runtime '+runtime.label+'.'));
    const id=String(++runtime.sequence);
    return new Promise((done,fail)=>{
      const waiting={timer:null};
      const finish=(answer,value)=>{clearTimeout(waiting.timer);runtime.pending.delete(id);answer(value);};
      runtime.pending.set(id,{done:value=>finish(done,value),fail:error=>finish(fail,error)});
      if(waitMs!==undefined)waiting.timer=setTimeout(()=>finish(fail,Object.assign(Error('Runtime '+runtime.label+' did not answer '+type+'.'),{code:'RUNTIME_TIMEOUT'})),waitMs);
      runtime.child.send({id,type,args},error=>{if(error)finish(fail,error);});
    });
  }
  // Shutdown owns its children: acknowledge, then terminate an unresponsive child.
  function closeRuntime(runtime){return runtime.closing??=(async()=>{
    const cleanup={error:null};
    try{await rpc(runtime,'close',{},controlProbeMs);}catch{/* A failed acknowledgement cannot veto Quit. */}
    try{if(runtime.child.connected)runtime.child.disconnect();}catch(error){cleanup.error=error;}
    if(runtime.child.exitCode!==null||runtime.child.signalCode!==null){if(cleanup.error)throw cleanup.error;return;}
    await new Promise((done,fail)=>{
      const termination={timer:null};
      const finished=()=>{clearTimeout(termination.timer);runtime.child.removeListener('exit',finished);if(cleanup.error)fail(cleanup.error);else done();};
      runtime.child.once('exit',finished);
      // Give a cooperative close its exit turn, then use this same owner's child handle.
      const kill=signal=>{try{runtime.child.kill(signal);}catch(error){cleanup.error??=error;}};
      termination.timer=setTimeout(()=>{kill();termination.timer=setTimeout(()=>{kill('SIGKILL');finished();},controlProbeMs);},controlProbeMs);
    });
  })();}
  const orchestrator=()=>({contract:orchestratorContract,label:'the running SAAM ('+services.status().version+')'});
  async function launch(selected){
    if(selection.closing)throw Error('SAAM is stopping.');
    const problem=contractProblem(orchestrator(),selected);
    if(problem)throw problem;
    const child=spawn(selected.node,[resolve(selected.codeRoot,'packaging/runtime-host.mjs')],{cwd:selected.codeRoot,windowsHide:true,
      stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,SAAM_RUNTIME:JSON.stringify(identity(selected))}});
    // A runtime is starting until its start answers; until then it holds no Studio, job or chat.
    const runtime={...selected,child,pending:new Map(),sequence:0,active:0,stderr:'',starting:true,closing:null};runtimes.set(runtime.id,runtime);
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
    // A runtime starts with no Studio of its own: every window opens on request (openOnStart:false
    // tells runtimes before 0.3.7, which opened one by default).
    try{await rpc(runtime,'start',{orchestrator:orchestrator(),autoOpen,openOnStart:false,service:services.status(),
      stateRoot:resolve(paths.state,'runtimes',runtime.id.replaceAll(':','-')),windows:windows.restore(runtime.id)});if(selection.closing)throw Error('SAAM is stopping.');runtime.starting=false;return runtime;}
    catch(error){await closeRuntime(runtime).catch(cleanup=>{error.message+=' Runtime cleanup: '+cleanup.message;});throw error;}
  }
  const fallback=await selectRuntime(codeRoot);
  const identity=({id,label,studioTitle,command,codeRoot})=>({id,label,studioTitle,command,codeRoot});
  // Names the runtime a control message reaches: the running one, else the one it would start.
  async function identify(message){
    const target=message.runtimeId??(message.studioInstanceId?windows.runtimeFor(message.studioInstanceId):null);
    const selected=runtimes.get(target)??(message.runtime?await selectRuntime(message.runtime.codeRoot):fallback);
    const {id,label}=runtimes.get(selected.id)??selected;return {id,label};
  }
  // Starting and stopping runtimes is serial. A running runtime keeps its code until an explicit reload.
  function serial(action){const task=selection.tail.then(action);selection.tail=task.then(()=>{},()=>{});return task;}
  function selected(message){
    return serial(async()=>{
      if(selection.closing)throw Error('SAAM is stopping.');
      // Runtime roots are validated locally; the client cannot supply an executable.
      const chosen=message.runtime?await selectRuntime(message.runtime.codeRoot):fallback;
      if(message.runtime?.id&&message.runtime.id!==chosen.id)throw Error('The selected runtime is no longer at its recorded code location. Reconnect with an explicit target.');
      return runtimes.get(chosen.id)??launch(chosen);
    });
  }
  async function inspect(runtime){const status=await rpc(runtime,'status',{},controlProbeMs);windows.reconcile(runtime.id,status.studios);return status;}
  // An explicit take-over closes other runtimes' Studios showing the print (refused while work runs there).
  async function releaseBundle(caller,bundleId){
    for(const other of runtimes.values())if(other!==caller){
      const studio=(await inspect(other)).studios.find(item=>item.printId===bundleId);
      if(studio){await rpc(other,'release',{studioInstanceId:studio.instanceId});await inspect(other);}
    }
    return {released:true};
  }
  // Studio opened another runtime's print: start that runtime, then move the window to it.
  // The reply comes first, because closing the Studio waits for its open request to finish.
  async function route(caller,{instanceId,printId,owner}){
    const target=await selected({runtime:{codeRoot:owner.codeRoot??paths.app}});
    if(target.id!==owner.id)throw Error(owner.label+' is no longer at its recorded location.');
    if((await inspect(target)).studios.some(studio=>studio.printId===printId))throw Object.assign(Error('This print is open in another Studio window of '+target.label+'. Switch to that window.'),{code:'BUNDLE_INSTANCE_BUSY'});
    setImmediate(()=>void moveWindow(caller,target,instanceId,{printId,routed:true}).catch(error=>console.error('Studio window move failed: '+error.message)));
    return {routed:true,runtime:{id:target.id,label:target.label}};
  }
  // A chat in caller needs a view: take an idle window someone is viewing in another runtime,
  // this chat's previous window first. The caller reopens it under the same identity.
  async function adopt(caller,{chatId}){
    const candidates=windows.present().filter(window=>window.visibility!=='hidden'&&window.runtimeId!==caller.id&&runtimes.has(window.runtimeId))
      .sort((a,b)=>(b.attachment?.ownerId===chatId)-(a.attachment?.ownerId===chatId));
    for(const window of candidates){
      const from=runtimes.get(window.runtimeId),{instanceId,sessionToken}=windows.record(window.instanceId);
      windows.move(instanceId,caller);
      try{await rpc(from,'release',{studioInstanceId:instanceId,idle:true});}
      catch{windows.move(instanceId,from);continue;}
      await inspect(from);return {instanceId,sessionToken};
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
    finally{await inspect(to);await inspect(from);}
  }
  // An untargeted open uses the installed default; its runtime reuses a visible Studio.
  // display:'caller' marks the person's own launch or tray click: the answer says how
  // that caller shows the window (studio-windows display), and nothing here opens a browser.
  // Only an open or an operation starts a runtime. saam answers help without SAAM, so a
  // help reaching here comes from a checkout older than this orchestrator.
  async function command(message){
    const opening=message.command==='open'||message.command==='new-instance',callerShows=opening&&message.display==='caller';
    if(!opening&&!['call','wait','start-tour'].includes(message.command))throw Error('Unknown SAAM command '+message.command+'. Use saam help; a checkout older than the running SAAM merges the current source first.');
    const named=message.studioInstanceId||message.args?.studioInstanceId||undefined;
    if(opening&&named&&!windows.runtimeFor(named))throw Error('That Studio window is no longer registered.');
    if(opening&&message.runtimeId&&named&&windows.runtimeFor(named)!==message.runtimeId)throw Error('The Studio and runtime targets do not match.');
    const target=message.runtimeId??(opening&&named?windows.runtimeFor(named):null);
    const candidate=target?runtimes.get(target)??windows.retained().find(window=>window.runtimeId===target):null;
    const runtime=target?(candidate?await selected({runtime:{id:target,codeRoot:candidate.codeRoot}}):null)
      :await selected(message);
    if(!runtime)throw Error('The selected runtime stopped. Reconnect from its checkout.');
    runtime.active++;
    try{
      if(opening){
        const opened=await rpc(runtime,'open',{studioInstanceId:named,newInstance:message.command==='new-instance',visibility:message.visibility??'visible',dispatch:!callerShows});
        return {ok:true,...opened,...(callerShows?{display:windows.display(opened.url)}:{})};
      }
      return await rpc(runtime,'command',message);
    }finally{runtime.active--;if(runtime.child.connected)await inspect(runtime);}
  }
  async function status(){
    const states=await Promise.all([...runtimes.values()].map(async runtime=>({runtime,status:runtime.starting?{jobs:[],studios:[]}:await inspect(runtime)})));
    const dormant=windows.retained().filter(window=>!runtimes.has(window.runtimeId));
    const dormantRuntimes=[...new Map(dormant.map(window=>[window.runtimeId,{id:window.runtimeId,label:window.runtimeLabel??'Retained '+window.codeRoot,codeRoot:window.codeRoot,dormant:true}])).values()];
    return {runtimes:[...states.map(({runtime})=>({id:runtime.id,label:runtime.label,codeRoot:runtime.codeRoot,pid:runtime.child.pid,...(runtime.starting&&{starting:true})})),...dormantRuntimes],
      jobs:states.flatMap(({runtime,status})=>status.jobs.map(job=>({...job,runtimeId:runtime.id,runtimeLabel:runtime.label}))),
      studios:[...states.flatMap(({runtime,status})=>status.studios.map(studio=>({...studio,runtimeId:runtime.id,runtimeLabel:runtime.label}))),...dormant.map(window=>({instanceId:window.instanceId,printId:window.printId,attachment:window.attachment,visibility:window.visibility??'visible',url:window.url,runtimeId:window.runtimeId,runtimeLabel:window.runtimeLabel??'Retained '+window.codeRoot,dormant:true}))]};
  }
  // A chat's turn end goes to every started runtime, since any may hold the chat; none is started.
  async function endTurn(chatId,reason){
    await Promise.all([...runtimes.values()].filter(runtime=>!runtime.starting).map(runtime=>rpc(runtime,'end-turn',{chatId,reason})));
  }
  // A starting runtime holds nothing to warn; it exits when the orchestrator disconnects.
  async function notifyStopping(reason){await Promise.allSettled([...runtimes.values()].filter(runtime=>!runtime.starting).map(runtime=>rpc(runtime,'stopping',{reason},controlProbeMs)));}
  // A runtime's active work as a confirmation to stop or reload it; null when it is idle.
  async function activeWork(runtime,reason){
    const current=await inspect(runtime);
    if(!current.jobs.length&&!runtime.active&&!current.active)return null;
    const jobs=current.jobs.map(job=>({...job,runtimeId:runtime.id,runtimeLabel:runtime.label}));
    return {confirmationRequired:true,jobs,message:(reason==='restart'?'Reloading':'Stopping')+' '+runtime.label+' cancels its active work:\n'+(describeJobs(jobs)||'- agent operations in progress')};
  }
  // Stops the runtime a message names. A reload keeps its windows for the new process; a stop retires them.
  // Closing waits for the runtime's Studios, which may themselves be asking to start a runtime.
  async function halt(message,reason){
    const removed=await serial(async()=>{
      const id=message.runtimeId??(await selectRuntime(message.runtime?.codeRoot??codeRoot)).id,runtime=runtimes.get(id);
      if(!runtime){
        const retained=windows.retained().find(window=>window.runtimeId===id);
        if(message.runtimeId&&!retained)throw Error('That runtime is no longer registered. Reconnect with an explicit code target.');
        return {stopped:false,runtimeId:id,codeRoot:retained?.codeRoot??message.runtime?.codeRoot??codeRoot};
      }
      const work=message.force?null:await activeWork(runtime,reason);
      if(work)return work;
      await rpc(runtime,'stopping',{reason},controlProbeMs).catch(()=>{});
      if(reason==='restart')windows.detach(runtime.id);else windows.retireRuntime(runtime.id);
      runtimes.delete(runtime.id);
      return {stopped:true,runtime};
    });
    if(!removed.stopped)return removed;
    const {runtime}=removed;
    await closeRuntime(runtime);
    return {stopped:true,runtimeId:runtime.id,codeRoot:runtime.codeRoot};
  }
  const stopRuntime=message=>halt(message,'runtime-stop');
  // Studio's Quit: while other runtimes run, it stops only its window's runtime; in the only running
  // runtime it quits SAAM, as the tray does. scope is what the person confirmed; when this moment's
  // answer differs, the person is asked again.
  const quitScope=()=>runtimes.size>1?'runtime':'saam';
  const quitQuestion=(runtime,scope)=>scope==='saam'?'No other SAAM runtime is running now, so Quit closes SAAM and its tray. Quit SAAM?'
    :'Other SAAM runtimes are running now, so Quit stops only '+runtime.label+'; SAAM and its tray keep running. Stop it?';
  async function quitFrom(runtime,{force=false,scope}={}){
    const actual=quitScope();
    if(scope!==undefined&&scope!==actual)return {confirmationRequired:true,scope:actual,message:quitQuestion(runtime,actual)};
    if(actual==='saam')return {...await services.quit({force}),scope:actual};
    const work=force?null:await activeWork(runtime,'runtime-stop');
    if(work)return {...work,scope:actual,message:work.message+'\nStop it anyway?'};
    // The answer reaches the window first: closing the runtime waits for this request to finish.
    setImmediate(()=>void halt({runtimeId:runtime.id,force:true},'runtime-stop').catch(error=>console.error('Stopping '+runtime.label+' failed: '+error.message)));
    return {quitting:true,scope:actual};
  }
  // The only way a running runtime gets newer code; its windows reopen with it.
  async function reloadRuntime(message){
    const halted=await halt(message,'restart');
    if(halted.confirmationRequired)return halted;
    const runtime=await selected({runtime:{id:halted.runtimeId,codeRoot:halted.codeRoot}});
    return {reloaded:true,runtime:{id:runtime.id,label:runtime.label}};
  }
  // Stop exactly the selected Studio, leaving other sessions and its runtime alive.
  function stopSession(message){
    return serial(async()=>{
      const instanceId=message.studioInstanceId??message.args?.studioInstanceId;
      if(!instanceId)throw Error('Choose a Studio instance to stop.');
      const runtime=runtimes.get(windows.runtimeFor(instanceId));
      if(!runtime)return windows.retire(instanceId);
      const result=await rpc(runtime,'release',{studioInstanceId:instanceId});
      await inspect(runtime);return {stopped:result.completed,studioInstanceId:instanceId};
    });
  }
  async function close(){selection.closing=true;const outcomes=await Promise.allSettled([...runtimes.values()].map(closeRuntime));await windows.close();runtimes.clear();const failed=outcomes.find(outcome=>outcome.status==='rejected');if(failed)throw failed.reason;}
  // Job inspection is a read: window persistence is never a prerequisite for Quit.
  async function runningJobs(){return (await Promise.all([...runtimes.values()].filter(runtime=>!runtime.starting).map(async runtime=>{
    try{return (await inspect(runtime)).jobs.map(job=>({...job,runtimeId:runtime.id,runtimeLabel:runtime.label}));}
    catch{return [{runtimeId:runtime.id,runtimeLabel:runtime.label,kind:'unresponsive runtime (active work unknown)'}];}
  }))).flat();}
  return {command,identify,status,endTurn,stopRuntime,stopSession,reloadRuntime,notifyStopping,close,runningJobs,
    observeEvents(observer){eventObservers.add(observer);return()=>eventObservers.delete(observer);},
    observeOperations(observer){operationObservers.add(observer);return()=>operationObservers.delete(observer);}};
}
