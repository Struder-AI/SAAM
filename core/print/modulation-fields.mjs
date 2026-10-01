import {prepareSolidDistance} from '../geom/solid-distance.mjs';

export async function prepareModulationFields(record){
  const report=[];
  const prepare=async(field,key)=>{
    if(field.kind==='solid-distance'){
      const {prepared,report:geometryReport}=await prepareSolidDistance(field.geometry,{toleranceMm:field.toleranceMm});
      report.push({key,...geometryReport});
      return {...field,prepared};
    }
    if(field.sources)return {...field,sources:await Promise.all(field.sources.map((source,i)=>prepare(source,`${key}.sources.${i}`)))};
    if(field.source)return {...field,source:await prepare(field.source,`${key}.source`)};
    return field;
  };
  const modifiers=await Promise.all(record.modifiers.map(async(modifier,i)=>({...modifier,field:await prepare(modifier.field,`modifiers.${i}.field`)})));
  return {record:{...record,modifiers},report:report.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)};
}
