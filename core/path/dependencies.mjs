import {createHash} from 'node:crypto';

export const PATH_CONTRACT='saam-deposition/10';
export const MACHINE_PATH_CONTRACT='saam-completed-motion/1';
// Toolpath owns the dependency projection. Unknown values remain dependencies.
// These fields affect only program templates/packaging, never explicit motion.
export function pathDependencies(plan,machine){
  const {bedC,buildVolumeC,filamentColor,materialGuid,firmwareVersion,startupVerified,...setup}=plan.setup??{};
  const skills=Object.fromEntries(Object.entries(plan.skills??{}).filter(([id,config])=>!['supports','plastic-weld'].includes(id)||config?.enabled));
  return {plan:{...plan,setup,skills},machine,contract:PATH_CONTRACT,completion:MACHINE_PATH_CONTRACT};
}
export function pathInputHash(plan,machine){
  const canonical=JSON.stringify(pathDependencies(plan,machine),function(key,value){return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value;});
  return createHash('sha256').update(canonical).digest('hex');
}
