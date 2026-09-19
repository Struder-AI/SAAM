import {Worker} from 'node:worker_threads';
// Runs repairSTL ('bytes'), repairSTLFiles ('files') or importOrRepairSTLBundle
// ('import') in a worker. It settles only after the worker has stopped, so a
// caller may then remove the directory the job was writing.
// A worker whose heap is exhausted reaches the supervisor as
// ERR_WORKER_OUT_OF_MEMORY. Say what ran out and on what, rather than reporting
// an anonymous worker failure; nothing refuses a mesh before trying it.
export function repairMemoryError(error,source){
  if(error?.code!=='ERR_WORKER_OUT_OF_MEMORY')return error;
  const bytes=typeof source==='string'?undefined:source?.byteLength??source?.length;
  const subject=typeof source==='string'?` reading ${source}`:Number.isFinite(bytes)?` on a ${Math.ceil(bytes/1048576)} MiB STL source`:'';
  return Object.assign(Error(`Mesh repair ran out of memory${subject}: Node's heap was exhausted (${error.message}). Run with a larger --max-old-space-size or on a machine with more RAM; geometry is never simplified automatically.`),{code:'MESH_MEMORY_EXHAUSTED',cause:error});
}
export function runRepairJob(mode,directory,source,options){
  const {signal,progress,onGeometry,...settings}=options;signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./mesh-repair-worker.mjs',import.meta.url),{execArgv:[],workerData:{mode,directory,source,options:settings,geometry:!!onGeometry}});let settled=false,callbackError;
    const abort=()=>worker.postMessage({type:'abort'});signal?.addEventListener('abort',abort,{once:true});
    const finish=async(error,value)=>{
      if(settled)return;settled=true;signal?.removeEventListener('abort',abort);
      try{await worker.terminate();}catch(stopped){error??=stopped;}
      error?reject(error):resolve(value);
    };
    worker.on('message',async message=>{
      if(message.type==='progress'){try{progress?.(message.event);}catch(error){callbackError=error;abort();}}
      else if(message.type==='geometry'){try{signal?.throwIfAborted();await onGeometry(message.event);worker.postMessage({type:'geometry-ack',id:message.id});}catch(error){callbackError=error;worker.postMessage({type:'geometry-ack',id:message.id,error:error.message});abort();}}
      else if(message.type==='error'){const e=Object.assign(Error(message.error.message),message.error);finish(callbackError??e);}
      else if(message.type==='result'){const result=message.result;if(result.repairedBytes)result.repairedBytes=Buffer.from(result.repairedBytes.buffer,result.repairedBytes.byteOffset,result.repairedBytes.byteLength);finish(callbackError??(signal?.aborted?signal.reason:null),result);}
    });
    worker.on('error',error=>finish(repairMemoryError(error,source)));worker.on('exit',code=>{if(!settled)finish(Error(`Mesh repair worker exited without a result (${code}).`));});
  });
}
