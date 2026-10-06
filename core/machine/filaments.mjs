import {requireThat} from '../private/toolpath/numeric.mjs';

const PROCESS_FIELDS=['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','skinSpeedMmS','firstLayerSpeedMmS','maxFlowMm3S','retractMm','retractSpeedMmS'];

// Filaments a recipe assigns to deposition assignments, in recipe
// order; the setup's own filament is not included.
export const assignedFilaments=plan=>[...(plan.slices?.assignments??[]),...(plan.composition?.filaments??[])].map(a=>a.filament).filter(v=>v!==null&&v!==undefined);

// Authored per-material process intent is independent of the installed tool,
// feeder and the selected machine-program dialect.
export function materialProcess(plan,index){
  const b=plan.setup.bambu,entry=b?.filaments?.[index];
  requireThat(Number.isSafeInteger(index)&&index>=0&&(entry||index===0&&b?.filaments===null),'Unknown logical filament selection.');
  const process=entry?.process??{};
  requireThat(process&&typeof process==='object'&&!Array.isArray(process)&&Object.keys(process).every(k=>PROCESS_FIELDS.includes(k)&&Number.isFinite(process[k])),'Invalid filament process override.');
  return {...plan.process,...process};
}


// Resolve authored material/nozzle defaults without applying device capability.
// Physical feeder compatibility is an exporter concern (checkedFilamentPlan).
export function filamentPlan(plan,machine,index){
  const b=plan.setup.bambu,entry=b?.filaments?.[index];
  requireThat(Number.isSafeInteger(index)&&index>=0&&(entry||index===0&&b?.filaments===null),'Unknown logical filament selection.');
  const tool=entry?.tool??plan.setup.tool;
  requireThat(Number.isSafeInteger(tool)&&tool>=0,'Filament tool must be a nonnegative integer.');
  const nozzleMm=tool===plan.setup.tool?plan.setup.nozzleMm:b.otherNozzleMm;
  requireThat(Number.isFinite(nozzleMm)&&nozzleMm>0,'Filament needs an authored nozzle diameter.');
  const process=materialProcess(plan,index);
  const setup={...plan.setup,tool,nozzleMm,core:`Hardened steel ${nozzleMm}`,nozzleC:entry?.nozzleC??plan.setup.nozzleC,
    ams:entry?.source?.type==='ams'?{unit:entry.source.unit,slot:entry.source.slot}:entry?.source?.type==='external'?null:index===b.filament?plan.setup.ams:null,
    filamentColor:entry?.colour??plan.setup.filamentColor,
    bambu:{...b,filament:index,otherNozzleMm:tool===plan.setup.tool?b.otherNozzleMm:plan.setup.nozzleMm}};
  return {...plan,setup,process};
}
export function filamentSelection(plan,index){
  return {filament:index,process:materialProcess(plan,index)};
}
