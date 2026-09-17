// One STL import entry for CLI and MCP: preserve source, assumed or explicit units,
// remembered setup, native mesh verification and the normal print lifecycle.
import { initBundle, proposedPlan, loadBundle, updatePlan } from './bundle.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import { hash } from './plan.mjs';
import { loadMachine, toolBounds } from '../machine/profile.mjs';
import { parseSTL,makeMesh } from '../geom/mesh.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';

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
  plan.placement = { xMm: bounds.min[0] + 5, yMm: bounds.min[1] + 5 };
  plan.skills['draped-skin'].enabled = false;
  return initBundle(directory, plan, { machineId: machine.id, setupFile, ...(file?{sourcePath:resolve(sourceBytes)}:{sourceBytes}) });
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
