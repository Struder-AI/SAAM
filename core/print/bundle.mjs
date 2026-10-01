// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import { defaults,compileRecipe,geometryTemplate,VERSION,BUILD_DATE } from './plan.mjs';
import { createGeometry,rhino } from './geometry.mjs';
import {buildShell,translateShell} from '../geom/build.mjs';
import {generatePath,GENERATION_CONTRACT} from './generate.mjs';
import {modulationGeometrySources,prepareModulationFields} from './modulation-fields.mjs';
import {booleanShell} from '../geom/boolean-solid.mjs';

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

export async function generatePreparedPath(plan,machine,options){
  ({plan,machine}=compileRecipe(plan,machine));
  const native=await rhino(),sources=modulationGeometrySources(plan.modulations);
  const material=geometry=>geometry.shape==='assembly'
    ?booleanShell('union',geometry.parts.map(part=>translateShell(material(part.geometry),part.xMm,part.yMm,part.zMm)))
    :geometry.shape==='boolean'?booleanShell(geometry.operation,geometry.operands.map(material)):buildShell(native,geometry);
  const fields=await prepareModulationFields(plan.modulations,{solids:sources.map(source=>({key:source.key,geometry:material(source.geometry)}))});
  return generatePath(plan,machine,native,{...options,modulations:fields.record,modulationPreparation:fields.report});
}

export const {root, EXPORT_NAME, atomicManifest, proposedPlan, initBundle, loadBundle, loadBundleSnapshot, bundleFingerprint, bundleFingerprints, migrateBundle, prepareGeneration, commitGeneration, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, exportReviewed, applySettingsSnapshot}=createBundleWorkflow({
  kind:'shell',defaults,geometryTemplate,createGeometry,
  generatePath:generatePreparedPath,generationContract:GENERATION_CONTRACT,
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',
  limitations:limitationsFor
});

export {changeMachine,rememberSetup} from '../machine/bundle-settings.mjs';
