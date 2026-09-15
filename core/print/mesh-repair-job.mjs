import {Worker} from 'node:worker_threads';
export function runRepairJob(mode,directory,source,options){
  const {signal,progress,onGeometry,...settings}=options;signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./mesh-repair-worker.mjs',import.meta.url),{execArgv:[],workerData:{mode,directory,source,options:settings,geometry:!!onGeometry}});let settled=false,callbackError;
    const abort=()=>worker.postMessage({type:'abort'});signal?.addEventListener('abort',abort,{once:true});
    const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    worker.on('message',async message=>{
      if(message.type==='progress'){try{progress?.(message.event);}catch(error){callbackError=error;abort();}}
      else if(message.type==='geometry'){try{signal?.throwIfAborted();await onGeometry(message.event);worker.postMessage({type:'geometry-ack',id:message.id});}catch(error){callbackError=error;worker.postMessage({type:'geometry-ack',id:message.id,error:error.message});abort();}}
      else if(message.type==='error'){const e=Object.assign(Error(message.error.message),message.error);finish(callbackError??e);}
      else if(message.type==='result'){const result=message.result;if(result.repairedBytes)result.repairedBytes=Buffer.from(result.repairedBytes.buffer,result.repairedBytes.byteOffset,result.repairedBytes.byteLength);finish(callbackError??(signal?.aborted?signal.reason:null),result);}
    });
    worker.on('error',error=>finish(error));worker.on('exit',code=>{if(!settled)finish(Error(`Mesh repair worker exited without a result (${code}).`));});
  });
}
