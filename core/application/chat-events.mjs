import {randomUUID} from 'node:crypto';
// One chat's queue of Studio observations, shared by that agent's Studio
// instances. Held kinds wait until the agent reads; delivered kinds push at once
// and carry everything held with them. Reads drain the queue; pushes do not, so
// a client that never surfaces a push still receives the batch on its next read.
// Observers see every recorded event, held or delivered, and never drain.
export const DELIVERED_KINDS=new Set(['chat-attached','chat-detached','chat-captured','tour-started','tour-lesson','tour-exited','tour-finished','request-queued','request-presented','view-failed','handback-failed',
  'geometry-completed','geometry-failed','geometry-cancelled','generation-failed','generation-cancelled','import-completed','import-failed','import-repair-started','import-cancelled','bundle-share-completed','bundle-share-failed','bundle-share-cancelled','print-opened','export-delivered','workspace-opened','workspace-closed','workspace-bundles-completed','workspace-bundles-failed','workspace-bundle-visible','workspace-bundle-view-failed']);
export const HELD_KINDS=new Set(['viewer-opened','viewer-closed','view-presented','geometry-started','generation-started','generation-finished','approved',
  'tour-playback','import-started','bundle-share-started','example-adopted','plan-updated','workspace-design-updated','workspace-previewed','workspace-bundles-started','workspace-bundles-progress','workspace-viewer-opened','workspace-viewer-closed']);
export const EVENT_KINDS=[...DELIVERED_KINDS,...HELD_KINDS];
// Only a changed selection/input or a person requesting agent work warrants an
// idle wake. Progress, presentation and advisory observations stay in context.
const WAKE_KINDS=new Set(['print-opened','import-completed','plan-updated','example-adopted','chat-attached','chat-captured',
  'tour-started','tour-lesson','tour-exited','workspace-opened','workspace-design-updated']);
export function studioWakeEvent(events){
  return events.findLast(event=>{
    // Runtime restoration retains the selection; its observation stays in context.
    if(event.kind==='print-opened'&&event.restored===true)return false;
    return WAKE_KINDS.has(event.kind)||event.kind==='request-queued'&&event.requestKind!=='advisory';
  })??null;
}
const clone=({key,...event})=>structuredClone(event);

export function createChatEvents({now=Date.now,limit=200,historyLimit=100}={}){
  const queued=[],recent=[],listeners=new Set(),observers=new Set(),pending=new Set();let seq=0,closed=false;
  const pendingDelivery=()=>queued.some(event=>event.delivery==='delivered');
  function record(kind,detail={}){
    if(closed)return null;
    if(!DELIVERED_KINDS.has(kind)&&!HELD_KINDS.has(kind))throw Error('Unknown Studio event kind: '+kind);
    const key=JSON.stringify([kind,detail]),last=queued.at(-1);
    if(last&&last.key===key)return clone(last); // Repeated identical observations add nothing.
    // Detail never overrides the queue's own fields.
    const event={...detail,id:randomUUID(),seq:++seq,at:now(),kind,delivery:DELIVERED_KINDS.has(kind)?'delivered':'held',key};
    queued.push(event);
    if(queued.length>limit)recent.push(...queued.splice(0,queued.length-limit).map(clone));
    if(recent.length>historyLimit)recent.splice(0,recent.length-historyLimit);
    for(const observer of [...observers]){
      const result=observer(clone(event));
      if(result?.then){const delivery={observer,event:clone(event),promise:result};pending.add(delivery);void result.catch(()=>{});}
    }
    if(event.delivery==='delivered'){const batch=queued.map(clone);for(const listener of [...listeners])listener(batch);}
    return clone(event);
  }
  return {
    record,pendingDelivery,
    async flush(){
      for(const delivery of [...pending]){
        try{await delivery.promise;pending.delete(delivery);}
        catch(error){delivery.promise=delivery.observer(delivery.event);void delivery.promise.catch(()=>{});throw error;}
      }
    },
    drain(){const batch=queued.splice(0).map(clone);recent.push(...batch);if(recent.length>historyLimit)recent.splice(0,recent.length-historyLimit);return batch;},
    history(){return recent.map(event=>structuredClone(event));},
    subscribe(listener){if(typeof listener!=='function')throw Error('Event listener must be a function.');listeners.add(listener);return()=>{listeners.delete(listener);};},
    observe(observer){if(typeof observer!=='function')throw Error('Event observer must be a function.');observers.add(observer);return()=>{observers.delete(observer);};},
    close(){closed=true;listeners.clear();observers.clear();}
  };
}
