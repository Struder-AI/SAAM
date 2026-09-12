// Explicit preprocessing only. The resulting STL enters the normal importer,
// Studio geometry review, locked-plan review and exact-export review afterward.
import {mkdir,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {decodeSTL,cleanTriangleSoup,reconstructMesh,validateRepair} from '../geom/mesh-repair.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {simplifyRepair} from '../geom/mesh-simplify.mjs';
import {triangleIndex,checkAdjacentContacts} from '../geom/mesh-spatial.mjs';
import {hash} from './plan.mjs';
import {requireThat} from '../geom/tolerance.mjs';

export function repairSTL(sourceBytes,{units,resolutionMm,maxGridPoints,maxOutputTriangles,fillRule='nonzero',targetTriangles=80000,maxPlaneErrorMm=0.05,progress=()=>{}}={}) {
  requireThat(Number.isFinite(resolutionMm)&&resolutionMm>0,'Specify a positive repair resolutionMm in millimeters.');
  requireThat(['nonzero','evenodd'].includes(fillRule),'Repair fillRule must be nonzero or evenodd.');
  requireThat(Number.isSafeInteger(targetTriangles)&&targetTriangles>=4&&targetTriangles<=100000,'Repair targetTriangles must be 4–100000.');
  requireThat(Number.isFinite(maxPlaneErrorMm)&&maxPlaneErrorMm>0,'Repair maxPlaneErrorMm must be positive.');
  const started=performance.now();
  const input=decodeSTL(sourceBytes,{units}),clean=cleanTriangleSoup(input);let result,sourceError;
  try{makeMesh(clean.vertices,clean.triangles);checkAdjacentContacts(clean);result={...clean,report:{method:'exact-cleanup/1',removed:clean.removed,inputTriangles:input.triangles.length,limitations:[]}};}catch(error){sourceError=error.message;}
  if(!result){
    result=reconstructMesh(input,{resolutionMm,maxGridPoints,maxOutputTriangles,fillRule,progress});
    if(result.triangles.length>targetTriangles)result=simplifyRepair(result,{targetTriangles,maxPlaneErrorMm,progress});
  }
  progress({stage:'validate',triangles:result.triangles.length});
  requireThat(result.triangles.length<=100000,`Repair still has ${result.triangles.length} triangles, above the 100000-triangle importer limit. Review maxPlaneErrorMm or resolutionMm explicitly; no repaired file was saved.`);
  const repairedBytes=validateRepair(result),sourceIndex=triangleIndex(clean.vertices,clean.triangles),repairedIndex=triangleIndex(result.vertices,result.triangles);
  // Bidirectional vertex samples expose removed thin features; these are samples,
  // not a Hausdorff bound, and include discarded internal intersection surfaces.
  const maxDistance=(points,index)=>points.reduce((max,p)=>Math.max(max,index.nearest(p).distance),0);
  const report={schema:'saam-mesh-repair/1',sourceSha256:hash(sourceBytes),sourceUnits:units,outputUnits:'mm',repairedSha256:hash(repairedBytes),sourceValidationError:sourceError??null,...result.report,
    inputBoundsMm:sourceIndex.bounds,outputBoundsMm:repairedIndex.bounds,outputTriangles:result.triangles.length,
    sampledDistanceMm:{sourceVerticesToResult:maxDistance(clean.vertices,repairedIndex),resultVerticesToSource:maxDistance(result.vertices,sourceIndex),coverage:'Vertices only; not a certified surface bound.'},
    validation:'Shared makeMesh, repair adjacent-contact checks and reimport of the exact output STL passed. Numerical intersection tolerance is 1e-9 mm; this is not an exact arithmetic solid-kernel proof.',geometryApproved:false};
  report.elapsedSeconds=(performance.now()-started)/1000;
  return {repairedBytes,report};
}

export async function repairSTLFiles(directory,sourceBytes,options) {
  try{await access(directory);throw Object.assign(new Error('EEXIST: repair destination already exists.'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
  const {repairedBytes,report}=repairSTL(sourceBytes,options);
  // Refuse existing directories rather than overwrite another repair or print.
  await mkdir(directory,{recursive:false});
  await writeFile(join(directory,'original.stl'),sourceBytes,{flag:'wx'});
  await writeFile(join(directory,'repaired.stl'),repairedBytes,{flag:'wx'});
  await writeFile(join(directory,'repair.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}
