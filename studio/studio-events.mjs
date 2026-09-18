// One agent-owned queue of Studio observations, shared by that agent's Studio
// instances. Held kinds wait until the agent reads; delivered kinds push at once
// and carry everything held with them. Reads drain the queue; pushes do not, so
// a client that never surfaces a push still receives the batch on its next read.
export const DELIVERED_KINDS=new Set(['tour-started','tour-lesson','tour-exited','tour-finished','request-queued','request-presented',
  'generation-failed','generation-cancelled','import-completed','import-failed','print-opened','export-delivered']);
export const HELD_KINDS=new Set(['viewer-opened','viewer-closed','view-presented','generation-started','generation-finished','approved',
  'tour-playback','import-started','example-adopted','plan-updated']);
export const EVENT_KINDS=[...DELIVERED_KINDS,...HELD_KINDS];
const clone=({key,...event})=>structuredClone(event);

export function createStudioEvents({now=Date.now,limit=200,historyLimit=100}={}){
  const queued=[],recent=[],listeners=new Set(),waiters=new Set();let seq=0,closed=false;
  const wake=()=>{for(const done of [...waiters])done();};
  const pendingDelivery=()=>queued.some(event=>event.delivery==='delivered');
  function record(kind,detail={}){
    if(closed)return null;
    if(!DELIVERED_KINDS.has(kind)&&!HELD_KINDS.has(kind))throw Error('Unknown Studio event kind: '+kind);
    const key=JSON.stringify([kind,detail]),last=queued.at(-1);
    if(last&&last.key===key)return clone(last); // Repeated identical observations add nothing.
    // Detail never overrides the queue's own fields.
    const event={...detail,seq:++seq,at:now(),kind,delivery:DELIVERED_KINDS.has(kind)?'delivered':'held',key};
    queued.push(event);
    if(queued.length>limit)recent.push(...queued.splice(0,queued.length-limit).map(clone));
    if(recent.length>historyLimit)recent.splice(0,recent.length-historyLimit);
    if(event.delivery==='delivered'){const batch=queued.map(clone);for(const listener of [...listeners])listener(batch);wake();}
    return clone(event);
  }
  return {
    record,pendingDelivery,
    get size(){return queued.length;},
    peek(){return queued.map(clone);},
    drain(){const batch=queued.splice(0).map(clone);recent.push(...batch);if(recent.length>historyLimit)recent.splice(0,recent.length-historyLimit);return batch;},
    history(){return recent.map(event=>structuredClone(event));},
    subscribe(listener){if(typeof listener!=='function')throw Error('Event listener must be a function.');listeners.add(listener);return()=>{listeners.delete(listener);};},
    // Resolves when a delivered-class event is queued, on timeout, on close or
    // when the signal aborts. The caller drains; held events never wake a wait.
    wait({waitMs=25000,signal}={}){
      const remaining=Math.min(25000,Math.max(0,waitMs));
      if(closed||pendingDelivery()||remaining<=0||signal?.aborted)return Promise.resolve(pendingDelivery());
      return new Promise(resolve=>{
        let timer;const done=()=>{clearTimeout(timer);waiters.delete(done);signal?.removeEventListener('abort',done);resolve(pendingDelivery());};
        waiters.add(done);timer=setTimeout(done,remaining);timer.unref?.();signal?.addEventListener('abort',done,{once:true});
      });
    },
    close(){closed=true;listeners.clear();wake();}
  };
}
