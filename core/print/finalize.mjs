// A producer's fields run before any consumer sees its supporting deposition.
import {matchingModulations,finalizeModulatedResult} from '../path/modulation.mjs';
import {depositedBeadFrames} from '../path/deposited-curves.mjs';
import {republishDepositedBoundary} from '../path/finished-surface.mjs';
import {maximumPathAngle} from '../path/deposition.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {toolBounds} from '../machine/profile.mjs';
import {requireThat} from '../geom/tolerance.mjs';

function finalizedOperation(operation,plan,machine,result){
  const selected=operation.filament===undefined?plan:filamentPlan(plan,machine,operation.filament);
  const bounds=machine.motionChecks==='deferred'?null:toolBounds(machine,selected.setup.tool);
  let high=-Infinity;
  for(const stroke of operation.strokes){
    const displaced=matchingModulations(result,stroke.role,plan.modulations).some(m=>m.channel==='displacement');
    const angle=displaced?maximumPathAngle(stroke.points):0;
    requireThat(angle<=1e-7||machine.capabilities.includes('nonplanar')&&Number.isFinite(machine.nonplanar?.maxAngleDeg)&&angle<=machine.nonplanar.maxAngleDeg+1e-7,
      `Modulated operation ${operation.id} exceeds the machine's fixed-axis path slope limit.`);
    for(const [i,p] of stroke.points.entries()){
      const width=Math.max(stroke.segmentMetadata?.[i]?.beadWidthMm??stroke.beadWidthMm,
        stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm);
      requireThat(!bounds||p.every((v,axis)=>v>=bounds.min[axis]+(axis===2?0:width/2)-1e-8&&v<=bounds.max[axis]-(axis===2?0:width/2)+1e-8),
        `Modulated operation ${operation.id} exceeds the selected tool bounds.`);
      high=Math.max(high,p[2]);
    }
  }
  const clearanceZ=Math.max(operation.clearanceZ??-Infinity,high+selected.process.liftMm);
  // Coverage and direct-travel regions belong to the original coordinates.
  const {region,materialRegion,materialCoverage,travelPolicy,...rest}=operation;
  return {...rest,modulationPendingPublication:false,clearanceZ,connectNearby:false,
    travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>clearanceZ}};
}

export function finalizeDepositionResult(result,plan,machine){
  if(!plan.modulations?.modifiers.length||!result.operations.some(op=>op.strokes.some(stroke=>matchingModulations(result,stroke.role,plan.modulations).length)))return result;
  requireThat(!result.operations.some(op=>op.phase==='bridging'&&op.strokes.some(stroke=>matchingModulations(result,stroke.role,plan.modulations).some(m=>m.channel==='displacement'))),
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
