// File ingestion retains indexed geometry, not a second full source/text buffer.
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {meshAllocationError} from './mesh-capacity.mjs';
import {meshInputError} from './mesh.mjs';
import {STLDecoder} from './stl-decoder.mjs';
export async function hashFile(path,{signal}={}){const sha=createHash('sha256');for await(const chunk of createReadStream(path,{signal}))sha.update(chunk);return sha.digest('hex');}
export async function decodeSTLFile(path,options={}){
  try{return await decodeFile(path,options);}catch(error){if(!error.code&&error.name==='Error'&&!error.message.startsWith('STL import needs')&&!error.message.includes('capacity'))throw meshInputError(error.message);throw error;}
}
async function decodeFile(path,{units,scale=1,signal,progress=()=>{}}={}){
  const size=(await stat(path)).size,decoder=new STLDecoder({units,scale,totalBytes:size}),sha=createHash('sha256');let bytesRead=0;
  try{for await(const data of createReadStream(path,{highWaterMark:65536,signal})){
    signal?.throwIfAborted();sha.update(data);bytesRead+=data.length;
    if(bytesRead>size)throw Error('STL file changed while reading.');
    decoder.write(data);
    progress({stage:'read-source',completed:bytesRead,total:size,percent:size?100*bytesRead/size:100,triangles:decoder.triangles.length});
  }
    if(bytesRead!==size)throw Error('STL file changed while reading.');
    const mesh=decoder.finish();return {...mesh,sha256:sha.digest('hex'),bytes:size};
  }catch(error){throw meshAllocationError(error,'STL decoding',decoder.vertices.length,decoder.triangles.length);}
}
