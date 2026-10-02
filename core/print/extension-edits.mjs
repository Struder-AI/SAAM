import {requireThat} from '../private/bundle/numeric.mjs';
// Bundle commits one engine-authored proposal through its revisioned edit.
// Extension execution and contribution assembly belong to the engines.
import {loadBundle,updatePlan,initBundle} from './bundle.mjs';
import {selectSettings} from '../machine/settings.mjs';

import {prepareExtensionRecipe} from './extension-recipe.mjs';
import {prepareExtensionGeometry} from '../geom/extension-edit.mjs';

async function prepareExtensionEdit(source,extension,request,options){
  const geometryContribution=await prepareExtensionGeometry(source,extension,request,options);
  if(geometryContribution&&geometryContribution.assignments===undefined&&geometryContribution.assignmentRequests===undefined)return geometryContribution;
  return prepareExtensionRecipe(source,extension,request,{...options,geometryContribution});
}

export async function applyExtensionEdit(directory,extension,request,{expectedRevision,...options}={}){
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing the print.');
  const {plan,report}=await prepareExtensionEdit(state.plan,extension,request,{...options,machine:state.machine});
  const updated=await updatePlan(directory,plan,state.revision);
  return report?{...updated,extensionReport:report}:updated;
}

export async function createExtensionBundle(directory,extension,request,options={}){
  const {defaults}=await import('./plan.mjs');
  const selection=options.machineId?await selectSettings(options.machineId,options):null;
  const source=selection?{...defaults(selection.machine),...selection.settings}:{schema:'saam-shell-plan/1'};
  const {plan}=await prepareExtensionEdit(source,extension,request,{...options,create:true});
  await initBundle(directory,{...plan,bundle:{machine:selection?.machine??null}},{...options,machineId:undefined});
  return loadBundle(directory,{program:false});
}
