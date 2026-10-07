// Persisted text results are native meshes with their editable construction recipe.
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};


// Every record carries its derived material partitions. standalone is present
// only on a reference body, so it stays optional.
export const textTemplate=(record={})=>({shape:'text',base:null,features:[],toleranceMm:0.02,maxEdgeMm:1,vertices:[],triangles:[],materialParts:[],
  ...(Object.hasOwn(record,'standalone')?{standalone:false}:{})});
export function validateTextRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(textTemplate(record)).sort().join(),'Unexpected text geometry fields.');
  requireThat(Array.isArray(record.features)&&record.features.length>0,'Text needs saved features.');
  requireThat(record.standalone===undefined||typeof record.standalone==='boolean','Invalid standalone text setting.');
  requireThat(Array.isArray(record.materialParts),'Invalid text material partitions.');
  const ids=new Set();
  for(const part of record.materialParts){
    requireThat(part&&Object.keys(part).sort().join()==='geometry,id'&&!ids.has(part.id),'Invalid or duplicate text material partition.');ids.add(part.id);
    requireThat(part.id==='base'?!record.standalone&&record.base:record.features.some(f=>f.mode==='raised'&&part.id==='text/'+f.id),'Unknown text material partition.');
    requireThat(part.geometry===null?part.id==='base':part.geometry?.shape==='mesh','Invalid text material geometry.');
  }
}
export const textRecordRuntime=()=>({validate:validateTextRecord});
