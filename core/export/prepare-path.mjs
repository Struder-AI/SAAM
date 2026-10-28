import {requireThat,distance} from '../private/export/numeric.mjs';
import {AdaptationMotion,machinePriming} from '../private/export/adaptation-motion.mjs';
import {validateSetup,toolBounds,startupPosition,startupRetracted} from '../machine/rules.mjs';
import {materialProcess,materialTool} from '../machine/filaments.mjs';
import {samePose,uprightPose,POSE_RESOLUTION} from '../path/pose.mjs';
import {placedPath} from '../path/placement.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {moveSeconds} from '../path/saampath.mjs';
import {pathSummary,pathInitialPosition,pathInitialPose} from '../path/curve-path.mjs';
import {machineTravel} from './machine-travel.mjs';

export const PREPARED_PATH_CONTRACT='saam-export-prepared/1';
const upright=pose=>!pose||samePose(pose,uprightPose());
const selection=(plan,machine,index)=>{
  const tool=materialTool(plan,index);
  return {filament:index,tool,process:materialProcess(plan,index),bounds:toolBounds(machine,tool)};
};
// These facts all require the same physical-action stream. Inspect it once;
// native/compact paths can be expensive to linearize even without deposition.
function inspectPath(path,plan,oriented,retreatMm){
  const poseMessage='Selected output cannot represent non-upright tool orientation.';
  requireThat(oriented||upright(pathInitialPose(path)),poseMessage);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let from=pathInitialPosition(path),deposits=false,primed=false,count=0;
  for(const {action,context} of machineTravel(path,{retreatMm})){
    count++;
    requireThat(oriented||upright(action.pose),poseMessage);
    requireThat(!(action.kind==='extrude'&&action.poseFrom&&action.pose&&
      action.pose.toolAxis.some((value,i)=>Math.abs(value-action.poseFrom.toolAxis[i])>POSE_RESOLUTION)),
      'Selected output does not support simultaneous stationary orientation and metered extrusion.');
    if(context.phase==='prime')primed=true;
    if(action.volumeMm3>0){
      deposits=true;
      const width=action.beadWidthMm??plan.process.lineWidthMm,height=action.normalHeightMm??action.gapMm??plan.process.layerMm;
      for(const point of action.kind==='move'?[from,action.to]:[from])for(let i=0;i<3;i++){
        min[i]=Math.min(min[i],point[i]-(i===2?height:width/2));max[i]=Math.max(max[i],point[i]+(i===2?0:width/2));
      }
    }
    if(action.kind==='move')from=action.to;
  }
  return {bounds:min.every(Number.isFinite)?{min,max}:pathSummary(path)?.boundsMm??null,deposits,count,prime:deposits&&!primed};
}
function* limitedFeed(start,actions,machine){
  const cursor={from:start};
  for(const action of actions){
    if(action.kind!=='move'){yield action;continue;}
    const length=distance(cursor.from,action.to),delta=action.to.map((v,i)=>Math.abs(v-cursor.from[i])),feed={speed:action.speedMmS};
    for(let i=0;i<3;i++)if(delta[i]>0)feed.speed=Math.min(feed.speed,machine.maxFeedMmS['xyz'[i]]*length/delta[i]);
    cursor.from=action.to;
    yield {...action,speedMmS:feed.speed,...(action.durationSeconds?{durationSeconds:Math.max(action.durationSeconds,length>0?moveSeconds(length,feed.speed):0)}:{})};
  }
}
function* drainActions(motion){
  const actions=motion.actions;motion.actions=[];yield* actions;
}
function adaptationMotion(start,plan,machine,block,oriented){
  return new AdaptationMotion({start,process:plan.process,retracted:startupRetracted(machine,plan),pose:block?.initialPose??null,
    ...(oriented&&block?.retreatMm?{retreatMm:block.retreatMm}:{})});
}

// The saved SAAMpath is independent of machine/output. This ephemeral path is
// the exact selected-machine motion sent into the program writer. The adapter
// declares whether it writes poses; its setup block may state the start pose
// and the posed-travel retreat (initialPose, retreatMm). The SAAMpath is moved
// onto the bed by the recipe's placement first. notes: what adaptation could not
// write as the profile asks (a shortened or omitted priming lane). onProgress
// hears travel planning, then the writer's consumption of the action stream.
export function prepareExportPath(saved,plan,machine,adapter,{onProgress}={}){
  validateSetup(plan,machine,{required:true,adapter});
  const oriented=adapter.poses===true,block=plan.setup[adapter.settings?.key];
  const path=placedPath(saved,plan.placement),retreatMm=block?.retreatMm;
  const inspection=inspectPath(path,plan,oriented,retreatMm);
  const bounds=toolBounds(machine,plan.setup.tool);
  const start=startupPosition(machine,plan,block);
  const deposited=inspection.bounds,model=pathSummary(path)?.boundsMm;
  const geometryBounds=model&&deposited?{min:model.min.map((v,i)=>Math.min(v,deposited.min[i])),
    max:model.max.map((v,i)=>Math.max(v,deposited.max[i]))}:model??deposited;
  const prime=inspection.prime;
  const priming=prime?machinePriming(adaptationMotion(start,plan,machine,block,oriented),machine,bounds,geometryBounds):null;
  const settings={path,plan,machine,bounds,start,block,oriented,geometryBounds,prime,retreatMm,written:onProgress?writingProgress(inspection.count,onProgress):null};
  const actions={*[Symbol.iterator](){yield* limitedFeed(start,adaptedActions(settings),machine);settings.written?.(inspection.count,true);}};
  const {placement:_placement,...source}=path;
  const prepared={...source,schema:PREPARED_PATH_CONTRACT,completion:{contract:PREPARED_PATH_CONTRACT},
    initialPosition:start,...(block?.initialPose?{initialPose:block.initialPose}:{}),
    actions,summary:{...pathSummary(path),boundsMm:geometryBounds},notes:priming?[priming]:[]};
  if(!oriented)delete prepared.initialPose;
  return prepared;
}

// Reports source actions consumed, at most every 256, then the final count.
function writingProgress(total,onProgress){
  return (completed,done=false)=>{if(done||completed%256===0)onProgress(done?{stage:'Packaging the file'}:{stage:'Writing the program',completed,total});};
}
function* adaptedActions({path,plan,machine,bounds,start,block,oriented,geometryBounds,prime,retreatMm,written}){
  const cursor={selected:{plan,tool:plan.setup.tool,process:plan.process,bounds},neutralFrom:pathInitialPosition(path),relocating:false};
  const motion=adaptationMotion(start,plan,machine,block,oriented);
  if(prime)machinePriming(motion,machine,bounds,geometryBounds);
  motion.phase='start';motion.layer=0;motion.operationId=null;
  motion.travel(pathInitialPosition(path),oriented?pathInitialPose(path)??null:null);
  yield* drainActions(motion);
  const debts=new Map([[cursor.selected.tool,motion.retraction]]);
  // Context is resolved only at the selected-machine boundary. These actions
  // are private prepared machine motion, never a persisted neutral SAAMpath.
  for(const {action:physical,context,index} of machineTravel(path,{retreatMm})){
    written?.(index);
    const original={...context,...physical};
    motion.context(original);
    if(original.kind==='toolChange'){
      requireThat(!Object.hasOwn(original,'tool'),
        'Neutral material changes must not select a physical tool.');
      const incoming=selection(plan,machine,original.filament);
      // A change to another tool is a tool swap. A same-nozzle change needs the output to
      // declare its own same-nozzle mode; how the machine performs it is the adapter's.
      const constraints=machine.outputs.find(o=>o.id===plan.output)?.constraints,sameNozzle=incoming.tool===cursor.selected.tool;
      requireThat(!sameNozzle||typeof constraints?.materialChangeMode==='string'&&constraints.materialChangeMode!=='tool-swap',
        'Selected output has no contract for this material change.');
      const lift=constraints?.toolChangeLiftMm;
      requireThat(Number.isFinite(lift)&&lift>0,'Selected output has no material-change clearance contract.');
      motion.retract();debts.set(cursor.selected.tool,motion.retraction);
      const lo=bounds.min.map((_,i)=>Math.max(cursor.selected.bounds.min[i],incoming.bounds.min[i]));
      const hi=bounds.max.map((_,i)=>Math.min(cursor.selected.bounds.max[i],incoming.bounds.max[i]));
      const z=Math.max(motion.position[2],motion.depositedMaxZ+lift);
      requireThat(lo.every((v,i)=>v<=hi[i])&&z<=hi[2],'Material change exceeds common nozzle clearance bounds.');
      motion.move([motion.position[0],motion.position[1],z],motion.process.zSpeedMmS);
      motion.move([Math.max(lo[0],Math.min(hi[0],motion.position[0])),Math.max(lo[1],Math.min(hi[1],motion.position[1])),z],motion.process.travelSpeedMmS);
      motion.append({...original,tool:incoming.tool});
      // A same-nozzle service primes the new material and hands it off with
      // its declared withdrawal. Ordinary tool reuse keeps the actual old debt.
      const debt=sameNozzle&&incoming.process.retractMm>0
        ?{filamentMm:incoming.process.retractMm,speedMmS:incoming.process.retractSpeedMmS}
        :sameNozzle?null:debts.get(incoming.tool)??null;
      motion.process=incoming.process;motion.retraction=debt;motion.pose=null;cursor.selected=incoming;
      debts.set(cursor.selected.tool,debt);cursor.relocating=true;yield* drainActions(motion);continue;
    }
    if(cursor.relocating&&original.kind==='move'&&original.volumeMm3===0){cursor.neutralFrom=original.to;continue;}
    if(cursor.relocating&&['retract','recover'].includes(original.kind))continue;
    if(cursor.relocating&&(original.kind==='move'||original.kind==='extrude'||original.stationaryRange)){
      motion.travel(cursor.neutralFrom);cursor.relocating=false;
    }
    if(original.kind==='move'){
      // The writer carries material when XYZ quantization collapses a deposit.
      if(original.volumeMm3>0&&distance(motion.position,cursor.neutralFrom)>ROUNDING_MM)motion.travel(cursor.neutralFrom);
      if(original.volumeMm3===0&&distance(motion.position,original.to)<ROUNDING_MM&&!(oriented&&original.pose)){cursor.neutralFrom=original.to;continue;}
      motion.position=[...original.to];motion.pose=original.pose??null;
      if(original.volumeMm3>0)motion.depositedMaxZ=Math.max(motion.depositedMaxZ,cursor.neutralFrom[2],original.to[2]);
      cursor.neutralFrom=original.to;
    }else if(original.kind==='retract'||original.kind==='recover'){
      requireThat(original.kind==='retract'?!motion.retracted:motion.retracted,
        'Retraction/recovery action disagrees with the current withdrawal state.');
      motion.retraction=original.kind==='retract'?{filamentMm:original.filamentMm,speedMmS:original.speedMmS}:null;
      debts.set(cursor.selected.tool,motion.retraction);
    }
    const action=oriented?original:original.pose?Object.fromEntries(Object.entries(original).filter(([key])=>key!=='pose')):original;
    motion.actions.push(action);yield* drainActions(motion);
  }
  if(cursor.relocating)motion.travel(cursor.neutralFrom);
  yield* drainActions(motion);
}
