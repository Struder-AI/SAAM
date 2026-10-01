import {requireThat,distance} from '../private/toolpath/numeric.mjs';
// A producer's fields run before any consumer sees its supporting deposition.
import {matchingModulations,finalizeModulatedResult} from '../path/modulation.mjs';
import {depositedBeadFrames} from '../path/deposited-curves.mjs';
import {republishDepositedBoundary} from '../path/finished-surface.mjs';
import {filamentPlan} from '../machine/filaments.mjs';

import {validatePose} from '../path/pose.mjs';
import {prepareDepositionMotion,prepareReferenceMotion} from '../machine/deposition-motion.mjs';
import {resolveDepositionConnections} from '../path/deposition-connections.mjs';

function finalizedOperation(operation,plan,machine,result){
  const selected=operation.filament===undefined?plan:filamentPlan(plan,machine,operation.filament);
  let high=-Infinity;
  for(const stroke of operation.strokes){
    if(stroke.stationaryExtrusion)requireThat(stroke.stationaryExtrusion.flowMm3S<=selected.process.maxFlowMm3S+1e-7,
      `Modulated operation ${operation.id} exceeds the selected stationary extrusion flow limit.`);
    if(stroke.poses){
      requireThat(stroke.poses.length===stroke.points.length,`Modulated operation ${operation.id} has inconsistent pose samples.`);
      stroke.poses.forEach(validatePose);
    }
    for(const [i,p] of stroke.points.entries()){
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

      }
    }
  }
  const clearanceZ=Math.max(operation.clearanceZ??-Infinity,high+selected.process.liftMm);
  // Coverage and direct-travel regions belong to the original coordinates.
  const {region,materialRegion,materialCoverage,travelPolicy,...rest}=operation;
  return {...rest,modulationPendingPublication:false,clearanceZ,connectNearby:false,
    travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>clearanceZ}};
}

export function finalizeDepositionResult(result,plan,machine,{entryPosition}={}){
  result={...result,operations:result.operations.map(op=>({...op,nominalRank:op.nominalRank??op.rank}))};
  // A nominal region cannot prove a join safe after its bead geometry changes.
  // Freeze every operation's order here; all deposited material, including joins,
  // must exist before modulation and before any supporting-surface publication.
  const excludedOperationIds=plan.modulations?.modifiers.length?result.operations.filter(op=>op.strokes.some(stroke=>
    matchingModulations(result,stroke.role,plan.modulations,op).some(m=>['displacement','width','flow'].includes(m.channel)))).map(op=>op.id):[];
  if(result.operations.some(operation=>operation.strokes.some(stroke=>stroke.motionIntent)))result=prepareReferenceMotion(result,machine);
  result=resolveDepositionConnections(result,{excludedOperationIds,entryPosition});
  result=prepareDepositionMotion(result,machine);
  if(result.report?.depositionConnections?.count)result=republishDepositedBoundary(result,{widthMm:plan.process.lineWidthMm});
  if(!plan.modulations?.modifiers.length||!result.operations.some(op=>op.strokes.some(stroke=>matchingModulations(result,stroke.role,plan.modulations,op).length)))return result;
  const prepared={...result,operations:result.operations.map(op=>{
    const selected=op.filament===undefined?plan:filamentPlan(plan,machine,op.filament);
    return {...op,strokes:op.strokes.map(stroke=>({...stroke,beadWidthMm:stroke.beadWidthMm??selected.process.lineWidthMm}))};
  })};
  const answer=finalizeModulatedResult(depositedBeadFrames(prepared),plan.modulations);
  if(!answer.report.changed)return result;
  const changed=new Set(answer.report.changedOperations);
  const operations=answer.result.operations.map(op=>changed.has(op.id)?finalizedOperation(op,plan,machine,result):op);
  const candidate={...answer.result,operations};
  const finalized=answer.report.materialChanged?republishDepositedBoundary(candidate,{widthMm:plan.process.lineWidthMm}):candidate;
  return {...finalized,report:{...result.report,modulation:answer.report}};
}

// Finalization may split a construction into operations or courses. Recombining
// them must retain the evidence for every deposited connection and modifier.
export function combineFinalizedResults(result,parts){
  const report={...result.report},connections=parts.map(part=>part.report?.depositionConnections).filter(Boolean),
    modulations=parts.map(part=>part.report?.modulation).filter(Boolean);
  if(connections.length)report.depositionConnections={count:connections.reduce((n,r)=>n+r.count,0),volumeMm3:connections.reduce((n,r)=>n+r.volumeMm3,0),
    operationIds:connections.flatMap(r=>r.operationIds),excludedOperationIds:connections.flatMap(r=>r.excludedOperationIds??[])};
  if(modulations.length)report.modulation={...modulations[0],changed:modulations.some(m=>m.changed),
    materialChanged:modulations.some(m=>m.materialChanged),materialChangedOperations:modulations.flatMap(m=>m.materialChangedOperations??[]),
    operationModifiers:Object.assign({},...modulations.map(m=>m.operationModifiers??{})),maxExcursionMm:Math.max(...modulations.map(m=>m.maxExcursionMm??0)),
    changedOperations:modulations.flatMap(m=>m.changedOperations),modifiers:[...new Set(modulations.flatMap(m=>m.modifiers))]};
  return {...result,report,operations:parts.flatMap(part=>part.operations)};
}
