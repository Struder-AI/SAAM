// Export boundary: turn an authored SAAMpath into the selected installation's
// startup, material-change and feed commands. The input path is never changed.
import {requireThat,distance} from '../geom/tolerance.mjs';
import {validateSetup,toolBounds,startupPosition,startupRetracted,sameNozzleMaterialChanges} from '../machine/rules.mjs';
import {checkedFilamentPlan,assignedFilaments} from '../machine/filaments.mjs';
import {createPlanningState,planTravel,planRetraction,planRecovery,planMove,materializeActions} from '../path/planning.mjs';
import {planPriming,validatePrimingClearance} from '../path/prime.mjs';
import {validateNozzleC,requireProcessControl} from '../path/process-controls.mjs';
import {validatePose,samePose,uprightPose} from '../path/pose.mjs';
const materialSelection=(plan,machine,index)=>{
  const p=checkedFilamentPlan(plan,machine,index);validateSetup(p,machine);
  return {plan:p,filament:index,tool:p.setup.tool,process:p.process,bounds:toolBounds(machine,p.setup.tool)};
};
function depositionBounds(path,plan){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let from=path.initialPosition;
  for(const a of path.actions){
    if(a.volumeMm3>0){
      const width=a.beadWidthMm??plan.process.lineWidthMm,height=a.normalHeightMm??a.gapMm??plan.process.layerMm;
      for(const p of a.kind==='move'?[from,a.to]:[from])for(let i=0;i<3;i++){
        min[i]=Math.min(min[i],p[i]-(i===2?height:width/2));max[i]=Math.max(max[i],p[i]+(i===2?0:width/2));
      }
    }
    if(a.kind==='move')from=a.to;
  }
  return min.every(Number.isFinite)?{min,max}:path.summary?.boundsMm??null;
}
function limitMachineFeed(path,actions,plan,machine){
  let from=path.initialPosition,process=plan.process;
  return actions.map(action=>{
    if(action.kind==='toolChange'){process=checkedFilamentPlan(plan,machine,action.filament).process;return action;}
    if(action.kind!=='move')return action;
    const length=distance(from,action.to),delta=action.to.map((v,i)=>Math.abs(v-from[i]));
    let speed=action.speedMmS;
    for(let i=0;i<3;i++)if(delta[i]>0)speed=Math.min(speed,machine.maxFeedMmS['xyz'[i]]*length/delta[i]);
    if(action.volumeMm3>0&&length>0)speed=Math.min(speed,process.maxFlowMm3S*length/action.volumeMm3);
    from=action.to;
    return {...action,speedMmS:speed,...(action.durationSeconds?{durationSeconds:Math.max(action.durationSeconds,length/speed)}:{})};
  });
}
export function prepareMachinePath(path,plan,machine){
  validateSetup(plan,machine,{required:true});
  const orientedOutput=plan.output==='denso-pacscript';
  const inputPoses=[path.initialPose,...path.actions.map(a=>a.pose)].filter(Boolean);
  inputPoses.forEach(validatePose);
  requireThat(orientedOutput||inputPoses.every(pose=>samePose(pose,uprightPose())),
    'Selected output cannot represent non-upright orientation or rotary motion.');
  // Fixed-axis outputs already mean print-Z alignment. Explicit upright output
  // is redundant there; actual non-upright intent was checked above, never lost.
  const {initialPose,...pathData}=path;
  const source=orientedOutput?path:{...pathData,actions:path.actions.map(({pose,...action})=>action)};
  const bounds=toolBounds(machine,plan.setup.tool),hasSelections=assignedFilaments(plan).length>0;
  let selected=hasSelections?materialSelection(plan,machine,plan.setup.bambu.filament):{plan,tool:plan.setup.tool,process:plan.process,bounds};
  let state=createPlanningState({start:startupPosition(machine,plan),process:plan.process,machine,
    generatorVersion:path.generatorVersion,retracted:startupRetracted(machine,plan),motion:plan.setup.denso??null,motionBounds:bounds});
  const chunks=[],append=stage=>{chunks.push(stage.actions);state=stage.state;};
  const geometryBounds=path.summary?.boundsMm??depositionBounds(path,plan);
  if(!path.actions.some(a=>a.phase==='prime')){
    const prime=planPriming(state);append(prime);
    // Deposition bounds include authored paths without a source solid.
    validatePrimingClearance(prime.points,geometryBounds,[],plan.process.lineWidthMm,machine.startup?.primingStrokes?.clearanceMm??0);
  }
  append(planTravel(state,source.initialPosition,{maxCombMm:0},source.initialPose));
  append(planRecovery(state));
  const debts=new Map([[selected.tool,0]]);let neutralFrom=path.initialPosition,relocating=false;
  for(const original of source.actions){
    state={...state,phase:original.phase,layer:original.layer,operationId:original.operation};
    if(original.kind==='toolChange'){
      const incoming=materialSelection(plan,machine,original.filament);
      requireThat(original.tool===incoming.tool,'Tool-change action disagrees with its authored filament mapping.');
      const sameNozzle=sameNozzleMaterialChanges(machine)&&incoming.tool===selected.tool;
      requireThat(sameNozzle||machine.id==='bambu-h2d'&&incoming.tool!==selected.tool,'Selected output has no contract for this material change.');
      const lift=machine.outputs.find(o=>o.id===plan.output)?.constraints?.toolChangeLiftMm;
      requireThat(Number.isFinite(lift)&&lift>0,'Selected output has no material-change clearance contract.');
      append(planRetraction(state));debts.set(selected.tool,state.retracted?selected.process.retractMm:0);
      const lo=bounds.min.map((_,i)=>Math.max(selected.bounds.min[i],incoming.bounds.min[i]));
      const hi=bounds.max.map((_,i)=>Math.min(selected.bounds.max[i],incoming.bounds.max[i]));
      const z=Math.max(state.position[2],state.depositedMaxZ+lift);
      requireThat(lo.every((v,i)=>v<=hi[i])&&z<=hi[2],'Material change exceeds common nozzle clearance bounds.');
      append(planMove(state,[state.position[0],state.position[1],z],state.process.zSpeedMmS));
      const at=[Math.max(lo[0],Math.min(hi[0],state.position[0])),Math.max(lo[1],Math.min(hi[1],state.position[1])),z];
      append(planMove(state,at,state.process.travelSpeedMmS));
      chunks.push({append:[{...original,tool:incoming.tool}]});
      const debt=sameNozzle?incoming.process.retractMm:debts.get(incoming.tool)??0;
      state={...state,process:incoming.process,retracted:debt>0,moveRun:null,pose:null};selected=incoming;
      append(planRecovery(state));debts.set(selected.tool,0);relocating=true;
      continue;
    }
    let action={...original};
    // Neutral approach moves began at the outgoing nozzle position. After a
    // machine service handoff the incoming nozzle instead approaches the same
    // deposition start from its common clearance point.
    if(relocating&&action.kind==='move'&&action.volumeMm3===0){neutralFrom=action.to;continue;}
    if(relocating&&['retract','recover'].includes(action.kind))continue;
    if(relocating&&(action.kind==='move'||action.kind==='extrude')){
      append(planTravel(state,neutralFrom,{maxCombMm:0}));append(planRecovery(state));relocating=false;
    }
    if(action.kind==='move'){
      if(action.volumeMm3>0&&distance(state.position,neutralFrom)>1e-8)append(planTravel(state,neutralFrom,{maxCombMm:0}));
      const length=distance(state.position,action.to);
      if(length===0&&!action.pose){requireThat(action.volumeMm3===0,'A zero-length move needs explicit stationary extrusion.');neutralFrom=action.to;continue;}
      state={...state,position:action.to,pose:action.pose??null,depositedMaxZ:action.volumeMm3>0?Math.max(state.depositedMaxZ,state.position[2],action.to[2]):state.depositedMaxZ,moveRun:null};
      neutralFrom=action.to;
    }else if(action.kind==='retract'||action.kind==='recover'){
      requireThat(action.kind==='retract'?!state.retracted:state.retracted,'Retraction/recovery action disagrees with the current withdrawal state.');
      state={...state,retracted:action.kind==='retract'};debts.set(selected.tool,state.retracted?action.filamentMm:0);
    }else if(action.kind==='temperature'){requireProcessControl(machine);validateNozzleC(action.targetC,selected.plan,machine);}
    else if(action.kind==='extrude')requireProcessControl(machine);
    chunks.push({append:[action]});
  }
  if(relocating)append(planTravel(state,neutralFrom,{maxCombMm:0}));
  return {...source,initialPosition:startupPosition(machine,plan),
    ...(plan.setup.denso?{initialPose:plan.setup.denso.initialPose}:{}),actions:limitMachineFeed({initialPosition:startupPosition(machine,plan)},materializeActions(chunks),plan,machine),
    summary:{...path.summary,boundsMm:geometryBounds}};
}
