import {randomUUID} from 'node:crypto';
// One chat's queue of Studio observations, shared by that agent's Studio
// instances. Held kinds wait until delivery; delivered kinds push at once
// and carry everything held with them. Reads retain events until explicit
// acknowledgement, so a client that misses a push can read the same observations.
// Observers see every recorded event, held or delivered, and never drain.
export const DELIVERED_KINDS=new Set(['chat-attached','chat-detached','chat-captured','tour-started','tour-lesson','tour-exited','tour-finished','request-queued','request-presented','view-failed','handback-failed',
  'geometry-completed','geometry-failed','geometry-cancelled','generation-failed','generation-cancelled','import-completed','import-failed','import-repair-started','import-cancelled','bundle-share-completed','bundle-share-failed','bundle-share-cancelled','print-opened','export-ready','export-cancelled','export-delivered','workspace-opened','workspace-closed','workspace-bundles-completed','workspace-bundles-failed','workspace-bundle-visible','workspace-bundle-view-failed']);
// export-delivered remains readable for legacy observations; new exports emit
// export-ready when captured program bytes have been prepared for download.
export const HELD_KINDS=new Set(['events-elided','viewer-opened','viewer-closed','view-presented','inspection-presented','geometry-started','generation-started','generation-finished','approved',
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
  const gaps={queued:null,recent:null};
  function elided(previous,events){
    const all=[...(previous?[previous]:[]),...events],firstOmittedSeq=Math.min(...all.map(event=>event.firstOmittedSeq??event.seq)),lastOmittedSeq=Math.max(...all.map(event=>event.lastOmittedSeq??event.seq));
    return {id:randomUUID(),seq:lastOmittedSeq,at:now(),kind:'events-elided',delivery:'held',partial:true,
      omittedEvents:all.reduce((count,event)=>count+(event.omittedEvents??1),0),
      firstOmittedSeq,lastOmittedSeq,
      message:'Earlier Studio observations were elided from this bounded queue. Read current state before acting.'};
  }
  const batch=()=>[...(gaps.queued?[structuredClone(gaps.queued)]:[]),...queued.map(clone)];
  function retain(events){
    recent.push(...events);
    recent.sort((a,b)=>a.seq-b.seq);
    if(recent.length>historyLimit)gaps.recent=elided(gaps.recent,recent.splice(0,recent.length-historyLimit));
  }
  const pendingDelivery=()=>queued.some(event=>event.delivery==='delivered');
  function record(kind,detail={}){
    if(closed)return null;
    if(!DELIVERED_KINDS.has(kind)&&!HELD_KINDS.has(kind))throw Error('Unknown Studio event kind: '+kind);
    const key=JSON.stringify([kind,detail]),last=queued.at(-1);
    if(last&&last.key===key)return clone(last); // Repeated identical observations add nothing.
    // Detail never overrides the queue's own fields.
    const event={...detail,id:randomUUID(),seq:++seq,at:now(),kind,delivery:DELIVERED_KINDS.has(kind)?'delivered':'held',key};
    queued.push(event);
    if(queued.length>limit)gaps.queued=elided(gaps.queued,queued.splice(0,queued.length-limit).map(clone));
    for(const observer of [...observers]){
      let promise;
      try{const result=observer(clone(event));if(result?.then)promise=Promise.resolve(result);}
      catch(error){promise=Promise.reject(error);}
      // Recording a fact cannot undo domain work. Explicit flush below still
      // requires observer delivery and retains the failed event for retry.
      if(promise){const delivery={observer,event:clone(event),promise};pending.add(delivery);void promise.catch(()=>{});}
    }
    if(event.delivery==='delivered')for(const listener of [...listeners]){
      try{Promise.resolve(listener(batch())).catch(()=>{});}catch{/* Wake notifications do not own the event. */}
    }
    return clone(event);
  }
  return {
    record,pendingDelivery,
    pending(){return {events:batch(),cursor:seq};},
    read({afterSeq=0}={}){
      const events=[...(gaps.recent?[structuredClone(gaps.recent)]:[]),...recent.map(event=>structuredClone(event)),...batch()];
      return {events:events.filter(event=>event.seq>afterSeq).sort((a,b)=>a.seq-b.seq),cursor:seq};
    },
    acknowledge(throughSeq){
      if(!Number.isInteger(throughSeq)||throughSeq<0||throughSeq>seq)throw Error('Acknowledge a returned Studio event cursor.');
      const acknowledged=queued.filter(event=>event.seq<=throughSeq).map(clone);
      const gap=gaps.queued&&gaps.queued.seq<=throughSeq?[structuredClone(gaps.queued)]:[];
      const remaining=queued.filter(event=>event.seq>throughSeq);queued.length=0;queued.push(...remaining);
      if(gap.length)gaps.queued=null;
      retain([...gap,...acknowledged]);
      return {status:'completed',throughSeq};
    },
    acknowledgeIds(eventIds){
      if(!Array.isArray(eventIds)||eventIds.some(id=>typeof id!=='string'||!id))throw Error('Acknowledge delivered Studio event IDs.');
      const ids=new Set(eventIds),acknowledged=queued.filter(event=>ids.has(event.id)).map(clone);
      const gap=gaps.queued&&ids.has(gaps.queued.id)?[structuredClone(gaps.queued)]:[];
      const remaining=queued.filter(event=>!ids.has(event.id));queued.length=0;queued.push(...remaining);
      if(gap.length)gaps.queued=null;
      retain([...gap,...acknowledged]);
      return {acknowledged:true};
    },
    async flush(){
      for(const delivery of [...pending]){
        try{await delivery.promise;pending.delete(delivery);}
        catch(error){delivery.promise=Promise.resolve().then(()=>delivery.observer(clone(delivery.event)));void delivery.promise.catch(()=>{});throw error;}
      }
    },
    drain(){const result=batch();queued.length=0;gaps.queued=null;retain(result);return result;},
    history(){return [...(gaps.recent?[structuredClone(gaps.recent)]:[]),...recent.map(event=>structuredClone(event))];},
    subscribe(listener){if(typeof listener!=='function')throw Error('Event listener must be a function.');listeners.add(listener);return()=>{listeners.delete(listener);};},
    observe(observer){if(typeof observer!=='function')throw Error('Event observer must be a function.');observers.add(observer);return()=>{observers.delete(observer);};},
    close(){closed=true;listeners.clear();observers.clear();}
  };
}
