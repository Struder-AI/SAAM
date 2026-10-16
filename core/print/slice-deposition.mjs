import {requireThat} from '../private/toolpath/numeric.mjs';
// Construct prepared work. Private contact adaptation can use predecessor beads;
// extensions receive prepared inputs, and authored rank never becomes run order.
import {sliceContextResult} from "./slices.mjs";
import {finalizeDepositionResult,combineFinalizedResults} from './finalize.mjs';
import {injectionResult} from './injection.mjs';
import {curveAssignmentResult,depositionReferences,authoredCurveResult,validateCurveAssignment} from './curves.mjs';
import {publishFinishedBoundary,republishDepositedBoundary} from '../path/finished-surface.mjs';
import {AssignmentFailure,assignmentWork} from './assignment-failure.mjs';
export {AssignmentFailure} from './assignment-failure.mjs';
export {prepareDepositionWork} from './deposition-work.mjs';


function combineSliceResults(record,sliceResults){
  if(!sliceResults.length)return {id:record.spec.id,report:record.context.report,operations:[],referenceStack:{...record.referenceStack,layers:[]}};
  if(sliceResults.length===1)return sliceResults[0];
  const report={...sliceResults[0].report,...record.context.report};
  report.topMm=sliceResults.reduce((top,result)=>result.operations.reduce((top,operation)=>operation.strokes.reduce((top,stroke)=>stroke.points.reduce((top,p)=>Math.max(top,p[2]),top),top),top),-Infinity);
  for(const key of ['layers','skippedLayers','areaMm2','loops','fillRows','solidAreaMm2','areaChart2','solidAreaChart2','uncoveredContactSamples','substrateContactQueries'])report[key]=sliceResults.reduce((sum,r)=>sum+(r.report[key]??0),0);
  const notes=sliceResults.flatMap(r=>r.report.notes??[]);
  if(notes.length)report.notes=notes;
  const contacts=sliceResults.filter(r=>r.report.contactSamples);
  if(contacts.length){report.contactSamples=contacts.reduce((n,r)=>n+r.report.contactSamples,0);report.minContactGapMm=Math.min(...contacts.map(r=>r.report.minContactGapMm));report.maxContactGapMm=Math.max(...contacts.map(r=>r.report.maxContactGapMm));}
  const layers=sliceResults.flatMap(r=>r.referenceStack.layers);
  return combineFinalizedResults({...sliceResults[0],report,stackLayers:layers,
    referenceStack:{...record.referenceStack,layers},finishedSurfaces:sliceResults.flatMap(r=>r.finishedSurfaces??[])},sliceResults);
}

export function constructDepositionWork(node,completed,{plan,onProgress,shells=[]}){
  const required=new Set();
  const collect=key=>{if(required.has(key))return;required.add(key);for(const prior of completed.get(key)?.node.requires??[])collect(prior);};
  node.requires.forEach(collect);
  const predecessors=[...completed.values()].filter(item=>required.has(item.node.key)),samePart=predecessors.filter(item=>item.node.part===node.part);
  const prerequisiteIds=key=>{const prior=completed.get(key);return prior.result.operations.length?prior.result.operations.map(op=>op.id):prior.node.requires.flatMap(prerequisiteIds);};
  // Geometry/reference prerequisites prepare construction; only explicit
  // process prerequisites become execution barriers. Scheduling derives the
  // physical support and access edges from the completed beads.
  const after=[...new Set((node.executionRequires??node.requires).flatMap(prerequisiteIds))];
  let result;
  if(node.construct)result=node.construct({node,plan,onProgress});
  else if(node.kind==='slice'){
    result=sliceContextResult(node.record,{layerIndex:node.index});
  }else if(node.kind==='trace'){
    const results=predecessors.map(item=>item.result);
    if(node.context.assignment.source)result=sourceCurveResult(node,completed,{plan,results,shells});
    else result=curveAssignmentResult(node.context.assignment,{plan,modelResults:results,
      references:depositionReferences(shells,results)});
  }else if(node.kind==='inject')result=injectionResult(node.context.assignment,{plan});
  else throw new Error(`Unsupported deposition construction ${node.kind}.`);
  const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
  const pose=assignment.toolPose??(assignment.source?completed.get(node.parentKey)?.node.record.spec.settings.toolPose:null);
  const motionIntent=pose?{kind:'derived-pose',alignToSliceNormal:pose.alignToSliceNormal}:null;
  const selected={...result,report:{...result.report,...node.report,depositionFamily:node.kind,construction:result.report.construction??(node.kind==='slice'?undefined:node.construction),owner:node.sourceId,part:node.part,...(node.dependencyNotes?.length?{notes:[...(result.report.notes??[]),...(node.report?.notes??[]),...node.dependencyNotes]}:{})},operations:result.operations.map(op=>({...op,part:node.part,...(motionIntent&&!result.depositionFinalized?{strokes:op.strokes.map(stroke=>({...stroke,motionIntent}))}:{}),
    after:[...new Set([...(op.after??[]),...after,...(assignment.dependencies?.after??assignment.after??[])])],...(assignment.filament===null?{}:{filament:assignment.filament})}))};
  return selected;
}

export function publishDepositionWork(node,result){
  const publication=node.kind==='slice'?node.record.context:node.construction==='curves'?node.context:null;
  return publication?.shell?republishDepositedBoundary(publishFinishedBoundary(result,{shell:publication.shell}),{widthMm:publication.process.lineWidthMm}):result;
}

// A generation-time source consumes prepared layer geometry and material intent.
// It has no access to the source's completed deposition or modulation results.
function sourceCurveResult(node,completed,{plan,results,shells}){
  const assignment=node.context.assignment;
  validateCurveAssignment(assignment);
  if(node.context.sourceError)throw node.context.sourceError;
  requireThat(node.context.curveSource&&typeof node.context.curveSource.constructLayer==='function','Trace source entry must provide constructLayer.');
  const parent=completed.get(node.parentKey);
  requireThat(parent,'Trace source names an absent Slice assignment or different part.');
  const record=parent.node.record,layer=record.preparedLayers?.get(node.index);
  requireThat(layer,'Trace source needs a prepared Slice layer; the selected source has no resolved layer geometry.');
  const prepared=node.context.preparedLayers?.get(record.spec.id+':'+node.index);
  requireThat(prepared,'Trace source curves must be prepared before construction.');
  const {source,produced,authored}=prepared;
  const referenceStack={...record.referenceStack,layers:record.spec.layers.map(layer=>record.preparedLayers?.get(layer.index)??layer)};
  const references={...depositionReferences(shells,results),['slice:'+record.spec.id]:referenceStack};
  const traced=authoredCurveResult(authored,{plan,process:assignment.process?{...source.process,...assignment.process}:source.process,references,modelResults:results,sourceLayer:{...source,referenceStack}});
  return {...traced,report:{...traced.report,...produced.report,notes:[...(traced.report.notes??[]),...(produced.report?.notes??[])],source:assignment.source,sourceLayer:node.index,sourceStack:record.spec.id,...(source.sectionReport?{sourceSection:source.sectionReport}:{})}};
}

// Construction follows material prerequisites only. It has no nozzle,
// execution order, travel, cooling or motion-action state.
export function constructDepositionResults(args,contexts){
  const {nodes,curveSources}=args,completed=new Map();
  while(completed.size<nodes.length){
    const ready=nodes.filter(node=>!completed.has(node.key)&&node.requires.every(key=>completed.has(key)));
    if(!ready.length){
      const blocked=nodes.find(node=>!completed.has(node.key));
      throw new AssignmentFailure(blocked,Error('Construction dependencies are missing or cyclic: '+nodes.filter(node=>!completed.has(node.key)).map(node=>node.key).join(', ')));
    }
    for(const node of ready){
      args.onProgress?.({stage:'Constructing deposition',assignment:node.sourceId,layer:node.index,completed:completed.size,total:nodes.length});
      const result=assignmentWork(node,()=>{
        const raw=constructDepositionWork(node,completed,args),finalized=finalizeDepositionResult(raw,args.plan);
        return publishDepositionWork(node,republishDepositedBoundary(finalized,{widthMm:args.plan.process.lineWidthMm}));
      });
      completed.set(node.key,{node,result});
    }
  }
  const results=[];
  for(const record of contexts){
    const sliceResults=nodes.filter(node=>node.kind==='slice'&&node.record===record).map(node=>completed.get(node.key).result);
    const result=combineSliceResults(record,sliceResults);
    results.push(result);
  }
  results.push(...nodes.filter(node=>node.kind!=='slice'&&!node.context?.assignment.source).map(node=>completed.get(node.key).result));
  for(const context of curveSources){
    const parts=nodes.filter(node=>node.context?.assignment.source&&node.sourceId===context.assignment.id).map(node=>completed.get(node.key).result);
    if(parts.length)results.push(combineFinalizedResults({id:context.assignment.id,report:{construction:'curves',depositionFamily:'trace',source:context.assignment.source,owner:context.assignment.id,part:context.assignment.part,
      layers:parts.filter(part=>part.report.skippedLayer===undefined).length,skippedLayers:parts.filter(part=>part.report.skippedLayer!==undefined).length,strokes:parts.reduce((sum,part)=>sum+(part.report.strokes??0),0),lengthMm:parts.reduce((sum,part)=>sum+(part.report.lengthMm??0),0),volumeMm3:parts.reduce((sum,part)=>sum+(part.report.volumeMm3??0),0),
      notes:parts.flatMap(part=>part.report.notes??[]),layerReports:parts.map(part=>part.report)}},parts));
  }
  const resultLayers=new Set(results.flatMap(result=>result.operations.map(op=>op.layerId)).filter(id=>id!==null&&id!==undefined));
  return {results,summary:{layers:resultLayers.size,instances:results.map(result=>({id:result.id,...result.report}))}};
}
