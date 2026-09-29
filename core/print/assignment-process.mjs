import {filamentPlan} from '../machine/filaments.mjs';
import {requireThat} from '../geom/tolerance.mjs';

const fields=['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','firstLayerSpeedMmS','fanPercent'];

export function validateAssignmentProcess(overrides) {
  requireThat(overrides===null||overrides&&typeof overrides==='object'&&!Array.isArray(overrides)&&Object.keys(overrides).every(key=>fields.includes(key)&&Number.isFinite(overrides[key])),
    'Assignment process must be null or finite firstLayerMm, layerMm, lineWidthMm, planarSpeedMmS, firstLayerSpeedMmS and fanPercent overrides.');
  return overrides;
}

// Material/nozzle selection establishes defaults; authored process values win.
// Slicing stack overrides remain a later, explicit geometric pitch decision.
export function assignmentPlan(plan,machine,assignment) {
  validateAssignmentProcess(assignment.process);
  const selected=assignment.filament===null?plan:filamentPlan(plan,machine,assignment.filament);
  return assignment.process===null?selected:{...selected,process:{...selected.process,...assignment.process}};
}
