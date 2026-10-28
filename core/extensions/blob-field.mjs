import {compileBlobFieldArtifact} from '../geom/blob-field-compile.mjs';
import {BLOB_FIELD_SCHEMA,BLOB_FIELD_THRESHOLD} from '../geom/blob-field.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {createPart,editPart} from '../application/part-execution.mjs';
import {requireEditRevision} from '../print/edit-identity.mjs';
import {prepareExtensionCreation} from '../print/extension-edits.mjs';
import {solidGeometry,replaceSolid} from '../geom/spatial.mjs';
import {normalizeSpatialPlan} from '../print/spatial-inputs.mjs';
import {editedPlacementOrigins} from '../print/placement-intent.mjs';


const REQUEST_FIELDS=['points','threshold','edgeMm'];

export async function createBlobFieldBundle(directory,request,{preparedCreation,...options}={}){
  const {geometry,geometryArtifact}=await prepareRequest(request,options),creation=preparedCreation??await prepareExtensionCreation(options),{selection}=creation;
  const plan=structuredClone(creation.plan);
  plan.geometry=geometry;
  const low=[0,1].map(a=>geometry.vertices.reduce((low,v)=>Math.min(low,v[a]),Infinity));
  plan.placement={xMm:20-low[0],yMm:20-low[1]};
  options.signal?.throwIfAborted();
  // The creation's settings are already resolved; the part keeps their machine label.
  await createPart(directory,{...plan,bundle:{machineId:selection?.machine.id??null}},{...options,geometryArtifact,machineId:undefined,
    placementOrigins:editedPlacementOrigins(creation.placementOrigins,plan.placement),notes:selection?.notes??[]});
  return loadBundle(directory,{program:false});
}
export async function updateBlobFieldBundle(directory,request,{expectedRevision,expectedEditRevision,part,signal,progress,beforeCommit}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const plan=structuredClone(normalizeSpatialPlan(state.plan)),root={geometry:solidGeometry(plan.geometry)},owner=part?root.geometry?.parts?.find(p=>p.id===part):root;
  if(owner?.geometry?.shape!=='blob-field')throw Error('Select an existing blob field part.');
  const prepared=await prepareRequest(request,{signal,progress});
  owner.geometry=prepared.geometry;
  plan.geometry=replaceSolid(plan.geometry,root.geometry);
  const geometryArtifacts=part?[{path:[...(plan.geometry.shape==='spatial'?['solid']:[]),'parts',part],artifact:prepared.geometryArtifact}]:undefined;
  signal?.throwIfAborted();
  return editPart(directory,plan,state.revision,{expectedEditRevision,signal,progress,beforeCommit,
    ...(part?{geometryArtifacts}:{geometryArtifact:prepared.geometryArtifact})});
}
// Threshold and sampling default here and are stored explicitly in the record.
export function compileRequest(request,options={}){
  return prepareRequest(request,options).then(result=>result.geometry);
}
function prepareRequest(request,{signal,progress}={}){
  if(!(request&&typeof request==='object'&&Object.keys(request).every(k=>REQUEST_FIELDS.includes(k))))throw Error(`A blob field request has ${REQUEST_FIELDS.join(', ')}.`);
  const {points,threshold=BLOB_FIELD_THRESHOLD,edgeMm=defaultEdgeMm(points)}=request;
  return compileBlobFieldArtifact({schema:BLOB_FIELD_SCHEMA,threshold,points},{edgeMm,signal,progress}).then(geometryArtifact=>({geometry:geometryArtifact.descriptor.parameters,geometryArtifact}));
}
// A lone strength-1 point is a ball of radius reach/2; sample it with at least
// four cells across that radius, and never coarser than half a millimetre.
function defaultEdgeMm(points){
  const reaches=Array.isArray(points)?points.map(p=>p?.reachMm).filter(r=>Number.isFinite(r)&&r>0):[];
  return reaches.length?Math.min(0.5,Math.min(...reaches)/8):0.5;
}
