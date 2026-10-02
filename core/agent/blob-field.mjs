import {compileBlobField} from '../geom/blob-field-compile.mjs';
import {BLOB_FIELD_SCHEMA,BLOB_FIELD_THRESHOLD} from '../geom/blob-field.mjs';
import {initBundle,loadBundle,updatePlan} from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {selectSettings} from '../machine/settings.mjs';


const REQUEST_FIELDS=['points','threshold','edgeMm'];

export async function createBlobFieldBundle(directory,request,options={}){
  const geometry=await compileRequest(request),selection=options.machineId?await selectSettings(options.machineId,options):null;
  const plan=selection?{...defaults(selection.machine),...selection.settings}:{schema:'saam-shell-plan/1'};
  plan.geometry=geometry;
  const low=[0,1].map(a=>Math.min(...geometry.vertices.map(v=>v[a])));
  plan.placement={xMm:20-low[0],yMm:20-low[1]};
  await initBundle(directory,{...plan,bundle:{machine:selection?.machine??null}},{...options,machineId:undefined});
  return loadBundle(directory,{program:false});
}
export async function updateBlobFieldBundle(directory,request,{expectedRevision,part}={}){
  if(!(typeof expectedRevision==='string'&&expectedRevision.length>0))throw Error('Blob field edits require expectedRevision from the current print.');
  const state=await loadBundle(directory,{program:false});
  if(state.revision!==expectedRevision)throw Error('This review is stale. Reload before changing the blob field.');
  const plan=structuredClone(state.plan),owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  if(owner?.geometry?.shape!=='blob-field')throw Error('Select an existing blob field part.');
  owner.geometry=await compileRequest(request);
  return updatePlan(directory,plan,state.revision);
}
// Threshold and sampling default here and are stored explicitly in the record.
export function compileRequest(request){
  if(!(request&&typeof request==='object'&&Object.keys(request).every(k=>REQUEST_FIELDS.includes(k))))throw Error(`A blob field request has ${REQUEST_FIELDS.join(', ')}.`);
  const {points,threshold=BLOB_FIELD_THRESHOLD,edgeMm=defaultEdgeMm(points)}=request;
  return compileBlobField({schema:BLOB_FIELD_SCHEMA,threshold,points},{edgeMm});
}
// A lone strength-1 point is a ball of radius reach/2; sample it with at least
// four cells across that radius, and never coarser than half a millimetre.
function defaultEdgeMm(points){
  const reaches=Array.isArray(points)?points.map(p=>p?.reachMm).filter(r=>Number.isFinite(r)&&r>0):[];
  return reaches.length?Math.min(0.5,Math.min(...reaches)/8):0.5;
}
