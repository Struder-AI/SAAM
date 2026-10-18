import {requireThat} from '../private/toolpath/numeric.mjs';
import {materialProcess} from '../machine/filaments.mjs';


const fields=['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','firstLayerSpeedMmS','fanPercent','liftMm','retractMm','minimumBridgeRatio'];
// An assignment whose layer or line step is unusable produces nothing (plan.mjs).
const steps=['firstLayerMm','layerMm','lineWidthMm'];

export function validateAssignmentProcess(overrides) {
  requireThat(overrides===null||overrides&&typeof overrides==='object'&&!Array.isArray(overrides)&&Object.keys(overrides).every(key=>fields.includes(key)&&(steps.includes(key)||Number.isFinite(overrides[key]))&&
    (key!=='minimumBridgeRatio'||overrides[key]>=0&&overrides[key]<=1)),
    'Assignment process needs supported finite overrides; minimumBridgeRatio must be between 0 and 1.');
  return overrides;
}

// Material/nozzle selection establishes defaults; authored process values win.
// Slicing stack overrides remain a later, explicit geometric pitch decision.
export function assignmentPlan(plan,assignment) {
  validateAssignmentProcess(assignment.process??null);
  const filament=assignmentFilament(plan,assignment);
  const process=filament===null?plan.process:materialProcess(plan,filament);
  return {...plan,process:assignment.process==null?process:{...process,...assignment.process}};
}

// A print owns selection. Producers supply identity, never their own routing rules.
export function assignmentFilament(plan,assignment) {
  const routes=plan.composition.filaments??[];
  const own=routes.find(route=>Object.hasOwn(route,'assignment')&&route.assignment===assignment.id);
  const part=assignment.part??null;
  const inherited=routes.find(route=>Object.hasOwn(route,'part')&&route.part===part)
    ??routes.find(route=>typeof part==='string'&&typeof route.part==='string'&&part.startsWith(route.part+'/'));
  return own?.filament??assignment.filament??inherited?.filament??null;
}

export function depositionAssignments(plan,{expandParts=true}={}) {
  return plan.slices.assignments.flatMap(assignment=>{
    const parts=expandParts&&!assignment.construction&&!assignment.geometry&&assignment.part===null&&plan.geometry?.shape==='assembly'
      ?plan.geometry.parts.map(part=>part.id):[assignment.part];
    return parts.map(part=>{
      const selected=part===assignment.part?assignment:{...assignment,part};
      return {...selected,filament:assignmentFilament(plan,selected)};
    });
  });
}
