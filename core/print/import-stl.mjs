// One STL import entry for CLI and MCP: preserve source, assumed or explicit units,
// remembered setup, native mesh verification and the normal print lifecycle.
import { initBundle, proposedPlan, loadBundle, updatePlan } from './bundle.mjs';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {isMainThread} from 'node:worker_threads';
import { hash } from './plan.mjs';
import { loadMachine, toolBounds, centeredPlacement } from '../machine/profile.mjs';
import { decodeSTL,parseSTL,makeMesh } from '../geom/mesh.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';
import {repairSTLFiles} from './repair-stl.mjs';
import {runRepairJob} from './mesh-repair-job.mjs';

export function inferSTLUnits(mesh,bounds){
  const size=[0,1,2].map(k=>{let min=Infinity,max=-Infinity;for(const p of mesh.vertices){min=Math.min(min,p[k]);max=Math.max(max,p[k]);}return max-min;});
  const longest=Math.max(...size),fitsInches=size.every((v,k)=>v*25.4<=bounds.max[k]-bounds.min[k]-(k<2?5:0));
  // Provisional D-030: prefer mm; only reinterpret a very small model when
  // inches give a plausible size that still fits this printer.
  return longest<10&&longest*25.4>=10&&fitsInches?'inch':'mm';
}
function geometryFromSTL(sourceHash,units,mesh,inferred=false){
  const factor=units==='inch'?25.4:1;
  const translationMm=[0,1,2].map(k=>-mesh.vertices.reduce((minimum,p)=>Math.min(minimum,p[k]*factor),Infinity));
  return {shape:'mesh',vertices:mesh.vertices.map(p=>p.map((v,k)=>v*factor+translationMm[k])),triangles:mesh.triangles,source:{format:'stl',sha256:sourceHash,units,scale:1,unitsInferred:inferred,translationMm}};
}
export async function importSTLBundle(directory, sourceBytes, { units='auto', machineId, setupFile,signal,progress,attribution } = {}) {
  if(!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  const machine = loadMachine(machineId);
  const plan = await proposedPlan(machine.id, { setupFile });
  const bounds = toolBounds(machine, plan.setup.tool);
  const file=typeof sourceBytes==='string',mesh=file?await decodeSTLFile(sourceBytes,{units:'mm',signal,progress}):parseSTL(sourceBytes,{units:'mm'}),inferred=units==='auto';
  if(file)makeMesh(mesh.vertices,mesh.triangles);
  if(inferred)units=inferSTLUnits(mesh,bounds);
  plan.geometry=geometryFromSTL(file?mesh.sha256:hash(sourceBytes),units,mesh,inferred);
  if(attribution){
    if(attribution.sha256!==plan.geometry.source.sha256)throw Error('Mesh attribution does not match the downloaded source hash.');
    plan.geometry.source.attribution=structuredClone(attribution);
  }
  // Centre the imported mesh on the plate. Its vertices were translated to put
  // the minimum XY at the origin, so the footprint size is the vertex span.
  const footprint=[0,1].map(k=>{let mn=Infinity,mx=-Infinity;for(const p of plan.geometry.vertices){mn=Math.min(mn,p[k]);mx=Math.max(mx,p[k]);}return mx-mn;});
  plan.placement = centeredPlacement(machine, plan.setup.tool, { runMm: footprint[0], widthMm: footprint[1] }) ?? { xMm: bounds.min[0] + 5, yMm: bounds.min[1] + 5 };
  plan.skills['draped-skin'].enabled = false;
  return initBundle(directory, plan, { machineId: machine.id, setupFile, ...(file?{sourcePath:resolve(sourceBytes)}:{sourceBytes}) });
}

// Malformed input, resource limits and setup failures keep their original
// diagnostic. Only recognized geometric defects are candidates for repair.
const repairable=error=>error.meshDiagnostic?.kind==='triangle-intersection'
  ||/^(?:Degenerate mesh triangle\.|Duplicate mesh triangle\.|Invalid mesh triangle indices\.|Mesh must be closed, manifold and consistently wound;|Unused or nonmanifold mesh vertex\.|Nonmanifold mesh vertex\.)/.test(error.message);

// Import into a new bundle directory; on an eligible defect, repair into its
// repair/ folder (original, repaired STL and report) and import the result.
// The caller owns the directory and removes it if this rejects.
// Progress stages: import, repair (with the repair step), import-repaired.
export async function importOrRepairSTLBundle(directory,sourceBytes,options={}){
  if(isMainThread)return runRepairJob('import',directory,sourceBytes,options);
  const {progress,signal,...settings}=options,bytes=Buffer.from(sourceBytes);
  progress?.({stage:'import'});
  try{await importSTLBundle(directory,bytes,{...settings,signal});return {repaired:false};}
  catch(error){if(!repairable(error))throw error;}
  let units=settings.units;
  if(units===undefined||units==='auto'){
    const machine=loadMachine(settings.machineId),plan=await proposedPlan(machine.id,{setupFile:settings.setupFile});
    units=inferSTLUnits(decodeSTL(bytes,{units:'mm'}),toolBounds(machine,plan.setup.tool));
  }
  const repairDirectory=join(directory,'repair');
  progress?.({stage:'repair'});
  await repairSTLFiles(repairDirectory,bytes,{units,maxHoleEdges:0,maxHoleDiameterMm:0,signal,
    progress:event=>progress?.({stage:'repair',step:event.stage})});
  progress?.({stage:'import-repaired'});
  await importSTLBundle(directory,join(repairDirectory,'repaired.stl'),{...settings,units:'mm',signal});
  return {repaired:true};
}

export async function setSTLUnits(directory,units,{expectedRevision}={}){
  if(!['mm','inch'].includes(units))throw Error('Choose mm or inch.');
  const state=await loadBundle(directory,{program:false}),original=state.plan.geometry;
  if(original.shape!=='mesh'||original.source?.format!=='stl')throw Error('This operation changes the units of an imported STL mesh.');
  const bytes=await readFile(resolve(directory,'geometry/source.stl'));
  if(hash(bytes)!==original.source.sha256)throw Error('The retained STL source changed.');
  const factor=(units==='inch'?25.4:1)/(original.source.units==='inch'?25.4:1);
  const geometry={...original,vertices:original.vertices.map(p=>p.map(v=>v*factor)),source:{...original.source,units,unitsInferred:false}};
  if(original.source.translationMm)geometry.source.translationMm=original.source.translationMm.map(v=>v*factor);
  await updatePlan(directory,{...state.plan,geometry},expectedRevision??state.revision);
  return loadBundle(directory,{program:false});
}
