// Numeric limits for selected-machine thermal settings and emitted commands.
export function validateTemperatureC(targetC){
  if(!Number.isFinite(targetC)||targetC<0||targetC>350)
    throw Error('Temperature must be between 0 and 350 °C.');
}
