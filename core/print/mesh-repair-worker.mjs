import {parentPort,workerData} from 'node:worker_threads';
import {repairSTL,repairSTLFiles} from './repair-stl.mjs';
import {prepareSTLImportInWorker} from '../geom/import-stl.mjs';
import {transferGeometry} from './geometry.mjs';
await runMeshRepairWorker();

async function runMeshRepairWorker(){
  const channel=initializeRepairWorkerChannel(workerData.geometry);
  const options={...workerData.options,...channel};
  try{
    const result=await executeRepairWorkerJob(workerData,options);
    const response=await prepareRepairWorkerResponse(result,workerData.mode);
    parentPort.postMessage(response.message,response.transfer);
  }catch(error){
    parentPort.postMessage({type:'error',error:{message:error.message,name:error.name,code:error.code,changes:error.changes,meshDiagnostic:error.meshDiagnostic,cleanupError:error.cleanupError,importDiagnostic:error.importDiagnostic}});
  }finally{
    parentPort.close();
  }
}

function initializeRepairWorkerChannel(geometry){
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
        message.error?entry.reject(Object.assign(Error(message.error.message??message.error),message.error)):entry.resolve(message.value);
      }
    }
  }
  function progress(event){parentPort.postMessage({type:'progress',event});}
  function onGeometry(event){
    return new Promise((resolve,reject)=>{
      const id=sequence++;
      pending.set(id,{resolve,reject});
      parentPort.postMessage({type:'geometry',id,event});
    });
  }
  parentPort.on('message',receiveMessage);
  return {signal:controller.signal,progress,...(geometry?{onGeometry}:{})};
}

async function executeRepairWorkerJob(job,options){
  const {mode,directory,source}=job;
  if(mode==='import'){
    return await prepareSTLImportInWorker(directory,source,options);
  }else if(mode==='files'){
    return await repairSTLFiles(directory,source,options);
  }else{
    return await repairSTL(source,options);
  }
}

async function prepareRepairWorkerResponse(result,mode){
  if(mode==='import')return {message:{type:'result',result:{...result,geometry:await transferGeometry(result.geometry)}},transfer:[]};
  if(result.repairedBytes){
    const bytes=new Uint8Array(result.repairedBytes.length);
    bytes.set(result.repairedBytes);
    return {message:{type:'result',result:{...result,repairedBytes:bytes}},transfer:[bytes.buffer]};
  }else{
    return {message:{type:'result',result},transfer:[]};
  }
}
