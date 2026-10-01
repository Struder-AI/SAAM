import {parentPort,workerData} from 'node:worker_threads';
import {repairSTL,repairSTLFiles} from './repair-stl.mjs';
import {prepareSTLImportInWorker} from '../geom/import-stl.mjs';
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
    if(message.type==='native-progress'){pending.get(message.id)?.progress?.(message.event);return;}
    if(message.type==='abort'){
      controller.abort();
      for(const entry of pending.values())entry.reject(controller.signal.reason);
      pending.clear();
    }else if(message.type==='geometry-ack'||message.type==='native-ack'||message.type==='native-result'){
      const entry=pending.get(message.id);
      if(entry){
        pending.delete(message.id);
        message.error?entry.reject(Object.assign(Error(message.error.message??message.error),message.error)):entry.resolve(message.value);
      }
    }
  }
  function progress(event){port.postMessage({type:'progress',event});}
  function nativeReady(){
    controller.signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const id=sequence++;pending.set(id,{resolve,reject});port.postMessage({type:'native-start',id});
    });
  }
  function nativeRun(input,output,{maxHoleEdges,maxHoleDiameterMm,progress}){
    controller.signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const id=sequence++;pending.set(id,{resolve,reject,progress});port.postMessage({type:'native-run',id,input,output,maxHoleEdges,maxHoleDiameterMm});
    });
  }
  function onGeometry(event){
    return new Promise((resolve,reject)=>{
      const id=sequence++;
      pending.set(id,{resolve,reject});
      port.postMessage({type:'geometry',id,event});
    });
  }
  port.on('message',receiveMessage);
  return {signal:controller.signal,progress,nativeReady,nativeRun,...(geometry?{onGeometry}:{})};
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
  port.postMessage({type:'error',error:{message:error.message,name:error.name,code:error.code,changes:error.changes,meshDiagnostic:error.meshDiagnostic,cleanupError:error.cleanupError}});
}

function closeRepairWorkerChannel(port){port.close();}
