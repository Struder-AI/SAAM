import {requireThat,distance} from '../private/export/numeric.mjs';
import {AdaptationMotion,machinePriming} from '../private/export/adaptation-motion.mjs';
import {validateSetup,toolBounds,startupPosition,startupRetracted} from '../machine/rules.mjs';
import {materialProcess,materialTool} from '../machine/filaments.mjs';
import {contextualActions} from '../path/action-context.mjs';
import {samePose,uprightPose} from '../path/pose.mjs';
import {placedPath} from '../path/placement.mjs';
import {NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {moveSeconds} from '../path/saampath.mjs';
import {pathActions,pathSummary,pathInitialPosition,pathInitialPose,pathCompletion} from '../path/curve-path.mjs';

export const PREPARED_PATH_CONTRACT='saam-export-prepared/1';
const upright=pose=>!pose||samePose(pose,uprightPose());
const selection=(plan,machine,index)=>{
  const tool=materialTool(plan,index);
  return {filament:index,tool,process:materialProcess(plan,index),bounds:toolBounds(machine,tool)};
};
function hasPrime(path){
  for(const {context} of contextualActions(path))if(context.phase==='prime')return true;
  return false;
}
function depositionBounds(path,plan){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let from=pathInitialPosition(path);
  for(const action of pathActions(path)){
    if(action.volumeMm3>0){
      const width=action.beadWidthMm??plan.process.lineWidthMm,height=action.normalHeightMm??action.gapMm??plan.process.layerMm;
      for(const point of action.kind==='move'?[from,action.to]:[from])for(let i=0;i<3;i++){
        min[i]=Math.min(min[i],point[i]-(i===2?height:width/2));max[i]=Math.max(max[i],point[i]+(i===2?0:width/2));
      }
    }
    if(action.kind==='move')from=action.to;
  }
  return min.every(Number.isFinite)?{min,max}:pathSummary(path)?.boundsMm??null;
}
function uprightPath(path){
  if(!upright(pathInitialPose(path)))return false;
  for(const action of pathActions(path))if(!upright(action.pose))return false;
  return true;
}
function depositsMaterial(path){for(const action of pathActions(path))if(action.volumeMm3>0)return true;return false;}
function limitedFeed(start,actions,machine){
  let from=start;
  return actions.map(action=>{
    if(action.kind!=='move')return action;
    const length=distance(from,action.to),delta=action.to.map((v,i)=>Math.abs(v-from[i]));
    let speed=action.speedMmS;
    for(let i=0;i<3;i++)if(delta[i]>0)speed=Math.min(speed,machine.maxFeedMmS['xyz'[i]]*length/delta[i]);
    from=action.to;
    return {...action,speedMmS:speed,...(action.durationSeconds?{durationSeconds:Math.max(action.durationSeconds,moveSeconds(length,speed))}:{})};
  });
}

// The saved SAAMpath is independent of machine/output. This ephemeral path is
// the exact selected-machine motion sent into the program writer. The adapter
// declares whether it writes poses; its setup block may state the start pose
// and the posed-travel retreat (initialPose, retreatMm). The SAAMpath is moved
// onto the bed by the recipe's placement first. notes: what adaptation could not
// write as the profile asks (a shortened or omitted priming lane).
export function prepareExportPath(saved,plan,machine,adapter){
  requireThat((saved?.deposition?.schema==='saampath/2'||saved?.schema==='saampath/1')&&pathCompletion(saved)?.contract===NEUTRAL_PATH_CONTRACT,
    'Export requires a current neutral SAAMpath. Generate the toolpath first.');
  const path=placedPath(saved,plan.placement);
  validateSetup(plan,machine,{required:true,adapter});
  const oriented=adapter.poses===true,block=plan.setup[adapter.settings?.key];
  requireThat(oriented||uprightPath(path),
    'Selected output cannot represent non-upright tool orientation.');
  const bounds=toolBounds(machine,plan.setup.tool);
  let selected={plan,tool:plan.setup.tool,process:plan.process,bounds};
  const start=startupPosition(machine,plan,block),motion=new AdaptationMotion({start,process:plan.process,
    retracted:startupRetracted(machine,plan),pose:block?.initialPose??null,
    ...(oriented&&block?.retreatMm?{retreatMm:block.retreatMm}:{})});
  const deposited=depositionBounds(path,plan),model=pathSummary(path)?.boundsMm;
  const geometryBounds=model&&deposited?{min:model.min.map((v,i)=>Math.min(v,deposited.min[i])),
    max:model.max.map((v,i)=>Math.max(v,deposited.max[i]))}:model??deposited;
  const priming=depositsMaterial(path)&&!hasPrime(path)?machinePriming(motion,machine,bounds,geometryBounds):null;
  motion.phase='start';motion.layer=0;motion.operationId=null;
  motion.travel(pathInitialPosition(path),oriented?pathInitialPose(path)??null:null);
  const debts=new Map([[selected.tool,0]]);let neutralFrom=pathInitialPosition(path),relocating=false;
  // Context is resolved only at the selected-machine boundary. These actions
  // are private prepared machine motion, never a persisted neutral SAAMpath.
  for(const {action:physical,context} of contextualActions(path)){
    const original={...context,...physical};
    motion.context(original);
    if(original.kind==='toolChange'){
      requireThat(!Object.hasOwn(original,'tool'),
        'Neutral material changes must not select a physical tool.');
      const incoming=selection(plan,machine,original.filament);
      // A same-nozzle change needs the output's declared mode; a change to another tool is a tool swap.
      const constraints=machine.outputs.find(o=>o.id===plan.output)?.constraints,sameNozzle=incoming.tool===selected.tool;
      requireThat(!sameNozzle||constraints?.materialChangeMode==='single-nozzle-ams',
        'Selected output has no contract for this material change.');
      const lift=constraints?.toolChangeLiftMm;
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
      // Rounding guard: a neutral move of zero length within rounding is no move.
      if(original.volumeMm3>0&&distance(motion.position,neutralFrom)>ROUNDING_MM)motion.travel(neutralFrom);
      // A deposition move of zero length is not written either.
      if(distance(motion.position,original.to)<ROUNDING_MM&&!(oriented&&original.pose)){neutralFrom=original.to;continue;}
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
  const prepared={...path,completion:{contract:PREPARED_PATH_CONTRACT},
    initialPosition:start,...(block?.initialPose?{initialPose:block.initialPose}:{}),
    actions:limitedFeed(start,motion.actions,machine),summary:{...pathSummary(path),boundsMm:geometryBounds},notes:priming?[priming]:[]};
  if(!oriented)delete prepared.initialPose;
  return prepared;
}
