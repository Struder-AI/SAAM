export function plannedNozzleTemperatures(plan){
  const settings=[...Object.values(plan.skills??{}).filter(s=>s.enabled),
    ...(plan.slices?.assignments??[]),...(plan.setup?.bambu?.filaments??[])];
  return new Set([plan.setup.nozzleC,...settings.map(s=>s.nozzleC).filter(Number.isFinite)]);
}
