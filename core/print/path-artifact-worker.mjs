// Parsing, source/schedule admission, placement and serialization can all be
// substantial. Transfer their result without blocking Studio's server thread.
import {parentPort,workerData} from 'node:worker_threads';
import {readMotionArtifact} from './path-artifact.mjs';
import {placedPath} from '../path/placement.mjs';

try{
  const path=await readMotionArtifact(workerData.directory,workerData.artifact);
  const bytes=new TextEncoder().encode(JSON.stringify(workerData.placement?placedPath(path,workerData.placement):path));
  parentPort.postMessage({type:'result',value:bytes},[bytes.buffer]);
}catch(error){
  parentPort.postMessage({type:'error',error:{name:error.name,message:error.message,code:error.code,stack:error.stack}});
}finally{parentPort.close();}
