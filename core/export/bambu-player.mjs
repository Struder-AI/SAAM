import {interpretMotion} from './griffin.mjs';
import {gcodeLines} from './gcode-lines.mjs';
import {toolBounds} from '../machine/rules.mjs';
import {requireThat} from '../geom/tolerance.mjs';
export const prelude=plan=>`G90\nG21\nM83\nG92 E0\nM190 S${plan.setup.bedC}\nM109 S${plan.setup.nozzleC}\n`;
export function interpretBody(body,plan,machine,options={}){
  requireThat(body.startsWith(prelude(plan)),'Bambu body is missing its explicit modal/temperature state.');
  // Physical T selectors and firmware macros belong only to the pinned envelope.
  for(const line of gcodeLines(body))requireThat(!/^T\d/.test(line.trim()),'Bambu body cannot change the selected tool.');
  const bounds=toolBounds(machine,plan.setup.tool),start=[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm];
  requireThat(start.every((v,i)=>v>=bounds.min[i]-1e-5&&v<=bounds.max[i]+1e-5),'Bambu body exceeds selected nozzle area.');
  // interpretMotion checks each decoded endpoint against these same bounds;
  // each following segment starts at the preceding checked endpoint.
  return interpretMotion(body,plan,machine,{...options,extrusionMode:'relative'});
}

export function interpretBambuSource(code,plan,machine,options={}) {
  const beginMarker=';SAAM_BODY_BEGIN\n',endMarker=';SAAM_BODY_END\n';
  const begin=code.indexOf(beginMarker),end=code.indexOf(endMarker);
  requireThat(begin>=0&&end>begin&&code.indexOf(beginMarker,begin+beginMarker.length)===-1&&code.indexOf(endMarker,end+endMarker.length)===-1,'Invalid Bambu body boundary.');
  let prefixLines=-1;for(const line of gcodeLines(code.slice(0,begin+beginMarker.length)))prefixLines++;
  const program=interpretBody(code.slice(begin+beginMarker.length,end),plan,machine,options);
  // Compact storage accepts an offset without expanding/rebuilding its moves.
  if(program.moves.offsetLines)program.moves.offsetLines(prefixLines);
  else for(const move of program.moves)move.line+=prefixLines;
  for(const event of program.events)event.line+=prefixLines;
  return program;
}
