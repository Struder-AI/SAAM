import {exportMotion,validatePath} from './griffin.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {prelude} from './bambu-player.mjs';
import {renderBambuChange} from './bambu-change.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {sameNozzleMaterialChanges} from '../machine/rules.mjs';

export function exportBambuBody(path,plan,machine){
  validatePath(path);
  const travelCommand=machine.outputs.find(o=>o.id===plan.output).constraints.bodyTravelCommand;
  requireThat(travelCommand==='G1','Bambu body requires coordinated G1 travel.');
  let filament=plan.setup.bambu.filament,selected=filamentPlan(plan,machine,filament),position=[...path.initialPosition],start=[...position],fan=0,count=0;
  const debt={},lines=[],usedTools=new Map([[selected.setup.tool,filament]]);let actions=[];
  const flush=()=>{
    lines.push(prelude(selected).trimEnd());
    for(const line of exportMotion({...path,initialPosition:start,actions},selected,{extrusionMode:'relative',travelCommand}))lines.push(line==='M107'?'M106 S0':line);
    actions=[];
  };
  for(const action of path.actions){
    if(action.kind==='toolChange'){
      flush();const incoming=filamentPlan(plan,machine,action.filament);
      requireThat(action.tool===incoming.setup.tool,'Tool-change action disagrees with the logical filament mapping.');
      const sameNozzle=sameNozzleMaterialChanges(machine)&&incoming.setup.tool===selected.setup.tool;
      requireThat(sameNozzle||!usedTools.has(incoming.setup.tool)||usedTools.get(incoming.setup.tool)===action.filament,'Changing material within one nozzle requires a separate flushing contract.');
      const incomingDebt=sameNozzle?incoming.process.retractMm:debt[incoming.setup.tool]??0;
      lines.push(renderBambuChange(plan,machine,{from:filament,to:action.filament,position,
        incomingDebt,knownOutgoing:count>0,fan,count:++count}).trimEnd());
      if(sameNozzle)debt[incoming.setup.tool]=incomingDebt;
      selected=incoming;filament=action.filament;usedTools.set(incoming.setup.tool,filament);start=[...position];
      continue;
    }
    actions.push(action);
    if(action.kind==='move')position=action.to.map(v=>Number(v.toFixed(5)));
    if(action.kind==='retract')debt[selected.setup.tool]=(debt[selected.setup.tool]??0)+action.filamentMm;
    if(action.kind==='recover')debt[selected.setup.tool]=Math.max(0,(debt[selected.setup.tool]??0)-action.filamentMm);
    if(action.kind==='fan')fan=Math.round(action.percent*255/100);
  }
  flush();return lines.join('\n')+'\n';
}
