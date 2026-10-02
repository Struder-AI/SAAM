import {requireThat} from '../private/toolpath/numeric.mjs';


// Temperature is bounded independently of material recommendations.
export function validateTemperatureC(targetC){
  requireThat(Number.isFinite(targetC)&&targetC>=0&&targetC<=350,'Temperature must be between 0 and 350 °C.');
}
export const validateNozzleC=validateTemperatureC;
export function plannedNozzleTemperatures(plan){
  const settings=[...Object.values(plan.skills??{}).filter(s=>s.enabled),
    ...(plan.slices?.assignments??[]),...(plan.setup?.bambu?.filaments??[])];
  return new Set([plan.setup.nozzleC,...settings.map(s=>s.nozzleC).filter(Number.isFinite)]);
}
