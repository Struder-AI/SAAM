import {requireThat} from '../private/toolpath/numeric.mjs';

export function plannedNozzleTemperatures(plan){
  requireThat(Number.isFinite(plan.setup?.nozzleC)&&plan.setup.nozzleC>=0,'Authored nozzle temperature must be finite and nonnegative.');
  const settings=[...Object.values(plan.skills??{}).filter(s=>s.enabled),
    ...(plan.slices?.assignments??[]),...(plan.setup?.filaments??[])];
  return new Set([plan.setup.nozzleC,...settings.map(s=>s.nozzleC).filter(Number.isFinite)]);
}
