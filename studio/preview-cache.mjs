// Versioned display cache. It never supplies manufacturing approvals or output.
const types={Float64Array,Float32Array,Uint32Array,Uint8Array};
export function encodePreview(value){
  const arrays=[];let size=0;
  const json=JSON.stringify(value,(_key,v)=>{
    if(v===undefined)return {$undefined:true};
    if(ArrayBuffer.isView(v)){size=Math.ceil(size/8)*8;const entry={$array:v.constructor.name,offset:size,length:v.length};arrays.push({entry,bytes:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)});size+=v.byteLength;return entry;}
    return v;
  });
  const header=new TextEncoder().encode(json),start=Math.ceil((8+header.length)/8)*8,buffer=new ArrayBuffer(start+size),bytes=new Uint8Array(buffer);
  new DataView(buffer).setUint32(0,1,true);new DataView(buffer).setUint32(4,header.length,true);bytes.set(header,8);
  for(const {entry,bytes:part}of arrays)bytes.set(part,start+entry.offset);
  return bytes;
}
export function decodePreview(buffer){
  const view=new DataView(buffer);if(view.getUint32(0,true)!==1)throw Error('Unsupported example display cache');
  const length=view.getUint32(4,true),start=Math.ceil((8+length)/8)*8;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,length)),(_key,v)=>{
    if(v?.$undefined)return undefined;
    if(v?.$array){const Type=types[v.$array];if(!Type)throw Error('Invalid example display column');return new Type(buffer,start+v.offset,v.length);}
    return v;
  });
}
