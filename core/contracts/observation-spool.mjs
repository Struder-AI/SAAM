// The receiver owns staging independently of the producer worker's lifetime.
import {randomUUID} from 'node:crypto';
import {mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {opendir,readFile,unlink,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parentPort} from 'node:worker_threads';

const sessions=new Map();
export function createObservationSession(directory,retain,{ownerId='standalone'}={}){
  if(!directory)return null;
  try{
    const id=randomUUID(),folder=resolve(directory,'.staging',id),control=new Int32Array(new SharedArrayBuffer(8));mkdirSync(folder,{recursive:true});
    const producer={id,folder,directory:resolve(directory),ownerId,control};let running=null,closing=null,sealed=false,closed=false,findings=0;
    async function scan(){
      do{
        Atomics.store(control,0,0);
        const entries=await opendir(folder).catch(()=>null);if(!entries)return;
        for await(const entry of entries){
          if(!/^[a-f0-9-]{36}\.ready\.json$/.test(entry.name))continue;
          const file=resolve(folder,entry.name);
          try{const record=JSON.parse(await readFile(file,'utf8'));await retain(producer,record);}catch{findings++;}
          finally{await unlink(file).catch(()=>{});}
        }
      }while(Atomics.load(control,0));
    }
    function kick(){
      if(closed)return;
      if(!running)running=scan().catch(()=>{findings++;}).finally(()=>{running=null;if(Atomics.load(control,0))kick();else if(sealed)return cleanup();});
    }
    function cleanup(){if(closing)return closing;closed=true;closing=rm(folder,{recursive:true,force:true}).catch(()=>{findings++;}).finally(()=>sessions.delete(id));return closing;}
    async function seal(){sealed=true;kick();while(running)await running;await cleanup();return {findings};}
    const session={producer,kick,seal,async close(){Atomics.store(control,1,1);return seal();}};
    sessions.set(id,session);return session;
  }catch{return null;}
}
export function publishObservation(producer,record){
  const partial=resolve(producer.folder,record.id+'.ready.partial'),ready=resolve(producer.folder,record.id+'.ready.json');
  writeFileSync(partial,JSON.stringify(record),{flag:'wx'});renameSync(partial,ready);
  if(Atomics.compareExchange(producer.control,0,0,1)===0){const session=sessions.get(producer.id);if(session)session.kick();else parentPort?.postMessage({type:'contract-observation-ready',sessionId:producer.id});}
}
export function wakeObservationSession(sessionId){sessions.get(sessionId)?.kick();}
export async function closeObservationSessions(directory,{ownerId='standalone'}={}){
  const owned=[...sessions.values()].filter(session=>session.producer.directory===resolve(directory)&&session.producer.ownerId===ownerId);
  await Promise.all(owned.map(session=>session.close()));
}
