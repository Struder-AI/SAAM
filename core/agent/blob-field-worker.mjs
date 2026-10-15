import {parentPort,workerData} from 'node:worker_threads';
import {compileBlobField} from '../geom/blob-field-compile.mjs';
import {transferGeometry} from '../print/geometry.mjs';
try{
  const geometry=await compileBlobField(workerData.field,workerData.options);
  parentPort.postMessage({type:'result',value:{geometry:await transferGeometry(geometry)}});
}catch(error){
  parentPort.postMessage({type:'error',error:{name:error.name,message:error.message,code:error.code,stage:error.stage,stack:error.stack}});
}finally{parentPort.close();}
