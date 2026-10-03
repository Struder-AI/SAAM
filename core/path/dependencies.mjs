import {createHash} from 'node:crypto';
import {resolveSpatialPlan} from '../print/spatial-inputs.mjs';

export const PATH_CONTRACT='saam-deposition/13';
export const NEUTRAL_PATH_CONTRACT='saam-neutral-motion/1';
// Only authored deposition inputs affect the saved path. Output and installed
// machine settings are checked while preparing the selected machine program.
export function pathDependencies(plan){
  plan=resolveSpatialPlan(plan);
  const {output,setup,...authored}=plan;
  const materialIntent={nozzleC:setup?.nozzleC,
    defaultFilament:setup?.bambu?.filament??null,
    filaments:setup?.bambu?.filaments?.map(entry=>entry?{nozzleC:entry.nozzleC??null,process:entry.process??{}}:null)??null};
  const skills=Object.fromEntries(Object.entries(plan.skills??{}).filter(([id,config])=>!['supports','plastic-weld'].includes(id)||config?.enabled));
  return {plan:{...authored,skills,materialIntent},contract:PATH_CONTRACT,completion:NEUTRAL_PATH_CONTRACT};
}
export function pathInputHash(plan){
  const canonical=JSON.stringify(pathDependencies(plan),function(key,value){return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value;});
  return createHash('sha256').update(canonical).digest('hex');
}
