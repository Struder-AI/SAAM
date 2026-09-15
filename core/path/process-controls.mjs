import {requireThat} from '../geom/tolerance.mjs';

// Operation-scoped nozzle settings use the same material and machine envelope
// as startup. The shared interpreter consumes this set from the locked recipe.
export function validateNozzleC(targetC,plan,machine){
  const ranges=[machine.temperatureLimitsC.nozzle,machine.materials?.[plan.setup.material]?.nozzleC];
  requireThat(Number.isFinite(targetC)&&ranges.every(r=>r&&targetC>=r[0]&&targetC<=r[1]),'Operation nozzle temperature outside machine/material limits.');
}
export function plannedNozzleTemperatures(plan){
  const settings=[...Object.values(plan.skills??{}).filter(s=>s.enabled),
    ...(plan.composition?.regions??[]).flatMap(r=>Object.entries(r.skills).map(([name,s])=>({...plan.skills[name],...s})))];
  return new Set([plan.setup.nozzleC,...settings.map(s=>s.nozzleC).filter(Number.isFinite)]);
}
export function requireProcessControl(machine){
  requireThat(machine.outputs?.some(o=>['griffin-gcode','bambu-gcode'].includes(o.id)),
    'Stationary metered extrusion and operation temperature control require a supported filament-axis G-code output; relay robot outputs are not implemented.');
}
