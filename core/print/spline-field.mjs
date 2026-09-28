import {compileSplineField} from '../geom/spline-field-compile.mjs';
import {proposedPlan,initBundle,loadBundle,updatePlan} from './bundle.mjs';
import {requireThat} from '../geom/tolerance.mjs';

export async function createSplineFieldBundle(directory,request,options={}){
  const geometry=await compileRequest(request),plan=await proposedPlan(options.machineId,options);
  plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;
  plan.placement={xMm:20-geometry.field.originMm[0],yMm:20-geometry.field.originMm[1]};
  await initBundle(directory,plan,options);
  return loadBundle(directory,{program:false});
}
export async function updateSplineFieldBundle(directory,request,{expectedRevision,part}={}){
  requireThat(typeof expectedRevision==='string'&&expectedRevision.length>0,'Spline field edits require expectedRevision from the current print.');
  const state=await loadBundle(directory,{program:false});
  requireThat(state.revision===expectedRevision,'This review is stale. Reload before changing the spline field.');
  const plan=structuredClone(state.plan),owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  requireThat(owner?.geometry?.shape==='spline-field','Select an existing spline field part.');
  owner.geometry=await compileRequest(request);
  return updatePlan(directory,plan,state.revision);
}
function compileRequest(request){
  requireThat(request&&Object.keys(request).sort().join()==='extraction,field','Spline field request needs field and extraction.');
  requireThat(request.extraction&&Object.keys(request.extraction).every(key=>['edgeMm','maxEvaluations'].includes(key)),'Unexpected spline field extraction request fields.');
  return compileSplineField(request.field,request.extraction);
}
