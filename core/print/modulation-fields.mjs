// Expensive native-solid preparation stays at the async print boundary. The
// synchronous field evaluator consumes only the returned immutable mesh data.
import {tessellateSolid} from '../geom/boolean-display.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {requireThat} from '../geom/tolerance.mjs';
export {modulationGeometrySources} from '../path/modulation-field.mjs';

export async function prepareModulationFields(record,{solids=[]}={}){
  const report=[];
  const prepare=async(field,key)=>{
    if(field.kind==='solid-distance'){
      const source=solids.find(s=>s.key===key);
      requireThat(source,`Missing evaluated modulation solid ${key}.`);
      const tessellation=await tessellateSolid(source.geometry,{toleranceMm:field.toleranceMm});
      const mesh=tessellation.kind==='triangle-mesh'?tessellation:makeMesh(tessellation.vertices,tessellation.triangles);
      report.push({key,toleranceMm:field.toleranceMm,triangles:mesh.triangles.length,representation:'tessellated solid distance; negative inside'});
      return {...field,prepared:mesh};
    }
    if(field.sources)return {...field,sources:await Promise.all(field.sources.map((source,i)=>prepare(source,`${key}.sources.${i}`)))};
    if(field.source)return {...field,source:await prepare(field.source,`${key}.source`)};
    return field;
  };
  const modifiers=await Promise.all(record.modifiers.map(async(modifier,i)=>({...modifier,field:await prepare(modifier.field,`modifiers.${i}.field`)})));
  return {record:{...record,modifiers},report:report.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)};
}
