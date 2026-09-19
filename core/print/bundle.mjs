// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import { defaults,validatePlan,geometryTemplate,VERSION,BUILD_DATE } from './plan.mjs';
import { createGeometry,verifyGeometry,rhino } from './geometry.mjs';
import { generatePath } from './generate.mjs';

export const LIMITATIONS = [
  'Physical clearance is the operator’s responsibility; no collision model is implemented.',
  'Bead shape, perimeter overlap and skin stacking are approximations; no part from these skills has been printed.',
  'Contour sampling is bounded by minFeatureMm; a closed feature smaller than that can be missed.',
  'The machine’s non-planar angle limit is a declared software limit, not a measured clearance rating.',
  'Firmware startup and service routines are not motion-simulated.'
];

const limitationsFor = (plan, machine) => {
  const regions=plan.composition?.regions??[];
  const skins=regions.length?regions.filter(r=>Object.hasOwn(r.skills,'draped-skin')).map(r=>({...plan.skills['draped-skin'],...r.skills['draped-skin']}))
    :plan.skills['draped-skin'].enabled?[plan.skills['draped-skin']]:[];
  const limits=[...LIMITATIONS,...(machine.limitations??[])];
  for(const override of new Set(skins.map(s=>s.maxAngleDegOverride).filter(v=>v!==null)))limits.push(
    `EXPERIMENTAL: this print overrides the machine profile’s declared ${machine.nonplanar.maxAngleDeg}° non-planar limit with ${override}°. Physical clearance and deposition behavior are unvalidated.`);
  if(plan.skills['wave-overhangs']?.enabled)limits.push('Experimental surface wave overhangs: seeds and material ownership are explicitly assigned. Surface propagation, lateral bead attachment, cooling and warping have not been physically validated. Small numerical residuals are retained in the wave report.');
  return limits;
};


export const {root, defaultSetupFile, EXPORT_NAME, EXPORT_PATH, proposedPlan, initBundle, loadBundle, bundleFingerprint, bundleFingerprints, rememberSetup, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, changeMachine}=createBundleWorkflow({
  kind:'shell',defaults,validatePlan,geometryTemplate,createGeometry,verifyGeometry,
  generatePath:async(plan,machine,options)=>generatePath(plan,machine,await rhino(),options),
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',machineFile:'machines/ultimaker-s5.json',
  limitations:limitationsFor
});
