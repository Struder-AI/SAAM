// Runtime's part execution: the work behind creating or editing a part.
// Each command reads the recipe into its current form, builds changed geometry,
// resolves the machine's settings against the built bounds and then hands Bundle
// the finished plan and artifact to store. Bundle itself only stores state.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadBundle,initBundle,updatePlan} from '../print/bundle.mjs';
import {machineLabel} from '../print/revisions.mjs';
import {requireThat} from '../private/bundle/numeric.mjs';
import {requireEditRevision} from '../print/edit-identity.mjs';
import {canonicalJson} from '../canonical-json.mjs';
import {currentRecipeTerms} from '../print/assignment-records.mjs';
import {normalizeSpatialPlan} from '../print/spatial-inputs.mjs';
import {createGeometry,bindGeometryArtifacts} from '../print/geometry.mjs';
import {selectSettings,resolveInitialSettings} from '../machine/settings.mjs';
import {checkedPlacementOrigins,initialPlacementOrigins} from '../print/placement-intent.mjs';
import {getObservationFlow,withObservationFlow,observeGeometryArtifact} from '../contracts/observations.mjs';

const currentRecipe=plan=>normalizeSpatialPlan(currentRecipeTerms(plan));

async function buildGeometry(parameters,revision,options){
  const flow=getObservationFlow(),build=()=>createGeometry(parameters,options);
  const artifact=await (flow?withObservationFlow({...flow,inputRevision:revision},build):build());
  await observeGeometryArtifact({wireId:'part-geometry',phase:'reply',value:artifact,
    stageId:'geometry-artifact:result',consumerId:'Bundle geometry publication'});
  return artifact;
}

// plan: a recipe, optionally with a saved manifest's `bundle` record, whose
// machine label, placement origins and display preferences carry over.
// machineId/preparedSelection: the machine whose settings this part takes.
export async function createPart(directory,plan={schema:'saam-shell-plan/1'},{machineId,appRoot,dataRoot,machineSetups,preparedSelection,
  placementOrigins,notes=[],signal,progress,geometryArtifact,...storage}={}){
  signal?.throwIfAborted();
  const {bundle:saved,...recipe}=plan??{};
  requireThat(recipe&&typeof recipe==='object'&&!Array.isArray(recipe),'Bundle contents must be a record.');
  const retained=preparedSelection===undefined?undefined:structuredClone(preparedSelection);
  requireThat(retained===undefined||retained?.machine&&retained.settings&&Array.isArray(retained.notes)&&(!machineId||retained.machine.id===machineId),'Prepared Settings selection must match the chosen machine.');
  const selection=retained??(machineId?await selectSettings(machineId,{appRoot,dataRoot,machineSetups}):null);
  const savedLabel=machineLabel(saved);
  const origins=placementOrigins!==undefined?checkedPlacementOrigins(placementOrigins)
    :saved&&(Object.hasOwn(saved,'placementOrigins')||(Object.hasOwn(saved,'machineId')||Object.hasOwn(saved,'machine'))&&!machineId&&!preparedSelection)?checkedPlacementOrigins(saved.placementOrigins):initialPlacementOrigins(recipe.placement);
  let next=currentRecipe(recipe);
  if(!next.geometry&&geometryArtifact)bindGeometryArtifacts(next.geometry,geometryArtifact);
  const geometry=next.geometry?await buildGeometry(next.geometry,null,{signal,progress,geometryArtifact}):null;
  if(geometry)next={...next,geometry:geometry.descriptor.parameters};
  if(selection)next={...next,...resolveInitialSettings(next,selection,{boundsMm:geometry?.descriptor.boundsMm,placementOrigins:origins})};
  return initBundle(directory,next,{...storage,signal,geometry,placementOrigins:origins,machineId:selection?.machine.id??savedLabel,
    notes:[...notes,...selection?.notes??[]],deferRememberSetup:saved?.deferRememberSetup===true,phaseColours:saved?.phaseColours});
}

// plan: the complete next recipe. Changed geometry is built here, reusing the
// saved artifact where its owner can; supplied prepared artifacts bind to it.
export async function editPart(directory,plan,revision,{expectedEditRevision,signal,progress,geometryArtifact,geometryArtifacts,...storage}={}){
  signal?.throwIfAborted();
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision:revision,expectedEditRevision});
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  let next=currentRecipe(structuredClone(plan));
  const geometryChanged=canonicalJson(next.geometry)!==canonicalJson(state.plan.geometry);
  let geometry=null;
  if(geometryChanged&&next.geometry){
    const saved=state.geometryArtifact;
    const previousArtifact=saved?{descriptor:saved.descriptor,bytes:saved.file?await readFile(resolve(state.dir,saved.file),{signal}):null}:null;
    geometry=await buildGeometry(next.geometry,state.revision,{previousGeometry:state.plan.geometry,previousArtifact,signal,progress,geometryArtifact,geometryArtifacts});
    next={...next,geometry:geometry.descriptor.parameters};
  }else if(geometryArtifact||geometryArtifacts?.length)bindGeometryArtifacts(next.geometry,geometryArtifact,geometryArtifacts);
  return updatePlan(directory,next,revision,{...storage,expectedEditRevision,signal,geometry});
}
