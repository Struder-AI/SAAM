// A Studio-owned preparation worker. Checking builds an in-memory candidate;
// only an explicit generation message may persist output or a generation record.
import {parentPort,workerData} from 'node:worker_threads';
import {bundleFor} from './adapter-resolution.mjs';
import {generationControl} from '../core/print/generation-control.mjs';

export function createProgressReporter(port,control,enabled) {
  if(!enabled)return undefined;
  let lastStage,lastPercent;
  return function reportProgress(progress) {
    control.check();
    const percent=progress.total>0?Math.floor(100*progress.completed/progress.total):null;
    if(progress.stage===lastStage&&percent===lastPercent)return;
    lastStage=progress.stage;lastPercent=percent;
    port.postMessage({type:'progress',progress});
  };
}

export async function prepareGeneration(bundle,{directory,generationHash,onProgress}) {
  try {
    const expected=await readExpectedBundle(bundle,directory,generationHash);
    await bundle.checkPathBundle(expected.directory,{onProgress});
    return {notification:{type:'prepared'},error:null};
  } catch(error) {
    return {notification:{type:'prepared',error:error.message},error};
  }
}

export async function readExpectedBundle(bundle,directory,generationHash) {
  const state=await bundle.loadBundle(directory,{program:false});
  if(state.generationHash!==generationHash)throw new Error('The prepared print changed. Reload before generating.');
  return {directory,generationHash:state.generationHash};
}

export async function runPreparedGeneration(bundle,expected,preparation,message,{control,onProgress}) {
  if(preparation.error)throw preparation.error;
  control.check();
  const checks=await bundle.generateBundle(expected.directory,{development:message.development===true,onProgress,beforeCommit:control.beforeCommit});
  return {directory:expected.directory,checks};
}

export async function loadGeneratedResponse(bundle,generation) {
  const generated=await bundle.loadBundle(generation.directory,{program:'source',allSources:true});
  if(!generated.program||generated.programError)throw new Error(generated.programError??'Checked machine source is unavailable.');
  return {type:'generated',checks:generation.checks,source:{generationHash:generated.generationHash,exportHash:generated.exportHash,
    metadata:generated.program,code:generated.code,sources:generated.sources}};
}

export async function generateMessage(message,ready,bundle,settings) {
  if(message.type!=='generate')return undefined;
  try {
    const preparation=await ready;
    const expected=await readExpectedBundle(bundle,settings.directory,settings.generationHash);
    const generation=await runPreparedGeneration(bundle,expected,preparation,message,settings);
    return await loadGeneratedResponse(bundle,generation);
  } catch(error) {
    return {type:'generated',error:error.message,code:error.code};
  }
}

export async function startGenerationWorker(port,data) {
  const {directory,generationHash}=data,control=generationControl(data.cancellation);
  const onProgress=createProgressReporter(port,control,data.progress),bundle=await bundleFor(directory);
  const settings={directory,generationHash,onProgress,control};
  const ready=prepareGeneration(bundle,settings).then(function announcePreparation(preparation) {
    port.postMessage(preparation.notification);
    return preparation;
  });
  port.on('message',async function onGenerationMessage(message) {
    const response=await generateMessage(message,ready,bundle,settings);
    if(response)port.postMessage(response);
  });
}

if(parentPort)await startGenerationWorker(parentPort,workerData);
