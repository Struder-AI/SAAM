import {interpretMotion,interpretMotionChunk} from './griffin.mjs';
import {gcodeLines} from './gcode-lines.mjs';
import {toolBounds} from '../machine/rules.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {startupRetracted,sameNozzleMaterialChanges} from '../machine/rules.mjs';
import {CHANGE_BEGIN,renderBambuChange} from './bambu-change.mjs';
export const prelude=plan=>`G90\nG21\nM83\nG92 E0\nM190 S${plan.setup.bedC}\nM109 S${plan.setup.nozzleC}\n`;
export function interpretBody(body,plan,machine,options={}){
  const travelCommand=machine.outputs.find(o=>o.id===plan.output)?.constraints.bodyTravelCommand;
  if(travelCommand==='G1')for(const line of gcodeLines(body))requireThat(!/^G0(?:\s|$)/.test(line.trim()),'Bambu body travel must use G1.');
  if(body.includes(CHANGE_BEGIN))return interpretMultiBody(body,plan,machine,options);
  requireThat(body.startsWith(prelude(plan)),'Bambu body is missing its explicit modal/temperature state.');
  // Physical T selectors and firmware macros belong only to the pinned envelope.
  for(const line of gcodeLines(body))requireThat(!/^T\d/.test(line.trim()),'Bambu body cannot change the selected tool.');
  const bounds=toolBounds(machine,plan.setup.tool),start=[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm];
  requireThat(start.every((v,i)=>v>=bounds.min[i]-1e-5&&v<=bounds.max[i]+1e-5),'Bambu body exceeds selected nozzle area.');
  // interpretMotion checks each decoded endpoint against these same bounds;
  // each following segment starts at the preceding checked endpoint.
  const program=interpretMotion(body,plan,machine,{...options,extrusionMode:'relative'});
  program.filamentSequence=[plan.setup.bambu.filament];
  program.filamentUsage=[{filament:plan.setup.bambu.filament,tool:plan.setup.tool,volumeMm3:program.volumeMm3}];
  return program;
}

export function interpretMultiBody(body,plan,machine,{moves=[]}={}){
  const initial=plan.setup.bambu.filament,debt={},sequence=[initial],usedTools=new Map([[plan.setup.tool,initial]]),usage=new Map(),events=[];
  let filament=initial,position=[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm],fan=0,time=0,volume=0,extrusions=0,count=0,cursor=0,lineOffset=0,maxDepositedZ=0;
  while(cursor<body.length){
    const marker=body.indexOf(CHANGE_BEGIN,cursor),end=marker<0?body.length:marker,chunk=body.slice(cursor,end);
    const selected=filamentPlan(plan,machine,filament);
    requireThat(chunk.startsWith(prelude(selected)),'Bambu segment is missing explicit modal/temperature state.');
    let length=0;
    const sink={get length(){return length;},push(move){
      const region=selected.composition.regions.find(r=>move.operation?.startsWith(r.id+':'));
      const tagged={...move,line:move.line+lineOffset,startSeconds:move.startSeconds+time,tool:selected.setup.tool,filament,
        nozzleMm:selected.setup.nozzleMm,lineWidthMm:region?.process?.lineWidthMm??selected.process.lineWidthMm,filamentColor:selected.setup.filamentColor};
      moves.push(tagged);length++;
      if(move.extruding)maxDepositedZ=Math.max(maxDepositedZ,...[move.from[2],move.to[2]]);
    }};
    const result=interpretMotionChunk(chunk,selected,machine,{position,debt:debt[selected.setup.tool]??0,fan,
      startupRecoveryPending:count===0&&startupRetracted(machine,selected)},sink);
    for(const event of result.events)events.push({...event,line:event.line+lineOffset,...(event.startSeconds===undefined?{}:{startSeconds:event.startSeconds+time}),tool:selected.setup.tool,filament});
    time+=result.seconds;volume+=result.volumeMm3;extrusions+=result.summary.extrusionMoves;
    usage.set(filament,(usage.get(filament)??0)+result.volumeMm3);
    position=result.finalPosition;fan=result.state.fan;debt[selected.setup.tool]=result.state.debt;
    lineOffset+=chunk.split('\n').length-1;
    if(marker<0)break;
    const markerEnd=body.indexOf('\n',marker),match=body.slice(marker,markerEnd).match(/^;SAAM_TOOL_CHANGE (\d+)$/);
    requireThat(match,'Malformed Bambu tool-change marker.');
    const incoming=Number(match[1]),next=filamentPlan(plan,machine,incoming);
    const sameNozzle=sameNozzleMaterialChanges(machine)&&next.setup.tool===selected.setup.tool;
    requireThat(sameNozzle||!usedTools.has(next.setup.tool)||usedTools.get(next.setup.tool)===incoming,'Changing material within one nozzle requires a separate flushing contract.');
    const lift=machine.outputs.find(o=>o.id==='bambu-gcode').constraints.toolChangeLiftMm;
    requireThat(position[2]>=maxDepositedZ+lift-1e-5,'Tool change has insufficient deposited-height clearance.');
    requireThat(Math.abs(result.state.debt-selected.process.retractMm)<1e-4,'Outgoing nozzle must be retracted before tool change.');
    const incomingDebt=sameNozzle?next.process.retractMm:debt[next.setup.tool]??0;
    const expected=renderBambuChange(plan,machine,{from:filament,to:incoming,position,incomingDebt,
      knownOutgoing:count>0,fan,count:++count});
    requireThat(body.startsWith(expected,marker),'Bambu tool-change block differs from its resolved settings or state.');
    if(sameNozzle)debt[next.setup.tool]=incomingDebt;
    events.push({line:lineOffset+1,kind:'tool-change',fromTool:selected.setup.tool,tool:next.setup.tool,fromFilament:filament,filament:incoming,startSeconds:time,simulated:false});
    filament=incoming;sequence.push(incoming);usedTools.set(next.setup.tool,incoming);
    cursor=marker+expected.length;lineOffset+=expected.split('\n').length-1;
  }
  requireThat(volume>0&&extrusions>0,'Bambu output needs deposition.');
  return {moves,events,header:{},seconds:time,volumeMm3:volume,finalPosition:position,
    filamentSequence:sequence,filamentUsage:[...usage].filter(([,v])=>v>0).map(([filament,volumeMm3])=>({filament,tool:filamentPlan(plan,machine,filament).setup.tool,volumeMm3})),
    summary:{moves:moves.length,extrusionMoves:extrusions,volumeMm3:volume,filamentMm:volume/(Math.PI*(plan.setup.filamentMm/2)**2),motionSeconds:time,
      startup:'Firmware startup and tool-change service moves are not simulated.',clearance:'Tool-change deposited-height clearance checked; physical head clearance remains unverified.'}};
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
