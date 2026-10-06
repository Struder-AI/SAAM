// Bundle's generation worker: prepares SAAMpath and checked program off the main
// thread, asks before saving, then commits under the caller's reservation.
import {parentPort,workerData} from 'node:worker_threads';
import {prepareGeneration,commitGeneration,withBundleInstance} from './bundle.mjs';

const beforeCommit=()=>new Promise((resolve,reject)=>{
  parentPort.once('message',message=>message.type==='commit'?resolve():reject(Error('Invalid generation commit acknowledgement.')));
  parentPort.postMessage({type:'before-commit'});
});
// One message per changed stage or whole percent.
const reported={stage:null,percent:null};
function reportProgress(progress){
  const percent=progress.total>0?Math.floor(100*progress.completed/progress.total):null;
  if(progress.stage===reported.stage&&percent===reported.percent)return;
  reported.stage=progress.stage;reported.percent=percent;
  parentPort.postMessage({type:'progress',value:progress});
}
try{
  const {directory,generationHash,development,instance}=workerData;
  const prepared=await prepareGeneration(directory,{onProgress:reportProgress});
  if(prepared.generationHash!==generationHash)throw Error('The prepared print changed. Reload before generating.');
  const commit=()=>commitGeneration(directory,prepared,{development,onProgress:reportProgress,beforeCommit});
  const value=instance?await withBundleInstance(directory,instance,commit):await commit();
  parentPort.postMessage({type:'result',value});
}catch(error){
  parentPort.postMessage({type:'error',error:{name:error.name,message:error.message,code:error.code,stage:error.stage,stack:error.stack}});
}finally{parentPort.close();}
