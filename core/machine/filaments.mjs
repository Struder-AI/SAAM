import {requireThat} from '../geom/tolerance.mjs';
import {toolFor,toolBounds,validateSetup,feederSelector} from './rules.mjs';

// Device numbers are local installation labels, in separate AMS/AMS HT spaces.
// They are never firmware tray IDs or logical material indices.
export function validateBambuConnections(connections,machine){
  if(connections===null)return;
  requireThat(Array.isArray(connections)&&connections.every(c=>c&&
    Object.keys(c).every(k=>['type','unit','tool'].includes(k))&&
    ['ams','ams-ht'].includes(c.type??'ams')&&Number.isInteger(c.unit)&&c.unit>=1&&
    c.unit<=((c.type??'ams')==='ams'?machine.ams?.units:machine.ams?.htUnits??0)&&
    machine.tools.some(t=>t.index===c.tool))&&
    new Set(connections.map(c=>`${c.type??'ams'}:${c.unit}`)).size===connections.length&&
    connections.length<=(machine.ams?.maxDevices??machine.ams?.units??0),
  'Bambu AMS connections need unique units within the machine device capacities and connected logical tools.');
}

// A logical material selection, separate from installed nozzle and feed route.
// No device/tray number is ever substituted for the logical filament index.
export function filamentPlan(plan,machine,index){
  requireThat(plan.output==='bambu-gcode','This output has no logical filament-selection adapter.');
  const b=plan.setup.bambu,entry=b?.filaments?.[index];
  requireThat(Number.isInteger(index)&&index>=0&&(entry||index===0&&b?.filaments===null),'Unknown logical filament selection.');
  const tool=entry?.tool??plan.setup.tool,t=toolFor(machine,tool);
  const nozzleMm=tool===plan.setup.tool?plan.setup.nozzleMm:b.otherNozzleMm;
  const source=entry?.source;
  validateBambuConnections(b.amsConnections,machine);
  if(source!==undefined){
    requireThat(source&&typeof source==='object'&&
      (['external','auto'].includes(source.type)&&Object.keys(source).join()==='type'||source.type==='ams'&&Object.keys(source).sort().join()==='slot,type,unit'||source.type==='ams-ht'&&Object.keys(source).sort().join()==='type,unit'),
    'A filament source must be auto, external, AMS with one-based unit/slot, or AMS HT with one-based unit.');
    if(index===b.filament&&plan.setup.ams!==null)requireThat(source.type==='ams'&&source.unit===plan.setup.ams.unit&&source.slot===plan.setup.ams.slot,'Selected filament source contradicts setup.ams.');
  }
  if(source?.type==='ams-ht'){
    requireThat(Number.isInteger(source.unit)&&source.unit>=1&&source.unit<=(machine.ams?.htUnits??0),'AMS HT unit exceeds machine capacity.');
    if(b.amsConnections!==null)requireThat(b.amsConnections.some(c=>c.type==='ams-ht'&&c.unit===source.unit&&c.tool===tool),'Requested AMS HT unit is not connected to the selected Bambu nozzle.');
  }
  const ams=source?.type==='ams'?{unit:source.unit,slot:source.slot}:source?.type==='external'?null:index===b.filament?plan.setup.ams:null;
  const process=entry?.process??{};
  requireThat(process&&typeof process==='object'&&!Array.isArray(process)&&Object.keys(process).every(k=>
    ['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','skinSpeedMmS','firstLayerSpeedMmS','maxFlowMm3S','retractMm','retractSpeedMmS'].includes(k)&&Number.isFinite(process[k])),
  'Unsupported filament process override.');
  if(entry?.nozzleC!==undefined)requireThat(Number.isFinite(entry.nozzleC)&&
    [machine.temperatureLimitsC.nozzle,machine.materials[plan.setup.material]?.nozzleC].every(limits=>limits&&entry.nozzleC>=limits[0]&&entry.nozzleC<=limits[1]),
  'Filament nozzle temperature outside machine/material limits.');
  const setup={...plan.setup,tool,nozzleMm,core:`Hardened steel ${nozzleMm}`,nozzleC:entry?.nozzleC??plan.setup.nozzleC,
    filamentColor:entry?.colour??plan.setup.filamentColor,ams,
    bambu:{...b,filament:index,otherNozzleMm:machine.tools.length===1?null:tool===plan.setup.tool?b.otherNozzleMm:plan.setup.nozzleMm}};
  const selected={...plan,setup,process:{...plan.process,...process}};
  requireThat(t.nozzleDiametersMm.includes(nozzleMm),'Filament selects an unsupported installed nozzle.');
  if(ams){feederSelector(selected,machine);if(b.amsConnections!==null)requireThat(b.amsConnections.some(c=>(c.type??'ams')==='ams'&&c.unit===ams.unit&&c.tool===tool),'Requested AMS unit is not connected to the selected Bambu nozzle.');}
  return selected;
}

export function filamentSelection(plan,machine,index){
  const selected=filamentPlan(plan,machine,index);validateSetup(selected,machine);
  return {filament:index,tool:selected.setup.tool,process:selected.process,bounds:toolBounds(machine,selected.setup.tool)};
}
