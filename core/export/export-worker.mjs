// Captured immutable path + settings to one owned transient artifact. No Bundle writes.
import {parentPort,workerData} from 'node:worker_threads';
import {readMotionArtifact} from '../print/path-artifact.mjs';
import {exportArtifact} from './registry.mjs';
const beforeCommit=()=>new Promise(resolve=>{
  parentPort.once('message',message=>{if(message.type==='commit')resolve();});
  parentPort.postMessage({type:'before-commit'});
});
try{
  const {directory,path,plan,machine,release,preparation,dataRoot}=workerData;
  const output=await exportArtifact(await readMotionArtifact(directory,path),plan,machine,release,{directory:preparation,beforeCommit,dataRoot,
    onProgress:value=>parentPort.postMessage({type:'progress',value})});
  parentPort.postMessage({type:'result',value:{artifact:output.artifact,report:output.report}});
}catch(error){parentPort.postMessage({type:'error',error:{name:error.name,message:error.message,code:error.code,stage:'export'}});}
finally{parentPort.close();}
