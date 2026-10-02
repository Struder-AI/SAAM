import {requireThat,distance} from '../private/export/numeric.mjs';
import {AdaptationMotion,machinePriming} from '../private/export/adaptation-motion.mjs';
import {validateSetup,checkMachinePath,toolBounds,startupPosition,startupRetracted,sameNozzleMaterialChanges} from '../machine/rules.mjs';
import {checkedFilamentPlan} from '../machine/filaments.mjs';
import {contextualActions} from '../path/action-context.mjs';

export const PREPARED_PATH_CONTRACT='saam-export-prepared/1';
const NEUTRAL_PATH_CONTRACT='saam-neutral-motion/1';
const upright=pose=>!pose||Math.abs(pose.rotaryDeg)<1e-9&&
  pose.toolAxis.every((v,i)=>Math.abs(v-[0,0,-1][i])<1e-9)&&
  pose.toolUp.every((v,i)=>Math.abs(v-[0,1,0][i])<1e-9);
const selection=(plan,machine,index)=>{
  const selected=checkedFilamentPlan(plan,machine,index);
  return {plan:selected,filament:index,tool:selected.setup.tool,process:selected.process,bounds:toolBounds(machine,selected.setup.tool)};
};
function hasPrime(path){
  for(const {context} of contextualActions(path))if(context.phase==='prime')return true;
  return false;
}
function depositionBounds(path,plan){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let from=path.initialPosition;
  for(const action of path.actions){
    if(action.volumeMm3>0){
      const width=action.beadWidthMm??plan.process.lineWidthMm,height=action.normalHeightMm??action.gapMm??plan.process.layerMm;
      for(const point of action.kind==='move'?[from,action.to]:[from])for(let i=0;i<3;i++){
        min[i]=Math.min(min[i],point[i]-(i===2?height:width/2));max[i]=Math.max(max[i],point[i]+(i===2?0:width/2));
      }
    }
    if(action.kind==='move')from=action.to;
  }
  return min.every(Number.isFinite)?{min,max}:path.summary?.boundsMm??null;
}
function limitedFeed(start,actions,machine){
  let from=start;
  return actions.map(action=>{
    if(action.kind!=='move')return action;
    const length=distance(from,action.to),delta=action.to.map((v,i)=>Math.abs(v-from[i]));
    let speed=action.speedMmS;
    for(let i=0;i<3;i++)if(delta[i]>0)speed=Math.min(speed,machine.maxFeedMmS['xyz'[i]]*length/delta[i]);
    from=action.to;
    return {...action,speedMmS:speed,...(action.durationSeconds?{durationSeconds:Math.max(action.durationSeconds,length/speed)}:{})};
  });
}

// The saved SAAMpath is independent of machine/output. This ephemeral path is
// the exact selected-machine motion sent into the program writer and checker.
export function prepareExportPath(path,plan,machine){
  requireThat(path?.schema==='saampath/1'&&path.completion?.contract===NEUTRAL_PATH_CONTRACT,
    'Export requires a current neutral SAAMpath. Generate the toolpath first.');
  validateSetup(plan,machine,{required:true});
  const oriented=plan.output==='denso-pacscript';
  requireThat(oriented||[path.initialPose,...path.actions.map(a=>a.pose)].every(upright),
    'Selected output cannot represent non-upright orientation or rotary motion.');
  const bounds=toolBounds(machine,plan.setup.tool);
  let selected={plan,tool:plan.setup.tool,process:plan.process,bounds};
  const start=startupPosition(machine,plan),motion=new AdaptationMotion({start,process:plan.process,
    retracted:startupRetracted(machine,plan),pose:plan.setup.denso?.initialPose??null,motion:plan.setup.denso??null});
  const deposited=depositionBounds(path,plan),model=path.summary?.boundsMm;
  const geometryBounds=model&&deposited?{min:model.min.map((v,i)=>Math.min(v,deposited.min[i])),
    max:model.max.map((v,i)=>Math.max(v,deposited.max[i]))}:model??deposited;
  if(path.actions.some(a=>a.volumeMm3>0)&&!hasPrime(path))
    machinePriming(motion,machine,bounds,geometryBounds);
  motion.phase='start';motion.layer=0;motion.operationId=null;
  motion.travel(path.initialPosition,oriented?path.initialPose??null:null);
  const debts=new Map([[selected.tool,0]]);let neutralFrom=path.initialPosition,relocating=false;
  // Context is resolved only at the selected-machine boundary. These actions
  // are private prepared machine motion, never a persisted neutral SAAMpath.
  for(const {action:physical,context} of contextualActions(path)){
    const original={...context,...physical};
    motion.context(original);
    if(original.kind==='toolChange'){
      requireThat(!Object.hasOwn(original,'tool'),
        'Neutral material changes must not select a physical tool.');
      const incoming=selection(plan,machine,original.filament);
      const sameNozzle=sameNozzleMaterialChanges(machine)&&incoming.tool===selected.tool;
      requireThat(sameNozzle||machine.id==='bambu-h2d'&&incoming.tool!==selected.tool,
        'Selected output has no contract for this material change.');
      const lift=machine.outputs.find(o=>o.id===plan.output)?.constraints?.toolChangeLiftMm;
      requireThat(Number.isFinite(lift)&&lift>0,'Selected output has no material-change clearance contract.');
      motion.retract();debts.set(selected.tool,motion.retracted?selected.process.retractMm:0);
      const lo=bounds.min.map((_,i)=>Math.max(selected.bounds.min[i],incoming.bounds.min[i]));
      const hi=bounds.max.map((_,i)=>Math.min(selected.bounds.max[i],incoming.bounds.max[i]));
      const z=Math.max(motion.position[2],motion.depositedMaxZ+lift);
      requireThat(lo.every((v,i)=>v<=hi[i])&&z<=hi[2],'Material change exceeds common nozzle clearance bounds.');
      motion.move([motion.position[0],motion.position[1],z],motion.process.zSpeedMmS);
      motion.move([Math.max(lo[0],Math.min(hi[0],motion.position[0])),Math.max(lo[1],Math.min(hi[1],motion.position[1])),z],motion.process.travelSpeedMmS);
      motion.append({...original,tool:incoming.tool});
      const debt=sameNozzle?incoming.process.retractMm:debts.get(incoming.tool)??0;
      motion.process=incoming.process;motion.retracted=debt>0;motion.pose=null;selected=incoming;
      motion.recover();debts.set(selected.tool,0);relocating=true;continue;
    }
    if(relocating&&original.kind==='move'&&original.volumeMm3===0){neutralFrom=original.to;continue;}
    if(relocating&&['retract','recover'].includes(original.kind))continue;
    if(relocating&&(original.kind==='move'||original.kind==='extrude')){
      motion.travel(neutralFrom);relocating=false;
    }
    if(original.kind==='move'){
      if(original.volumeMm3>0&&distance(motion.position,neutralFrom)>1e-8)motion.travel(neutralFrom);
      if(distance(motion.position,original.to)<1e-10&&!original.pose){
        requireThat(original.volumeMm3===0,'A zero-length move needs stationary extrusion.');neutralFrom=original.to;continue;
      }
      motion.position=[...original.to];motion.pose=original.pose??null;
      if(original.volumeMm3>0)motion.depositedMaxZ=Math.max(motion.depositedMaxZ,neutralFrom[2],original.to[2]);
      neutralFrom=original.to;
    }else if(original.kind==='retract'||original.kind==='recover'){
      requireThat(original.kind==='retract'?!motion.retracted:motion.retracted,
        'Retraction/recovery action disagrees with the current withdrawal state.');
      motion.retracted=original.kind==='retract';debts.set(selected.tool,motion.retracted?original.filamentMm:0);
    }
    const action=oriented?original:original.pose?Object.fromEntries(Object.entries(original).filter(([key])=>key!=='pose')):original;
    motion.actions.push(action);
  }
  if(relocating)motion.travel(neutralFrom);
  const prepared={...path,completion:{contract:PREPARED_PATH_CONTRACT,sourceHash:path.completion.inputHash,
    authoredNozzleTemperatures:path.completion.authoredNozzleTemperatures},
    initialPosition:start,...(plan.setup.denso?{initialPose:plan.setup.denso.initialPose}:{}),
    actions:limitedFeed(start,motion.actions,machine),summary:{...path.summary,boundsMm:geometryBounds}};
  if(!oriented)delete prepared.initialPose;
  checkMachinePath(prepared,plan,machine);
  return prepared;
}
