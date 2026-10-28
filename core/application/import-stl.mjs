// Runtime's STL import: Geometry admits one shape, Settings supplies the
// machine bounds, part execution builds and Bundle stores the part.
import {loadBundle} from '../print/bundle.mjs';
import {createPart,editPart} from './part-execution.mjs';
import {bundleInstance,requireBundleInstance} from '../print/studio-ownership.mjs';
import {requireEditRevision} from '../print/edit-identity.mjs';
import {solidGeometry,replaceSolid} from '../geom/spatial.mjs';
import {selectSettings,machineBounds} from '../machine/settings.mjs';
import {readFile,mkdir,realpath,rm,access} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {recipeDefaults} from '../print/plan.mjs';
import {prepareSTLImport,releaseSTLImport} from '../geom/import-stl.mjs';
export {inferSTLUnits} from '../geom/import-stl.mjs';

export async function commitSTLImport(directory,candidate,{appRoot,dataRoot,preparedSelection,...options}={}){
  preparedSelection=preparedSelection===undefined?undefined:structuredClone(preparedSelection);
  try{
  options.signal?.throwIfAborted();
  await mkdir(dirname(resolve(directory)),{recursive:true});
  const parent=await realpath(dirname(resolve(directory))),target=join(parent,basename(resolve(directory)));
  try{await mkdir(target);}catch(error){if(error.code!=='EEXIST')throw error;
    const owned=await bundleInstance(target),saved=await readFile(join(target,'plan.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(!owned||saved){error.importDestinationExists=true;throw error;}await requireBundleInstance(target);}
  let committed=false;
  try{
    await createPart(target,{...recipeDefaults(),geometry:candidate.geometry},{appRoot,dataRoot,machineId:options.machineId,machineSetups:options.machineSetups,preparedSelection,
      sourcePath:candidate.sourcePath,attachments:candidate.attachments,geometryArtifact:candidate.geometryArtifact,
      signal:options.signal,progress:options.progress,beforeCommit:()=>options.beforeCommit?.('Saving imported geometry')});
    committed=true;
    return {directory:target,repaired:candidate.repaired,importDiagnostic:candidate.importDiagnostic};
  }catch(error){
    try{
      // A post-publication auxiliary failure must not delete the saved print.
      if(!committed)committed=await access(join(target,'plan.json')).then(()=>true,failure=>{if(failure.code==='ENOENT')return false;throw failure;});
      if(!committed&&await realpath(target)===target&&dirname(target)===parent)await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
    catch(cleanup){if(cleanup.code!=='ENOENT'){error.cleanupError=cleanup.message;error.message+=' Incomplete import cleanup failed: '+cleanup.message;}}
    throw error;
  }
  }catch(error){
    throw Object.assign(error,{importDiagnostic:{...candidate.importDiagnostic,stage:'bundle',
      failure:{name:error.name,code:error.code??null,message:error.message}}});
  }
}
export async function createSTLBundle(directory,source,{appRoot,dataRoot,machineId,machineSetups,preparedSelection,...options}={}){
  options.signal?.throwIfAborted();
  const retained=preparedSelection===undefined?undefined:structuredClone(preparedSelection);
  if(retained!==undefined&&(!retained?.machine||!retained.settings||!Array.isArray(retained.notes)||machineId&&retained.machine.id!==machineId))throw Error('Prepared Settings selection must match the chosen machine.');
  const suppliedBounds=structuredClone(options.bounds);
  if(options.paths)options.paths=Object.freeze({...options.paths});
  const selection=retained??(machineId?await selectSettings(machineId,{appRoot,dataRoot,machineSetups}):undefined);
  const bounds=suppliedBounds??(selection?structuredClone(machineBounds(selection.machine,selection.settings.setup.tool)):undefined);
  const candidate=await prepareSTLImport(source,{...options,bounds});
  try{
    return await commitSTLImport(directory,candidate,{...options,preparedSelection:selection});
  }
  finally{await releaseSTLImport(candidate);}
}
// Studio's import: admit the STL once, then save it to the first free directory the
// caller names. retry:false makes an occupied destination the import's failure.
export async function createSTLBundleIn(directories,source,{paths,units,progress,signal,retry=true}={}){
  const candidate=await prepareSTLImport(source,{paths,units,progress,signal});
  try{
    for(const directory of directories){
      try{
        const {repaired}=await commitSTLImport(directory,candidate,{signal});
        return {directory,repaired,importDiagnostic:candidate.importDiagnostic};
      }catch(error){if(!retry||!error.importDestinationExists)throw error;}
    }
    throw Error('No free folder for the imported STL.');
  }finally{await releaseSTLImport(candidate);}
}
export async function importSTLBundle(directory,source,options={}){
  return (await createSTLBundle(directory,source,{...options,repair:false})).directory;
}

export async function setSTLUnits(directory,units,{expectedRevision,expectedEditRevision}={}){
  if(!['mm','inch'].includes(units))throw Error('Choose mm or inch.');
  const state=await loadBundle(directory,{program:false}),original=solidGeometry(state.plan.geometry);
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  if(original?.shape!=='mesh'||original.source?.format!=='stl')throw Error('This operation changes the units of an imported STL mesh.');
  const factor=(units==='inch'?25.4:1)/(original.source.units==='inch'?25.4:1);
  const geometry={...original,vertices:original.vertices.map(p=>p.map(v=>v*factor)),source:{...original.source,units,unitsInferred:false}};
  if(original.source.translationMm)geometry.source.translationMm=original.source.translationMm.map(v=>v*factor);
  await editPart(directory,{...state.plan,geometry:replaceSolid(state.plan.geometry,geometry)},expectedRevision??state.revision,{expectedEditRevision});
  return loadBundle(directory,{program:false});
}
