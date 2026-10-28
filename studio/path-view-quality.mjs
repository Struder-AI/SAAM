import {PRINT_RESOLUTION_MM} from '../core/dimensions.mjs';

// Shared display precision for scheduled and unscheduled Paath. It changes no
// source geometry or downstream numerical/program tolerance.
export function pathViewPositionTolerance({plan,source}={}){
  let tolerance=20*PRINT_RESOLUTION_MM;
  const include=process=>{
    for(const value of [process?.lineWidthMm/20,process?.layerMm/10])if(Number.isFinite(value)&&value>0)tolerance=Math.min(tolerance,value);
  };
  include(plan?.process);
  for(const id in source?.processes)include(source.processes[id]);
  return tolerance;
}
