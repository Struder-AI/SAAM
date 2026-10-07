// File ingestion retains indexed geometry, not a second full source/text buffer.
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {meshAllocationError} from './mesh-capacity.mjs';
import {meshInputError} from './mesh.mjs';
import {STLDecoder} from './stl-decoder.mjs';
export async function decodeSTLFile(path,options={}){
  try{return await decodeFile(path,options);}catch(error){if(!error.code&&error.name==='Error'&&!error.message.startsWith('STL import needs')&&!error.message.includes('capacity'))throw Object.assign(meshInputError(error.message),{stlSource:error.stlSource});throw error;}
}
async function decodeFile(path,{units,scale=1,signal,progress=()=>{}}={}){
  const size=(await stat(path)).size,decoder=new STLDecoder({units,scale,totalBytes:size}),sha=createHash('sha256'),reading={bytes:0,rejection:null,sha256:null};
  try{for await(const data of createReadStream(path,{highWaterMark:65536,signal})){
    signal?.throwIfAborted();sha.update(data);reading.bytes+=data.length;
    if(reading.bytes>size)throw Error('STL file changed while reading.');
    // Finish hashing rejected input without retaining more mesh data. Diagnostics
    // identify the full bytes read, including a malformed file's unread tail.
    if(!reading.rejection){try{decoder.write(data);}catch(error){reading.rejection=error;}}
    progress({stage:'read-source',completed:reading.bytes,total:size,percent:size?100*reading.bytes/size:100,triangles:decoder.triangles.length});
  }
    if(reading.bytes!==size)throw Error('STL file changed while reading.');
    reading.sha256=sha.digest('hex');
    if(reading.rejection)throw reading.rejection;
    const mesh=decoder.finish();return {...mesh,sha256:reading.sha256,bytes:size};
  }catch(error){throw Object.assign(meshAllocationError(error,'STL decoding',decoder.vertices.length,decoder.triangles.length),
    {stlSource:{sha256:reading.sha256,bytes:reading.bytes,complete:reading.sha256!==null,vertices:decoder.vertices.length,triangles:decoder.triangles.length}});}
}
