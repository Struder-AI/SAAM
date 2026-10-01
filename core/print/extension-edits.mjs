import {requireThat} from '../private/bundle/numeric.mjs';
// Bundle commits one engine-authored proposal through its revisioned edit.
// Extension execution and contribution assembly belong to the engines.
import {loadBundle,updatePlan,proposedPlan,initBundle} from './bundle.mjs';

import {prepareExtensionRecipe} from './extension-recipe.mjs';

export async function applyExtensionEdit(directory,extension,request,{expectedRevision,...options}={}){
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing the print.');
  const {plan,report}=await prepareExtensionRecipe(state.plan,extension,request,{...options,machine:state.machine});
  const updated=await updatePlan(directory,plan,state.revision);
  return report?{...updated,extensionReport:report}:updated;
}

export async function createExtensionBundle(directory,extension,request,options={}){
  const source=await proposedPlan(options.machineId,options);
  const {plan}=await prepareExtensionRecipe(source,extension,request,{...options,create:true});
  await initBundle(directory,plan,options);
  return loadBundle(directory,{program:false});
}
