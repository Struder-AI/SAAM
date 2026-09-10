// Wedge geometry and recipe adapter; lifecycle/export are shared.
import { createBundleWorkflow } from '../../../core/print/workflow.mjs';
import { defaults,validatePlan,requireThat,legacyPoints,VERSION,BUILD_DATE } from './model.mjs';
import { createGeometry,verifyGeometry } from './geometry.mjs';
import { generatePath } from './path.mjs';
export const {root, defaultSetupFile, EXPORT_NAME, EXPORT_PATH, runtimeHash, proposedPlan, initBundle, loadBundle, bundleFingerprint, rememberSetup, checkPathBundle, adjustBundle, updatePlan, generateBundle, approve, deliver, upgradeBundle}=createBundleWorkflow({
  kind:'wedge',defaults,validatePlan,createGeometry,verifyGeometry,generatePath,
  version:VERSION,buildDate:BUILD_DATE,exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',
  limitations:(_plan,machine)=>['Physical clearance is the operator’s responsibility for this demo.',
    ...(machine.id==='bambu-h2d'?[
      'Experimental H2D output uses PLA, Textured PEI and no chamber heating; physical printing and head clearance are unvalidated.',
      'Firmware probing, wiping, calibration, purge and unload are not simulated. Startup may use both nozzles; printing totals exclude firmware service routines.'
    ]:machine.id==='dobot-mg400'?[
      'Experimental Dobot relay output requires configured installation values and external heating/positioning.',
      'Lua playback checks commanded motion; robot reachability, swept-link clearance and actual deposited volume are unverified.'
    ]:[
    'User reports the final startup avoids bed leveling and unused-nozzle heating; complete print quality is not validated.',
    'Griffin firmware startup internals are not animated.'])],
  runtimeFiles:[...['model.mjs','geometry.mjs','path.mjs','gcode.mjs','bundle.mjs'].map(file=>new URL(file,import.meta.url)),
    ...['core/path/builder.mjs','core/path/comb.mjs','core/region/offset.mjs','core/region/clipper.mjs','node_modules/clipper-lib/clipper.js','package-lock.json'].map(file=>new URL('../../../'+file,import.meta.url)),
    ...['mesh.mjs','shell.mjs','nurbs.mjs','tolerance.mjs'].map(file=>new URL('../../../core/geom/'+file,import.meta.url)),
    new URL('../../../core/region/region2d.mjs',import.meta.url)],
  upgradePlan(plan,machine){
  requireThat(['0.1.0','0.2.0','0.2.1','0.2.2','0.2.3','0.2.4',VERSION].includes(plan.generatorVersion),'Unsupported bundle upgrade.');
  if(!Object.hasOwn(plan.geometry,'points'))plan.geometry={points:legacyPoints(plan.geometry)};
  plan.generatorVersion=VERSION;plan.process.skinDirection='alternating';
  plan.process.combTravelMm??=defaults().process.combTravelMm;
  plan.process.startupRetracted??=defaults(machine).process.startupRetracted;
  plan.setup.buildVolumeC??=defaults(machine).setup.buildVolumeC;
  plan.setup.materialGuid||=defaults(machine).setup.materialGuid;

  }
});
