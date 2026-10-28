import {requireThat,checkedFilamentPlan as filamentPlan,sameNozzleMaterialChanges} from './filaments.mjs';
import {renderBambuChange} from './bambu-change.mjs';

// Explicit modal and temperature state at the start of each body segment.
const prelude=plan=>`G90\nG21\nM83\nG92 E0\nM190 S${plan.setup.bedC}\nM109 S${plan.setup.nozzleC}\n`;
// Consume each material run directly; command text and thumbnail geometry are
// output artifacts, while the neutral input remains a repeatable local stream.
export function* bambuBodyLines(path,plan,machine,Export,{onStroke,onSegment}){
  const travelCommand=machine.outputs.find(o=>o.id===plan.output).constraints.bodyTravelCommand;
  requireThat(travelCommand==='G1','Bambu body requires coordinated G1 travel.');
  const state={filament:plan.setup.filament,selected:filamentPlan(plan,machine,plan.setup.filament),position:[...path.initialPosition],start:[...path.initialPosition],fan:0,count:0};
  const debt={},usedTools=new Map([[state.selected.setup.tool,state.filament]]),cursor={iterator:preparedActions(path),change:null,done:false};
  try{for(;;){
    yield prelude(state.selected).trimEnd();
    const written=Export.gcodeStream({...path,initialPosition:state.start,actions:materialActions(cursor,state,debt,Export)},state.selected,{extrusionMode:'relative',travelCommand,onStroke});
    for(const line of written.lines)yield line==='M107'?'M106 S0':line;
    onSegment({filament:state.filament,tool:state.selected.setup.tool,tally:written.tally});
    if(cursor.done)break;
    const action=cursor.change,incoming=filamentPlan(plan,machine,action.filament);
    requireThat(action.tool===incoming.setup.tool,'Tool-change action disagrees with the logical filament mapping.');
    const sameNozzle=sameNozzleMaterialChanges(machine)&&incoming.setup.tool===state.selected.setup.tool;
    requireThat(sameNozzle||!usedTools.has(incoming.setup.tool)||usedTools.get(incoming.setup.tool)===action.filament,'Changing material within one nozzle requires a separate flushing contract.');
    const incomingDebt=sameNozzle?incoming.process.retractMm:debt[incoming.setup.tool]??0;
    const knownOutgoing=state.count>0;state.count++;
    yield renderBambuChange(plan,machine,{from:state.filament,to:action.filament,position:state.position,incomingDebt,knownOutgoing,fan:state.fan,count:state.count},Export).trimEnd();
    if(sameNozzle)debt[incoming.setup.tool]=incomingDebt;
    state.selected=incoming;state.filament=action.filament;usedTools.set(incoming.setup.tool,state.filament);state.start=[...state.position];
  }}finally{cursor.iterator.return?.();}
}
function* preparedActions(path){yield* path.actions;}
function* materialActions(cursor,state,debt,Export){
  for(;;){
    const next=cursor.iterator.next();
    if(next.done){cursor.done=true;return;}
    const action=next.value;
    if(action.kind==='toolChange'){cursor.change=action;return;}
    yield action;
    if(action.kind==='move')state.position=action.to.map(value=>Export.number(value,'xyz'));
    if(action.kind==='retract')debt[state.selected.setup.tool]=(debt[state.selected.setup.tool]??0)+action.filamentMm;
    if(action.kind==='recover')debt[state.selected.setup.tool]=Math.max(0,(debt[state.selected.setup.tool]??0)-action.filamentMm);
    if(action.kind==='fan')state.fan=Math.min(255,Math.max(0,Math.round(action.percent*255/100)));
  }
}
