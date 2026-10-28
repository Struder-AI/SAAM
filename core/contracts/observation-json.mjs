// Strict generic observation admission deliberately preserves its width cost.
export {observationChunkBytes,jsonChunks,textChunks,writeChunksSync,copyArtifactSync} from '../json-artifact.mjs';

export function jsonProblem(value,path='$',seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return null;
  if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0)?null:path+': number cannot round-trip through JSON';
  if(typeof value!=='object')return path+': '+typeof value;
  if(seen.has(value))return path+': cyclic value';
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return path+': native/non-JSON object '+(value.constructor?.name??'unknown');
  seen.add(value);
  // Generic admission deliberately keeps its existing own-key inventory cost.
  // Indexed traversal alone cannot reject hidden/additional array properties.
  const keys=Reflect.ownKeys(value);
  if(Array.isArray(value)&&(keys.length!==value.length+1||keys.some((key,index)=>index<value.length?key!==String(index):key!=='length')))
    return path+': sparse array or additional array properties';
  for(const key of keys){
    if(Array.isArray(value)&&key==='length')continue;
    if(typeof key!=='string')return path+': symbol key';
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor.enumerable)return path+'.'+key+': non-enumerable property';
    if(!Object.hasOwn(descriptor,'value'))return path+'.'+key+': accessor';
    const problem=jsonProblem(descriptor.value,path+'.'+key,seen);if(problem)return problem;
  }
  seen.delete(value);return null;
}

