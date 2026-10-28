// Observation encoding owns its output, never a second whole JSON string.
import {createHash} from 'node:crypto';
import {openSync,writeSync,closeSync,unlinkSync,readSync} from 'node:fs';
import {open,unlink} from 'node:fs/promises';

export const observationChunkBytes=64*1024;
export {stringPieces,jsonChunks,textChunks} from './json-chunks.mjs';
function* byteChunks(chunks){
  let buffer=Buffer.allocUnsafe(observationChunkBytes),used=0;
  for(const chunk of chunks){
    if(typeof chunk==='string'){
      const size=Buffer.byteLength(chunk);
      if(size>buffer.length)throw Error('JSON encoder emitted an oversized token.');
      if(size>buffer.length-used){yield buffer.subarray(0,used);buffer=Buffer.allocUnsafe(observationChunkBytes);used=0;}
      used+=buffer.write(chunk,used);continue;
    }
    for(let offset=0;offset<chunk.length;){const size=Math.min(buffer.length-used,chunk.length-offset);buffer.set(chunk.subarray(offset,offset+size),used);used+=size;offset+=size;
      if(used===buffer.length){yield buffer;buffer=Buffer.allocUnsafe(observationChunkBytes);used=0;}}
  }
  if(used)yield buffer.subarray(0,used);
}
export function writeChunksSync(file,chunks,{control,expected}={}){
  let fd,created=false;const hash=createHash('sha256');let byteLength=0;
  try{
    fd=openSync(file,'wx');created=true;
    for(const bytes of byteChunks(chunks)){
      if(control&&Atomics.load(control,1))throw Error('Observation capture stopped.');
      let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,Math.min(observationChunkBytes,bytes.length-offset));if(!count)throw Error('Observation write made no progress.');hash.update(bytes.subarray(offset,offset+count));byteLength+=count;offset+=count;}
    }
    const valueId=hash.digest('hex');
    if(expected&&(valueId!==expected.valueId||byteLength!==expected.byteLength))throw Error('Borrowed artifact changed before observation adoption.');
    closeSync(fd);fd=undefined;return {valueId,byteLength};
  }catch(error){if(fd!==undefined)try{closeSync(fd);}catch{}if(created)try{unlinkSync(file);}catch{}throw error;}
}
export async function writeJsonChunks(file,chunks,{signal}={}){
  let handle,created=false;const hash=createHash('sha256');let byteLength=0;
  try{signal?.throwIfAborted();handle=await open(file,'wx');created=true;
    for(const chunk of byteChunks(chunks)){signal?.throwIfAborted();await handle.writeFile(chunk);hash.update(chunk);byteLength+=chunk.length;}
    await handle.close();handle=null;return {valueId:hash.digest('hex'),byteLength};
  }catch(error){await handle?.close().catch(()=>{});if(created)await unlink(file).catch(()=>{});throw error;}
}
// The caller owns the read-only file interval. Copying finishes before it can
// release/delete the source; neither the pathname nor its bytes enter a queue.
export function copyArtifactSync(file,target,{control,expected}={}){
  const fd=openSync(file,'r');
  try{
    function* chunks(){const buffer=Buffer.allocUnsafe(observationChunkBytes);let position=0;
      for(;;){const size=readSync(fd,buffer,0,buffer.length,position);if(!size)return;position+=size;yield buffer.subarray(0,size);}}
    return writeChunksSync(target,chunks(),{control,expected});
  }finally{closeSync(fd);}
}
