import {compileBlobField} from '../geom/blob-field-compile.mjs';
import {BLOB_FIELD_SCHEMA,BLOB_FIELD_THRESHOLD} from '../geom/blob-field.mjs';
import {proposedPlan,initBundle,loadBundle,updatePlan} from './bundle.mjs';
import {requireThat} from '../geom/tolerance.mjs';

const REQUEST_FIELDS=['points','threshold','edgeMm'];

export async function createBlobFieldBundle(directory,request,options={}){
  const geometry=await compileRequest(request),plan=await proposedPlan(options.machineId,options);
  plan.geometry=geometry;
  const low=[0,1].map(a=>Math.min(...geometry.vertices.map(v=>v[a])));
  plan.placement={xMm:20-low[0],yMm:20-low[1]};
  await initBundle(directory,plan,options);
  return loadBundle(directory,{program:false});
}
export async function updateBlobFieldBundle(directory,request,{expectedRevision,part}={}){
  requireThat(typeof expectedRevision==='string'&&expectedRevision.length>0,'Blob field edits require expectedRevision from the current print.');
  const state=await loadBundle(directory,{program:false});
  requireThat(state.revision===expectedRevision,'This review is stale. Reload before changing the blob field.');
  const plan=structuredClone(state.plan),owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  requireThat(owner?.geometry?.shape==='blob-field','Select an existing blob field part.');
  owner.geometry=await compileRequest(request);
  return updatePlan(directory,plan,state.revision);
}
// Threshold and sampling default here and are stored explicitly in the record.
export function compileRequest(request){
  requireThat(request&&typeof request==='object'&&Object.keys(request).every(k=>REQUEST_FIELDS.includes(k)),`A blob field request has ${REQUEST_FIELDS.join(', ')}.`);
  const {points,threshold=BLOB_FIELD_THRESHOLD,edgeMm=defaultEdgeMm(points)}=request;
  return compileBlobField({schema:BLOB_FIELD_SCHEMA,threshold,points},{edgeMm});
}
// A lone strength-1 point is a ball of radius reach/2; sample it with at least
// four cells across that radius, and never coarser than half a millimetre.
function defaultEdgeMm(points){
  const reaches=Array.isArray(points)?points.map(p=>p?.reachMm).filter(r=>Number.isFinite(r)&&r>0):[];
  return reaches.length?Math.min(0.5,Math.min(...reaches)/8):0.5;
}
