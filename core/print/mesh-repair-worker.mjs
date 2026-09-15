import {parentPort,workerData} from 'node:worker_threads';
import {repairSTL,repairSTLFiles} from './repair-stl.mjs';
const controller=new AbortController(),pending=new Map();let sequence=0;
parentPort.on('message',message=>{if(message.type==='abort'){controller.abort();for(const entry of pending.values())entry.reject(controller.signal.reason);pending.clear();}else if(message.type==='geometry-ack'){const entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(Error(message.error)):entry.resolve();}}});
const options={...workerData.options,signal:controller.signal,progress:event=>parentPort.postMessage({type:'progress',event})};
if(workerData.geometry)options.onGeometry=event=>new Promise((resolve,reject)=>{const id=sequence++;pending.set(id,{resolve,reject});parentPort.postMessage({type:'geometry',id,event});});
try{
  const result=workerData.mode==='files'?await repairSTLFiles(workerData.directory,workerData.source,options):await repairSTL(workerData.source,options);
  if(result.repairedBytes){const bytes=new Uint8Array(result.repairedBytes.length);bytes.set(result.repairedBytes);result.repairedBytes=bytes;parentPort.postMessage({type:'result',result},[bytes.buffer]);}
  else parentPort.postMessage({type:'result',result});
}catch(error){parentPort.postMessage({type:'error',error:{message:error.message,name:error.name,code:error.code,changes:error.changes}});}finally{parentPort.close();}
