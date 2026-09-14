// A Studio-owned preparation worker. Checking builds an in-memory candidate;
// only an explicit generation message may persist output or a generation record.
import {parentPort,workerData} from 'node:worker_threads';
import {bundleFor} from './server.mjs';

const {directory,planHash}=workerData;
let preparationError;
const bundle=await bundleFor(directory);
const ready=(async()=>{
  try{
    const state=await bundle.loadBundle(directory,{program:false});
    if(state.planHash!==planHash)throw new Error('The prepared print changed. Reload before generating.');
    await bundle.checkPathBundle(directory);
    parentPort.postMessage({type:'prepared'});
  }catch(error){preparationError=error;parentPort.postMessage({type:'prepared',error:error.message});}
})();
parentPort.on('message',async message=>{
  if(message.type!=='generate')return;
  try{
    await ready;
    const state=await bundle.loadBundle(directory,{program:false});
    if(state.planHash!==planHash)throw new Error('The prepared print changed. Reload before generating.');
    if(preparationError)throw preparationError;
    const checks=await bundle.generateBundle(directory,{development:message.development===true});
    const generated=await bundle.loadBundle(directory,{program:'source',allSources:true});
    if(!generated.program||generated.programError)throw new Error(generated.programError??'Checked machine source is unavailable.');
    parentPort.postMessage({type:'generated',checks,source:{planHash:generated.planHash,exportHash:generated.exportHash,
      metadata:generated.program,code:generated.code,sources:generated.sources}});
  }catch(error){parentPort.postMessage({type:'generated',error:error.message});}
});
