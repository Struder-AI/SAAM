// Explicit field -> manufacturing mesh conversion, shared by slicing and Studio.
import {solidKernel,preciseSolidMesh} from './solid.mjs';
import {makeMesh} from './mesh.mjs';
import {createSplineFieldEvaluator} from './spline-field.mjs';
import {SPLINE_FIELD_COMPILER,validateSplineFieldExtraction,splineFieldDigest} from './spline-field-record.mjs';
import {requireThat} from './tolerance.mjs';

export const compileSplineField=(field,options)=>extractSplineField(field,options,true);
// Display extraction is deliberately not a manufacturing validation gate.
export const previewSplineField=(field,options)=>extractSplineField(field,options,false);
async function extractSplineField(field,{edgeMm,maxEvaluations=2000000}={},check){
  field=structuredClone(field);
  const evaluate=createSplineFieldEvaluator(field);
  const extraction={compiler:SPLINE_FIELD_COMPILER,edgeMm,maxEvaluations};validateSplineFieldExtraction(extraction);
  const min=field.originMm,max=min.map((v,i)=>v+field.sizeMm[i]),padding=2*edgeMm;
  let evaluations=0;
  // Extend the boundary values outside the domain, extract in a padded box,
  // then clip to the exact design domain. This keeps the extractor's implicit
  // grid caps away from manufacturing boundaries, including a bed-flush face.
  // Offset the sampling lattice from the clipping planes. A coincident lattice
  // edge can collapse separate surface fans onto a cap vertex during clipping.
  const phase=[.173,.317,.419].map(v=>v*edgeMm);
  const bounds={min:min.map((v,a)=>v-padding+phase[a]),max:max.map((v,a)=>v+padding+phase[a])};
  requireThat([...bounds.min,...bounds.max].every(Number.isFinite),'Spline field extraction bounds overflow.');
  // Reject an obviously oversized grid before WASM allocates it. The callback
  // also enforces the actual evaluation budget; this estimate is a lower bound.
  const gridEstimate=bounds.min.reduce((n,v,i)=>n*Math.ceil((bounds.max[i]-v)/edgeMm),1);
  requireThat(Number.isSafeInteger(gridEstimate)&&gridEstimate<=maxEvaluations,`Spline field extraction grid exceeds maxEvaluations (${maxEvaluations}); increase it explicitly or increase edgeMm.`);
  const kernel=await solidKernel();let raw,box,solid;
  try{
    raw=kernel.Manifold.levelSet(point=>{
      requireThat(++evaluations<=maxEvaluations,`Spline field extraction exceeds maxEvaluations (${maxEvaluations}); increase it explicitly or increase edgeMm.`);
      return evaluate(point.map((v,i)=>Math.max(min[i],Math.min(max[i],v)))).value-field.isoValue;
    },bounds,edgeMm,0,-1);
    const cube=kernel.Manifold.cube(field.sizeMm);try{box=cube.translate(min);}finally{cube.delete();}
    solid=raw.intersect(box);
    requireThat(solid.status()==='NoError'&&!solid.isEmpty(),'Spline field extraction is empty or invalid; check the threshold and extraction resolution.');
    const {vertices,triangles}=preciseSolidMesh(solid);
    if(check)makeMesh(vertices,triangles);
    const record={shape:'spline-field',field:structuredClone(field),extraction,vertices,triangles};
    return {...record,compiledHash:splineFieldDigest(record)};
  }finally{solid?.delete();box?.delete();raw?.delete();}
}
