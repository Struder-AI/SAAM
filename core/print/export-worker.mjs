// Captured immutable path + settings to transient download bytes. No bundle writes.
import {parentPort,workerData} from 'node:worker_threads';
import {readMotionArtifact} from './path-artifact.mjs';
import {exportProgram} from '../export/registry.mjs';
try{
  const {directory,path,plan,machine,release}=workerData;
  const output=await exportProgram(await readMotionArtifact(directory,path),plan,machine,release);
  const bytes=Buffer.from(output.bytes),value=new Uint8Array(bytes.length);value.set(bytes);
  parentPort.postMessage({type:'result',value:{bytes:value,report:output.report}},[value.buffer]);
}catch(error){parentPort.postMessage({type:'error',error:{name:error.name,message:error.message,code:error.code,stage:'export'}});}
finally{parentPort.close();}
