// Explicit field -> manufacturing mesh conversion, shared by slicing and Studio.
import {solidKernel,preciseSolidMesh} from './solid.mjs';
import {makeMesh} from './mesh.mjs';
import {createVoxelEvaluator} from './voxel.mjs';
import {VOXEL_COMPILER,validateVoxelExtraction,voxelDigest} from './voxel-record.mjs';
import {requireThat} from './tolerance.mjs';

export const compileVoxel=(field,options)=>extractVoxel(field,options,true);
// Display extraction is deliberately not a manufacturing validation gate.
export const previewVoxel=(field,options)=>extractVoxel(field,options,false);
async function extractVoxel(field,{edgeMm,maxEvaluations=2000000}={},check){
  field=structuredClone(field);
  const evaluate=createVoxelEvaluator(field);
  const extraction={compiler:VOXEL_COMPILER,edgeMm,maxEvaluations};validateVoxelExtraction(extraction);
  const min=field.originMm,max=min.map((v,i)=>v+field.sizeMm[i]),padding=2*edgeMm;
  let evaluations=0;
  // Extend the boundary values outside the domain, extract in a padded box,
  // then clip to the exact design domain. This keeps the extractor's implicit
  // grid caps away from manufacturing boundaries, including a bed-flush face.
  // Offset the sampling lattice from the clipping planes. A coincident lattice
  // edge can collapse separate surface fans onto a cap vertex during clipping.
  const phase=[.173,.317,.419].map(v=>v*edgeMm);
  const bounds={min:min.map((v,a)=>v-padding+phase[a]),max:max.map((v,a)=>v+padding+phase[a])};
  requireThat([...bounds.min,...bounds.max].every(Number.isFinite),'Voxel extraction bounds overflow.');
  // Reject an obviously oversized grid before WASM allocates it. The callback
  // also enforces the actual evaluation budget; this estimate is a lower bound.
  const gridEstimate=bounds.min.reduce((n,v,i)=>n*Math.ceil((bounds.max[i]-v)/edgeMm),1);
  requireThat(Number.isSafeInteger(gridEstimate)&&gridEstimate<=maxEvaluations,`Voxel extraction grid exceeds maxEvaluations (${maxEvaluations}); increase it explicitly or increase edgeMm.`);
  const kernel=await solidKernel();let raw,box,solid;
  try{
    raw=kernel.Manifold.levelSet(point=>{
      requireThat(++evaluations<=maxEvaluations,`Voxel extraction exceeds maxEvaluations (${maxEvaluations}); increase it explicitly or increase edgeMm.`);
      return evaluate(point.map((v,i)=>Math.max(min[i],Math.min(max[i],v)))).value-field.isoValue;
    },bounds,edgeMm,0,-1);
    const cube=kernel.Manifold.cube(field.sizeMm);try{box=cube.translate(min);}finally{cube.delete();}
    solid=raw.intersect(box);
    requireThat(solid.status()==='NoError'&&!solid.isEmpty(),'Voxel extraction is empty or invalid; check the threshold and extraction resolution.');
    const {vertices,triangles}=preciseSolidMesh(solid);
    if(check)makeMesh(vertices,triangles);
    const record={shape:'voxel',field:structuredClone(field),extraction,vertices,triangles};
    return {...record,compiledHash:voxelDigest(record)};
  }finally{solid?.delete();box?.delete();raw?.delete();}
}
