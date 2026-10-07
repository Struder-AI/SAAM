// Admission of source-authored meshes; generated and validated geometry stays exact.
import {mergeCloseVertices} from './mesh-vertices.mjs';
import {mergeMeshVertices} from './mesh-autorefine.mjs';
import {makeMesh} from './mesh.mjs';
import {checkAdjacentContacts} from './mesh-spatial.mjs';

// Valid source solids use the same constrained collapse as reconstructed solids.
// Raw seams use coordinate normalization before ordinary artifact validation.
function sourceMeshStatus(value){
  try{makeMesh(value.vertices,value.triangles);checkAdjacentContacts(value);return {valid:true};}
  catch(error){if(error.code==='MESH_MEMORY_EXHAUSTED'||error instanceof RangeError)throw error;return {valid:false,error:error.message};}
}
export function normalizeSourceMesh(value){
  const proposal=mergeCloseVertices(value.vertices,value.triangles);
  if(!proposal.merge.mergedVertices&&!proposal.merge.collapsedTriangles)return {geometry:value,report:proposal.merge};
  const status=sourceMeshStatus(value);
  if(!status.valid)return {geometry:{...value,vertices:proposal.vertices,triangles:proposal.triangles},report:{...proposal.merge,sourceValidationError:status.error}};
  const vertices=value.vertices.length,packed={xyz:Float64Array.from(value.vertices.flat()),tri:Int32Array.from(value.triangles.flat()),source:new Uint8Array(vertices).fill(1),onSheet:new Int32Array(vertices).fill(-1)};
  const merged=mergeMeshVertices(packed),points=[],faces=[];
  for(let i=0;i<merged.xyz.length;i+=3)points.push([merged.xyz[i],merged.xyz[i+1],merged.xyz[i+2]]);
  for(let i=0;i<merged.tri.length;i+=3)faces.push([merged.tri[i],merged.tri[i+1],merged.tri[i+2]]);
  makeMesh(points,faces);checkAdjacentContacts({vertices:points,triangles:faces});
  return {geometry:{...value,vertices:points,triangles:faces},report:{...merged.merge,maxDisplacementMm:merged.merge.maxMoveMm}};
}
function retainedMeshes(geometry,meshes){
  if(!geometry)return;
  if(geometry.shape==='mesh')meshes.push(geometry);
  else if(geometry.shape==='spatial')retainedMeshes(geometry.solid,meshes);
  else if(geometry.shape==='assembly')for(const part of geometry.parts)retainedMeshes(part.geometry,meshes);
  else if(geometry.shape==='boolean')for(const operand of geometry.operands)retainedMeshes(operand,meshes);
}
function sameMesh(a,b){
  return a.vertices?.length===b.vertices?.length&&a.triangles?.length===b.triangles?.length
    &&a.vertices.every((p,i)=>p.every((v,k)=>v===b.vertices[i][k]))
    &&a.triangles.every((t,i)=>t.every((v,k)=>v===b.triangles[i][k]));
}
// Normalize only newly admitted mesh values. Existing exact arrays remain exact
// when wrapped, reordered or carried through a settings edit. Source metadata stays.
export function normalizeAuthoredGeometry(geometry,previous){
  const admitted=[],reports=[];retainedMeshes(previous,admitted);
  function normalize(value,path){
    if(!value)return value;
    if(value.shape==='spatial')return {...value,solid:normalize(value.solid,path+'/solid')};
    if(value.shape==='assembly')return {...value,parts:value.parts.map(part=>({...part,geometry:normalize(part.geometry,path+'/parts/'+part.id)}))};
    if(value.shape==='boolean')return {...value,operands:value.operands.map((operand,i)=>normalize(operand,path+'/operands/'+i))};
    if(value.shape!=='mesh'||admitted.some(mesh=>sameMesh(value,mesh)))return value;
    const normalized=normalizeSourceMesh(value);
    if(!normalized.report.mergedVertices&&!normalized.report.collapsedTriangles&&!normalized.report.remainingPairs)return value;
    reports.push({path,...normalized.report});
    return normalized.geometry;
  }
  return {geometry:normalize(geometry,'geometry'),reports};
}
