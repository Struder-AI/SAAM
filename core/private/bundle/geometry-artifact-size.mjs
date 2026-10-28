// Optional cache accounting, not a serializer or a limit on accepted geometry.
// Packed backing buffers are exact. JS containers/slots/strings use a size
// model; their engine overhead cannot be measured exactly from these values.
export function geometryArtifactBytes(artifact,limit){
  const seen=new WeakSet(),buffers=new WeakSet(),stack=[];let bytes=1024;
  const keys=function*(value){for(const key in value)if(Object.hasOwn(value,key))yield key;};
  const include=value=>{
    if(typeof value==='string'){bytes+=24+2*value.length;return;}
    if(value===null||typeof value==='number'||typeof value==='boolean'||value===undefined)return;
    if(typeof value!=='object'){bytes=Infinity;return;}
    if(seen.has(value))return;seen.add(value);bytes+=64;
    if(ArrayBuffer.isView(value)){
      if(!buffers.has(value.buffer)){buffers.add(value.buffer);bytes+=value.buffer.byteLength;}
    }else if(value instanceof ArrayBuffer||typeof SharedArrayBuffer!=='undefined'&&value instanceof SharedArrayBuffer){
      if(!buffers.has(value)){buffers.add(value);bytes+=value.byteLength;}
    }else if(Array.isArray(value)){
      bytes+=8*value.length;stack.push({value,index:0});
    }else if(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)stack.push({value,keys:keys(value)});
    else bytes=Infinity; // Unknown/native ownership remains outside this cache.
  };
  try{
    include(artifact);
    while(stack.length&&bytes<=limit){
      const frame=stack.at(-1);
      if(frame.keys){const next=frame.keys.next();if(next.done){stack.pop();continue;}
        bytes+=24+2*next.value.length;include(frame.value[next.value]);
      }else if(frame.index===frame.value.length)stack.pop();
      else include(frame.value[frame.index++]);
    }
    return bytes<=limit?bytes:Infinity;
  }catch{return Infinity;}
}
