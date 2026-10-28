import {requireEditRevision} from './edit-identity.mjs';
// Bundle commits one engine-authored proposal through its revisioned edit.
// Extension execution and contribution assembly belong to the engines.
import {loadBundle} from './bundle.mjs';
import {createPart,editPart} from '../application/part-execution.mjs';
import {selectSettings} from '../machine/settings.mjs';
import {lstat,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {summary} from './summary.mjs';
import {prepareExtensionEdit} from '../extensions/contributions.mjs';
import {validateSelectedExtensionRecipe} from '../../skills/records.mjs';
import {normalizeSpatialPlan} from './spatial-inputs.mjs';
import {checkedPlacementOrigins,editedPlacementOrigins,initialPlacementOrigins} from './placement-intent.mjs';

export async function prepareExtensionCreation({machineId,machineSetups,appRoot,dataRoot}={}){
  const {defaults}=await import('./plan.mjs');
  const selection=machineId?await selectSettings(machineId,{machineSetups,appRoot,dataRoot}):null;
  return {selection,placementOrigins:initialPlacementOrigins(),plan:selection?{...defaults(selection.machine),...structuredClone(selection.settings)}:{schema:'saam-shell-plan/1'}};
}
async function rejectSetupLinks(path){
  const info=await lstat(path);
  if(info.isSymbolicLink())throw Error('Symbolic links and junctions are not supported in SAAM print bundles.');
  if(info.isFile()&&info.nlink>1)throw Error('Hard-linked files are not supported in SAAM print bundles.');
  if(info.isDirectory())for(const name of await readdir(path))await rejectSetupLinks(resolve(path,name));
}
// The bound directory port admits only this invocation's library targets. No
// Settings resolver or raw filesystem capability is handed to Extensions.
export function createExtensionBundleAccess({directory,machineSetupsPath,appRoot,dataRoot}){
  const roots={appRoot,dataRoot};
  return Object.freeze({summary,async prepareTarget(bundleId,{create=false,machineId}={}){
    const dir=await directory(bundleId,{create});
    if(!create)return {dir,state:await loadBundle(dir,{program:false})};
    if(machineSetupsPath){
      try{
        if((await lstat(dirname(machineSetupsPath))).isSymbolicLink())throw Error('The machine setup parent cannot be a symbolic link or junction.');
        await rejectSetupLinks(machineSetupsPath);
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return {dir,creation:await prepareExtensionCreation({...roots,machineId,machineSetups:machineSetupsPath})};
  }});
}

export async function applyExtensionEdit(directory,extension,request,{expectedRevision,expectedEditRevision,...options}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const {plan,placement,report,editProvenance}=await prepareExtensionEdit(state.plan,extension,request,options);
  await validateSelectedExtensionRecipe(plan);
  const normalized=normalizeSpatialPlan(plan);
  options.signal?.throwIfAborted();
  const updated=await editPart(directory,normalized,state.revision,{expectedEditRevision,...options,editProvenance,
    placementOrigins:editedPlacementOrigins(state.placementOrigins,placement)});
  return report?{...updated,extensionReport:report}:updated;
}

export async function createExtensionBundle(directory,extension,request,{preparedCreation,...options}={}){
  options.signal?.throwIfAborted();
  const {selection,plan:source,placementOrigins}=preparedCreation??await prepareExtensionCreation(options);
  const origins=checkedPlacementOrigins(placementOrigins)??{};
  const {plan,placement,report,editProvenance}=await prepareExtensionEdit(source,extension,request,{...options,create:true});
  await validateSelectedExtensionRecipe(plan);
  const normalized=normalizeSpatialPlan(plan);
  // The construction's notes are recorded with the creation, so they show as the print's limitations.
  options.signal?.throwIfAborted();
  await createPart(directory,normalized,{...options,machineId:undefined,preparedSelection:selection??undefined,
    placementOrigins:editedPlacementOrigins(origins,placement),notes:report?.notes??[],editProvenance});
  // The fresh state is this call's own; assigning keeps its non-enumerable geometry artifact.
  const created=await loadBundle(directory,{program:false});
  return report?Object.assign(created,{extensionReport:report}):created;
}
