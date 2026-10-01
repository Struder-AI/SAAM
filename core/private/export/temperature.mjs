// Numeric limits for selected-machine thermal settings and emitted commands.
export function validateTemperatureC(targetC){
  if(!Number.isFinite(targetC)||targetC<0||targetC>350)
    throw Error('Temperature must be between 0 and 350 °C.');
}

// The neutral path supplies authored process targets. A standalone program
// can still be read at its explicit setup temperature; additional targets
// require the saved path's inventory.
export function authoredNozzleTargets(plan,authoredNozzleTemperatures){
  const targets=authoredNozzleTemperatures??[plan.setup.nozzleC];
  if(!Array.isArray(targets)||!targets.length||!targets.includes(plan.setup.nozzleC))
    throw Error('Invalid authored nozzle target inventory.');
  for(const target of targets){
    validateTemperatureC(target);
    if(!(target>0))throw Error('Authored nozzle targets must be positive.');
  }
  return new Set(targets);
}
