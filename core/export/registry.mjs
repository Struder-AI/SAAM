import {exportGriffin,interpretGriffin} from './griffin.mjs';
import {exportBambu,interpretBambu} from './bambu.mjs';
import {exportDobot,interpretDobot} from './dobot.mjs';
import {exportDenso,interpretDenso} from './denso.mjs';
import {requireThat} from '../geom/tolerance.mjs';
const adapters={
  'denso-pacscript':{export:exportDenso,interpret:interpretDenso},
  'griffin-gcode':{export:exportGriffin,interpret:(bytes,plan,machine)=>interpretGriffin(Buffer.isBuffer(bytes)?bytes.toString('utf8'):bytes,plan,machine)},
  'bambu-gcode':{export:exportBambu,interpret:interpretBambu},
  'dobot-lua':{export:exportDobot,interpret:interpretDobot}
};
export function outputAdapter(plan,machine){
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false&&adapters[declaration.id],declaration.reason??`No exporter/interpreter for ${declaration.id}.`);
  return adapters[declaration.id];
}
export const exportProgram=(path,plan,machine,release)=>{
  requireThat(plan.output==='denso-pacscript'||!path.initialPose&&!path.actions.some(a=>a.pose),'Selected output cannot represent oriented/rotary motion.');
  return outputAdapter(plan,machine).export(path,plan,machine,release);
};
export const interpretProgram=(code,plan,machine)=>outputAdapter(plan,machine).interpret(code,plan,machine);
