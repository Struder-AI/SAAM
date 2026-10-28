import {COARSE_CHORD_TOLERANCE_MM} from '../dimensions.mjs';
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
import {spatialPreview,validateSpatial,solidGeometry} from '../geom/spatial.mjs';
import {normalizeAuthoredGeometry} from '../geom/mesh-source.mjs';
import {executeGeometry,validateGeometryExecution} from '../geom/execution.mjs';
import {geometryArtifactBytes} from '../private/bundle/geometry-artifact-size.mjs';

// Active work and publication callers own their complete values. Optional reuse
// has only weak graph references and bounded strong metadata; byte weights model
// opportunistic reuse, not a hard graph/RSS bound on mutable caller-owned data.
const preparations=new WeakMap();
const completedAliases=new WeakMap(),completedArtifacts=new Map();let completedBytes=0;
const GEOMETRY_ARTIFACT_CACHE_BYTES=32*1024*1024,MAX_COMPLETED_GEOMETRIES=16;
function forgetArtifact(entry){
  if(completedArtifacts.delete(entry))completedBytes-=entry.bytes;
  for(const {owner}of entry.aliases){const parameters=owner.deref();if(parameters&&completedAliases.get(parameters)?.entry===entry)completedAliases.delete(parameters);}
  entry.artifact=null;entry.aliases=[];
}
function completedArtifact(parameters,key){
  const alias=completedAliases.get(parameters),entry=alias?.entry,artifact=entry?.artifact?.deref();
  if(!artifact){if(entry)forgetArtifact(entry);return null;}
  if(alias.key!==key)return null;
  // The admitted source is itself an exposed alias. Mutating it invalidates all
  // aliases, including an unchanged original authoring object.
  try{if(parameters!==artifact.descriptor.parameters&&canonicalHash(artifact.descriptor.parameters)!==entry.sourceKey){forgetArtifact(entry);return null;}}
  catch{forgetArtifact(entry);return null;}
  completedArtifacts.delete(entry);completedArtifacts.set(entry,true);return artifact;
}
function retainArtifact(artifact,aliases,sourceKey){
  const bytes=geometryArtifactBytes(artifact,GEOMETRY_ARTIFACT_CACHE_BYTES);
  if(bytes>GEOMETRY_ARTIFACT_CACHE_BYTES)return;
  while(completedBytes+bytes>GEOMETRY_ARTIFACT_CACHE_BYTES||completedArtifacts.size>=MAX_COMPLETED_GEOMETRIES)forgetArtifact(completedArtifacts.keys().next().value);
  const entry={artifact:new WeakRef(artifact),sourceKey,bytes,aliases:[]};
  for(const [parameters,key]of aliases){
    if(entry.aliases.some(alias=>alias.owner.deref()===parameters))continue;
    const prior=completedAliases.get(parameters)?.entry;if(prior)forgetArtifact(prior);
    entry.aliases.push({owner:new WeakRef(parameters)});completedAliases.set(parameters,{key,entry});
  }
  completedArtifacts.set(entry,true);completedBytes+=bytes;
}
export async function createGeometry(parameters,{previousGeometry,previousArtifact,geometryArtifact,geometryArtifacts=[],...execution}={}){
  validateGeometryExecution(execution);
  const contributions=bindGeometryArtifacts(parameters,geometryArtifact,geometryArtifacts);
  if(contributions[0]?.path.length===0)return contributions[0].artifact;
  const key=canonicalHash(parameters),reusable=previousGeometry===undefined,owned=Boolean(execution.signal||execution.timeoutMs!==undefined);
  const completed=reusable&&!contributions.length?completedArtifact(parameters,key):null;
  if(completed)return completed;
  const cached=reusable&&!owned&&!contributions.length?preparations.get(parameters):null;
  if(cached?.key===key)return cached.preparation;
  const entry={key,preparation:null};
  const preparation=executeGeometry('geometry-artifact',{parameters,previousGeometry,previousArtifact,geometryArtifacts:contributions.map(({path,artifact})=>({path,artifact}))},{subject:'Geometry artifact construction',...execution}).then(artifact=>{
    execution.signal?.throwIfAborted();
    if(reusable){
      const admitted=artifact.descriptor.parameters,sourceKey=canonicalHash(admitted),aliases=[[admitted,sourceKey]],current=preparations.get(parameters),existing=completedAliases.get(parameters);
      let unchanged=false;try{unchanged=canonicalHash(parameters)===key;}catch{/* Caller changed the authoring object; the captured result still stands. */}
      if(unchanged&&(!current||current===entry||current.key!==key)&&(!existing?.entry.artifact?.deref()||existing.key!==key||current===entry))aliases.push([parameters,key]);
      retainArtifact(artifact,aliases,sourceKey);
    }
    return artifact;
  });
  entry.preparation=preparation;
  if(reusable&&!owned)preparations.set(parameters,entry);
  try{return await preparation;}finally{if(preparations.get(parameters)===entry)preparations.delete(parameters);}
}
// Admission, native lifetime, tessellation and encoded-byte verification share
// one calculation lease. The application only caches its completed artifact.
export async function prepareGeometryArtifactValue(parameters,{previousGeometry,previousArtifact,geometryArtifact,geometryArtifacts=[],signal,progress=()=>{}}={}){
  signal?.throwIfAborted();progress({stage:'Admitting geometry'});
  const contributions=bindGeometryArtifacts(parameters,geometryArtifact,geometryArtifacts);
  if(contributions[0]?.path.length===0)return contributions[0].artifact;
  const admitted=normalizeAuthoredGeometry(parameters,previousGeometry,contributions.map(entry=>entry.geometry));
  signal?.throwIfAborted();progress({stage:'Constructing geometry'});
  const retained=retainedSolidArtifact(admitted.geometry,previousGeometry,previousArtifact);
  const suppliedSolid=contributions.find(entry=>entry.path.length===1&&entry.path[0]==='solid')?.artifact;
  let artifact=admitted.geometry.shape==='spatial'?await createSpatialGeometry(admitted.geometry,suppliedSolid??retained,contributions):retained??await createGeometryArtifact(admitted.geometry,contributions);
  signal?.throwIfAborted();progress({stage:'Geometry prepared'});
  const reports=[...retainedNormalizationReports(parameters,previousGeometry,previousArtifact),...admitted.reports,
    ...contributions.flatMap(({path,artifact})=>(artifact.descriptor.meshNormalization??[]).map(report=>({...report,path:sourcePath(path)+(report.path??'geometry').slice('geometry'.length)})))];
  if(reports.length){
    if(artifact.descriptor===retained?.descriptor)artifact={...artifact,descriptor:{...artifact.descriptor}};
    const seen=new Set(),unique=reports.filter(report=>{const key=canonicalHash(report);if(seen.has(key))return false;seen.add(key);return true;});
    artifact.descriptor.meshNormalization=unique;
    if(artifact.descriptor.solidArtifact)artifact.descriptor.solidArtifact.meshNormalization=unique;
  }
  return artifact;
}

// Paths name spatial solids and stable assembly IDs, never array positions.
const sourcePath=path=>'geometry'+path.map(part=>'/'+part).join('');
function geometryAtPath(parameters,path){
  let geometry=parameters;
  for(let i=0;i<path.length;i++){
    if(path[i]==='solid'&&geometry?.shape==='spatial')geometry=geometry.solid;
    else if(path[i]==='parts'&&geometry?.shape==='assembly'&&typeof path[i+1]==='string'){
      const id=path[++i],matches=geometry.parts.filter(part=>part.id===id);
      requireThat(matches.length===1,'Prepared geometry needs one unambiguous component ID.');geometry=matches[0].geometry;
    }else throw Error('Prepared geometry names an unavailable source location.');
  }
  return geometry;
}
export function bindGeometryArtifacts(parameters,artifact,entries=[]){
  requireThat(Array.isArray(entries),'Prepared geometry contributions must be a list.');
  const supplied=entries.slice();
  if(artifact){
    requireThat(parameters,'Prepared geometry has no final source.');
    const source=artifact.descriptor?.parameters;
    requireThat(source,'Prepared geometry needs its admitted source.');
    const path=canonicalHash(parameters)===canonicalHash(source)?[]:parameters?.shape==='spatial'&&canonicalHash(parameters.solid)===canonicalHash(source)?['solid']:null;
    requireThat(path,'Prepared geometry does not match the final source.');supplied.unshift({path,artifact});
  }
  return supplied.map((entry,index)=>{
    requireThat(entry&&Array.isArray(entry.path)&&entry.path.every(part=>typeof part==='string')&&entry.artifact?.descriptor?.parameters&&Object.hasOwn(entry.artifact,'bytes')&&entry.artifact.bytes!==undefined,'Prepared geometry needs a complete artifact and source path.');
    const {path,artifact}=entry,geometry=geometryAtPath(parameters,path);
    requireThat(geometry,'Prepared geometry names an unavailable source location.');
    requireThat(!supplied.slice(0,index).some(prior=>path.slice(0,Math.min(path.length,prior.path.length)).every((part,i)=>part===prior.path[i])),'Prepared geometry source locations must not overlap.');
    requireThat(canonicalHash(geometry)===canonicalHash(artifact.descriptor.parameters),'Prepared geometry does not match the source at '+sourcePath(path)+'.');
    requireThat(!artifact.descriptor.patchHash||artifact.bytes?.length,'Prepared native geometry is missing its encoded bytes.');
    requireThat(!path.includes('parts')||!artifact.bytes,'Prepared native component binding is unsupported; this assembly has no slot for the component\'s exact native artifact.');
    return {path,artifact,geometry};
  });
}

// A new assembly drawing has its own identity. Unchanged source components keep
// their original admission findings, even when another component is edited.
function retainedNormalizationReports(parameters,previous,artifact){
  const reports=artifact?.descriptor?.meshNormalization??[];
  if(!reports.length||!previous||!artifact.descriptor.parameters||canonicalHash(previous)!==canonicalHash(artifact.descriptor.parameters))return [];
  const priorPrefix=previous.shape==='spatial'?'geometry/solid':'geometry',nextPrefix=parameters.shape==='spatial'?'geometry/solid':'geometry';
  const paths=new Set(reports.filter(report=>report.path===priorPrefix||report.path?.startsWith(priorPrefix+'/')).map(report=>report.path.slice(priorPrefix.length)));
  const collect=geometry=>{
    const found=new Map();
    const visit=(value,path='')=>{
      if(!value)return;
      if(paths.has(path))found.set(path,found.has(path)?null:value);
      if(value.shape==='assembly')for(const part of value.parts)visit(part.geometry,path+'/parts/'+part.id);
      else if(value.shape==='boolean')for(const [index,operand]of value.operands.entries())visit(operand,path+'/operands/'+index);
    };
    visit(solidGeometry(geometry));return found;
  };
  const before=collect(previous),after=collect(parameters),matches=new Map();
  return reports.flatMap(report=>{
    if(report.path!==priorPrefix&&!report.path?.startsWith(priorPrefix+'/'))return [];
    const path=report.path?.slice(priorPrefix.length);
    if(!paths.has(path))return [];
    if(!matches.has(path))matches.set(path,Boolean(before.get(path)&&after.get(path)&&canonicalHash(before.get(path))===canonicalHash(after.get(path))));
    return matches.get(path)?[{...report,path:nextPrefix+path}]:[];
  });
}

const directMesh=parameters=>parameters?.shape==='spatial'?directMesh(parameters.solid)
  :Array.isArray(parameters?.vertices)&&Array.isArray(parameters?.triangles)?parameters:null;
// Source parameters are the recipe authority; cached display data cannot supply a second shape.
// A stored artifact's descriptor for its recipe geometry. Reading never builds:
// when the recipe's geometry is no longer the one the artifact was built from,
// the artifact is described as saved and flagged until an edit rebuilds it.
export const GEOMETRY_RECIPE_MISMATCH='The saved geometry was built from an earlier form of its recipe and is shown as saved; edit the geometry to rebuild it.';
export async function geometryDescriptor(parameters,descriptor){
  if(!descriptor)return null;
  if(descriptor.parameters&&canonicalHash(descriptor.parameters)!==canonicalHash(parameters)){
    const saved=await geometryDescriptor(descriptor.parameters,descriptor);
    return {...saved,recipeMismatch:true,notes:[...new Set([...saved.notes??[],GEOMETRY_RECIPE_MISMATCH])]};
  }
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
  return transferGeometryArtifact(artifact);
}
export function transferGeometryArtifact(artifact){
  return {schema:'saam-geometry-transfer/1',parameters:artifact.descriptor.parameters,
    view:storedGeometryDescriptor(artifact.descriptor),bytes:artifact.bytes};
}
export async function receiveGeometryArtifact(record){
  requireThat(record?.schema==='saam-geometry-transfer/1','Incompatible Geometry worker result. Reload the source runtime.');
  requireThat(record.parameters&&record.view&&Object.hasOwn(record,'bytes')&&record.bytes!==undefined,'Geometry worker result is missing its complete artifact.');
  requireThat(!record.view.parameters||canonicalHash(record.view.parameters)===canonicalHash(record.parameters),'Geometry worker descriptor does not match its source.');
  const parameters=record.parameters;
  const descriptor=await geometryDescriptor(parameters,record.view),artifact={bytes:record.bytes,descriptor};
  return artifact;
}
// Source intent only; exact bytes and findings require receiveGeometryArtifact.
export async function receiveGeometry(record){
  return (await receiveGeometryArtifact(record)).descriptor.parameters;
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

async function createGeometryArtifact(parameters,contributions=[]) {
  if(parameters.shape==='spatial')return createSpatialGeometry(parameters,undefined,contributions);
  if(directMesh(parameters))return createMeshGeometry(null,parameters);
  const r = await rhino();
  if(hasMesh(parameters))return await createMeshGeometry(r,parameters,contributions);
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
    doc.applicationName='SAAM';doc.applicationDetails='Shell pipeline (planar and nonplanar slices)';
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

// Bundle supplies the association to its saved source and complete artifact.
// Legacy spatial views have no scoped solid bounds/features, so rebuild once.
function retainedSolidArtifact(parameters,previousGeometry,artifact){
  const solid=solidGeometry(parameters),previous=solidGeometry(previousGeometry),descriptor=artifact?.descriptor;
  if(!solid||!previous||!descriptor?.parameters||!Object.hasOwn(artifact,'bytes')||descriptor.patchHash&&!artifact.bytes?.length||canonicalHash(descriptor.parameters)!==canonicalHash(previousGeometry)
    ||canonicalHash(solid)!==canonicalHash(previous))return null;
  if(previousGeometry.shape!=='spatial')return {bytes:artifact.bytes,descriptor};
  if(!descriptor.solidArtifact)return null;
  const {vertices,faces,labels,cornerNormals}=descriptor;
  return {bytes:artifact.bytes,descriptor:{...descriptor.solidArtifact,parameters:previous,vertices,faces,labels,...(cornerNormals?{cornerNormals}:{})}};
}

// The flat proxy arrays belong only to the solid. Its scoped metadata plus those
// arrays is the complete prepared solid; persist neither a second mesh nor recipe.
export async function createSpatialGeometry(parameters,solidArtifact,contributions=[]){
  validateSpatial(parameters);
  const solid=parameters.solid?(solidArtifact??await createGeometryArtifact(parameters.solid,contributions)):null;
  const {parameters:_source,vertices=[],faces=[],labels=[],cornerNormals,...metadata}=solid?.descriptor??{};
  const features=metadata.features??[];
  const preview=spatialPreview(parameters),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  const include=p=>p.forEach((v,i)=>{bounds.min[i]=Math.min(bounds.min[i],v);bounds.max[i]=Math.max(bounds.max[i],v);});
  if(solid){include(solid.descriptor.boundsMm.min);include(solid.descriptor.boundsMm.max);}
  for(const c of preview.curves)for(const p of c.points)include(p);
  for(const p of preview.points)include(p.point);
  if(!Number.isFinite(bounds.min[0])){bounds.min=[0,0,0];bounds.max=[0,0,0];}
  return {bytes:solid?.bytes??null,descriptor:{...metadata,schema:'saam-shell-geometry/1',parameters,
    nativeForm:'authored solid, curves and points',solidArtifact:solid?metadata:null,vertices,faces,labels,...(cornerNormals?{cornerNormals}:{}),features:[...features,...preview.curves.map(c=>({id:c.id,kind:'curve'})),...preview.points.map(p=>({id:p.id,kind:'point'}))],boundsMm:bounds,...preview}};
}

// Quad proxy for the viewer: each patch is sampled on its own (u, v) grid, so
// every quad carries the name of the face it came from and stays selectable.
async function proxyMesh(shell) {
  if(shell.kind==='surface-solid'){
    const mesh=await tessellateSurfaceShell(shell,{toleranceMm:COARSE_CHORD_TOLERANCE_MM});
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
async function createMeshGeometry(r,parameters,contributions=[]) {
  if(directMesh(parameters)){
    const shell=buildShell(r,parameters,{native:false}),mesh=directMesh(parameters);
    return {bytes:null,descriptor:{schema:'saam-shell-geometry/1',parameters,nativeForm:'indexed manufacturing mesh',
      features:[{id:'mesh'}],boundsMm:shell.bounds,vertices:mesh.vertices,faces:mesh.triangles,labels:mesh.triangles.map(()=>'mesh')}};
  }
  // A nested assembly shows its components, outer/inner, as generation slices them.
  const parts=parameters.shape==='assembly'?assemblyComponents(parameters.parts):[{geometry:parameters,id:'',xMm:0,yMm:0,zMm:0}];
  const [shell,...components]=buildShells(r,[parameters,...parts.map(part=>displayGeometry(part.geometry))],{native:false});
  const vertices=[],faces=[],labels=[],cornerNormals=[],features=[],notes=[...(shell.notes??[])];
  const append=async(component,id,translation,prepared)=>{
    const display=!prepared&&component.kind==='boolean'?await booleanDisplayMesh(component):null;
    const proxy=prepared?.descriptor??(display?{vertices:display.vertices,faces:display.triangles,labels:display.triangles.map(()=>'boolean'),notes:display.notes}
      :component.kind==='triangle-mesh'?{vertices:component.vertices,faces:component.triangles,labels:component.triangles.map((_,i)=>`triangle:${i}`)}:await proxyMesh(component));
    for(const note of proxy.notes??[])notes.push(id?`${id}: ${note}`:note);
    const offset=vertices.length;
    for(const p of proxy.vertices)vertices.push(p.map((v,i)=>v+translation[i]));
    for(const f of proxy.faces)faces.push(f.map(v=>v+offset));
    const names=proxy.labels.map(label=>id||(component.patches?label:'mesh'));
    for(const name of names)labels.push(name);
    for(const [index,face] of proxy.faces.entries())cornerNormals.push(proxy.cornerNormals?.[index]??face.map(()=>null));
    for(const name of new Set(names))features.push({id:name});
  };
  for(const [index,part] of parts.entries())await append(components[index],part.id,[part.xMm,part.yMm,part.zMm],contributions.find(entry=>entry.geometry===part.geometry)?.artifact);
  return {bytes:null,descriptor:{schema:'saam-shell-geometry/1',parameters,
    nativeForm:'display mesh derived from authoritative geometry recipes',features,boundsMm:shell.bounds,vertices,faces,labels,cornerNormals,...(notes.length?{notes:[...new Set(notes)]}:{})}};
}
