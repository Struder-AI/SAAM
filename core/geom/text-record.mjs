// Persisted text results are native meshes with their editable construction recipe.
import {createHash} from 'node:crypto';
import {requireThat} from './tolerance.mjs';

export const textTemplate=()=>({shape:'text',base:null,features:[],toleranceMm:0.02,maxEdgeMm:1,vertices:[],triangles:[],compiledHash:''});
export function textDigest(record){
  const {compiledHash,...content}=record;
  return createHash('sha256').update(JSON.stringify(content,function(_key,value){
    return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value;
  })).digest('hex');
}
export function validateTextRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(textTemplate()).sort().join(),'Unexpected text geometry fields.');
  requireThat(Array.isArray(record.features)&&record.features.length>0&&record.compiledHash===textDigest(record),'Text recipe or mesh changed. Rebuild with the text skill (apply_text / shell text).');
}
