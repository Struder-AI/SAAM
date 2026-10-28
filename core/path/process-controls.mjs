import {requireThat} from '../private/toolpath/numeric.mjs';

export const DEFAULT_MINIMUM_BRIDGE_RATIO=.8;
export const MIN_RECOMMENDED_DEPOSITION_ASPECT_RATIO=1;

export function plannedNozzleTemperatures(plan){
  requireThat(Number.isFinite(plan.setup?.nozzleC)&&plan.setup.nozzleC>=0,'Authored nozzle temperature must be finite and nonnegative.');
  const settings=[...Object.values(plan.skills??{}).filter(s=>s.enabled),
    ...(plan.slices?.assignments??[]),...(plan.setup?.filaments??[])];
  return new Set([plan.setup.nozzleC,...settings.map(s=>s.nozzleC).filter(Number.isFinite)]);
}
