import {requireEditRevision} from './edit-identity.mjs';
// Bundle commits one engine-authored proposal through its revisioned edit.
// Extension execution and contribution assembly belong to the engines.
import {loadBundle,updatePlan,initBundle} from './bundle.mjs';
import {selectSettings} from '../machine/settings.mjs';

import {prepareExtensionRecipe} from './extension-recipe.mjs';
import {prepareExtensionGeometry} from '../extensions/geometry-edits.mjs';
import {validateSelectedExtensionRecipe} from '../../skills/records.mjs';
import {resolveSpatialPlan,normalizeSpatialPlan} from './spatial-inputs.mjs';
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
  await validateSelectedExtensionRecipe(plan);
  const normalized=normalizeSpatialPlan(plan);
  const updated=await updatePlan(directory,normalized,state.revision,{expectedEditRevision});
  return report?{...updated,extensionReport:report}:updated;
}

export async function createExtensionBundle(directory,extension,request,options={}){
  const {defaults}=await import('./plan.mjs');
  const selection=options.machineId?await selectSettings(options.machineId,options):null;
  const source=selection?{...defaults(selection.machine),...selection.settings}:{schema:'saam-shell-plan/1'};
  const {plan,report}=await prepareExtensionEdit(source,extension,request,{...options,create:true});
  await validateSelectedExtensionRecipe(plan);
  const normalized=normalizeSpatialPlan(plan);
  // The construction's notes are recorded with the creation, so they show as the print's limitations.
  await initBundle(directory,{...normalized,bundle:{machine:selection?.machine??null}},{...options,machineId:undefined,notes:[...(selection?.notes??[]),...(report?.notes??[])]});
  // The fresh state is this call's own; assigning keeps its non-enumerable geometry artifact.
  const created=await loadBundle(directory,{program:false});
  return report?Object.assign(created,{extensionReport:report}):created;
}
