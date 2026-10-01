// Agent import commands coordinate Geometry and Bundle; persistence accepts completed artifacts.
import {initBundle,loadBundle,updatePlan,changeMachine} from './bundle.mjs';
import {readFile,mkdir,realpath,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {hash} from './plan.mjs';
import {prepareSTLImport,releaseSTLImport} from '../geom/import-stl.mjs';
export {inferSTLUnits} from '../geom/import-stl.mjs';

export async function commitSTLImport(directory,candidate,options={}){
  options.signal?.throwIfAborted();
  await mkdir(dirname(resolve(directory)),{recursive:true});
  const parent=await realpath(dirname(resolve(directory))),target=join(parent,basename(resolve(directory)));
  try{await mkdir(target);}catch(error){if(error.code==='EEXIST')error.importDestinationExists=true;throw error;}
  try{
    await initBundle(target,{schema:'saam-shell-plan/1',geometry:candidate.geometry},{machineId:null,
      sourcePath:candidate.sourcePath,preparedGeometry:candidate.artifact,attachments:candidate.attachments});
    options.signal?.throwIfAborted();
    return {directory:target,repaired:candidate.repaired};
  }catch(error){
    try{if(await realpath(target)===target&&dirname(target)===parent)await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
    catch(cleanup){if(cleanup.code!=='ENOENT'){error.cleanupError=cleanup.message;error.message+=' Incomplete import cleanup failed: '+cleanup.message;}}
    throw error;
  }
}
export async function createSTLBundle(directory,source,options={}){
  const candidate=await prepareSTLImport(source,options);
  try{
    const result=await commitSTLImport(directory,candidate,options);
    if(options.machineId)await changeMachine(result.directory,options.machineId,{setupFile:options.setupFile});
    return result;
  }
  finally{await releaseSTLImport(candidate);}
}
export async function importSTLBundle(directory,source,options={}){
  return (await createSTLBundle(directory,source,{...options,repair:false})).directory;
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
