import {requireThat} from '../geom/tolerance.mjs';
import {toolBounds,validateSetup} from '../machine/rules.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {renderX1MaterialChange} from './bambu-x1-change.mjs';

export const CHANGE_BEGIN=';SAAM_TOOL_CHANGE ',CHANGE_END=';SAAM_TOOL_CHANGE_END\n';
const n=value=>Number(value.toFixed(5));

// SAAM-authored, tower-free H2D service recipe. Coordinates are service motions,
// not simulated deposition. The caller restores the checked body position.
export function renderBambuChange(plan,machine,{from,to,position,incomingDebt,knownOutgoing,fan,count}){
  if(machine.id==='bambu-x1-carbon')return renderX1MaterialChange(plan,machine,{from,to,position,incomingDebt,fan,count});
  requireThat(machine.id==='bambu-h2d'&&Number.isInteger(count)&&count>0,'No tool-change contract for this machine.');
  const old=filamentPlan(plan,machine,from),next=filamentPlan(plan,machine,to);
  validateSetup(old,machine);validateSetup(next,machine);
  requireThat(old.setup.tool!==next.setup.tool,'Same-nozzle material changes require a separate flushing contract.');
  requireThat(Number.isFinite(incomingDebt)&&incomingDebt>=0&&incomingDebt<=next.process.retractMm+1e-4,'Invalid incoming nozzle retraction.');
  requireThat(Number.isFinite(fan)&&fan>=0&&fan<=255,'Invalid changeover fan state.');
  for(const selected of [old,next]){
    const b=toolBounds(machine,selected.setup.tool);
    requireThat(position.every((v,i)=>Number.isFinite(v)&&v>=b.min[i]&&v<=b.max[i]),'Tool change must hand off inside both nozzle bounds.');
  }
  const k=machine.outputs.find(o=>o.id==='bambu-gcode').constraints;
  const feed=n(k.startupPurgeFlowMm3S/2.4053*60),reduced=n(feed*0.8),b=knownOutgoing?old.setup.tool:-1;
  const oldS=old.setup,newS=next.setup,z=n(position[2]),r=n(incomingDebt);
  return [CHANGE_BEGIN+to,'M400','M993 A2 B2 C2','M993 A0 B0 C0','M1015.4 S1 K0',
    `M620 S${to}A H-1`,'M1002 gcode_claim_action : 4',`M204 S${k.toolChangeAcceleration}`,`G1 Z${z} F1200`,'M400','M106 P1 S0','M106 P2 S0',
    `M620.10 A0 F${reduced} L0 H${oldS.nozzleMm} T${k.startupFlushC} P${oldS.nozzleC} S1`,
    `M620.10 A1 F${reduced} L0 H${newS.nozzleMm} T${k.startupFlushC} P${newS.nozzleC} S1`,
    `M620.11 P0 I${from} B${b} E0`,`M620.11 K1 I${from} B${b} R10 F${feed}`,`M620.15 C${newS.nozzleC}`,
    'M628 S1',`M620.11 S1 L0 I${from} B${b} R10 D8 E-10 F${feed}`,'M629','M620.11 H0',`T${to} H-1`,
    'SYNC T0','M1002 set_filament_type:PLA','M400','M83',`M620.10 R${r}`,'M628 S0','M629','M400',
    `M983.3 F${n(next.process.maxFlowMm3S/2.4)} A0.4 R${r}`,'M400','G1 Y295 F30000','G1 Y265 F18000',`G1 Z${z} F3000`,
    `M204 S${k.bodyAcceleration}`,`M621 S${to}A`,'M993 A3 B3 C3','M1015.3 S0',`M1015.4 S1 K1 H${newS.nozzleMm}`,`M620.6 I${to} H-1 W1`,
    `M620 Q${count+1}`,'M1002 gcode_claim_action : 0',
    // Explicit waits and modes instead of assuming the service macro's state.
    'G90','G21','M83','G92 E0',`M109 S${newS.nozzleC}`,`M106 S${n(fan)}`,
    `G1 X${n(position[0])} Y${n(position[1])} Z${z} F${n(Math.min(next.process.travelSpeedMmS,old.process.travelSpeedMmS)*60)}`,
    'M400',CHANGE_END.trimEnd()].join('\n')+'\n';
}
