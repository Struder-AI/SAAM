import {randomBytes} from 'node:crypto';

// A window owns offered bytes only until expiry, eviction or shutdown. A read
// acquires the value itself, so removing its capability cannot alter that read.
export function createDownloadCapabilities({limit=16,lifetimeMs=10*60*1000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onCleanupError=()=>{}}={}){
  const entries=new Map(),pending=new Set();let closed=false;
  function release(artifact){
    if(!artifact)return;
    const work=Promise.resolve().then(()=>artifact.release());pending.add(work);
    work.catch(error=>{try{Promise.resolve(onCleanupError(error)).catch(()=>{});}catch{}}).finally(()=>pending.delete(work));
  }
  function remove(key){
    const entry=entries.get(key);if(!entry)return;
    entries.delete(key);clearTimer(entry.timer);entry.timer=null;release(entry.value.artifact);entry.value=null;
  }
  function arm(key,entry){
    entry.timer=setTimer(()=>{
      entry.timer=null;if(entries.get(key)!==entry)return;
      if(entry.value.expiresAt>now())arm(key,entry);else remove(key);
    },Math.max(0,entry.value.expiresAt-now()));
    entry.timer.unref?.();
  }
  function stage({name,bytes,artifact,outputId,report,attribution}){
    if(closed){release(artifact);throw Error('Studio closed before the download could be offered.');}
    const at=now();for(const [key,entry] of entries)if(entry.value.expiresAt<=at)remove(key);
    if(entries.size>=limit)remove(entries.keys().next().value);
    let key;
    try{
      key=randomBytes(24).toString('hex');const expiresAt=at+lifetimeMs;
      const entry={value:{bytes,artifact,name,outputId,expiresAt},timer:null};entries.set(key,entry);arm(key,entry);
      return {url:'/api/download/'+key,name,outputId,expiresAt,report,
        ...(attribution?{attribution:stage({name:'source-attribution.json',bytes:Buffer.from(JSON.stringify(attribution,null,2)+'\n'),outputId})}:{})};
    }catch(error){if(key&&entries.has(key))remove(key);else release(artifact);throw error;}
  }
  function get(key){
    const entry=entries.get(key);if(!entry)return null;
    if(entry.value.expiresAt<=now()){remove(key);return null;}
    return entry.value;
  }
  function close(){closed=true;for(const key of entries.keys())remove(key);return Promise.allSettled([...pending]);}
  return {stage,get,close};
}
