import {reconcileAuthoredCorrespondence} from '../path/authored-curves.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {moveSeconds} from '../path/saampath.mjs';
// A producer's fields run before any consumer sees its supporting deposition.
import {matchingModulations,finalizeModulatedResult,combineModulationSampling} from '../path/modulation.mjs';
import {depositedBeadFrames} from '../path/deposited-curves.mjs';
import {materialProcess} from '../machine/filaments.mjs';

import {validatePose} from '../path/pose.mjs';
import {prepareDepositionMotion,prepareReferenceMotion} from '../path/deposition-motion.mjs';
import {resolveDepositionConnections} from '../path/deposition-connections.mjs';
import {retainConstructionCurves} from '../path/construction-curves.mjs';
import {traceContactNotes} from '../path/contact-curves.mjs';

function finalizedOperation(operation){
  let high=-Infinity;
  for(const stroke of operation.strokes){
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
        // A zero-length segment moves nowhere; planning skips it. Speeds at or
        // below zero pass with an unknown time; a non-finite one is a SAAM fault.
        if(!length)continue;
        requireThat(Number.isFinite(speed),`Modulated operation ${operation.id} has a non-finite deposition speed.`);
        const seconds=moveSeconds(length,speed);
        const flow=volume/seconds;
        requireThat(Number.isFinite(flow)&&flow>=0,`Modulated operation ${operation.id} produced invalid deposition flow.`);

      }
    }
  }
  // Coverage belongs to the original coordinates. Scheduling derives clearance
  // from the new material height and its resolved process, after Bundle saves it.
  const {region,materialRegion,materialCoverage,materialGeometry,clearanceZ,...rest}=operation;
  return {...rest,modulationPendingPublication:false,connectNearby:false,
    materialGeometry:{kind:'bounds',maxZ:high}};
}

export function finalizeDepositionResult(result,plan,{authored=null}={}){
  if(result.depositionFinalized)return result;
  const material=retainConstructionCurves(finalizeMaterial(result,plan));
  const reconciled=reconcileAuthoredCorrespondence(material,authored);
  return traceContactNotes({...reconciled,depositionFinalized:true});
}

function finalizeMaterial(result,plan){
  result={...result,operations:result.operations.map(op=>({...op,nominalRank:op.nominalRank??op.rank}))};
  // A nominal region cannot prove a join safe after its bead geometry changes.
  // Freeze every operation's order here; all deposited material, including joins,
  // must exist before modulation and before any supporting-surface publication.
  const excludedOperationIds=plan.modulations?.modifiers.length?result.operations.filter(op=>op.strokes.some(stroke=>
    matchingModulations(result,stroke.role,plan.modulations,op).some(m=>['displacement','width','flow'].includes(m.channel)))).map(op=>op.id):[];
  if(result.operations.some(operation=>operation.strokes.some(stroke=>stroke.motionIntent)))result=prepareReferenceMotion(result);
  result=resolveDepositionConnections(result,{excludedOperationIds});
  result=prepareDepositionMotion(result);
  result=depositedBeadFrames(result);
  result=retainConstructionCurves(result);
  if(!plan.modulations?.modifiers.length||!result.operations.some(op=>op.strokes.some(stroke=>matchingModulations(result,stroke.role,plan.modulations,op).length)))return result;
  const prepared={...result,operations:result.operations.map(op=>{
    const selected=op.filament===undefined?plan:{...plan,process:materialProcess(plan,op.filament)};
    return {...op,strokes:op.strokes.map(stroke=>({...stroke,beadWidthMm:stroke.beadWidthMm??selected.process.lineWidthMm}))};
  })};
  const answer=finalizeModulatedResult(prepared,plan.modulations);
  if(!answer.report.changed)return result;
  const changed=new Set(answer.report.changedOperations);
  const operations=answer.result.operations.map(op=>changed.has(op.id)?finalizedOperation(op):op);
  const candidate={...answer.result,operations};
  return {...candidate,report:{...result.report,modulation:answer.report}};
}

// Finalization may split a construction into operations or batches. Recombining
// them must retain the evidence for every deposited connection and modifier.
export function combineFinalizedResults(result,parts){
  const report={...result.report},connections=parts.map(part=>part.report?.depositionConnections).filter(Boolean),
    modulations=parts.map(part=>part.report?.modulation).filter(Boolean);
  const advisories=[...new Map([...(report.advisories??[]),...parts.flatMap(part=>part.report?.advisories??[])].map(item=>[JSON.stringify(item),item])).values()];
  if(advisories.length){report.advisories=advisories;report.notes=[...new Set([...(report.notes??[]),...advisories.map(item=>item.message)])];}
  if(connections.length)report.depositionConnections={count:connections.reduce((n,r)=>n+r.count,0),volumeMm3:connections.reduce((n,r)=>n+r.volumeMm3,0),
    operationIds:connections.flatMap(r=>r.operationIds),excludedOperationIds:connections.flatMap(r=>r.excludedOperationIds??[])};
  if(modulations.length)report.modulation={...modulations[0],changed:modulations.some(m=>m.changed),
    materialChanged:modulations.some(m=>m.materialChanged),materialChangedOperations:modulations.flatMap(m=>m.materialChangedOperations??[]),
    operationModifiers:Object.assign({},...modulations.map(m=>m.operationModifiers??{})),maxExcursionMm:Math.max(...modulations.map(m=>m.maxExcursionMm??0)),
    changedOperations:modulations.flatMap(m=>m.changedOperations),modifiers:[...new Set(modulations.flatMap(m=>m.modifiers))],
    ...(modulations.some(m=>m.sampling)?{sampling:combineModulationSampling(modulations.map(m=>m.sampling))}:{})};
  return {...result,report,logicalAfter:parts.flatMap(part=>part.logicalAfter??[]),depositionFinalized:parts.every(part=>part.depositionFinalized),operations:parts.flatMap(part=>part.operations)};
}
