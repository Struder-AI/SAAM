// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import {VERSION,BUILD_DATE} from './version.mjs';
import {pathDependencies,PATH_CONTRACT} from '../path/dependencies.mjs';
import {manufacturingInput} from './spatial-inputs.mjs';
import {geometryTree} from '../../skills/records.mjs';
export {generatePreparedPath} from './construction-command.mjs';

// A geometry using a retired shape is read as its saved geometry's mesh
// (savedGeometry, the stored descriptor); without one the recipe shows without geometry.
// A wedge plan's geometry (eight corner points) is such a shape.
// A stored read is machine-agnostic: settings are returned as saved; the
// consumer that resolves them against a profile reports a missing value.
async function readRecipe(plan,{savedGeometry=null}={}){
  const {readRecipe:readCurrent,GEOMETRY_SHAPES}=await import('./plan.mjs');
  const read=recipe=>readCurrent(recipe,null,{settingsAsSaved:true});
  const shapeOf=node=>node.shape??(plan.schema==='saam-wedge-plan/1'?'wedge':undefined);
  const retired=[...new Set(geometryTree(plan.geometry).map(shapeOf).filter(shape=>shape!==undefined&&!GEOMETRY_SHAPES.includes(shape)))];
  if(!retired.length)return read(plan);
  const {geometry:_retired,...wider}=plan,recipe={...wider,schema:'saam-shell-plan/1'},shapes=retired.join(', ');
  const mesh=Array.isArray(savedGeometry?.vertices)&&Array.isArray(savedGeometry?.faces)?{shape:'mesh',vertices:savedGeometry.vertices,source:null,
    triangles:savedGeometry.faces.flatMap(face=>face.slice(2).map((_,i)=>[face[0],face[i+1],face[i+2]]))}:null;
  const result=read(mesh?{...recipe,geometry:mesh}:recipe);
  return {...result,geometryFromSaved:Boolean(mesh),notes:[mesh?`Retired shape ${shapes} read as its saved mesh.`:`Retired shape ${shapes} has no saved mesh; the recipe shows without geometry.`,...result.notes]};
}
export const {root, initBundle, loadBundle, loadBundleSnapshot, migrateBundle, readConstructedPath, readGenerationInputs, readGenerationPath, retainGenerationArtifact, publishGenerationResults, restoreRevision, updatePlan, setDeferredSetupSave, setPhaseColours, applySettingsSnapshot}=createBundleWorkflow({
  kind:'shell',readRecipe,manufacturingInput,
  pathDependencies,generationContract:PATH_CONTRACT,
  version:VERSION,buildDate:BUILD_DATE
});

export {changeMachine} from '../machine/bundle-settings.mjs';
export {bundleInstance,claimBundleInstance,releaseBundleInstance,withBundleInstance,recoverBundleInstance} from './studio-ownership.mjs';
export {createBundleRecipeState} from './recipe-state.mjs';
