import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {observationChunkBytes} from './observation-json.mjs';

const leases=new Set();
export function trackObservationLease(directory,ownerId='standalone',lease){
  const entry={directory:resolve(directory),ownerId,close:null};let closing;
  const close=()=>{if(!closing)closing=Promise.resolve().then(()=>lease.close()).finally(()=>leases.delete(entry));return closing;};entry.close=close;leases.add(entry);
  async function* bytes(){try{yield* lease.bytes();}finally{await close();}}
  return {...lease,bytes,close};
}
export async function closeObservationLeases(directory,{ownerId='standalone'}={}){
  await Promise.all([...leases].filter(entry=>entry.directory===resolve(directory)&&entry.ownerId===ownerId).map(entry=>entry.close()));
}
// Verification and transmission share one owned handle; a final payload chunk
// remains withheld until the transmitted-byte hash agrees. Prefix/suffix are
// only the small observation envelope, never an escaped payload string.
export async function openVerifiedObservationBytes({directory,ownerId,file,valueId,byteLength,manifest,prefix='',suffix='',signal,verifyRelated}){
  signal?.throwIfAborted();const handle=await open(file,'r');let closing,closed=false,consumed=false;
  const cancel=()=>{void close().catch(()=>{});};
  const close=()=>{if(!closing){closed=true;signal?.removeEventListener('abort',cancel);closing=handle.close();}return closing;};
  signal?.addEventListener('abort',cancel,{once:true});
  const head=Buffer.from(prefix),tail=Buffer.from(suffix);let stream;
  const tracked=trackObservationLease(directory,ownerId,{manifest,byteLength:head.length+byteLength+tail.length,contentType:'application/json',bytes:()=>stream(),close});
  try{
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(observationChunkBytes);let position=0;
    for(;;){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
    if(position!==byteLength||hash.digest('hex')!==valueId)throw Error('Retained JSON bytes changed.');
    await verifyRelated?.();signal?.throwIfAborted();
    async function* bytes(){
      if(consumed||closed)throw Error('Observation byte lease is closed or consumed.');consumed=true;
      const hash=createHash('sha256');let position=0,pending=null;
      try{
        if(head.length)yield head;
        for(;;){signal?.throwIfAborted();const buffer=Buffer.allocUnsafe(observationChunkBytes),{bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;
          const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);position+=bytesRead;if(pending)yield pending;pending=chunk;}
        if(position!==byteLength||hash.digest('hex')!==valueId)throw Error('Retained JSON bytes changed during transfer.');
        if(pending)yield pending;if(tail.length)yield tail;
      }finally{await close();}
    }
    stream=bytes;return tracked;
  }catch(error){await tracked.close();throw error;}
}
