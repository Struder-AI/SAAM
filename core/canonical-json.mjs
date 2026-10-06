// SAAM's one canonical JSON: the semantic identity behind bundle, geometry,
// path and extension hashes. Output is exactly JSON.stringify with every
// non-array object's keys rebuilt in sorted order (array-index keys first in
// numeric order, as property order puts them, then the rest by UTF-16 code
// unit). Arrays of primitives and nested such arrays (mesh vertices and
// triangles) go to the native serializer whole, which writes the same bytes.
import {createHash} from 'node:crypto';

export function canonicalJson(value){return serialize(value,'');}
export const canonicalHash=value=>createHash('sha256')
  .update(typeof value==='string'||value instanceof Uint8Array?value:canonicalJson(value)).digest('hex');

const INDEX_KEY=/^(?:0|[1-9]\d{0,9})$/;
const indexKey=key=>INDEX_KEY.test(key)&&Number(key)<=4294967294;
// A property's text, or undefined where JSON omits it (undefined, functions, symbols).
function serialize(value,key){
  if(value!==null&&(typeof value==='object'||typeof value==='bigint')&&typeof value.toJSON==='function')value=value.toJSON(String(key));
  if(typeof value==='number')return Number.isFinite(value)?String(value):'null';
  if(typeof value!=='object'||value===null)return JSON.stringify(value);
  if(Array.isArray(value)){
    if(primitiveArray(value))return JSON.stringify(value);
    const parts=new Array(value.length);
    for(let i=0;i<value.length;i++)parts[i]=serialize(value[i],i)??'null';
    return `[${parts.join(',')}]`;
  }
  const keys=Object.keys(value).sort(),indices=keys.filter(indexKey),parts=[];
  for(const name of indices.length?[...indices.sort((a,b)=>a-b),...keys.filter(k=>!indexKey(k))]:keys){
    const text=serialize(value[name],name);if(text!==undefined)parts.push(`${JSON.stringify(name)}:${text}`);
  }
  return `{${parts.join(',')}}`;
}
// Numbers, strings, booleans, null and arrays of them, with no toJSON.
function primitiveArray(list){
  if(typeof list.toJSON==='function')return false;
  for(let i=0;i<list.length;i++){
    const item=list[i],type=typeof item;
    if(type==='number'||type==='string'||type==='boolean'||item===null)continue;
    if(!Array.isArray(item)||!primitiveArray(item))return false;
  }
  return true;
}
