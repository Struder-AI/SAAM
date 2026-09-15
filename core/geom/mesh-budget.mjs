import {getHeapStatistics} from 'node:v8';
import {totalmem} from 'node:os';
const MiB=1048576;
export function meshMemoryBudget(){
  const configured=process.env.SAAM_MESH_MEMORY_MIB;
  const value=configured===undefined?Math.min(1536,getHeapStatistics().heap_size_limit/MiB*.4,totalmem()/MiB*.25):Number(configured);
  if(!Number.isFinite(value)||value<16)throw Error('SAAM_MESH_MEMORY_MIB must be at least 16 MiB.');
  return value*MiB;
}
// Conservative working-set estimate, not a promise about native allocator RSS.
// The same budget applies at decoding, cleanup and validation boundaries.
export function checkMeshBudget(vertices,triangles,sourceBytes=0){
  const estimated=vertices*192+triangles*512+sourceBytes,budget=meshMemoryBudget();
  if(!Number.isSafeInteger(vertices)||!Number.isSafeInteger(triangles)||vertices<0||triangles<0||vertices>0x7ffffffe||triangles>0x3ffffffe)throw Error('Mesh index capacity exceeded.');
  if(estimated>budget)throw Object.assign(new Error(`Mesh working-set estimate ${Math.ceil(estimated/MiB)} MiB exceeds the ${Math.floor(budget/MiB)} MiB budget. Increase SAAM_MESH_MEMORY_MIB with sufficient RAM and Node heap; geometry will not be simplified automatically.`),{code:'MESH_MEMORY_BUDGET',estimatedBytes:estimated,budgetBytes:budget});
  return estimated;
}
