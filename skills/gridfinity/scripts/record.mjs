import {createHash} from 'node:crypto';
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const gridfinityTemplate=()=>({shape:'gridfinity',parameters:null,vertices:[],triangles:[],compiledHash:''});
export function gridfinityDigest({compiledHash,...content}){
  return createHash('sha256').update(JSON.stringify(content,(_key,value)=>
    value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');
}
export function validateGridfinityRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(gridfinityTemplate()).sort().join(),'Unexpected gridfinity geometry fields.');
  requireThat(record.parameters&&record.compiledHash===gridfinityDigest(record),'Gridfinity recipe or mesh changed. Rebuild with the gridfinity skill.');
}
