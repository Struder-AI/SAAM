// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import {VERSION,BUILD_DATE} from './version.mjs';
import {pathDependencies,PATH_CONTRACT,NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {requireGenerationExtensions} from '../path/extension-dependencies.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeSpatialPlan,geometryInput} from './spatial-inputs.mjs';

const defaults=async machine=>(await import('./plan.mjs')).defaults(machine);
const createGeometry=async parameters=>(await import('./geometry.mjs')).createGeometry(parameters);
async function presentGeometry(plan,descriptor){
  if(plan.geometry?.shape==='spatial'||plan.geometry&&!(plan.slices?.assignments??[]).some(a=>['curves','inject'].includes(a.construction)))return descriptor;
  const normalized=normalizeSpatialPlan(plan);
  const {createSpatialGeometry}=await import('./geometry.mjs');
  return (await createSpatialGeometry(normalized.geometry,descriptor)).descriptor;
}
async function patchPlan(previous,patch){
  const {geometryTemplate}=await import('./plan.mjs');
  return resolvePlanPatch(previous,patch,{geometryTemplate});
}

export const LIMITATIONS = [
  'Physical clearance is the operator’s responsibility; no collision model is implemented.',
  'Bead shape, perimeter overlap and surface stacking are approximations.',
  'Contour sampling is bounded by minFeatureMm; a closed feature smaller than that can be missed.',
  'Firmware startup and service routines are not motion-simulated.'
];

const limitationsFor = (plan, machine) => {
  const assignments=plan.slices?.assignments??[];
  const limits=[...LIMITATIONS,...(machine.limitations??[])];
  if(assignments.some(a=>a.fillOrder?.kind==='fronts'))limits.push('Experimental surface wave overhangs: seeds and material ownership are explicitly assigned. Surface propagation, lateral bead attachment, cooling and warping have not been physically validated. Small numerical residuals are retained in the wave report.');
  return limits;
};

export async function generatePreparedPath(plan,options){
  await requireGenerationExtensions(plan);
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
  try {
    const selected=await requireGenerationExtensions(plan);
    const hash=createHash('sha256').update(JSON.stringify([version,PATH_CONTRACT,NEUTRAL_PATH_CONTRACT,
      selected.map(({id,digest})=>[id,digest])])).digest('hex');
    return {release:version,hash};
  } catch(error){if(error.code!=='EXTENSION_MISSING')throw error;return {release:version,hash:null,missing:error};}
}

export const {root, EXPORT_NAME, atomicManifest, proposedPlan, initBundle, loadBundle, loadBundleSnapshot, bundleFingerprint, bundleFingerprints, migrateBundle, readToolpath, prepareGeneration, commitGeneration, generateToolpath, restoreRevision, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, exportReviewed, setDeferredSetupSave, applySettingsSnapshot}=createBundleWorkflow({
  kind:'shell',defaults,patchPlan,createGeometry,normalizePlan:normalizeSpatialPlan,geometryInput,presentGeometry,
  generatePath:generatePreparedPath,pathDependencies,pathSource,generationContract:PATH_CONTRACT,completionContract:NEUTRAL_PATH_CONTRACT,
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',
  limitations:limitationsFor
});

export {changeMachine} from '../machine/bundle-settings.mjs';
export {shareBundle,importBundle} from './portable.mjs';
export {bundleInstance,claimBundleInstance,releaseBundleInstance,withBundleInstance,recoverBundleInstance} from './studio-ownership.mjs';
