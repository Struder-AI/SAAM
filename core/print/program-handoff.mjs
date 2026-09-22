// Job-scoped provenance for machine source already checked by a Studio worker.
// Only this module can mint a ticket, and only the workflow can consume it.
import {Worker} from 'node:worker_threads';

const checkedPrograms=new WeakMap();

export function createCheckedProgramHandoff(worker,expectedGenerationHash,receive){
  if(!(worker instanceof Worker))throw new TypeError('Expected the Studio generation worker.');
  if(typeof receive!=='function')throw new TypeError('Expected a checked-output receiver.');
  let active=true,listenerDisposed=false;
  const onMessage=message=>{
    let ticket=null;
    if(active&&message.type==='generated'&&!message.error){
      const source=message.source,checks=message.checks;
      if(source&&source.generationHash===expectedGenerationHash&&source.generationHash===checks?.generationHash
        &&source.exportHash===checks?.exportHash){
        const {moves,events,...metadata}=source.metadata;
        ticket={};
        checkedPrograms.set(ticket,{generationHash:source.generationHash,exportHash:source.exportHash,
          metadata:structuredClone(metadata),code:source.code,sources:{...source.sources}});
        active=false;
      }
    }
    receive(message,ticket);
  };
  worker.on('message',onMessage);
  return {dispose(){if(!active&&listenerDisposed)return;active=false;listenerDisposed=true;worker.off('message',onMessage);}};
}

export function consumeCheckedProgram(ticket,generationHash,exportHash){
  if(!ticket||typeof ticket!=='object')return null;
  const source=checkedPrograms.get(ticket);checkedPrograms.delete(ticket);
  if(source?.generationHash!==generationHash||source.exportHash!==exportHash)return null;
  // No mutable worker-owned data escapes to workflow consumers or their callers.
  return {metadata:structuredClone(source.metadata),code:source.code,sources:{...source.sources}};
}

export function createPendingCheckedProgramStore({capacity=32,ttlMs=60000}={}){
  const entries=new Map();
  const remove=key=>{const entry=entries.get(key);if(!entry)return;clearTimeout(entry.expiry);entries.delete(key);};
  return {
    retain(key,source){
      remove(key);
      while(entries.size>=capacity)remove(entries.keys().next().value);
      const expiry=setTimeout(()=>entries.delete(key),ttlMs);expiry.unref?.();
      entries.set(key,{source,expiry});
    },
    take(key){const source=entries.get(key)?.source;remove(key);return source??null;},
    get size(){return entries.size;}
  };
}
