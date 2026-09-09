import {exportGriffin,interpretGriffin} from './griffin.mjs';
import {requireThat} from '../geom/tolerance.mjs';
const adapters={'griffin-gcode':{export:exportGriffin,interpret:interpretGriffin}};
export function outputAdapter(plan,machine){
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false&&adapters[declaration.id],declaration.reason??`No exporter/interpreter for ${declaration.id}.`);
  return adapters[declaration.id];
}
export const exportProgram=(path,plan,machine,release)=>outputAdapter(plan,machine).export(path,plan,machine,release);
export const interpretProgram=(code,plan,machine)=>outputAdapter(plan,machine).interpret(code,plan,machine);
