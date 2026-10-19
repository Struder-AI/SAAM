import {manufacturedSurfaceReadiness} from './surface-readiness.mjs';
import {isDeepStrictEqual} from 'node:util';
import {requireThat} from '../private/toolpath/numeric.mjs';
// Trace can read named predecessor deposition; Slice reads prepared regions.
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
  for(const key of ['layers','skippedLayers','loops','fillRows','uncoveredContactSamples','substrateContactQueries'])report[key]=sliceResults.reduce((sum,r)=>sum+(r.report[key]??0),0);
  const notes=sliceResults.flatMap(r=>r.report.notes??[]);
  if(notes.length)report.notes=notes;
  const contacts=sliceResults.filter(r=>r.report.contactSamples);
  if(contacts.length){report.contactSamples=contacts.reduce((n,r)=>n+r.report.contactSamples,0);report.minContactGapMm=Math.min(...contacts.map(r=>r.report.minContactGapMm));report.maxContactGapMm=Math.max(...contacts.map(r=>r.report.maxContactGapMm));}
  const layers=sliceResults.flatMap(r=>r.referenceStack.layers);
  return combineFinalizedResults({...sliceResults[0],report,stackLayers:layers,
    referenceStack:{...record.referenceStack,layers},finishedSurfaces:sliceResults.flatMap(r=>r.finishedSurfaces??[])},sliceResults);
}

export function constructDepositionWork(node,completed,{plan,onProgress,shells=[],contexts=[]}){
  if(node.kind==='completion')return {id:node.key,operations:[],report:{}};
  const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
  // Trace consumes only named predecessors. Slice consumes prepared geometry;
  // its optional substrate barrier needs no unrelated completed deposition.
  const predecessors=[];
  if(node.kind==='trace'&&!node.construct||node.kind==='slice'&&assignment.substrate){
    const required=new Set(),pending=[...node.requires];
    while(pending.length){
      const key=pending.pop();if(required.has(key))continue;required.add(key);
      const prior=completed.get(key);if(prior){predecessors.push(prior);for(const dependency of prior.node.requires)pending.push(dependency);}
    }
    predecessors.sort((a,b)=>(a.ordinal??0)-(b.ordinal??0));
  }
  let result;
  if(node.construct)result=node.construct({node,plan,onProgress,materialReadiness:footprints=>manufacturedSurfaceReadiness(node.materialContexts??contexts,footprints,{part:node.part,exclude:node.sourceId,side:'upper'})});
  else if(node.kind==='slice'){
    result=sliceContextResult(node.record,{layerIndex:node.index});
  }else if(node.kind==='trace'){
    const results=predecessors.filter(item=>item.node.kind!=='completion').map(item=>item.result);
    if(node.context.assignment.source)result=sourceCurveResult(node,completed,{plan,results,shells});
    else result=curveAssignmentResult(node.context.assignment,{plan,modelResults:results,
      references:depositionReferences(shells,results)});
  }else if(node.kind==='inject')result=injectionResult(node.context.assignment,{plan});
  else throw new Error(`Unsupported deposition construction ${node.kind}.`);
  const pose=assignment.toolPose??(assignment.source?completed.get(node.parentKey)?.node.record.spec.settings.toolPose:null);
  const motionIntent=pose?{kind:'derived-pose',alignToSliceNormal:pose.alignToSliceNormal}:null;
  const selected={...result,...(assignment.edgeAfter?{edgeAfter:assignment.edgeAfter}:{}),report:{...result.report,depositionFamily:node.kind,construction:result.report.construction??(node.kind==='slice'?undefined:node.construction),owner:node.sourceId,part:node.part},operations:result.operations.map(op=>({...op,part:node.part,...(motionIntent&&!result.depositionFinalized?{strokes:op.strokes.map(stroke=>({...stroke,motionIntent}))}:{}),
    after:[...new Set([...(op.after??[]),...(assignment.dependencies?.after??assignment.after??[]),...(node.record?.prerequisites??[]),...(node.layer?.prerequisites??[]),
      ...(assignment.substrate&&(node.kind!=='slice'||!predecessors.some(item=>item.node.record===node.record&&item.result.operations.length))?[assignment.substrate]:[])])],...(assignment.filament===null?{}:{filament:assignment.filament})}))};
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
  const traced=authoredCurveResult(authored,{plan,process:assignment.process?{...source.process,...assignment.process}:source.process,references,modelResults:results,sourceLayer:{...source,referenceStack,sliceMember:produced.sliceMember===true}});
  return {...traced,report:{...traced.report,...produced.report,notes:[...(traced.report.notes??[]),...(produced.report?.notes??[])],source:assignment.source,sourceLayer:node.index,sourceStack:record.spec.id,...(source.sectionReport?{sourceSection:source.sectionReport}:{})}};
}

// Construction follows material prerequisites only. It has no nozzle,
// execution order, travel, cooling or motion-action state.
export function constructDepositionResults(args,contexts){
  const {nodes,curveSources,retainedWork=new Map()}=args,completed=new Map();
  const work=new Map(nodes.map((node,ordinal)=>[node.key,{node,ordinal,remaining:node.requires.length}])),dependents=new Map();
  for(const entry of work.values())for(const key of entry.node.requires){
    if(!dependents.has(key))dependents.set(key,[]);dependents.get(key).push(entry);
  }
  for(const key of retainedWork.keys())if(!work.has(key))retainedWork.delete(key);
  // Only retries compare inputs. Material ownership and contact preparation
  // can change even without an explicit graph edge. Compare shared records
  // once per attempt, rather than once for every layer that uses them.
  const comparisons=new WeakMap();
  const sameInput=(a,b)=>{
    if(a===b)return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object')return isDeepStrictEqual(a,b);
    let peers=comparisons.get(a);if(!peers){peers=new WeakMap();comparisons.set(a,peers);}
    if(!peers.has(b))peers.set(b,isDeepStrictEqual(a,b));
    return peers.get(b);
  };
  let ready=nodes.filter(node=>!node.requires.length);
  while(ready.length){
    const next=[];
    for(const node of ready){
      const inputs={...node,...(node.construct?{materialContexts:node.materialContexts??contexts}:{}),
        ...(node.context?{context:{...node.context}}:{}),...(node.record?{record:{...node.record}}:{})};
      const prior=retainedWork.get(node.key);
      const reusable=prior&&Object.keys(inputs).length===Object.keys(prior.node).length&&
        Object.keys(inputs).every(key=>Object.hasOwn(prior.node,key)&&sameInput(prior.node[key],inputs[key]))&&
        node.requires.every((key,index)=>prior.producers[index]===completed.get(key).result);
      args.onProgress?.({stage:reusable?'Reusing deposition':'Constructing deposition',assignment:node.sourceId,layer:node.index,completed:completed.size,total:nodes.length});
      const result=reusable?prior.result:assignmentWork(node,()=>{
        const raw=constructDepositionWork(node,completed,{...args,contexts}),finalized=finalizeDepositionResult(raw,args.plan);
        return node.kind==='completion'?finalized:publishDepositionWork(node,republishDepositedBoundary(finalized,{widthMm:args.plan.process.lineWidthMm}));
      });
      args.generation?.captureResult(node,result);
      completed.set(node.key,{node,result,ordinal:completed.size});
      // Reference preparation replaces these fields on mutable contexts. Keep
      // the inputs used here, not a handle that the next attempt can rewrite.
      retainedWork.set(node.key,{node:inputs,result,producers:node.requires.map(key=>completed.get(key).result)});
      for(const entry of dependents.get(node.key)??[])if(--entry.remaining===0)next.push(entry);
    }
    // Keep authored order within each ready frontier, as before. Discovering
    // that frontier now visits only the edges released by completed work.
    ready=next.sort((a,b)=>a.ordinal-b.ordinal).map(entry=>entry.node);
  }
  if(completed.size<nodes.length){
    const blocked=nodes.filter(node=>!completed.has(node.key));
    throw new AssignmentFailure(blocked[0],Error('Construction dependencies are missing or cyclic: '+blocked.map(node=>node.key).join(', ')));
  }
  const results=[],slices=new Map(),sources=new Map(),constructions=[];
  for(const node of nodes){
    const result=completed.get(node.key).result;
    if(node.kind==='slice'){
      if(!slices.has(node.record))slices.set(node.record,[]);slices.get(node.record).push(result);
    }else if(node.kind!=='completion'){
      if(node.context?.assignment.source){
        if(!sources.has(node.sourceId))sources.set(node.sourceId,[]);sources.get(node.sourceId).push(result);
      }else constructions.push(result);
    }
  }
  for(const record of contexts){
    const result=combineSliceResults(record,slices.get(record)??[]);
    results.push(result);
  }
  results.push(...constructions);
  for(const context of curveSources){
    const parts=sources.get(context.assignment.id)??[];
    if(parts.length)results.push(combineFinalizedResults({id:context.assignment.id,report:{construction:'curves',depositionFamily:'trace',source:context.assignment.source,owner:context.assignment.id,part:context.assignment.part,
      layers:parts.filter(part=>part.report.skippedLayer===undefined).length,skippedLayers:parts.filter(part=>part.report.skippedLayer!==undefined).length,strokes:parts.reduce((sum,part)=>sum+(part.report.strokes??0),0),lengthMm:parts.reduce((sum,part)=>sum+(part.report.lengthMm??0),0),volumeMm3:parts.reduce((sum,part)=>sum+(part.report.volumeMm3??0),0),
      notes:parts.flatMap(part=>part.report.notes??[]),layerReports:parts.map(part=>part.report)}},parts));
  }
  const resultLayers=new Set(results.flatMap(result=>result.operations.map(op=>op.layerId)).filter(id=>id!==null&&id!==undefined));
  return {results,summary:{layers:resultLayers.size,instances:results.map(result=>({id:result.id,...result.report}))}};
}
