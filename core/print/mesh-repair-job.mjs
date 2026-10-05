import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {createTemporaryWorkspace} from '../application/temporary-workspace.mjs';
import {runNativeMeshRepair} from '../geom/mesh-native.mjs';
// Runs repairSTL ('bytes'), repairSTLFiles ('files') or prepareSTLImportInWorker
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
    const nativeController=new AbortController();let nativeDirectory,nativeRun;
    // The supervisor owns native scratch and the child process. It can stop
    // synchronous import work without losing either resource, including on OOM.
    const abort=()=>{
      worker.postMessage({type:'abort'});
      nativeController.abort();
      if(mode==='import')void finish(callbackError??signal?.reason??new DOMException('Import cancelled.','AbortError'));
    };signal?.addEventListener('abort',abort,{once:true});
    const finish=async(error,value)=>{
      if(settled)return;settled=true;signal?.removeEventListener('abort',abort);
      error=callbackError??(signal?.aborted?signal.reason:null)??error;
      nativeController.abort();
      try{await worker.terminate();}catch(stopped){error??=stopped;}
      try{
        await nativeRun?.catch(()=>{});
        await (await nativeDirectory)?.release();
      }catch(cleanup){if(error){error.cleanupError=cleanup.message;error.message+=' Native repair cleanup failed: '+cleanup.message;}else error=cleanup;}
      error?reject(error):resolve(value);
    };
    worker.on('message',async message=>{
      if(settled)return;
      if(message.type==='native-start'){
        try{
          nativeDirectory??=createTemporaryWorkspace('mesh-repair');
          const scratch=(await nativeDirectory).directory;
          if(!settled)worker.postMessage({type:'native-ack',id:message.id,value:scratch});
        }catch(error){void finish(error);}
      }
      else if(message.type==='native-run'){
        try{
          const workspace=await nativeDirectory,scratch=workspace?.directory;
          if(settled)return;
          if(!scratch||nativeRun||message.input!==join(scratch,'input.off')||message.output!==join(scratch,'output.off'))throw Error('Invalid native repair job paths.');
          nativeRun=runNativeMeshRepair(message.input,message.output,{maxHoleEdges:message.maxHoleEdges,maxHoleDiameterMm:message.maxHoleDiameterMm,signal:nativeController.signal,temporaryWorkspace:workspace,
            progress:event=>{if(!settled)worker.postMessage({type:'native-progress',id:message.id,event});}});
          const value=await nativeRun;if(!settled)worker.postMessage({type:'native-result',id:message.id,value});
        }catch(error){if(!settled)worker.postMessage({type:'native-result',id:message.id,error:{name:error.name,message:error.message,code:error.code,nativeDiagnostic:error.nativeDiagnostic}});}
      }
      else if(message.type==='progress'){try{progress?.(message.event);}catch(error){callbackError=error;abort();}}
      else if(message.type==='geometry'){try{signal?.throwIfAborted();await onGeometry(message.event);worker.postMessage({type:'geometry-ack',id:message.id});}catch(error){callbackError=error;worker.postMessage({type:'geometry-ack',id:message.id,error:error.message});abort();}}
      else if(message.type==='error'){const e=Object.assign(Error(message.error.message),message.error);finish(callbackError??e);}
      else if(message.type==='result'){const result=message.result;if(result.repairedBytes)result.repairedBytes=Buffer.from(result.repairedBytes.buffer,result.repairedBytes.byteOffset,result.repairedBytes.byteLength);finish(callbackError??(signal?.aborted?signal.reason:null),result);}
    });
    worker.on('error',error=>finish(repairMemoryError(error,source)));worker.on('exit',code=>{if(!settled)finish(Error(`Mesh repair worker exited without a result (${code}).`));});
  });
}
