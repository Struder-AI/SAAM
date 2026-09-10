// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import { defaults,validatePlan,geometryTemplate,VERSION,BUILD_DATE } from './plan.mjs';
import { createGeometry,verifyGeometry,rhino } from './geometry.mjs';
import { generatePath } from './generate.mjs';
const RUNTIME_FILES = [
  '../geom/cylinder.mjs','../path/pose.mjs','../machine/denso.mjs','../export/denso.mjs','../export/denso-player.mjs','../../skills/pipe-cladding/scripts/clad.mjs',
  '../region/offset.mjs', '../region/clipper.mjs', '../../node_modules/clipper-lib/clipper.js', '../../package-lock.json',
  '../region/intersection.mjs', '../../node_modules/clipper2-wasm/dist/umd/clipper2z.js',
  '../../node_modules/clipper2-wasm/dist/umd/clipper2z.wasm',
  '../region/surface-offset.mjs', '../geom/surface-derivatives.mjs',
  '../geom/nurbs.mjs', '../geom/section.mjs', '../geom/shell.mjs', '../geom/shapes.mjs', '../geom/field.mjs',
  '../geom/tolerance.mjs', '../region/region2d.mjs', '../region/boolean.mjs', '../path/builder.mjs', '../path/compose.mjs',
  '../geom/query.mjs','../geom/mesh.mjs','../machine/profile.mjs','../export/registry.mjs',
  '../path/comb.mjs', './regions.mjs', '../region/reservation.mjs',
  '../export/griffin.mjs', './plan.mjs', './generate.mjs', './geometry.mjs', './bundle.mjs',
  '../../skills/full-fill/scripts/fill.mjs', '../../skills/draped-skin/scripts/drape.mjs',
  '../../skills/planar-infill/scripts/infill.mjs', '../../skills/vase-wall/scripts/vase.mjs'
  ,'../../skills/planar-infill/scripts/patterns.mjs'
  ,'../../skills/supports/scripts/supports.mjs'
  ,'../../skills/rimming-planar/scripts/rimming.mjs','../../skills/rimming-normal/scripts/rimming.mjs'
  ,'../geom/support-surface.mjs','../region/section-offset.mjs'
];

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
  const limits=machine.id==='bambu-h2d'?[...LIMITATIONS,'H2D uses the supplied PLA / Textured PEI firmware envelope. Startup purge uses 240 C and up to 25 mm³/s; its time and material are excluded from print-body totals. Printer-selected calibration may heat both nozzles. Experimental output has not been physically validated.','The H2D non-planar limit is an explicit user-selected experimental limit, not a manufacturer clearance rating.']:[...LIMITATIONS];
  for(const override of new Set(skins.map(s=>s.maxAngleDegOverride).filter(v=>v!==null)))limits.push(
    `EXPERIMENTAL: this print overrides the machine profile’s declared ${machine.nonplanar.maxAngleDeg}° non-planar limit with ${override}°. Physical clearance and deposition behavior are unvalidated.`);
  return limits;
};


export const {root, defaultSetupFile, EXPORT_NAME, EXPORT_PATH, runtimeHash, proposedPlan, initBundle, loadBundle, bundleFingerprint, rememberSetup, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, upgradeBundle}=createBundleWorkflow({
  kind:'shell',defaults,validatePlan,geometryTemplate,createGeometry,verifyGeometry,
  generatePath:async(plan,machine)=>generatePath(plan,machine,await rhino()),
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',machineFile:'machines/ultimaker-s5.json',
  limitations:limitationsFor,runtimeFiles:RUNTIME_FILES.map(file=>new URL(file,import.meta.url))
});
