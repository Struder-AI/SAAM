import {watch} from 'node:fs';
import {readdir,stat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const valid=name=>/^[a-f0-9-]{32,64}\.json$/.test(name);
// Rebuildable process-local discovery. JSON files remain authoritative. Watches
// are hints: periodically reconcile metadata, and always reread before a write.
export function createRequestIndex(folder,{reconcileMs=5000,onChange=()=>{},onHint=()=>{}}={}){
  const entries=new Map(),dirty=new Set();
  let watcher,idle,scan=true,lastScan=0,pending,closed=false,retained=0;
  function stopWatching(){clearTimeout(idle);watcher?.close();watcher=null;scan=true;}
  function releaseLater(){clearTimeout(idle);if(watcher&&!retained){idle=setTimeout(stopWatching,2000);idle.unref();}}
  function drop(name){if(entries.delete(name))onChange(name.slice(0,-5),null);}
  async function read(name){
    const path=resolve(folder,name);
    try{
      const info=await stat(path,{bigint:true}),key=[info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
      if(entries.get(name)?.key===key)return;
      let record;
      try{record=JSON.parse(await readFile(path,'utf8'));}
      catch(error){if(!(error instanceof SyntaxError))throw error;
        record={id:name.slice(0,-5),kind:'diagnostic',status:'failed',createdAt:0,updatedAt:0,error:'Unreadable request record: '+error.message};}
      entries.set(name,{key,record});onChange(name.slice(0,-5),record);
    }catch(error){if(error.code==='ENOENT')drop(name);else throw error;}
  }
  async function refresh(force){
    if(closed)return;
    if(!watcher&&!force)try{
      watcher=watch(folder,{persistent:false},(_event,name)=>{
        if(!name)scan=true;else{name=String(name);if(valid(name))dirty.add(name);}
        onHint();
      });
      scan=true; // Include files created before this watch was attached.
      watcher.on('error',()=>{stopWatching();onHint();});
    }catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOSYS'&&error.code!=='ENOSPC')throw error;}
    // Short-lived CLI callers need no explicit disposal, and an abandoned
    // index must not retain a directory watch after its library is removed.
    releaseLater();
    if(force||scan||!watcher||Date.now()-lastScan>=reconcileMs){
      scan=false;lastScan=Date.now();
      let names;try{names=(await readdir(folder)).filter(valid);}catch(error){if(error.code!=='ENOENT')throw error;names=[];}
      const found=new Set(names);
      for(const name of entries.keys())if(!found.has(name))drop(name);
      // Bound simultaneous open files in large libraries.
      for(let offset=0;offset<names.length;offset+=32)await Promise.all(names.slice(offset,offset+32).map(read));
    }
    const changed=[...dirty];dirty.clear();
    await Promise.all(changed.map(read));
  }
  return {
    async refresh({force=false}={}){
      if(pending){await pending;if(!force&&!dirty.size&&!scan)return;}
      pending=refresh(force);try{await pending;}finally{pending=null;}
    },
    changed(id){dirty.add(id+'.json');},
    retain(){
      if(closed)return()=>{};
      retained++;clearTimeout(idle);
      return()=>{retained=Math.max(0,retained-1);releaseLater();};
    },
    close(){closed=true;stopWatching();entries.clear();dirty.clear();}
  };
}
