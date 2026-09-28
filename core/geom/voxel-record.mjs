import {createHash} from 'node:crypto';
import {validateVoxelField} from './voxel.mjs';
import {requireThat} from './tolerance.mjs';

export const VOXEL_COMPILER='manifold-3d@3.5.3/level-set-linear/2';
export const voxelTemplate=()=>({shape:'voxel',field:null,extraction:null,vertices:[],triangles:[],compiledHash:''});
export function voxelDigest({compiledHash,...content}){
  return createHash('sha256').update(JSON.stringify(content,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');
}
export function validateVoxelExtraction(extraction){
  requireThat(extraction&&Object.keys(extraction).sort().join()==='compiler,edgeMm,maxEvaluations','Unexpected voxel extraction fields.');
  requireThat([VOXEL_COMPILER,'manifold-3d@3.5.3/level-set-linear/1'].includes(extraction.compiler),'Unsupported voxel compiler. Rebuild explicitly with the voxel tools.');
  requireThat(Number.isFinite(extraction.edgeMm)&&extraction.edgeMm>0,'Voxel extraction edgeMm must be positive.');
  requireThat(Number.isSafeInteger(extraction.maxEvaluations)&&extraction.maxEvaluations>0,'Voxel maxEvaluations must be a positive safe integer.');
}
export function validateVoxelRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(voxelTemplate()).sort().join(),'Unexpected voxel geometry fields.');
  validateVoxelField(record.field);validateVoxelExtraction(record.extraction);
  requireThat(record.compiledHash===voxelDigest(record),'Voxel field or mesh changed. Rebuild with the voxel tools.');
}
