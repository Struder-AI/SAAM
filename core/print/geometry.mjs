import {canonicalHash} from '../canonical-json.mjs';
// Native geometry for a shell print: the 3DM the maker's part is stored as.
//
// Spline shells store named supporting surfaces and SAAM face metadata in 3DM.
// Reopening verifies both control nets and trims; the recipe remains authority.

import {rhino} from '../geom/runtime.mjs';
import { patchFromSurface, evaluate } from '../geom/nurbs.mjs';
import {buildShell,buildShells} from '../geom/build.mjs';
import {hasMesh} from '../geom/mesh.mjs';
import {assemblyComponents} from '../geom/selections.mjs';

import {requireThat} from '../geom/tolerance.mjs';
import { booleanDisplayMesh } from '../geom/boolean-display.mjs';
import {tessellateSurfaceShell} from '../geom/surface-tessellate.mjs';
import {displayGeometry} from '../geom/boolean-solid.mjs';
import {spatialPreview,validateSpatial} from '../geom/spatial.mjs';
import {normalizeAuthoredGeometry} from '../geom/mesh-source.mjs';
import {executeGeometry} from '../geom/execution.mjs';

const preparations=new WeakMap();
export async function createGeometry(parameters,{previousGeometry,...execution}={}){
  execution.signal?.throwIfAborted();
  const key=canonicalHash(parameters),owned=Boolean(execution.signal||execution.timeoutMs),cached=owned?null:preparations.get(parameters);
  if(cached?.key===key)return cached.preparation;
  const preparation=executeGeometry('geometry-artifact',{parameters,previousGeometry},{subject:'Geometry artifact construction',...execution}).then(artifact=>{
    const admitted=artifact.descriptor.parameters;
    if(!owned)preparations.set(admitted,{key:canonicalHash(admitted),preparation});
    return artifact;
  });
  if(!owned)preparations.set(parameters,{key,preparation});
  try{return await preparation;}catch(error){if(!owned&&preparations.get(parameters)?.preparation===preparation)preparations.delete(parameters);throw error;}
}
// Admission, native lifetime, tessellation and encoded-byte verification share
// one calculation lease. The application only caches its completed artifact.
export async function prepareGeometryArtifactValue(parameters,{previousGeometry}={}){
  const admitted=normalizeAuthoredGeometry(parameters,previousGeometry);
  const artifact=await createGeometryArtifact(admitted.geometry);
  if(admitted.reports.length)artifact.descriptor.meshNormalization=admitted.reports;
  return artifact;
}

const directMesh=parameters=>parameters?.shape==='spatial'?directMesh(parameters.solid)
  :Array.isArray(parameters?.vertices)&&Array.isArray(parameters?.triangles)?parameters:null;
// Source parameters are the recipe authority; cached display data cannot supply a second shape.
export async function geometryDescriptor(parameters,descriptor){
  if(!descriptor)return null;
  if(descriptor.parameters&&canonicalHash(descriptor.parameters)!==canonicalHash(parameters))return (await createGeometry(parameters)).descriptor;
  const mesh=directMesh(parameters);
  if(mesh)return {...descriptor,schema:'saam-shell-geometry/1',parameters,vertices:mesh.vertices,faces:mesh.triangles,labels:mesh.triangles.map(()=>'mesh'),
    boundsMm:parameters.shape==='spatial'?descriptor.boundsMm:mesh.vertices.length?{min:[0,1,2].map(axis=>mesh.vertices.reduce((bound,p)=>Math.min(bound,p[axis]),Infinity)),max:[0,1,2].map(axis=>mesh.vertices.reduce((bound,p)=>Math.max(bound,p[axis]),-Infinity))}:{min:[0,0,0],max:[0,0,0]}};
  return {...descriptor,schema:'saam-shell-geometry/1',parameters};
}
export function storedGeometryDescriptor(descriptor,{snapshot=false}={}){
  const {parameters,...derived}=descriptor;
  if(directMesh(parameters)){delete derived.vertices;delete derived.faces;delete derived.labels;}
  return snapshot?{...derived,schema:'saam-geometry-snapshot/1',parameters}:{...derived,schema:'saam-geometry-view/1'};
}
export function storedGeometryArtifact(geometry){
  return geometry?{...geometry,descriptor:storedGeometryDescriptor(geometry.descriptor)}:null;
}
// Worker transport carries one shape and its owned derived data, never a second recipe.
export async function transferGeometry(parameters){
  const artifact=await createGeometry(parameters);
  return {schema:'saam-geometry-transfer/1',parameters:artifact.descriptor.parameters,
    view:storedGeometryDescriptor(artifact.descriptor),bytes:artifact.bytes};
}
export async function receiveGeometry(record){
  requireThat(record?.schema==='saam-geometry-transfer/1','Incompatible Geometry worker result. Reload the source runtime.');
  const parameters=record.parameters,key=canonicalHash(parameters);
  const descriptor=await geometryDescriptor(parameters,record.view),artifact={bytes:record.bytes,descriptor};
  preparations.set(parameters,{key,preparation:Promise.resolve(artifact)});return parameters;
}

// Display resolution of the proxy mesh: steps per knot span, per direction,
// within a per-patch range. The proxy is for the viewer only; every toolpath
// comes from the patches themselves.
const PROXY_STEPS_PER_SPAN = 8, PROXY_STEPS_MAX = 64;
const spans = (knots, order, count) => { let n = 0; for (let i = order - 1; i < count; i++) if (knots[i + 1] > knots[i]) n++; return n; };
const proxySteps = (knots, order, count) => Math.min(PROXY_STEPS_MAX, PROXY_STEPS_PER_SPAN * spans(knots, order, count));

// Control nets are compared through a rounded hash: 3DM stores doubles, and a
// nanometre is nine orders below the tolerances the process works at.
const netHash = patches => canonicalHash(patches.map(patch => [patch.name, patch.nu, patch.nv, patch.orderU, patch.orderV,
  [...patch.knotsU].map(round), [...patch.knotsV].map(round), [...patch.cp].map(round),
  ...(patch.trimLoops===undefined&&patch.normalSide===undefined?[]:[faceMetadata(patch)])]));
const round = value => Number(value.toFixed(9));
function faceMetadata(patch){
  return {...(patch.trimLoops===undefined?{}:{trimLoops:patch.trimLoops}),...(patch.normalSide===undefined?{}:{normalSide:patch.normalSide})};
}

async function createGeometryArtifact(parameters) {
  if(parameters.shape==='spatial')return createSpatialGeometry(parameters);
  if(directMesh(parameters))return createMeshGeometry(null,parameters);
  const r = await rhino();
  if(hasMesh(parameters))return await createMeshGeometry(r,parameters);
  const shell = buildShell(r, parameters);
  const {bytes,features}=nativeShellBytes(r,shell);

  const descriptor = {
    schema: 'saam-shell-geometry/1',
    parameters,
    nativeForm: shell.patches.some(p=>p.trimLoops)?'named NURBS supporting surfaces with retained SAAM UV trims':'named untrimmed NURBS surfaces, not a Rhino solid',
    patchHash: netHash(shell.patches),
    features,
    boundsMm: shell.bounds,
    ...await proxyMesh(shell)
  };
  await reopenShell(bytes, descriptor);
  return { bytes, descriptor };
}

// Native file encoding owns the document and surfaces until their bytes exist.
// Only numerical patches and encoded values leave this operation.
function nativeShellBytes(runtime,shell){
  const owned={document:null};
  try{
    requireThat(shell.surfaces?.length===shell.patches.length,'The shape builder did not supply one Rhino surface per patch.');
    const doc=new runtime.File3dm();owned.document=doc;
    doc.applicationName='SAAM';doc.applicationDetails='Shell pipeline (slices, draped-skin)';
    doc.settings().modelUnitSystem=runtime.UnitSystem.Millimeters;
    const features=[];
    for(const [index,entry]of shell.surfaces.entries()){
      const attributes=new runtime.ObjectAttributes();
      try{
        attributes.name=entry.name;attributes.setUserString('saam:feature',entry.name);
        const metadata=faceMetadata(shell.patches[index]);
        if(Object.keys(metadata).length)attributes.setUserString('saam:face',JSON.stringify(metadata));
        features.push({id:entry.name,objectId:doc.objects().add(entry.surface,attributes),patchIndex:index});
      }finally{attributes.delete();}
    }
    return {bytes:doc.toByteArray(),features};
  }finally{owned.document?.destroy();for(const entry of shell.surfaces??[])entry.surface.delete();}
}

// Reopen the written 3DM, rebuild the patches from it, and require them to be
// the ones just built.
async function reopenShell(bytes, descriptor) {
  const r = await rhino();
  const doc = r.File3dm.fromByteArray(bytes);
  try {
    requireThat(doc && doc.objects().count === descriptor.features.length, 'Invalid shell 3DM: unexpected object count.');
    const patches = [];
    for (const [index, feature] of descriptor.features.entries()) {
      const object = doc.objects().get(index);
      const attributes = object.attributes();
      requireThat(attributes.getUserString('saam:feature') === feature.id, `3DM object ${index} is not the named face "${feature.id}".`);
      const metadata=attributes.getUserString('saam:face');
      patches.push({...patchFromSurface(object.geometry(), feature.id),...(metadata?JSON.parse(metadata):{})});
    }
    requireThat(netHash(patches) === descriptor.patchHash, 'The 3DM surfaces or face trims differ from the reviewed geometry.');
  } finally { doc?.destroy(); }
}

export async function createSpatialGeometry(parameters,solidDescriptor){
  validateSpatial(parameters);
  const solid=parameters.solid?(solidDescriptor?{descriptor:solidDescriptor}:await createGeometryArtifact(parameters.solid)):null;
  const {vertices=[],faces=[],labels=[],features=[],cornerNormals}=solid?.descriptor??{};
  const preview=spatialPreview(parameters),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  const include=p=>p.forEach((v,i)=>{bounds.min[i]=Math.min(bounds.min[i],v);bounds.max[i]=Math.max(bounds.max[i],v);});
  if(solid){include(solid.descriptor.boundsMm.min);include(solid.descriptor.boundsMm.max);}
  for(const c of preview.curves)for(const p of c.points)include(p);
  for(const p of preview.points)include(p.point);
  if(!Number.isFinite(bounds.min[0])){bounds.min=[0,0,0];bounds.max=[0,0,0];}
  return {bytes:solid?.bytes??null,descriptor:{schema:'saam-shell-geometry/1',parameters,
    nativeForm:'authored solid, curves and points',vertices,faces,labels,...(cornerNormals?{cornerNormals}:{}),features:[...features,...preview.curves.map(c=>({id:c.id,kind:'curve'})),...preview.points.map(p=>({id:p.id,kind:'point'}))],boundsMm:bounds,...preview}};
}

// Quad proxy for the viewer: each patch is sampled on its own (u, v) grid, so
// every quad carries the name of the face it came from and stays selectable.
async function proxyMesh(shell) {
  if(shell.kind==='surface-solid'){
    const mesh=await tessellateSurfaceShell(shell,{toleranceMm:.05});
    // Frame the visible face region, rather than discarded supporting controls.
    const boundsMm=mesh.vertices.length?{min:[0,1,2].map(k=>mesh.vertices.reduce((bound,p)=>Math.min(bound,p[k]),Infinity)),max:[0,1,2].map(k=>mesh.vertices.reduce((bound,p)=>Math.max(bound,p[k]),-Infinity))}:shell.bounds;
    return {vertices:mesh.vertices,faces:mesh.triangles,labels:mesh.faceIndices.map(face=>shell.patches[face].name),cornerNormals:mesh.cornerNormals,boundsMm,notes:mesh.notes};
  }
  const vertices = [], faces = [], labels = [], normals=[],cornerNormals=[];
  for (const patch of shell.patches) {
    const [u0, u1] = patch.domainU, [v0, v1] = patch.domainV;
    const stepsU = proxySteps(patch.knotsU, patch.orderU, patch.nu), stepsV = proxySteps(patch.knotsV, patch.orderV, patch.nv);
    const base = vertices.length, row = stepsV + 1;
    for (let i = 0; i <= stepsU; i++)
      for (let j = 0; j <= stepsV; j++)
        {const frame=evaluate(patch,u0+(u1-u0)*i/stepsU,v0+(v1-v0)*j/stepsV);vertices.push(frame.point.map(round));normals.push(frame.normal);}
    for (let i = 0; i < stepsU; i++)
      for (let j = 0; j < stepsV; j++) {
        faces.push([base + i * row + j, base + (i + 1) * row + j, base + (i + 1) * row + j + 1, base + i * row + j + 1]);
        cornerNormals.push(faces.at(-1).map(index=>normals[index]));
        labels.push(patch.name);
      }
  }
  return { vertices, faces, labels,cornerNormals };
}

// Indexed mesh coordinates belong to the recipe. Mixed assemblies retain their
// source spline recipes; each component still uses its own query backend.
// A boolean shows its selected operand or Manifold mesh, one selectable body.
async function createMeshGeometry(r,parameters) {
  if(directMesh(parameters)){
    const shell=buildShell(r,parameters,{native:false}),mesh=directMesh(parameters);
    return {bytes:null,descriptor:{schema:'saam-shell-geometry/1',parameters,nativeForm:'indexed manufacturing mesh',
      features:[{id:'mesh'}],boundsMm:shell.bounds,vertices:mesh.vertices,faces:mesh.triangles,labels:mesh.triangles.map(()=>'mesh')}};
  }
  // A nested assembly shows its components, outer/inner, as generation slices them.
  const parts=parameters.shape==='assembly'?assemblyComponents(parameters.parts):[{geometry:parameters,id:'',xMm:0,yMm:0,zMm:0}];
  const [shell,...components]=buildShells(r,[parameters,...parts.map(part=>displayGeometry(part.geometry))],{native:false});
  const vertices=[],faces=[],labels=[],cornerNormals=[],features=[],notes=[...(shell.notes??[])];
  const append=async(component,id,translation)=>{
    const display=component.kind==='boolean'?await booleanDisplayMesh(component):null;
    const proxy=display?{vertices:display.vertices,faces:display.triangles,labels:display.triangles.map(()=>'boolean'),notes:display.notes}
      :component.kind==='triangle-mesh'?{vertices:component.vertices,faces:component.triangles,labels:component.triangles.map((_,i)=>`triangle:${i}`)}:await proxyMesh(component);
    for(const note of proxy.notes??[])notes.push(id?`${id}: ${note}`:note);
    const offset=vertices.length;
    for(const p of proxy.vertices)vertices.push(p.map((v,i)=>v+translation[i]));
    for(const f of proxy.faces)faces.push(f.map(v=>v+offset));
    const names=proxy.labels.map(label=>id||(component.patches?label:'mesh'));
    for(const name of names)labels.push(name);
    for(const [index,face] of proxy.faces.entries())cornerNormals.push(proxy.cornerNormals?.[index]??face.map(()=>null));
    for(const name of new Set(names))features.push({id:name});
  };
  for(const [index,part] of parts.entries())await append(components[index],part.id,[part.xMm,part.yMm,part.zMm]);
  return {bytes:null,descriptor:{schema:'saam-shell-geometry/1',parameters,
    nativeForm:'display mesh derived from authoritative geometry recipes',features,boundsMm:shell.bounds,vertices,faces,labels,cornerNormals,...(notes.length?{notes:[...new Set(notes)]}:{})}};
}
