// Geometry converts acquired STL bytes and provenance into an authored geometry record.
import {hash} from '../private/geometry/hash.mjs';
import {parseSTL,makeMesh} from './mesh.mjs';
import {decodeSTLFile} from './stl-file.mjs';

export function inferSTLUnits(mesh,bounds){
  const size=[0,1,2].map(k=>{let min=Infinity,max=-Infinity;for(const p of mesh.vertices){min=Math.min(min,p[k]);max=Math.max(max,p[k]);}return max-min;});
  const longest=Math.max(...size),fitsInches=size.every((v,k)=>v*25.4<=bounds.max[k]-bounds.min[k]-(k<2?5:0));
  // Provisional D-030: prefer mm; only reinterpret a very small model when
  // inches give a plausible size that still fits this printer.
  return longest<10&&longest*25.4>=10&&fitsInches?'inch':'mm';
}
function geometryFromSTL(sourceHash,units,mesh,inferred=false){
  const factor=units==='inch'?25.4:1;
  const translationMm=[0,1,2].map(k=>-mesh.vertices.reduce((minimum,p)=>Math.min(minimum,p[k]*factor),Infinity));
  return {shape:'mesh',vertices:mesh.vertices.map(p=>p.map((v,k)=>v*factor+translationMm[k])),triangles:mesh.triangles,source:{format:'stl',sha256:sourceHash,units,scale:1,unitsInferred:inferred,translationMm}};
}

export async function prepareImportedGeometry(sourceBytes,{units='auto',bounds,signal,progress,attribution,repairReport}={}){
  let geometry;
  const file=typeof sourceBytes==='string',mesh=file?await decodeSTLFile(sourceBytes,{units:'mm',signal,progress}):parseSTL(sourceBytes,{units:'mm'}),inferred=units==='auto';
  if(file)makeMesh(mesh.vertices,mesh.triangles);
  if(inferred)units=inferSTLUnits(mesh,bounds);
  geometry=geometryFromSTL(file?mesh.sha256:hash(sourceBytes),units,mesh,inferred);
  if(attribution){
    if(attribution.sha256!==(repairReport?.sourceSha256??geometry.source.sha256)||repairReport&&repairReport.repairedSha256!==geometry.source.sha256)throw Error('Mesh attribution does not match the downloaded source hash or verified repair.');
    geometry.source.attribution=structuredClone(attribution);
    if(repairReport)geometry.source.repair={sourceSha256:repairReport.sourceSha256,repairedSha256:repairReport.repairedSha256};
  }
  // Centre the imported mesh on the plate. Its vertices were translated to put
  // the minimum XY at the origin, so the footprint size is the vertex span.
  const footprint=[0,1].map(k=>{let mn=Infinity,mx=-Infinity;for(const p of geometry.vertices){mn=Math.min(mn,p[k]);mx=Math.max(mx,p[k]);}return mx-mn;});
  return {geometry,footprint};
}
