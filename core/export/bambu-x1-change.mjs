import {requireThat} from '../geom/tolerance.mjs';
import {toolBounds,validateSetup,sameNozzleMaterialChanges} from '../machine/rules.mjs';
import {filamentPlan} from '../machine/filaments.mjs';

const n=value=>Number(value.toFixed(5));

// Authored X1 PLA change recipe, cross-referenced to the installed X1 template.
// Loading/cutting and chute service are firmware operations, not body geometry.
export function renderX1MaterialChange(plan,machine,{from,to,position,incomingDebt,fan,count}){
  requireThat(machine.id==='bambu-x1-carbon'&&sameNozzleMaterialChanges(machine),'No single-nozzle AMS change contract.');
  requireThat(Number.isInteger(count)&&count>0&&from!==to,'Invalid AMS change sequence.');
  const old=filamentPlan(plan,machine,from),next=filamentPlan(plan,machine,to);
  for(const p of [old,next]){
    validateSetup(p,machine);
    requireThat(p.setup.tool===0&&p.setup.material==='PLA'&&p.setup.nozzleMm===0.4,'X1 AMS changes require the 0.4 mm PLA contract.');
    requireThat(p.setup.bambu.filaments?.[p.setup.bambu.filament]?.source?.type!=='external','Automatic X1 material changes require AMS feeds, not an external spool.');
  }
  const bounds=toolBounds(machine,0),k=machine.outputs.find(o=>o.id==='bambu-gcode').constraints;
  requireThat(position.every((v,i)=>Number.isFinite(v)&&v>=bounds.min[i]&&v<=bounds.max[i]),'AMS change handoff exceeds nozzle bounds.');
  requireThat(Number.isFinite(incomingDebt)&&Math.abs(incomingDebt-next.process.retractMm)<1e-6,'AMS change must hand off the new filament retracted.');
  requireThat(Number.isFinite(fan)&&fan>=0&&fan<=255,'Invalid AMS change fan state.');
  const feed=n(k.startupPurgeFlowMm3S/2.4053*60),area=Math.PI*(next.setup.filamentMm/2)**2;
  requireThat(Number.isFinite(k.materialChangeFlushMm3)&&k.materialChangeFlushMm3>0,'AMS change needs a positive chute flush volume.');
  const z=n(position[2]),lines=[`;SAAM_TOOL_CHANGE ${to}`,'M400','G90','M83',
    `M620 S${to}A`,`M204 S${k.toolChangeAcceleration}`,`G1 Z${z} F1200`,
    'G1 X70 F21000','G1 Y245','G1 Y265 F3000','M400','M106 P1 S0','M106 P2 S0',
    `M104 S${old.setup.nozzleC}`,'M620.11 S0','M400',
    'G1 X90 F3000','G1 Y255 F4000','G1 X100 F5000','G1 X120 F15000','G1 X20 Y50 F21000','G1 Y-3'];
  if(count===1)lines.push('M620.1 X70 Y245 F21000 P0','M620.1 X70 Y265 F21000 P1','M620.1 X100 Y265 F21000 P2');
  lines.push(`M620.1 E F${feed} T${k.startupFlushC}`,`T${to}`,`M620.1 E F${feed} T${k.startupFlushC}`,
    'M620.11 S0','G90','M83','G92 E0',`M109 S${k.startupFlushC}`,
    `;SAAM_CHUTE_FLUSH_MM3:${k.materialChangeFlushMm3}`);
  // Bound each extrusion command; the sum is the one profile-owned volume.
  let remaining=k.materialChangeFlushMm3/area;
  while(remaining>1e-6){const part=Math.min(remaining,40);lines.push(`G1 E${n(part)} F${feed}`);remaining-=part;}
  lines.push('M400',`M109 S${next.setup.nozzleC}`,`G1 E2 F${feed}`,'M400','G92 E0',
    `G1 E-${n(incomingDebt)} F1800`,'M106 P1 S255','M400 S3',
    'G1 X70 F5000','G1 X90 F3000','G1 Y255 F4000','G1 X105 F5000','G1 Y265 F5000',
    'G1 X70 F10000','G1 X100 F5000','G1 X70 F10000','G1 X100 F5000',
    'G1 X80 F15000','G1 X60','G1 X80','G1 X60','G1 X80','G1 X100 F5000','G1 X165 F15000','G1 Y256','M400',
    `G1 Z${z} F3000`,`M204 S${k.bodyAcceleration}`,`M621 S${to}A`,
    'G90','G21','M83','G92 E0',`M109 S${next.setup.nozzleC}`,`M106 P1 S${n(fan)}`,
    `G1 X${n(position[0])} Y${n(position[1])} Z${z} F${n(Math.min(old.process.travelSpeedMmS,next.process.travelSpeedMmS)*60)}`,
    'M400',';SAAM_TOOL_CHANGE_END');
  return lines.join('\n')+'\n';
}
