// Agent import commands coordinate Geometry and Bundle; persistence accepts completed artifacts.
import {initBundle,loadBundle,updatePlan} from './bundle.mjs';
import {bundleInstance,requireBundleInstance} from './studio-ownership.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {solidGeometry,replaceSolid} from '../geom/spatial.mjs';
import {changeMachine} from '../machine/bundle-settings.mjs';
import {readFile,mkdir,realpath,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {recipeDefaults} from './plan.mjs';
import {prepareSTLImport,releaseSTLImport} from '../geom/import-stl.mjs';
export {inferSTLUnits} from '../geom/import-stl.mjs';

export async function commitSTLImport(directory,candidate,options={}){
  try{
  options.signal?.throwIfAborted();
  await mkdir(dirname(resolve(directory)),{recursive:true});
  const parent=await realpath(dirname(resolve(directory))),target=join(parent,basename(resolve(directory)));
  try{await mkdir(target);}catch(error){if(error.code!=='EEXIST')throw error;
    const owned=await bundleInstance(target),saved=await readFile(join(target,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(!owned||saved){error.importDestinationExists=true;throw error;}await requireBundleInstance(target);}
  try{
    await initBundle(target,{...recipeDefaults(),geometry:candidate.geometry},{machineId:null,
      sourcePath:candidate.sourcePath,preparedGeometry:candidate.artifact,attachments:candidate.attachments});
    options.signal?.throwIfAborted();
    if(options.machineId)await changeMachine(target,options.machineId,{machineSetups:options.machineSetups});
    options.signal?.throwIfAborted();
    return {directory:target,repaired:candidate.repaired,importDiagnostic:candidate.importDiagnostic};
  }catch(error){
    try{if(await realpath(target)===target&&dirname(target)===parent)await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
    catch(cleanup){if(cleanup.code!=='ENOENT'){error.cleanupError=cleanup.message;error.message+=' Incomplete import cleanup failed: '+cleanup.message;}}
    throw error;
  }
  }catch(error){
    throw Object.assign(error,{importDiagnostic:{...candidate.importDiagnostic,stage:'bundle',
      failure:{name:error.name,code:error.code??null,message:error.message}}});
  }
}
export async function createSTLBundle(directory,source,options={}){
  const candidate=await prepareSTLImport(source,options);
  try{
    return await commitSTLImport(directory,candidate,options);
  }
  finally{await releaseSTLImport(candidate);}
}
export async function importSTLBundle(directory,source,options={}){
  return (await createSTLBundle(directory,source,{...options,repair:false})).directory;
}

export async function setSTLUnits(directory,units,{expectedRevision,expectedEditRevision}={}){
  if(!['mm','inch'].includes(units))throw Error('Choose mm or inch.');
  const state=await loadBundle(directory,{program:false}),original=solidGeometry(state.plan.geometry);
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  if(original?.shape!=='mesh'||original.source?.format!=='stl')throw Error('This operation changes the units of an imported STL mesh.');
  const bytes=await readFile(resolve(directory,'geometry/source.stl'));
  if(createHash('sha256').update(bytes).digest('hex')!==original.source.sha256)throw Error('The retained STL source changed.');
  const factor=(units==='inch'?25.4:1)/(original.source.units==='inch'?25.4:1);
  const geometry={...original,vertices:original.vertices.map(p=>p.map(v=>v*factor)),source:{...original.source,units,unitsInferred:false}};
  if(original.source.translationMm)geometry.source.translationMm=original.source.translationMm.map(v=>v*factor);
  await updatePlan(directory,{...state.plan,geometry:replaceSolid(state.plan.geometry,geometry)},expectedRevision??state.revision,{expectedEditRevision});
  return loadBundle(directory,{program:false});
}
