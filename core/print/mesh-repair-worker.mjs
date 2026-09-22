import {parentPort,workerData} from 'node:worker_threads';
import {repairSTL,repairSTLFiles} from './repair-stl.mjs';
import {importOrRepairSTLBundle} from './import-stl.mjs';
await runMeshRepairWorker(parentPort,workerData);

async function runMeshRepairWorker(port,job){
  const channel=initializeRepairWorkerChannel(port,job.geometry);
  const options={...job.options,...channel};
  try{
    const result=await executeRepairWorkerJob(job,options);
    const response=prepareRepairWorkerResponse(result);
    publishRepairWorkerResponse(port,response);
  }catch(error){
    publishRepairWorkerFailure(port,error);
  }finally{
    closeRepairWorkerChannel(port);
  }
}

function initializeRepairWorkerChannel(port,geometry){
  const controller=new AbortController(),pending=new Map();let sequence=0;
  function receiveMessage(message){
    if(message.type==='abort'){
      controller.abort();
      for(const entry of pending.values())entry.reject(controller.signal.reason);
      pending.clear();
    }else if(message.type==='geometry-ack'){
      const entry=pending.get(message.id);
      if(entry){
        pending.delete(message.id);
        message.error?entry.reject(Error(message.error)):entry.resolve();
      }
    }
  }
  function progress(event){port.postMessage({type:'progress',event});}
  function onGeometry(event){
    return new Promise((resolve,reject)=>{
      const id=sequence++;
      pending.set(id,{resolve,reject});
      port.postMessage({type:'geometry',id,event});
    });
  }
  port.on('message',receiveMessage);
  return geometry?{signal:controller.signal,progress,onGeometry}:{signal:controller.signal,progress};
}

async function executeRepairWorkerJob(job,options){
  const {mode,directory,source}=job;
  if(mode==='import'){
    return await importOrRepairSTLBundle(directory,source,options);
  }else if(mode==='files'){
    return await repairSTLFiles(directory,source,options);
  }else{
    return await repairSTL(source,options);
  }
}

function prepareRepairWorkerResponse(result){
  if(result.repairedBytes){
    const bytes=new Uint8Array(result.repairedBytes.length);
    bytes.set(result.repairedBytes);
    return {message:{type:'result',result:{...result,repairedBytes:bytes}},transfer:[bytes.buffer]};
  }else{
    return {message:{type:'result',result},transfer:[]};
  }
}

function publishRepairWorkerResponse(port,response){
  port.postMessage(response.message,response.transfer);
}

function publishRepairWorkerFailure(port,error){
  port.postMessage({type:'error',error:{message:error.message,name:error.name,code:error.code,changes:error.changes,meshDiagnostic:error.meshDiagnostic}});
}

function closeRepairWorkerChannel(port){port.close();}
