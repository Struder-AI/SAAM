// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import {VERSION,BUILD_DATE} from './version.mjs';
import {pathDependencies,PATH_CONTRACT,NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {generationExtensionSources} from '../path/extension-dependencies.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeSpatialPlan,manufacturingInput} from './spatial-inputs.mjs';
import {currentRecipeTerms} from './assignment-records.mjs';
import {geometryTree} from '../../skills/records.mjs';

const defaults=async machine=>(await import('./plan.mjs')).defaults(machine);
// A geometry using a retired shape is read as its saved geometry's mesh
// (savedGeometry, the stored descriptor); without one the recipe shows without geometry.
// A wedge plan's geometry (eight corner points) is such a shape.
async function readRecipe(plan,machine,{savedGeometry=null}={}){
  const {readRecipe:read,GEOMETRY_SHAPES}=await import('./plan.mjs');
  const shapeOf=node=>node.shape??(plan.schema==='saam-wedge-plan/1'?'wedge':undefined);
  const retired=[...new Set(geometryTree(plan.geometry).map(shapeOf).filter(shape=>shape!==undefined&&!GEOMETRY_SHAPES.includes(shape)))];
  if(!retired.length)return read(plan,machine);
  const {geometry:_retired,...wider}=plan,recipe={...wider,schema:'saam-shell-plan/1'},shapes=retired.join(', ');
  const mesh=Array.isArray(savedGeometry?.vertices)&&Array.isArray(savedGeometry?.faces)?{shape:'mesh',vertices:savedGeometry.vertices,source:null,
    triangles:savedGeometry.faces.flatMap(face=>face.slice(2).map((_,i)=>[face[0],face[i+1],face[i+2]]))}:null;
  const result=read(mesh?{...recipe,geometry:mesh}:recipe,machine);
  return {...result,geometryFromSaved:Boolean(mesh),notes:[mesh?`Retired shape ${shapes} read as its saved mesh.`:`Retired shape ${shapes} has no saved mesh; the recipe shows without geometry.`,...result.notes]};
}
const createGeometry=async (parameters,options)=>(await import('./geometry.mjs')).createGeometry(parameters,options);
const normalizePlan=plan=>({plan:normalizeSpatialPlan(currentRecipeTerms(plan))});
async function presentGeometry(plan,descriptor){
  if(plan.geometry?.shape==='spatial'||plan.geometry&&!(plan.slices?.assignments??[]).some(a=>['curves','inject'].includes(a.construction)))return descriptor;
  const normalized=normalizeSpatialPlan(plan);
  if(normalized.geometry?.shape!=='spatial')return descriptor;
  const {createSpatialGeometry}=await import('./geometry.mjs');
  return (await createSpatialGeometry(normalized.geometry,descriptor)).descriptor;
}
async function patchPlan(previous,patch){
  const {geometryTemplate}=await import('./plan.mjs');
  return resolvePlanPatch(previous,patch,{geometryTemplate});
}

export async function generatePreparedPath(plan,options){
  const [{compileRecipe},{generatePath},{prepareModulationFields}]=await Promise.all([
    import('./plan.mjs'),import('./generate.mjs'),import('./modulation-fields.mjs')]);
  plan=compileRecipe(plan).plan;
  const fields=await prepareModulationFields(plan.modulations);
  return generatePath(plan,{...options,modulations:fields.record,modulationPreparation:fields.report});
}

export async function pathSource(plan){
  const release=await readFile(new URL('../../release.json',import.meta.url),'utf8').then(JSON.parse)
    .catch(error=>{if(error.code!=='ENOENT')throw error;return {version:PATH_CONTRACT};});
  if(!release||typeof release.version!=='string'||!release.version)throw Error('Installed release record has no version.');
  const version=release.version;
  // An unavailable executable extension affects only its assignments. Its
  // absence still belongs to the source snapshot, so installing or repairing
  // it invalidates an earlier partial path before the next generation.
  const selected=await generationExtensionSources(plan);
  const hash=createHash('sha256').update(JSON.stringify([version,PATH_CONTRACT,NEUTRAL_PATH_CONTRACT,selected])).digest('hex');
  return {release:version,hash};
}

export const {root, EXPORT_NAME, proposedPlan, initBundle, loadBundle, loadBundleSnapshot, migrateBundle, readDrawnPath, readConstructedPath, prepareGeneration, commitGeneration, restoreRevision, checkPathBundle, adjustBundle, updatePlan, generateBundle, exportReviewed, setDeferredSetupSave, setPhaseColours, applySettingsSnapshot}=createBundleWorkflow({
  kind:'shell',defaults,readRecipe,patchPlan,createGeometry,normalizePlan,manufacturingInput,presentGeometry,
  generatePath:generatePreparedPath,pathDependencies,pathSource,generationContract:PATH_CONTRACT,
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode'
});

export {changeMachine} from '../machine/bundle-settings.mjs';
export {shareBundle,importBundle} from './portable.mjs';
export {bundleInstance,claimBundleInstance,releaseBundleInstance,withBundleInstance,recoverBundleInstance} from './studio-ownership.mjs';
