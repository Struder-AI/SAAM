import {parentPort,workerData} from 'node:worker_threads';
import {compileBlobField} from '../geom/blob-field-compile.mjs';
import {createGeometry} from '../print/geometry.mjs';
import {solidGeometry} from '../geom/spatial.mjs';
try{
  const geometry=await compileBlobField(workerData.field,workerData.options);
  if(!workerData.prepareGeometry){parentPort.postMessage({type:'result',value:{geometry}});}
  else{
    const parameters=workerData.geometry??geometry;
    if(workerData.geometry){
      const source=solidGeometry(parameters),owner=workerData.part?source?.parts?.find(part=>part.id===workerData.part):null;
      if(!workerData.part&&parameters.shape==='spatial')parameters.solid=geometry;
      else {
        if(!owner)throw Error('Select an existing blob field part.');
        owner.geometry=geometry;
      }
    }
    const preparedGeometry=await createGeometry(parameters);
    parentPort.postMessage({type:'result',value:{geometry,preparedGeometry}});
  }
}catch(error){
  parentPort.postMessage({type:'error',error:{name:error.name,message:error.message,code:error.code,stage:error.stage,stack:error.stack}});
}finally{parentPort.close();}
