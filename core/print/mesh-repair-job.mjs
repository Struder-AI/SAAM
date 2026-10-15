import {computationWorker,workerMemoryError} from './computation-job.mjs';
import {receiveGeometry} from './geometry.mjs';
// Runs repairSTL ('bytes'), repairSTLFiles ('files') or prepareSTLImportInWorker
// ('import') in a worker. It settles only after the worker has stopped, so a
// caller may then remove the directory the job was writing.
// Nothing refuses a mesh before trying it; an exhausted heap names the source.
export function repairMemoryError(error,source){
  const bytes=typeof source==='string'?undefined:source?.byteLength??source?.length;
  const detail=typeof source==='string'?` reading ${source}`:Number.isFinite(bytes)?` on a ${Math.ceil(bytes/1048576)} MiB STL source`:'';
  return workerMemoryError(error,'Mesh repair',{detail,code:'MESH_MEMORY_EXHAUSTED'});
}
export function runRepairJob(mode,directory,source,options){
  const {signal,progress,onGeometry,...settings}=options;signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=computationWorker(new URL('./mesh-repair-worker.mjs',import.meta.url),{mode,directory,source,options:settings,geometry:!!onGeometry});let settled=false,callbackError;
    // The supervisor can stop synchronous import work, including on OOM.
    const abort=()=>{
      worker.postMessage({type:'abort'});
      if(mode==='import')void finish(callbackError??signal?.reason??new DOMException('Import cancelled.','AbortError'));
    };signal?.addEventListener('abort',abort,{once:true});
    const finish=async(error,value)=>{
      if(settled)return;settled=true;signal?.removeEventListener('abort',abort);
      error=callbackError??(signal?.aborted?signal.reason:null)??error;
      try{await worker.terminate();}catch(stopped){error??=stopped;}
      error?reject(error):resolve(value);
    };
    worker.on('message',async message=>{
      if(settled)return;
      if(message.type==='progress'){try{progress?.(message.event);}catch(error){callbackError=error;abort();}}
      else if(message.type==='geometry'){try{signal?.throwIfAborted();await onGeometry(message.event);worker.postMessage({type:'geometry-ack',id:message.id});}catch(error){callbackError=error;worker.postMessage({type:'geometry-ack',id:message.id,error:error.message});abort();}}
      else if(message.type==='error'){const e=Object.assign(Error(message.error.message),message.error);finish(callbackError??e);}
      else if(message.type==='result'){
        try{const result=message.result;if(mode==='import')result.geometry=await receiveGeometry(result.geometry);
          if(result.repairedBytes)result.repairedBytes=Buffer.from(result.repairedBytes.buffer,result.repairedBytes.byteOffset,result.repairedBytes.byteLength);
          finish(callbackError??(signal?.aborted?signal.reason:null),result);
        }catch(error){finish(error);}
      }
    });
    worker.on('error',error=>finish(repairMemoryError(error,source)));worker.on('exit',code=>{if(!settled)finish(Error(`Mesh repair worker exited without a result (${code}).`));});
  });
}
