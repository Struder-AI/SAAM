// Named Geometry capabilities share one execution protocol and resource owner.
import {Worker,MessageChannel,receiveMessageOnPort,parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {heapCeilingMb} from '../memory.mjs';
const RESPONSIVENESS={pollMs:10,progressMs:25,shutdownMs:1000};
const runtime={supervisor:null};

export function geometryMemoryError(error,subject,{detail='',code='GEOMETRY_MEMORY_EXHAUSTED',heapMb}={}){
  if(error?.code!=='ERR_WORKER_OUT_OF_MEMORY')return error;
  return Object.assign(Error(`${subject} ran out of memory${detail}: its ${heapMb?`${(heapMb/1024).toFixed(1)} GiB `:''}heap, sized to available memory, was exhausted. Nothing is simplified automatically; a machine with more RAM can finish it.`),{code,cause:error});
}
export async function executeGeometry(operation,input,options={}){
  const session=beginExecution(operation,input,options);
  try{for(;;){const outcome=pollExecution(session);if(outcome){if(outcome.error)throw outcome.error;return outcome.value;}await delay(RESPONSIVENESS.pollMs);}}
  finally{closeExecution(session);}
}
export function executeGeometrySync(operation,input,options={}){
  if(options.onGeometry)throw Error('Synchronous Geometry execution cannot await an asynchronous geometry consumer.');
  const session=beginExecution(operation,input,options);
  try{for(;;){
    const outcome=pollExecution(session);if(outcome){if(outcome.error)throw outcome.error;return outcome.value;}
    if(session.cancelledAt&&performance.now()-session.cancelledAt>RESPONSIVENESS.shutdownMs){
      if(runtime.supervisor===session.supervisor)runtime.supervisor=null;session.supervisor.worker.terminate().catch(ignoreTermination);throw session.localFailure;
    }
    Atomics.wait(session.control,1,Atomics.load(session.control,1),RESPONSIVENESS.pollMs);
  }}finally{closeExecution(session);}
}
function beginExecution(operation,input,options){
  options.signal?.throwIfAborted();
  if(options.timeoutMs!==undefined&&!(Number.isFinite(options.timeoutMs)&&options.timeoutMs>0))throw deadlineError(options.timeoutMs);
  const supervisor=geometrySupervisor(),channel=new MessageChannel(),control=new Int32Array(new SharedArrayBuffer(8)),id=supervisor.sequence++;
  const session={supervisor,id,port:channel.port1,control,options,result:null,stopped:null,progress:null,localFailure:null,cancelledAt:null,closed:false,
    deadline:options.timeoutMs===undefined?Infinity:performance.now()+options.timeoutMs};
  session.abort=()=>cancelExecution(session,options.signal.reason);supervisor.jobs.set(id,session);supervisor.worker.ref();
  try{
    supervisor.worker.postMessage({type:'start',id,port:channel.port2,control,timeoutMs:options.timeoutMs,
      expiresAt:options.timeoutMs===undefined?null:Date.now()+options.timeoutMs,
      subject:options.subject??'Geometry construction',detail:options.detail??'',memoryCode:options.memoryCode},[channel.port2]);
    session.port.postMessage({operation,input,geometry:!!options.onGeometry});
    options.signal?.addEventListener('abort',session.abort,{once:true});if(options.signal?.aborted)session.abort();return session;
  }catch(error){cancelExecution(session,error);closeExecution(session);throw error;}
}
function geometrySupervisor(){
  if(!runtime.supervisor){
    const channel=new MessageChannel(),worker=new Worker(new URL('./execution-worker.mjs',import.meta.url),{execArgv:[],workerData:{supervise:true,reply:channel.port2},transferList:[channel.port2],resourceLimits:{maxOldGenerationSizeMb:heapCeilingMb()}});
    const supervisor={worker,reply:channel.port1,jobs:new Map(),sequence:0,failed:false};runtime.supervisor=supervisor;
    const failed=async error=>{
      if(supervisor.failed)return;supervisor.failed=true;if(runtime.supervisor===supervisor)runtime.supervisor=null;
      await worker.terminate().catch(ignoreTermination);
      for(const session of supervisor.jobs.values())session.stopped={error:errorRecord(geometryMemoryError(error,session.options.subject,{detail:session.options.detail,code:session.options.memoryCode,heapMb:worker.resourceLimits.maxOldGenerationSizeMb}))};
    };
    worker.on('error',failed);worker.on('exit',code=>{void failed(Object.assign(Error(`Geometry execution supervisor exited (${code}).`),{code:'GEOMETRY_EXECUTION_STOPPED'}));});
    channel.port1.unref();worker.unref();
  }
  return runtime.supervisor;
}
function cancelExecution(session,error){
  if(session.closed||session.cancelledAt)return;
  session.localFailure=error;session.cancelledAt=performance.now();Atomics.store(session.control,0,1);
  session.supervisor.worker.postMessage({type:'cancel',id:session.id});
}
function pollExecution(session){
  for(;;){const item=receiveMessageOnPort(session.supervisor.reply);if(!item)break;const target=session.supervisor.jobs.get(item.message.id);if(target)target.stopped=item.message;}
  for(;;){const item=receiveMessageOnPort(session.port);if(!item)break;const message=item.message;
    if(message.type==='geometry')void consumeGeometry(session,message);
    else if(message.type==='progress'){session.progress=message.value;if(!session.cancelledAt)try{session.options.progress?.(message.value);}catch(error){cancelExecution(session,error);}}
    else session.result=message;
  }
  if(performance.now()>=session.deadline&&!session.cancelledAt)cancelExecution(session,deadlineError(session.options.timeoutMs,session.progress));
  if(session.stopped){
    const record=session.stopped.error??session.result?.error,error=session.localFailure??(record?restoreError(record,session.stopped.error?'execution':'calculation'):null);
    if(error){if(!session.localFailure)error.progress??=session.result?.progress??session.progress;return {error};}
    if(session.result)return {value:session.result.value};
  }
  return null;
}
async function consumeGeometry(session,message){
  if(session.closed||session.cancelledAt)return;
  try{session.options.signal?.throwIfAborted();await session.options.onGeometry(message.value);
    if(!session.closed&&!session.cancelledAt)session.port.postMessage({type:'geometry-ack',id:message.id});
  }catch(error){cancelExecution(session,error);}
}
function closeExecution(session){
  session.closed=true;session.options.signal?.removeEventListener('abort',session.abort);session.port.close();session.supervisor.jobs.delete(session.id);
  if(!session.supervisor.jobs.size)session.supervisor.worker.unref();
}
function ignoreTermination(){}
function deadlineError(timeoutMs,progress){return Object.assign(Error(`Geometry calculation interrupted after ${timeoutMs} ms.`),{code:'GEOMETRY_EXECUTION_TIMEOUT',timeoutMs,...(progress?{progress}:{})});}
function errorRecord(error){
  if(!error||typeof error!=='object')return {name:'Error',message:String(error)};
  const record=Object.fromEntries(Object.getOwnPropertyNames(error).filter(key=>key!=='cause').map(key=>[key,error[key]]));
  return {name:error.name,message:error.message,...record,...(error.cause?{cause:{name:error.cause.name,message:error.cause.message,code:error.cause.code}}:{})};
}
function restoreError(record,origin){return Object.assign(Error(record.message),record,...(origin?[{geometryFailure:origin}]:[]));}

// Supervision stays responsive during synchronous calls. Payloads travel directly
// to a leased calculation port; only lifecycle outcomes cross the supervisor.
export function serveGeometryExecution(){
  if(workerData.supervise){
    const pool={idle:null,workers:new Set(),leases:new Map()};
    parentPort.on('message',request=>{
      if(request.type==='start')superviseExecution(pool,request);
      else{const lease=pool.leases.get(request.id);if(lease)void settleLease(pool,lease,Error('Geometry calculation cancelled.'));}
    });
  }else parentPort.on('message',executeLease);
}
function calculationWorker(pool){
  if(pool.idle){const record=pool.idle;pool.idle=null;record.worker.ref();return record;}
  const heapMb=heapCeilingMb({workers:pool.workers.size+2}),worker=new Worker(new URL('./execution-worker.mjs',import.meta.url),{execArgv:[],workerData:{supervise:false},resourceLimits:{maxOldGenerationSizeMb:heapMb}});
  const record={worker,heapMb,lease:null};pool.workers.add(record);
  worker.on('message',message=>{if(record.lease)void settleLease(pool,record.lease,undefined,{retire:message.retire});});
  const failed=error=>{if(record.lease)void settleLease(pool,record.lease,error);else{if(pool.idle===record)pool.idle=null;pool.workers.delete(record);}};
  worker.on('error',failed);worker.on('exit',code=>failed(Object.assign(Error(`Geometry calculation exited without a result (${code}).`),{code:'GEOMETRY_EXECUTION_STOPPED'})));return record;
}
function superviseExecution(pool,request){
  const record=calculationWorker(pool),lease={...request,record,settling:false,timer:null};record.lease=lease;pool.leases.set(lease.id,lease);
  if(request.expiresAt!==null)lease.timer=setTimeout(()=>{void settleLease(pool,lease,deadlineError(request.timeoutMs));},Math.max(0,request.expiresAt-Date.now()));
  try{record.worker.postMessage({port:request.port,control:request.control},[request.port]);}catch(error){void settleLease(pool,lease,error);}
}
async function settleLease(pool,lease,error,{retire=false}={}){
  if(lease.settling)return;lease.settling=true;clearTimeout(lease.timer);pool.leases.delete(lease.id);
  const record=lease.record,failureState={error};
  if(error||retire){Atomics.store(lease.control,0,1);try{await record.worker.terminate();}catch(stopped){failureState.error??=stopped;}pool.workers.delete(record);}
  else{if(pool.idle){pool.workers.delete(pool.idle);pool.idle.worker.terminate().catch(ignoreTermination);}pool.idle=record;record.worker.unref();}
  record.lease=null;
  const failure=geometryMemoryError(failureState.error,lease.subject,{detail:lease.detail,code:lease.memoryCode,heapMb:record.heapMb});
  workerData.reply.postMessage({id:lease.id,...(failure?{error:errorRecord(failure)}:{completed:true})});Atomics.add(lease.control,1,1);Atomics.notify(lease.control,1);
}
async function executeLease({port,control}){
  const controller=new AbortController(),pending=new Map(),state={progress:null,lastSent:-Infinity,lastStage:null,retire:false,sequence:0};
  const abort=()=>{if(Atomics.load(control,0)&&!controller.signal.aborted){controller.abort();for(const entry of pending.values())entry.reject(controller.signal.reason);pending.clear();}};
  const timer=setInterval(abort,RESPONSIVENESS.progressMs);
  const progress=value=>{abort();controller.signal.throwIfAborted();state.progress=value;
    if(value.stage!==state.lastStage||performance.now()-state.lastSent>=RESPONSIVENESS.progressMs||value.total>0&&value.completed>=value.total){
      state.lastSent=performance.now();state.lastStage=value.stage;port.postMessage({type:'progress',value});Atomics.add(control,1,1);Atomics.notify(control,1);
    }
  };
  const onGeometry=value=>new Promise((resolve,reject)=>{const id=state.sequence++;pending.set(id,{resolve,reject});port.postMessage({type:'geometry',id,value});});
  try{
    const request=await new Promise(resolve=>port.once('message',resolve));
    port.on('message',message=>{const entry=pending.get(message.id);if(entry){pending.delete(message.id);entry.resolve();}});
    abort();controller.signal.throwIfAborted();
    const value=await calculateGeometry(request.operation,request.input,{signal:controller.signal,progress,...(request.geometry?{onGeometry}:{})});
    controller.signal.throwIfAborted();port.postMessage({type:'result',value});
  }catch(error){state.retire=error instanceof RangeError||error instanceof WebAssembly.RuntimeError;port.postMessage({type:'error',error:errorRecord(error),progress:state.progress});}
  finally{clearInterval(timer);port.close();parentPort.postMessage({completed:true,retire:state.retire});}
}
async function calculateGeometry(operation,input,context){
  switch(operation){
    case 'surface-boolean': {const {constructSurfaceBoolean}=await import('./surface-boolean-kernel.mjs');return constructSurfaceBoolean(input.operation,input.operands,{...input.options,onPhase:context.progress});}
    case 'stl-repair': {const {prepareSTLRepairValue}=await import('./stl-repair.mjs');return prepareSTLRepairValue(input.source,{...input.options,...context});}
    case 'stl-source': {const {prepareSTLSourceValue}=await import('./import-stl.mjs');return prepareSTLSourceValue(input.source,{...input.options,...context});}
    case 'blob-field': {const {compileBlobFieldValue}=await import('./blob-field-compile.mjs'),{transferGeometry}=await import('../print/geometry.mjs');return transferGeometry(await compileBlobFieldValue(input.field,{...input.options,...context}));}
    default: throw Error('Unknown Geometry calculation: '+operation);
  }
}
