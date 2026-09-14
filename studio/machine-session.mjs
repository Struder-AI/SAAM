import {moveStore} from './move-store.mjs';
import {compileMachine,poseMachine} from './machine-view.mjs';

// Bounded worker requests and latest-time cache. Obsolete responses cannot paint.
export function sourceSession(worker){
  let nextId=0,closed=false,latest=null,held=null,pendingPose=null,scene=null,error='',epoch=0;
  const pending=new Map();
  const abortError=()=>new DOMException('Source session changed','AbortError');
  function rpc(type,fields={},signal){
    if(closed)return Promise.reject(abortError());
    signal?.throwIfAborted();const id=++nextId;
    return new Promise((resolve,reject)=>{
      const abort=()=>{pending.delete(id);reject(signal.reason??abortError());};
      pending.set(id,{resolve,reject,clean:()=>signal?.removeEventListener('abort',abort)});
      signal?.addEventListener('abort',abort,{once:true});worker.postMessage({id,type,...fields});
    });
  }
  worker.onmessage=({data})=>{const call=pending.get(data.id);if(!call)return;pending.delete(data.id);call.clean();data.error?call.reject(Error(data.error)):call.resolve(data);};
  worker.onerror=event=>{error=event.message||'Machine player stopped';closed=true;for(const p of pending.values()){p.clean();p.reject(Error(error));}pending.clear();worker.terminate();};
  const sourceKey=state=>JSON.stringify([state.printId,String(state.revision),state.exportHash]);
  const poseKey=(seconds,manual,jog)=>JSON.stringify([seconds,manual??null,jog??null]);
  let identity;
  function install(data,state){
    error=data.machineError??'';
    try{scene=data.descriptor?compileMachine(data.descriptor):null;}catch(e){scene=null;error=e.message;}
    identity=sourceKey(state);latest=null;held=null;pendingPose=null;epoch++;
    if(!scene){worker.terminate();closed=true;}
  }
  return {
    get scene(){return scene;},get error(){return error;},
    async load(state){const data=await rpc('load',{state});install(data,state);return {...data.program,moves:moveStore(data.program.moves)};},
    async bind(state){if(identity===sourceKey(state)||!scene||closed)return;pendingPose?.controller.abort();epoch++;latest=null;held=null;const data=await rpc('bind',{state});install(data,state);},
    held(seconds){return held?.seconds===seconds?held:null;},
    current(seconds,{manual,jog}={}){return latest?.key===poseKey(seconds,manual,jog)?latest:null;},
    sample(seconds,{signal,manual,jog}={}){
      signal?.throwIfAborted();
      const key=poseKey(seconds,manual,jog);
      if(!scene)return Promise.resolve(null);
      if(closed){latest={key,seconds,snapshot:null,pose:null};return Promise.resolve(latest);}
      if(pendingPose&&pendingPose.key!==key)pendingPose.controller.abort();
      if(latest?.key===key)return Promise.resolve(latest);
      if(pendingPose?.key===key)return pendingPose.promise;
      const controller=new AbortController(),version=epoch;
      const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
      const promise=rpc('sample',{seconds,...(manual?{manual:[...manual]}:{}),...(jog?{jog:structuredClone(jog)}:{})},controller.signal).then(({snapshot})=>{
        if(closed||epoch!==version)throw abortError();
        const result={key,seconds,snapshot,pose:poseMachine(scene,snapshot)};latest=result;if(snapshot?.status==='ready'&&result.pose)held=result;error='';return result;
      }).catch(e=>{if(e.name!=='AbortError'){error=e.message;latest={key,seconds,snapshot:null,pose:null};return latest;}throw e;})
        .finally(()=>{signal?.removeEventListener('abort',abort);if(pendingPose?.promise===promise)pendingPose=null;});
      pendingPose={key,promise,controller};return promise;
    },
    dispose(){closed=true;epoch++;pendingPose?.controller.abort();for(const p of pending.values()){p.clean();p.reject(abortError());}pending.clear();worker.terminate();latest=null;held=null;scene=null;}
  };
}

// Viewport state belongs to the mode, not the source model or playback clock.
export function machineCameras(){
  let mode='ghost',saved={};
  return {
    get mode(){return mode;},
    switch(next,current,firstMachine){if(next===mode)return current;saved[mode]=structuredClone(current);mode=next;return structuredClone(saved[next]??(next==='machine'?firstMachine:current));},
    reset(){mode='ghost';saved={};},
    refit(fit){for(const key of Object.keys(saved))saved[key]={...saved[key],fitBounds:fit(key)};},
    snapshot(current){return {mode,views:{...saved,[mode]:structuredClone(current)}};},
    restore(value){
      const valid=c=>c&&[c.yaw,c.tilt,c.zoom,...(c.pan??[])].every(Number.isFinite)&&c.zoom>0&&c.pan?.length===2&&(!c.fitBounds||c.fitBounds.min?.length===3&&c.fitBounds.max?.length===3&&[...c.fitBounds.min,...c.fitBounds.max].every(Number.isFinite));
      if(!['ghost','machine'].includes(value?.mode))return null;
      saved=Object.fromEntries(Object.entries(value.views??{}).filter(([key,c])=>['ghost','machine'].includes(key)&&valid(c)));if(!saved[value.mode])return null;mode=value.mode;return saved[mode];
    }
  };
}
