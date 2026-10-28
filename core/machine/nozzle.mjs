import {requireThat} from '../geom/tolerance.mjs';
import {DEFAULT_NOZZLE_GEOMETRY} from '../geom/convex-clearance.mjs';
import {assignedFilaments,materialTool} from './filaments.mjs';

// Export resolves physical tools. Geometry queries receive numerical models.
function nozzleModel(machine,index){
  return machine?.tools?.find(tool=>tool.index===index)?.nozzleGeometry??machine?.nozzleGeometry??
    {...DEFAULT_NOZZLE_GEOMETRY,name:'Generic nozzle',quality:'estimated',note:'Working clearance envelope; installed nozzle dimensions are unknown.'};
}
function toolNozzle(machine,index){
  const model=nozzleModel(machine,index);
  requireThat(Number.isFinite(model.includedAngleDeg)&&model.includedAngleDeg>0&&model.includedAngleDeg<180&&
    Number.isFinite(model.tipDiameterMm)&&model.tipDiameterMm>=0,'Nozzle geometry needs an included angle between 0 and 180 degrees and a nonnegative flat-tip diameter.');
  return structuredClone(model);
}

// Capture numerical inputs before Construction; Scheduler qualifies used tools.
export function schedulingNozzleInputs(machine,plan){
  if(!machine)return {};
  const materials=plan.setup?.filaments,indexes=materials?Array.from(materials.keys()).filter(index=>materials[index]):[0];
  return Object.fromEntries(indexes.map(index=>{
    const model=nozzleModel(machine,materialTool(plan,index));
    return [index,{includedAngleDeg:model.includedAngleDeg,tipDiameterMm:model.tipDiameterMm}];
  }));
}

export function resolveNozzleGeometries(machine,plan,{toolIndexes=[]}={}){
  const filaments=[...new Set([plan.setup?.filament,...assignedFilaments(plan),...toolIndexes].filter(Number.isInteger))];
  return {default:toolNozzle(machine,plan.setup?.tool??machine?.defaultSetup?.tool),
    filaments:Object.fromEntries(filaments.map(index=>[index,toolNozzle(machine,materialTool(plan,index))]))};
}

export function resolveNozzleGeometry(machine,plan,options){
  const selected=resolveNozzleGeometries(machine,plan,options),assigned=Object.values(selected.filaments),models=assigned.length?assigned:[selected.default];
  if(models.every(model=>model.includedAngleDeg===models[0].includedAngleDeg&&model.tipDiameterMm===models[0].tipDiameterMm))return structuredClone(models[0]);
  // Aggregate rejection uses an enclosing cone. Actual contacts use the active
  // material's nozzle, so another tool cannot impose a false ordering edge.
  return {includedAngleDeg:Math.max(...models.map(model=>model.includedAngleDeg)),tipDiameterMm:Math.max(...models.map(model=>model.tipDiameterMm)),
    name:'Selected-tool envelope',quality:'envelope',note:'Encloses every selected nozzle; parked tools and carriage are not modeled.',models:structuredClone(models)};
}
