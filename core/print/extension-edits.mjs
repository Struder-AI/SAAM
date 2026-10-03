import {requireEditRevision} from './edit-identity.mjs';
// Bundle commits one engine-authored proposal through its revisioned edit.
// Extension execution and contribution assembly belong to the engines.
import {loadBundle,updatePlan,initBundle} from './bundle.mjs';
import {selectSettings} from '../machine/settings.mjs';

import {prepareExtensionRecipe} from './extension-recipe.mjs';
import {prepareExtensionGeometry} from '../geom/extension-edit.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {validateSelectedExtensionRecipe} from '../../skills/records.mjs';
import {resolveSpatialPlan} from './spatial-inputs.mjs';
import {replaceSolid} from '../geom/spatial.mjs';

async function prepareExtensionEdit(source,extension,request,options){
  const contribution=await prepareExtensionGeometry(resolveSpatialPlan(source),extension,request,options);
  const geometryContribution=contribution?{...contribution,plan:{...contribution.plan,geometry:replaceSolid(source.geometry,contribution.plan.geometry??null)}}:null;
  if(geometryContribution&&geometryContribution.assignments===undefined&&geometryContribution.assignmentRequests===undefined)return geometryContribution;
  return prepareExtensionRecipe(source,extension,request,{...options,geometryContribution});
}

export async function applyExtensionEdit(directory,extension,request,{expectedRevision,expectedEditRevision,...options}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const {plan,report}=await prepareExtensionEdit(state.plan,extension,request,options);
  await validateSelectedExtensionRecipe(plan,assignment=>assignmentPlan(plan,assignment).process);
  const updated=await updatePlan(directory,plan,state.revision,{expectedEditRevision});
  return report?{...updated,extensionReport:report}:updated;
}

export async function createExtensionBundle(directory,extension,request,options={}){
  const {defaults}=await import('./plan.mjs');
  const selection=options.machineId?await selectSettings(options.machineId,options):null;
  const source=selection?{...defaults(selection.machine),...selection.settings}:{schema:'saam-shell-plan/1'};
  const {plan}=await prepareExtensionEdit(source,extension,request,{...options,create:true});
  await validateSelectedExtensionRecipe(plan,assignment=>assignmentPlan(plan,assignment).process);
  await initBundle(directory,{...plan,bundle:{machine:selection?.machine??null}},{...options,machineId:undefined});
  return loadBundle(directory,{program:false});
}
