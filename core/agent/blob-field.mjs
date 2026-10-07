import {runComputationJob} from '../print/computation-job.mjs';
import {BLOB_FIELD_SCHEMA,BLOB_FIELD_THRESHOLD} from '../geom/blob-field.mjs';
import {initBundle,loadBundle,updatePlan} from '../print/bundle.mjs';
import {requireEditRevision} from '../print/edit-identity.mjs';
import {defaults} from '../print/plan.mjs';
import {selectSettings} from '../machine/settings.mjs';
import {solidGeometry,replaceSolid} from '../geom/spatial.mjs';
import {normalizeSpatialPlan} from '../print/spatial-inputs.mjs';


const REQUEST_FIELDS=['points','threshold','edgeMm'];

export async function createBlobFieldBundle(directory,request,options={}){
  const {geometry,preparedGeometry}=await prepareRequest(request,{...options,prepareGeometry:true}),selection=options.machineId?await selectSettings(options.machineId,options):null;
  const plan=selection?{...defaults(selection.machine),...selection.settings}:{schema:'saam-shell-plan/1'};
  plan.geometry=geometry;
  const low=[0,1].map(a=>geometry.vertices.reduce((low,v)=>Math.min(low,v[a]),Infinity));
  plan.placement={xMm:20-low[0],yMm:20-low[1]};
  options.signal?.throwIfAborted();options.beforeCommit?.();
  await initBundle(directory,{...plan,bundle:{machine:selection?.machine??null}},{...options,machineId:undefined,preparedGeometry});
  return loadBundle(directory,{program:false});
}
export async function updateBlobFieldBundle(directory,request,{expectedRevision,expectedEditRevision,part,signal,beforeCommit}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const plan=structuredClone(normalizeSpatialPlan(state.plan)),root={geometry:solidGeometry(plan.geometry)},owner=part?root.geometry?.parts?.find(p=>p.id===part):root;
  if(owner?.geometry?.shape!=='blob-field')throw Error('Select an existing blob field part.');
  const prepared=await prepareRequest(request,{signal,prepareGeometry:true,...(part||plan.geometry.shape==='spatial'?{geometry:plan.geometry,part}:{})});
  owner.geometry=prepared.geometry;
  plan.geometry=replaceSolid(plan.geometry,root.geometry);
  signal?.throwIfAborted();beforeCommit?.();
  return updatePlan(directory,plan,state.revision,{preparedGeometry:prepared.preparedGeometry,expectedEditRevision});
}
// Threshold and sampling default here and are stored explicitly in the record.
export function compileRequest(request,options={}){
  return prepareRequest(request,options).then(result=>result.geometry);
}
function prepareRequest(request,{signal,prepareGeometry=false,geometry,part}={}){
  if(!(request&&typeof request==='object'&&Object.keys(request).every(k=>REQUEST_FIELDS.includes(k))))throw Error(`A blob field request has ${REQUEST_FIELDS.join(', ')}.`);
  const {points,threshold=BLOB_FIELD_THRESHOLD,edgeMm=defaultEdgeMm(points)}=request;
  return runComputationJob(new URL('./blob-field-worker.mjs',import.meta.url),{field:{schema:BLOB_FIELD_SCHEMA,threshold,points},options:{edgeMm},prepareGeometry,geometry,part},{signal,subject:'Blob field construction'});
}
// A lone strength-1 point is a ball of radius reach/2; sample it with at least
// four cells across that radius, and never coarser than half a millimetre.
function defaultEdgeMm(points){
  const reaches=Array.isArray(points)?points.map(p=>p?.reachMm).filter(r=>Number.isFinite(r)&&r>0):[];
  return reaches.length?Math.min(0.5,Math.min(...reaches)/8):0.5;
}
