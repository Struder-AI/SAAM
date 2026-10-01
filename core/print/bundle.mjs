// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import {VERSION,BUILD_DATE} from './version.mjs';
import {pathDependencies,PATH_CONTRACT,NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {requireGenerationExtensions} from '../path/extension-dependencies.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const defaults=async machine=>(await import('./plan.mjs')).defaults(machine);
const createGeometry=async parameters=>(await import('./geometry.mjs')).createGeometry(parameters);
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
  const [{compileRecipe},{rhino},{buildShell,translateShell},{generatePath},
    {modulationGeometrySources,prepareModulationFields},{booleanShell}]=await Promise.all([
      import('./plan.mjs'),import('../geom/runtime.mjs'),import('../geom/build.mjs'),import('./generate.mjs'),
      import('./modulation-fields.mjs'),import('../geom/boolean-solid.mjs')]);
  plan=compileRecipe(plan).plan;
  const native=await rhino(),sources=modulationGeometrySources(plan.modulations);
  const material=geometry=>geometry.shape==='assembly'
    ?booleanShell('union',geometry.parts.map(part=>translateShell(material(part.geometry),part.xMm,part.yMm,part.zMm)))
    :geometry.shape==='boolean'?booleanShell(geometry.operation,geometry.operands.map(material)):buildShell(native,geometry);
  const fields=await prepareModulationFields(plan.modulations,{solids:sources.map(source=>({key:source.key,geometry:material(source.geometry)}))});
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

export const {root, EXPORT_NAME, atomicManifest, proposedPlan, initBundle, loadBundle, loadBundleSnapshot, bundleFingerprint, bundleFingerprints, migrateBundle, prepareGeneration, commitGeneration, generateToolpath, restoreRevision, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, exportReviewed, applySettingsSnapshot}=createBundleWorkflow({
  kind:'shell',defaults,patchPlan,createGeometry,
  generatePath:generatePreparedPath,pathDependencies,pathSource,generationContract:PATH_CONTRACT,completionContract:NEUTRAL_PATH_CONTRACT,
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',
  limitations:limitationsFor
});

export {changeMachine,rememberSetup} from '../machine/bundle-settings.mjs';
export {bundleInstance,claimBundleInstance,releaseBundleInstance,withBundleInstance,recoverBundleInstance} from './studio-ownership.mjs';
