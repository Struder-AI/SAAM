// Engine prerequisites already encoded by the recipe's geometry, constructions
// and selected skill settings. The bundle keeps those values as supplied.
import {resolveExtensions} from '../extensions/library.mjs';

const geometryExtensions={text:'text',gridfinity:'gridfinity','heat-set':'heat-set-inserts'};

function geometryIds(geometry,ids){
  if(!geometry||typeof geometry!=='object')return;
  if(geometryExtensions[geometry.shape])ids.add(geometryExtensions[geometry.shape]);
  if(geometry.base)geometryIds(geometry.base,ids);
  for(const part of geometry.parts??[])geometryIds(part.geometry,ids);
  for(const operand of geometry.operands??[])geometryIds(operand,ids);
}

export function requiredExtensionIds(plan){
  const ids=new Set();
  geometryIds(plan.geometry,ids);
  for(const assignment of plan.slices?.assignments??[])
    if(assignment.join)ids.add('vase-wall');
    else if(assignment.construction==='sleeve')ids.add(assignment.pattern===null?'vase-wall':'advanced-vase-wall');
  for(const [id,settings] of Object.entries(plan.skills??{}))
    if(settings?.enabled)ids.add(id);
  return [...ids].sort();
}

export async function requireGenerationExtensions(plan,options){
  return resolveExtensions(requiredExtensionIds(plan),options);
}
