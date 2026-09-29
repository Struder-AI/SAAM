// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import { defaults,validatePlan,geometryTemplate,VERSION,BUILD_DATE } from './plan.mjs';
import { createGeometry,verifyGeometry,rhino } from './geometry.mjs';
import { generatePath,buildShell,translateShell,GENERATION_CONTRACT } from './generate.mjs';
import {modulationGeometrySources,prepareModulationFields} from './modulation-fields.mjs';
import {booleanShell} from '../geom/boolean-solid.mjs';

export const LIMITATIONS = [
  'Physical clearance is the operator’s responsibility; no collision model is implemented.',
  'Bead shape, perimeter overlap and skin stacking are approximations; no part from these skills has been printed.',
  'Contour sampling is bounded by minFeatureMm; a closed feature smaller than that can be missed.',
  'The machine’s non-planar angle limit is a declared software limit, not a measured clearance rating.',
  'Firmware startup and service routines are not motion-simulated.'
];

const limitationsFor = (plan, machine) => {
  const assignments=plan.slices?.assignments??[],skins=assignments.filter(a=>a.construction==='skin');
  const limits=[...LIMITATIONS,...(machine.limitations??[])];
  for(const override of new Set(skins.map(s=>s.maxAngleDegOverride).filter(v=>v!==null)))limits.push(
    `EXPERIMENTAL: this print overrides the machine profile’s declared ${machine.nonplanar.maxAngleDeg}° non-planar limit with ${override}°. Physical clearance and deposition behavior are unvalidated.`);
  if(assignments.some(a=>a.construction==='fronts'))limits.push('Experimental surface wave overhangs: seeds and material ownership are explicitly assigned. Surface propagation, lateral bead attachment, cooling and warping have not been physically validated. Small numerical residuals are retained in the wave report.');
  return limits;
};

export async function generatePreparedPath(plan,machine,options){
  const native=await rhino(),sources=modulationGeometrySources(plan.modulations);
  const material=geometry=>geometry.shape==='assembly'
    ?booleanShell('union',geometry.parts.map(part=>translateShell(material(part.geometry),part.xMm,part.yMm,part.zMm)))
    :geometry.shape==='boolean'?booleanShell(geometry.operation,geometry.operands.map(material)):buildShell(native,geometry);
  const fields=await prepareModulationFields(plan.modulations,{solids:sources.map(source=>({key:source.key,geometry:material(source.geometry)}))});
  return generatePath(plan,machine,native,{...options,modulations:fields.record,modulationPreparation:fields.report});
}

export const {root, EXPORT_NAME, atomicManifest, proposedPlan, initBundle, loadBundle, loadBundleSnapshot, bundleFingerprint, bundleFingerprints, rememberSetup, migrateBundle, prepareGeneration, commitGeneration, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, changeMachine}=createBundleWorkflow({
  kind:'shell',defaults,validatePlan,geometryTemplate,createGeometry,verifyGeometry,
  generatePath:generatePreparedPath,generationContract:GENERATION_CONTRACT,
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',machineFile:'machines/ultimaker-s5.json',
  limitations:limitationsFor
});
