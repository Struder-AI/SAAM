// Persisted text results are native meshes with their editable construction recipe.
import {createHash} from 'node:crypto';
import {requireThat} from './tolerance.mjs';

// Optional derived material partitions leave pre-partition text records valid.
export const textTemplate=(record={})=>({shape:'text',base:null,features:[],toleranceMm:0.02,maxEdgeMm:1,vertices:[],triangles:[],compiledHash:'',
  ...(Object.hasOwn(record,'materialParts')?{materialParts:[]}:{}),
  ...(Object.hasOwn(record,'standalone')?{standalone:false}:{})});
export function textDigest(record){
  const {compiledHash,...content}=record;
  return createHash('sha256').update(JSON.stringify(content,function(_key,value){
    return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value;
  })).digest('hex');
}
export function validateTextRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(textTemplate(record)).sort().join(),'Unexpected text geometry fields.');
  requireThat(Array.isArray(record.features)&&record.features.length>0,'Text needs saved features.');
  requireThat(record.standalone===undefined||typeof record.standalone==='boolean','Invalid standalone text setting.');
  if(record.materialParts!==undefined){
    requireThat(Array.isArray(record.materialParts),'Invalid text material partitions.');
    const ids=new Set();
    for(const part of record.materialParts){
      requireThat(part&&Object.keys(part).sort().join()==='geometry,id'&&!ids.has(part.id),'Invalid or duplicate text material partition.');ids.add(part.id);
      requireThat(part.id==='base'?!record.standalone&&record.base:record.features.some(f=>f.mode==='raised'&&part.id==='text/'+f.id),'Unknown text material partition.');
      requireThat(part.geometry===null?part.id==='base':part.geometry?.shape==='mesh','Invalid text material geometry.');
    }
  }
  requireThat(record.compiledHash===textDigest(record),'Text recipe or mesh changed. Rebuild with the text skill (apply_text / shell text).');
}
