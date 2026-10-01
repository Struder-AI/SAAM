// One STL import entry for CLI and MCP: preserve source, assumed or explicit units,
// remembered setup, native mesh verification and the normal print lifecycle.
import { initBundle, proposedPlan, loadBundle, updatePlan } from './bundle.mjs';
import {readFile,mkdir,realpath,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {isMainThread} from 'node:worker_threads';
import { hash } from './plan.mjs';
import { loadMachine, toolBounds, centeredPlacement } from '../machine/profile.mjs';
import {decodeSTL} from '../geom/mesh.mjs';
import {prepareImportedGeometry,inferSTLUnits} from '../geom/import-stl.mjs';
export {inferSTLUnits} from '../geom/import-stl.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';
import {repairSTLFiles} from './repair-stl.mjs';
import {runRepairJob} from './mesh-repair-job.mjs';

export async function importSTLBundle(directory, sourceBytes, { units='auto', machineId, setupFile,signal,progress,attribution,repairReport } = {}) {
  if(!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  const machine = loadMachine(machineId);
  const plan = await proposedPlan(machine.id, { setupFile });
  const bounds = toolBounds(machine, plan.setup.tool);
  const file=typeof sourceBytes==='string';
  const {geometry,footprint}=await prepareImportedGeometry(sourceBytes,{units,bounds,signal,progress,attribution,repairReport});
  plan.geometry=geometry;
  plan.placement = centeredPlacement(machine, plan.setup.tool, { runMm: footprint[0], widthMm: footprint[1] }) ?? { xMm: bounds.min[0] + 5, yMm: bounds.min[1] + 5 };
  return initBundle(directory, plan, { machineId: machine.id, setupFile, ...(file?{sourcePath:resolve(sourceBytes)}:{sourceBytes}) });
}

// Malformed input, resource limits and setup failures keep their original
// diagnostic. Only recognized geometric defects are candidates for repair.
const repairable=error=>error.meshDiagnostic?.kind==='triangle-intersection'
  ||/^(?:Degenerate mesh triangle\.|Duplicate mesh triangle\.|Invalid mesh triangle indices\.|Mesh must be closed, manifold and consistently wound;|Unused or nonmanifold mesh vertex\.|Nonmanifold mesh vertex\.)/.test(error.message);

// All user-facing imports own a fresh destination. A stopped worker can leave
// partial files, so cleanup belongs to this supervisor, after the job settles.
export async function createSTLBundle(directory,source,options={}){
  options.signal?.throwIfAborted();
  await mkdir(dirname(resolve(directory)),{recursive:true});
  const parent=await realpath(dirname(resolve(directory))),target=join(parent,basename(resolve(directory)));
  try{await mkdir(target);}catch(error){if(error.code==='EEXIST')error.importDestinationExists=true;throw error;}
  try{return {directory:target,...await importOrRepairSTLBundle(target,source,options)};}
  catch(error){
    try{if(await realpath(target)===target&&dirname(target)===parent)await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
    catch(cleanup){if(cleanup.code!=='ENOENT'){error.cleanupError=cleanup.message;error.message+=' Incomplete import cleanup failed: '+cleanup.message;}}
    throw error;
  }
}

// Import into a new bundle directory; on an eligible defect, repair into its
// repair/ folder (original, repaired STL and report) and import the result.
// The caller owns the directory and removes it if this rejects.
// Progress stages: import, repair (with the repair step), import-repaired.
export async function importOrRepairSTLBundle(directory,sourceBytes,options={}){
  if(isMainThread)return runRepairJob('import',directory,sourceBytes,options);
  const {progress,signal,...settings}=options;
  const source=typeof sourceBytes==='string'?sourceBytes:Buffer.from(sourceBytes);
  progress?.({stage:'import'});
  try{await importSTLBundle(directory,source,{...settings,signal,progress:event=>progress?.({...event,stage:'import',step:event.stage})});return {repaired:false};}
  catch(error){if(!repairable(error))throw error;}
  let units=settings.units;
  if(units===undefined||units==='auto'){
    const machine=loadMachine(settings.machineId),plan=await proposedPlan(machine.id,{setupFile:settings.setupFile});
    const mesh=typeof source==='string'?await decodeSTLFile(source,{units:'mm',signal,progress}):decodeSTL(source,{units:'mm'});
    units=inferSTLUnits(mesh,toolBounds(machine,plan.setup.tool));
  }
  const repairDirectory=join(directory,'repair');
  progress?.({stage:'repair'});
  const repairReport=await repairSTLFiles(repairDirectory,source,{units,maxHoleEdges:0,maxHoleDiameterMm:0,signal,nativeReady:settings.nativeReady,nativeRun:settings.nativeRun,
    progress:event=>progress?.({...event,stage:'repair',step:event.stage})});
  progress?.({stage:'import-repaired'});
  await importSTLBundle(directory,join(repairDirectory,'repaired.stl'),{...settings,repairReport,units:'mm',signal,progress:event=>progress?.({...event,stage:'import-repaired',step:event.stage})});
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
