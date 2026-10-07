import {requireThat} from '../private/toolpath/numeric.mjs';

const PROCESS_FIELDS=['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','skinSpeedMmS','firstLayerSpeedMmS','maxFlowMm3S','retractMm','retractSpeedMmS'];

// Filaments a recipe assigns to deposition assignments, in recipe
// order; the setup's own filament is not included.
export const assignedFilaments=plan=>[...(plan.slices?.assignments??[]),...(plan.composition?.filaments??[])].map(a=>a.filament).filter(v=>v!==null&&v!==undefined);

// A logical material (setup.filaments[index]); without a list, 0 is the setup's own.
function material(plan,index){
  const list=plan.setup.filaments,entry=list?.[index];
  requireThat(Number.isSafeInteger(index)&&index>=0&&(entry||index===0&&list==null),'Unknown logical filament selection.');
  return entry??{};
}
// Authored per-material process intent is independent of the installed tool,
// feeder and the selected machine-program dialect.
export function materialProcess(plan,index){
  const process=material(plan,index).process??{};
  requireThat(process&&typeof process==='object'&&!Array.isArray(process)&&Object.keys(process).every(k=>PROCESS_FIELDS.includes(k)&&Number.isFinite(process[k])),'Invalid filament process override.');
  return {...plan.process,...process};
}

// The installed tool a logical material feeds.
export const materialTool=(plan,index)=>material(plan,index).tool??plan.setup.tool;
export function filamentSelection(plan,index){
  return {filament:index,process:materialProcess(plan,index)};
}
