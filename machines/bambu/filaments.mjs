// Bambu logical filament selection: the installed nozzle, feed source and AMS
// connections each filament uses. Core has already validated common setup.
export const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const toolFor=(machine,index)=>{
  const tool=machine.tools.find(t=>t.index===index);
  requireThat(tool,'Selected tool is not declared by this machine.');return tool;
};
export const toolBounds=(machine,index)=>toolFor(machine,index).bounds??machine.bounds;
export const sameNozzleMaterialChanges=machine=>machine.outputs.some(o=>o.id==='bambu-gcode'&&o.constraints?.materialChangeMode==='single-nozzle-ams');
// The pinned startup ends at the selected tool's startup position.
export const startupPosition=(machine,plan)=>[...toolFor(machine,plan.setup.tool).startupXY,machine.startup.zAfterStartupMm];

// Optional spool choice from the profile's declared feeder units. No request
// keeps the first filament path, which a printer without a feeder also uses.
// This flattens physical tray intent only. It must never be emitted as a
// logical filament ID. Printer/job dispatch owns that mapping; see SKILL.md.
export function feederSelector(plan,machine){
  const request=plan.setup.ams,feeder=machine.ams;
  if(request==null)return 0;
  requireThat(feeder,'This machine profile declares no AMS.');
  requireThat([[request.unit,feeder.units],[request.slot,feeder.slotsPerUnit]].every(([value,count])=>Number.isInteger(value)&&value>=1&&value<=count),
    `AMS choice must be unit 1–${feeder.units} and slot 1–${feeder.slotsPerUnit}.`);
  return (request.unit-1)*feeder.slotsPerUnit+request.slot-1;
}

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
export function checkedFilamentPlan(plan,machine,index){
  requireThat(plan.output==='bambu-gcode','This output has no logical filament-selection adapter.');
  const b=plan.setup.bambu,entry=plan.setup.filaments?.[index];
  requireThat(Number.isInteger(index)&&index>=0&&(entry||index===0&&plan.setup.filaments==null),'Unknown logical filament selection.');
  const tool=entry?.tool??plan.setup.tool,t=toolFor(machine,tool);
  const nozzleMm=tool===plan.setup.tool?plan.setup.nozzleMm:b.otherNozzleMm;
  const source=entry?.source;
  validateBambuConnections(b.amsConnections,machine);
  if(source!==undefined){
    requireThat(source&&typeof source==='object'&&
      (['external','auto'].includes(source.type)&&Object.keys(source).join()==='type'||source.type==='ams'&&Object.keys(source).sort().join()==='slot,type,unit'||source.type==='ams-ht'&&Object.keys(source).sort().join()==='type,unit'),
    'A filament source must be auto, external, AMS with one-based unit/slot, or AMS HT with one-based unit.');
    if(index===plan.setup.filament&&plan.setup.ams!==null)requireThat(source.type==='ams'&&source.unit===plan.setup.ams.unit&&source.slot===plan.setup.ams.slot,'Selected filament source contradicts setup.ams.');
  }
  if(source?.type==='ams-ht'){
    requireThat(Number.isInteger(source.unit)&&source.unit>=1&&source.unit<=(machine.ams?.htUnits??0),'AMS HT unit exceeds machine capacity.');
    if(b.amsConnections!==null)requireThat(b.amsConnections.some(c=>c.type==='ams-ht'&&c.unit===source.unit&&c.tool===tool),'Requested AMS HT unit is not connected to the selected Bambu nozzle.');
  }
  const ams=source?.type==='ams'?{unit:source.unit,slot:source.slot}:source?.type==='external'?null:index===plan.setup.filament?plan.setup.ams:null;
  const setup={...plan.setup,tool,nozzleMm,core:`Hardened steel ${nozzleMm}`,nozzleC:entry?.nozzleC??plan.setup.nozzleC,
    filamentColor:entry?.colour??plan.setup.filamentColor,ams,filament:index,
    bambu:{...b,otherNozzleMm:machine.tools.length===1?null:tool===plan.setup.tool?b.otherNozzleMm:plan.setup.nozzleMm}};
  const selected={...plan,setup,process:{...plan.process,...entry?.process}};
  requireThat(t.nozzleDiametersMm.includes(nozzleMm),'Filament selects an unsupported installed nozzle.');
  if(ams){feederSelector(selected,machine);if(b.amsConnections!==null)requireThat(b.amsConnections.some(c=>(c.type??'ams')==='ams'&&c.unit===ams.unit&&c.tool===tool),'Requested AMS unit is not connected to the selected Bambu nozzle.');}
  return selected;
}
