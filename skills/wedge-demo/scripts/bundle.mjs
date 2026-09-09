// Wedge geometry and recipe adapter; lifecycle/export are shared.
import { createBundleWorkflow } from '../../../core/print/workflow.mjs';
import { defaults,validatePlan,requireThat,VERSION,BUILD_DATE } from './model.mjs';
import { createGeometry,verifyGeometry } from './geometry.mjs';
import { generatePath } from './path.mjs';
export const {root, defaultSetupFile, EXPORT_NAME, EXPORT_PATH, runtimeHash, initBundle, loadBundle, bundleFingerprint, rememberSetup, adjustBundle, updatePlan, generateBundle, approve, deliver, upgradeBundle}=createBundleWorkflow({
  kind:'wedge',defaults,validatePlan,createGeometry,verifyGeometry,generatePath,
  version:VERSION,buildDate:BUILD_DATE,exportName:'wedge.gcode',machineFile:'machines/ultimaker-s5.json',
  limitations:()=>['Physical clearance is the operator’s responsibility for this demo.',
    'User reports the final startup avoids bed leveling and unused-nozzle heating; complete print quality is not validated.',
    'Griffin firmware startup internals are not animated.'],
  runtimeFiles:['model.mjs','geometry.mjs','path.mjs','gcode.mjs','bundle.mjs'].map(file=>new URL(file,import.meta.url)),
  upgradePlan(plan){
  requireThat(['0.1.0','0.2.0','0.2.1','0.2.2','0.2.3',VERSION].includes(plan.generatorVersion),'Unsupported bundle upgrade.');
  plan.generatorVersion=VERSION;plan.process.skinDirection='alternating';
  plan.process.combTravelMm??=defaults().process.combTravelMm;
  plan.process.startupRetracted??=defaults().process.startupRetracted;
  plan.setup.buildVolumeC??=defaults().setup.buildVolumeC;
  plan.setup.materialGuid||=defaults().setup.materialGuid;

  }
});
