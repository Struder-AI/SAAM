// A producer's fields run before any consumer sees its supporting deposition.
import {matchingModulations,finalizeModulatedResult} from '../path/modulation.mjs';
import {depositedBeadFrames} from '../path/deposited-curves.mjs';
import {republishDepositedBoundary} from '../path/finished-surface.mjs';
import {maximumPathAngle} from '../path/deposition.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {toolBounds} from '../machine/profile.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';
import {validatePose} from '../path/pose.mjs';
import {prepareDepositionMotion} from '../machine/deposition-motion.mjs';

function finalizedOperation(operation,plan,machine,result){
  const selected=operation.filament===undefined?plan:filamentPlan(plan,machine,operation.filament);
  const bounds=machine.motionChecks==='deferred'?null:toolBounds(machine,selected.setup.tool);
  let high=-Infinity;
  for(const stroke of operation.strokes){
    if(stroke.stationaryExtrusion)requireThat(stroke.stationaryExtrusion.flowMm3S<=selected.process.maxFlowMm3S+1e-7,
      `Modulated operation ${operation.id} exceeds the selected stationary extrusion flow limit.`);
    const displaced=matchingModulations(result,stroke.role,plan.modulations,operation).some(m=>m.channel==='displacement');
    const oriented=!!stroke.poses;
    requireThat(!oriented||machine.capabilities.includes('tool-orientation'),`Modulated operation ${operation.id} needs tool-orientation support.`);
    if(oriented){
      requireThat(stroke.poses.length===stroke.points.length,`Modulated operation ${operation.id} has inconsistent pose samples.`);
      stroke.poses.forEach(validatePose);
      requireThat(machine.capabilities.includes('coordinated-rotary')||stroke.poses.every(p=>Math.abs(p.rotaryDeg)<1e-9),`Modulated operation ${operation.id} needs coordinated rotary support.`);
    }
    const angle=displaced&&!oriented?maximumPathAngle(stroke.points):0;
    requireThat(angle<=1e-7||machine.capabilities.includes('nonplanar')&&Number.isFinite(machine.nonplanar?.maxAngleDeg)&&angle<=machine.nonplanar.maxAngleDeg+1e-7,
      `Modulated operation ${operation.id} exceeds the machine's fixed-axis path slope limit.`);
    for(const [i,p] of stroke.points.entries()){
      const width=Math.max(stroke.segmentMetadata?.[i]?.beadWidthMm??stroke.beadWidthMm,
        stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm);
      requireThat(!bounds||p.every((v,axis)=>v>=bounds.min[axis]+(axis===2?0:width/2)-1e-8&&v<=bounds.max[axis]-(axis===2?0:width/2)+1e-8),
        `Modulated operation ${operation.id} exceeds the selected tool bounds.`);
      high=Math.max(high,p[2]);
      if(i){
        const length=distance(stroke.points[i-1],p),metadata=stroke.segmentMetadata?.[i-1];
        const speed=metadata?.speedMmS??stroke.speedMmS;
        const volume=stroke.volumesMm3?.[i-1]??length*stroke.beadAreaMm2;
        requireThat(Number.isFinite(speed)&&speed>0&&length>0,`Modulated operation ${operation.id} has invalid speed or a zero-length deposition segment.`);
        const seconds=length/speed;
        const flow=volume/seconds;
        requireThat(Number.isFinite(flow)&&flow<=selected.process.maxFlowMm3S+1e-7,
          `Modulated operation ${operation.id} requests ${flow.toFixed(4)} mm³/s; selected material limit is ${selected.process.maxFlowMm3S} mm³/s. Reduce speed, width or flow modulation.`);
        requireThat(p.every((v,axis)=>Math.abs(v-stroke.points[i-1][axis])/seconds<=machine.maxFeedMmS['xyz'[axis]]+1e-7),
          `Modulated operation ${operation.id} exceeds a commanded axis speed limit.`);
      }
    }
  }
  const clearanceZ=Math.max(operation.clearanceZ??-Infinity,high+selected.process.liftMm);
  // Coverage and direct-travel regions belong to the original coordinates.
  const {region,materialRegion,materialCoverage,travelPolicy,...rest}=operation;
  return {...rest,modulationPendingPublication:false,clearanceZ,connectNearby:false,
    travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>clearanceZ}};
}

export function finalizeDepositionResult(result,plan,machine){
  result=prepareDepositionMotion(result,machine);
  if(!plan.modulations?.modifiers.length||!result.operations.some(op=>op.strokes.some(stroke=>matchingModulations(result,stroke.role,plan.modulations,op).length)))return result;
  requireThat(!result.operations.some(op=>op.phase==='bridging'&&op.strokes.some(stroke=>matchingModulations(result,stroke.role,plan.modulations,op).some(m=>m.channel==='displacement'))),
    'Bridge attachment displacement is not supported; modulate supporting assignments before constructing the bridge.');
  const prepared={...result,operations:result.operations.map(op=>{
    const selected=op.filament===undefined?plan:filamentPlan(plan,machine,op.filament);
    return {...op,strokes:op.strokes.map(stroke=>({...stroke,beadWidthMm:stroke.beadWidthMm??selected.process.lineWidthMm}))};
  })};
  const answer=finalizeModulatedResult(depositedBeadFrames(prepared),plan.modulations);
  if(!answer.report.changed)return result;
  const changed=new Set(answer.report.changedOperations);
  const operations=answer.result.operations.map(op=>changed.has(op.id)?finalizedOperation(op,plan,machine,result):op);
  const finalized=republishDepositedBoundary({...answer.result,operations},{widthMm:plan.process.lineWidthMm});
  return {...finalized,report:{...result.report,modulation:answer.report}};
}

export function finalizeDepositionResults(results,plan,machine){
  return results.map(result=>finalizeDepositionResult(result,plan,machine));
}
