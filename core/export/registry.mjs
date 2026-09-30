import {exportGriffin,interpretGriffin} from './griffin.mjs';
import {exportBambu,interpretBambu,exportAndInterpretBambu} from './bambu.mjs';
import {exportDobot,interpretDobot} from './dobot.mjs';
import {exportDenso,interpretDenso} from './denso.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {withTravelAdvisory} from './travel-advisory.mjs';
const adapters={
  'denso-pacscript':{export:exportDenso,interpret:interpretDenso},
  'griffin-gcode':{export:exportGriffin,interpret:(bytes,plan,machine)=>interpretGriffin(Buffer.isBuffer(bytes)?bytes.toString('utf8'):bytes,plan,machine)},
  'bambu-gcode':{export:exportBambu,interpret:interpretBambu,exportAndInterpret:exportAndInterpretBambu},
  'dobot-lua':{export:exportDobot,interpret:interpretDobot}
};
export function outputAdapter(plan,machine){
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false&&adapters[declaration.id],declaration.reason??`No exporter/interpreter for ${declaration.id}.`);
  return adapters[declaration.id];
}
const requireSupportedMotion=(path,plan)=>requireThat(plan.output==='denso-pacscript'||!path.initialPose&&!path.actions.some(a=>a.pose),
  'Selected output cannot represent oriented/rotary motion.');
export const exportProgram=(path,plan,machine,release)=>{
  requireSupportedMotion(path,plan);
  return outputAdapter(plan,machine).export(path,plan,machine,release);
};
export const interpretProgram=(code,plan,machine)=>withTravelAdvisory(outputAdapter(plan,machine).interpret(code,plan,machine));

// One shared lifecycle entry point: adapters that need interpretation while
// exporting may carry that exact result forward. Others interpret once here.
export function exportAndInterpretProgram(path,plan,machine,release){
  requireSupportedMotion(path,plan);
  const adapter=outputAdapter(plan,machine);
  if(adapter.exportAndInterpret){
    const result=adapter.exportAndInterpret(path,plan,machine,release);
    return {...result,program:withTravelAdvisory(result.program)};
  }
  const bytes=adapter.export(path,plan,machine,release);
  return {bytes,program:withTravelAdvisory(adapter.interpret(bytes,plan,machine))};
}
