// Shell-specific adapter for the shared print lifecycle.
import { createBundleWorkflow } from './workflow.mjs';
import { defaults,validatePlan,geometryTemplate,VERSION,BUILD_DATE } from './plan.mjs';
import { createGeometry,verifyGeometry,rhino } from './geometry.mjs';
import { generatePath } from './generate.mjs';
const RUNTIME_FILES = [
  '../geom/offset-curvature.mjs',
  '../geom/mesh-distance.mjs','../geom/surface-offset.mjs','../geom/sleeve-frame.mjs','../geom/directional-contour.mjs','../geom/prepared-radial-contact.mjs',
  '../geom/sleeve-contact.mjs','../geom/mesh-sleeve.mjs','../geom/least-squares.mjs','../region/stroke.mjs','../../skills/vase-wall/scripts/reference.mjs',
  '../../skills/plastic-weld/scripts/weld.mjs',
  '../../skills/heat-set-inserts/scripts/feature.mjs','../../skills/heat-set-inserts/scripts/catalog.mjs',
  '../../skills/heat-set-inserts/scripts/geometry.mjs','../../skills/heat-set-inserts/scripts/reinforcement.mjs','./heat-set.mjs',
  '../../skills/wave-overhangs/scripts/wave.mjs',
  '../../skills/gridfinity/scripts/record.mjs','../../skills/gridfinity/scripts/gridfinity.mjs','../../skills/gridfinity/scripts/bundle.mjs',
  '../path/deposition.mjs','../geom/contour-path.mjs','../geom/prepared-contours.mjs','../../skills/vase-wall/scripts/paths.mjs','../../skills/vase-wall/scripts/motif.mjs','../../skills/vase-wall/scripts/boundary-courses.mjs',
  '../geom/text-record.mjs','../geom/selections.mjs','../geom/solid.mjs','../geom/reference-surface.mjs','../geom/tessellate.mjs','../geom/text-outline.mjs',
  '../../skills/text/scripts/text.mjs','./text.mjs','../../node_modules/manifold-3d/manifold.js','../../node_modules/manifold-3d/manifold.wasm',
  '../../node_modules/fontkit/dist/module.mjs',
  '../path/spacing.mjs','../path/prime.mjs',
  '../path/finished-surface.mjs',
  '../../skills/pipe-cladding/scripts/course.mjs',
  '../geom/spline-tube.mjs','../geom/surface-region.mjs','../region/normal-surface.mjs','../../skills/pipe-cladding/scripts/surface-clad.mjs',
  '../geom/cylinder.mjs','../path/pose.mjs','../machine/denso.mjs','../export/denso.mjs','../export/denso-player.mjs','../../skills/pipe-cladding/scripts/clad.mjs',
  '../region/offset.mjs', '../region/clipper.mjs', '../region/clipper2.mjs', '../../package-lock.json',
  '../region/intersection.mjs', '../../node_modules/clipper2-wasm/dist/umd/clipper2z.js',
  '../../node_modules/clipper2-wasm/dist/umd/clipper2z.wasm',
  '../region/surface-offset.mjs', '../geom/surface-derivatives.mjs',
  '../geom/nurbs.mjs', '../geom/section.mjs', '../geom/shell.mjs', '../geom/shapes.mjs', '../geom/field.mjs',
  '../geom/tolerance.mjs', '../region/region2d.mjs', '../region/boolean.mjs', '../path/builder.mjs', '../path/compose.mjs',
  '../geom/query.mjs','../geom/mesh.mjs','../geom/mesh-topology.mjs','../geom/mesh-budget.mjs','../geom/triangle-bvh.mjs','../geom/stl-file.mjs','../machine/profile.mjs','../export/registry.mjs',
  '../path/comb.mjs', './regions.mjs', '../region/reservation.mjs',
  '../export/griffin.mjs', './plan.mjs', './generate.mjs', './geometry.mjs', './bundle.mjs',
  '../../skills/full-fill/scripts/fill.mjs', '../../skills/draped-skin/scripts/drape.mjs',
  '../../skills/planar-infill/scripts/infill.mjs', '../../skills/vase-wall/scripts/vase.mjs'
  ,'../../skills/thick-lip/scripts/lip.mjs'
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
  if(plan.skills['wave-overhangs']?.enabled)limits.push('Experimental surface wave overhangs: seeds and material ownership are explicitly assigned. Surface propagation, lateral bead attachment, cooling and warping have not been physically validated. Small numerical residuals are retained in the wave report.');
  return limits;
};


export const {root, defaultSetupFile, EXPORT_NAME, EXPORT_PATH, runtimeHash, proposedPlan, initBundle, loadBundle, bundleFingerprint, rememberSetup, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, changeMachine, upgradeBundle}=createBundleWorkflow({
  kind:'shell',defaults,validatePlan,geometryTemplate,createGeometry,verifyGeometry,
  generatePath:async(plan,machine,options)=>generatePath(plan,machine,await rhino(),options),
  version:VERSION,buildDate:BUILD_DATE,exportName:'part.gcode',machineFile:'machines/ultimaker-s5.json',
  limitations:limitationsFor,runtimeFiles:RUNTIME_FILES.map(file=>new URL(file,import.meta.url))
});
