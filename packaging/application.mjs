// One ready local application owns commands, Studios, jobs and release services.
import {writeFile,unlink,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {userInfo} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRuntimeRegistry,describeJobs} from './runtime-registry.mjs';
import {migrateRuntimeState,restoreRuntimeState} from './runtime-state.mjs';
import {homePaths} from '../core/application/home.mjs';
import {migrateLocalData,restoreLocalData} from '../core/application/home-layout.mjs';
import {applicationPort,readInstance,controlRequest,leaseHolder} from '../core/application/control.mjs';
import {orchestratorContract} from '../core/application/runtime-selection.mjs';
import {createReleaseService,releaseConfiguration} from './release-service.mjs';
import {installUpdate} from './update.mjs';
import {startTray} from './tray.mjs';
import {setupClients,writeHomeGuidance} from './client-setup.mjs';
import {replaceFile} from '../core/file-write.mjs';
import {createDiagnosticReports} from '../core/application/diagnostics.mjs';
import {cleanupTemporaryWorkspaces} from '../core/application/temporary-workspace.mjs';

async function jsonBody(request){
  const chunks=[],size={bytes:0};
  for await(const chunk of request){size.bytes+=chunk.length;if(size.bytes>128*1024*1024)throw Error('SAAM command input exceeds 128 MiB.');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a command object.');
  return value;
}
function respond(response,value,status=200){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
export async function startApplication({autoOpen=true,openOnStart=true,tray=true}={}){
  const paths=homePaths(),codeRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const reports=createDiagnosticReports({home:paths.home});
  const previous=await readInstance();
  if(previous?.user&&previous.user!==userInfo().username)throw Error('SAAM is running for '+previous.user+'.');
  // A launch is the person's own: this process shows the Studio the open answers (launch.mjs).
  const opening=openOnStart?{command:'open',display:'caller'}:{command:'status'};
  const state={runtime:null,services:null,tray:null,control:null,stopping:null,migration:null,runtimeMigration:null},token=randomBytes(24).toString('hex');
  const report=async(event,options={})=>{
    if(state.services)return state.services.recordDiagnostic(event,options);
    if(options.firstRun)await reports.firstRun(event,{complete:options.complete}).catch(()=>{});
    if(options.error)await reports.networkIssue(event,options.error).catch(()=>{});
  };
  const instanceFile=resolve(paths.state,'instance.json');
  const config=await releaseConfiguration(),instanceId=randomBytes(16).toString('hex');
  // The release service reads only its state file and configuration. It opens once
  // this process holds the home's lease, or to report a failure to obtain it.
  const openService=async()=>state.services??=await createReleaseService({...config,instanceId,statePath:resolve(paths.state,'release-service.json'),watchState:true,reports,
    update:config.platform&&config.updateHost?async(offered,{force=false}={})=>{
      const jobs=await state.runtime.runningJobs();
      if(jobs.length&&!force)return {confirmationRequired:true,jobs,message:'Updating SAAM cancels these running jobs:\n'+describeJobs(jobs)};
      const result=await installUpdate(offered,{...config,report:(event,options)=>report(event,options)});await state.runtime.notifyStopping('update');later();return result;
    }:null,
    quit:({force=false}={})=>quit(force)});
  // Ending reports its outcome (stopped, stop failed or startup failed), then
  // closes the release service, which delivers what it already accepted.
  function end(failure=null){return state.stopping??=(async()=>{
    if(failure)await openService().catch(()=>{});
    state.services?.observeRuntime(null);
    let cleanupError=null;
    try{
      state.tray?.stop();await state.runtime?.close();
      if(state.runtimeMigration){await restoreRuntimeState(state.runtimeMigration);state.runtimeMigration=null;}
      if(state.migration){
        try{await restoreLocalData(state.migration);state.migration=null;}
        catch(error){cleanupError=error;await report({kind:'startup-data-restore-failed',error:error.message},{firstRun:true}).catch(()=>{});}
      }
      if(state.control?.listening){const closed=new Promise(done=>state.control.close(done));state.control.closeAllConnections();await closed;}
      const current=JSON.parse(await readFile(instanceFile,'utf8').catch(()=>'{}'));
      if(current.token===token)await unlink(instanceFile).catch(()=>{});
    }catch(error){cleanupError=error;}
    const outcome=failure?{kind:'application-startup-failed',error:failure.message,...(cleanupError?{cleanupError:cleanupError.message}:{})}
      :cleanupError?{kind:'application-stop-failed',error:cleanupError.message}:{kind:'application-stopped'};
    await report(outcome,failure?{firstRun:true,complete:true,error:failure}:{}).catch(()=>{});
    await state.services?.close();
    if(cleanupError)throw cleanupError;
  })();}
  const stop=()=>end();
  const later=()=>{setTimeout(()=>void stop().catch(()=>{}),250);};
  async function quit(force=false){
    const jobs=await state.runtime.runningJobs();
    if(jobs.length&&!force)return {confirmationRequired:true,jobs,message:'Quitting SAAM cancels these running jobs:\n'+describeJobs(jobs)+'\nQuit anyway?'};
    await state.runtime.notifyStopping('quit');later();return {quitting:true};
  }
  async function retryClients(){return setupClients({home:paths.home});}

  try{
    // The OS listener is the exclusive application lease, including during startup.
    state.control=createServer(async(request,response)=>{
      if(request.method!=='POST'||request.url!=='/control'||request.headers['x-saam-control']!==token||request.headers.origin){respond(response,{ok:false,error:'Invalid local control request.'},403);return;}
      const named=async message=>({runtime:await state.runtime?.identify(message).catch(()=>undefined)});
      let message={};
      try{message=await jsonBody(request);respond(response,{...await command(message),...await named(message)});}
      catch(error){respond(response,{ok:false,error:error.message,code:error.code??null,...await named(message),...(error.code==='STUDIO_TARGET_CHANGED'?{currentStudio:error.currentStudio,expectedStudio:error.expectedStudio}:{}),...(error.workRequest?{workRequest:error.workRequest}:{}),...(error.importDiagnostic?{importDiagnostic:error.importDiagnostic}:{}),...(error.bundleRuntime?{bundleRuntime:error.bundleRuntime}:{})},400);}
    });
    try{await new Promise((done,fail)=>{state.control.once('error',fail);state.control.listen(applicationPort(paths.home),'127.0.0.1',done);});}
    catch(error){
      if(error.code!=='EADDRINUSE')throw error;
      // Another application holds the lease: wait while it lives and is starting, then
      // ask it. This process never becomes a second application.
      for(;;){
        const running=await readInstance();
        if(running){
          try{const answer=await controlRequest(running,opening,{waitMs:null});return {existing:true,opened:openOnStart?answer:null};}
          catch(failure){if(failure.result&&failure.status!==403)throw failure;/* A record from before the holder's start. */}
        }
        const holder=await leaseHolder(applicationPort(paths.home));
        if(holder==='none')throw Error('the SAAM already starting stopped before it was ready. Open SAAM again.');
        if(holder==='other')throw Error('Another program uses the SAAM control port '+applicationPort(paths.home)+'. Close it, then open SAAM again.');
        await new Promise(done=>setTimeout(done,200));
      }
    }
    await openService();
    await report({kind:'application-starting'},{firstRun:true});
    state.migration=await migrateLocalData(paths.home);
    await cleanupTemporaryWorkspaces();
    await writeHomeGuidance(paths.home);
    state.runtimeMigration=await migrateRuntimeState(paths.state);
    state.runtime=await createRuntimeRegistry({paths,autoOpen,services:state.services,retryClients,codeRoot});
    state.services.observeRuntime(state.runtime);
    async function command(message){
      if(message.command==='record-diagnostic'){
        await report(message.event,message.options);return {ok:true};
      }
      if(message.command==='diagnostics')return {ok:true,receipt:await state.services.flushDiagnostics(),service:state.services.status()};
      if(message.command==='status')return {ok:true,pid:process.pid,instanceId,version:config.version,home:paths.home,...await state.runtime.status(),service:state.services.status()};
      if(message.command==='reload-runtime')return {ok:true,...await state.runtime.reloadRuntime(message)};
      if(message.command==='stop-runtime')return {ok:true,...await state.runtime.stopRuntime(message)};
      if(message.command==='quit')return {ok:true,...await quit(message.force===true)};
      if(message.command==='update')return {ok:true,...await state.services.update({force:message.force===true})};
      return state.runtime.command(message);
    }

    const record={instanceId,pid:process.pid,port:state.control.address().port,token,version:config.version,contract:orchestratorContract,codeRoot,user:userInfo().username};
    if(tray&&!process.env.SAAM_DATA&&!process.env.SAAM_BACKGROUND&&!process.env.NODE_TEST_CONTEXT){
      state.tray=await startTray(record);
      if(state.tray.problem)await report({kind:'tray-unavailable',error:state.tray.problem},{firstRun:true});
    }
    await replaceFile(instanceFile,JSON.stringify(record)+'\n');
    const opened=openOnStart?await state.runtime.command(opening):null;
    await report({kind:'application-ready',version:config.version},{firstRun:true,complete:true});
    state.migration=null;state.runtimeMigration=null;
    return {existing:false,opened,record,runtime:state.runtime,services:state.services,stop};
  }catch(error){
    await end(error).catch(cleanup=>{error.message+=' Startup cleanup failed: '+cleanup.message;});throw error;
  }
}
