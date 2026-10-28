// Engine prerequisites already encoded by the recipe's geometry, constructions
// and selected skill settings. The bundle keeps those values as supplied.
import {resolveExtensions,extensionRuntimeSourceError} from '../extensions/library.mjs';

function geometryIds(geometry,ids){
  if(!geometry||typeof geometry!=='object')return;
  if(geometry.shape==='extension')ids.add(geometry.extension);
  if(geometry.base)geometryIds(geometry.base,ids);
  if(geometry.solid)geometryIds(geometry.solid,ids);
  for(const part of geometry.parts??[])geometryIds(part.geometry,ids);
  for(const operand of geometry.operands??[])geometryIds(operand,ids);
}

// A portable recipe carries its geometry authors as well as its constructors.
export function requiredExtensionIds(plan){
  const ids=new Set(generationExtensionIds(plan));
  geometryIds(plan.geometry,ids);
  return [...ids].sort();
}

export function generationExtensionIds(plan){
  const ids=new Set();
  // Geometry records carry their completed meshes. Only executing a
  // construction needs its extension; editing geometry selects its own author.
  for(const assignment of plan.slices?.assignments??[])
    if(assignment.construction==='curves'&&assignment.source)ids.add(assignment.source.extension);
    else if(assignment.join)ids.add('vase-wall');
    else if(assignment.construction==='sleeve')ids.add(assignment.pattern===null?'vase-wall':'advanced-vase-wall');
  for(const [id,settings] of Object.entries(plan.skills??{}))
    if(settings?.enabled)ids.add(id);
  return [...ids].sort();
}

// Each executable extension contributes its own provenance or unavailable
// marker; another assignment can still construct without that extension.
export async function generationExtensionSources(plan,options){
  const records=[];
  for(const id of generationExtensionIds(plan)){
    try{
      const extensions=await resolveExtensions([id],options);
      const unavailable=extensionRuntimeSourceError(extensions);
      records.push(unavailable?{id,error:unavailable}:{id,extensions:extensions.map(({id,digest})=>({id,digest}))});
    }catch(error){
      if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
      records.push({id,error:{code:error.code??'EXTENSION_UNAVAILABLE',message:error.message}});
    }
  }
  return records;
}
