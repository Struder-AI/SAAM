import {randomUUID} from 'node:crypto';

// One live viewer answers each request. The transport deadline bounds an absent
// browser reply, not the geometry or path the viewer is asked to draw.
export function createViewerCapture({notify,waitMs=15_000}){
  const pending=new Map();
  function finish(id,error,frame){
    const request=pending.get(id);if(!request)return;
    pending.delete(id);clearTimeout(request.timer);
    if(error)request.reject(error);else request.resolve(frame);
  }
  function capture({bundleId,target,stage}){
    return new Promise((resolve,reject)=>{
      const id=randomUUID(),timer=setTimeout(()=>finish(id,Error('Studio viewer did not return its visual check within '+waitMs/1000+' seconds.')),waitMs);
      pending.set(id,{bundleId,target,stage,timer,resolve,reject});
      if(!notify({kind:'visual-check',id,bundleId,target,stage}))finish(id,Error('No Studio viewer is connected; no visual check was captured.'));
    });
  }
  function accept(data){
    const request=pending.get(data.id);
    if(!request)throw Error('This Studio visual check has expired.');
    const target=request.target;
    if(data.bundleId!==request.bundleId||data.stage!==request.stage
      ||['revision','inputKey','geometryKey','generationKey'].some(key=>(data.target?.[key]??null)!==(target[key]??null)))
      throw Error('The Studio visual check belongs to different saved inputs.');
    if(data.error){finish(data.id,Error('Studio '+request.stage+' view failed: '+data.error));return;}
    if(typeof data.png!=='string'||!data.png.startsWith('data:image/png;base64,'))throw Error('Studio did not return a PNG frame.');
    const png=Buffer.from(data.png.slice('data:image/png;base64,'.length),'base64');
    if(png.length<24||png.readUInt32BE(0)!==0x89504e47)throw Error('Studio returned an invalid PNG frame.');
    finish(data.id,null,{png,phases:data.phases});
  }
  function close(){for(const id of pending.keys())finish(id,Error('Studio closed before returning its visual check.'));}
  return {capture,accept,close};
}
