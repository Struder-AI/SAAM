import {requireThat} from '../geom/tolerance.mjs';
import {DEFAULT_NOZZLE_GEOMETRY} from '../geom/convex-clearance.mjs';
import {assignedFilaments,materialTool} from './filaments.mjs';

// Installation selection ends here. Scheduling receives dimensions, not machine IDs.
export function resolveNozzleGeometry(machine,plan){
  const filaments=[...new Set([plan.setup?.filament,...assignedFilaments(plan)].filter(Number.isInteger))];
  const tools=filaments.length?filaments.map(index=>materialTool(plan,index)):[plan.setup?.tool??machine?.defaultSetup?.tool];
  const models=tools.map(index=>machine?.tools?.find(tool=>tool.index===index)?.nozzleGeometry??machine?.nozzleGeometry??
    {...DEFAULT_NOZZLE_GEOMETRY,name:'Generic nozzle',quality:'estimated',note:'Working clearance envelope; installed nozzle dimensions are unknown.'});
  for(const model of models)requireThat(Number.isFinite(model.includedAngleDeg)&&model.includedAngleDeg>0&&model.includedAngleDeg<180&&
    Number.isFinite(model.tipDiameterMm)&&model.tipDiameterMm>=0,'Nozzle geometry needs an included angle between 0 and 180 degrees and a nonnegative flat-tip diameter.');
  if(models.every(model=>model.includedAngleDeg===models[0].includedAngleDeg&&model.tipDiameterMm===models[0].tipDiameterMm))return structuredClone(models[0]);
  // One enclosing cone covers every selected tool throughout a multi-tool job.
  return {includedAngleDeg:Math.max(...models.map(model=>model.includedAngleDeg)),tipDiameterMm:Math.max(...models.map(model=>model.tipDiameterMm)),
    name:'Selected-tool envelope',quality:'envelope',note:'Encloses every selected nozzle; parked tools and carriage are not modeled.',models:structuredClone(models)};
}
