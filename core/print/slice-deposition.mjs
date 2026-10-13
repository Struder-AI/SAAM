import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
// Resolve ownership and prerequisites before selecting work. Every construction
// consumes finalized predecessor beads; authored rank never becomes run order.
import {sliceContextResult} from "./slices.mjs";
import {finalizeDepositionResult,combineFinalizedResults} from './finalize.mjs';
import {injectionResult} from './injection.mjs';
import {curveAssignmentResult,depositionReferences,authoredCurveResult,validateCurveAssignment} from './curves.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {publishFinishedBoundary,republishDepositedBoundary} from '../path/finished-surface.mjs';
import {depositedBeadSegments} from '../path/deposited-curves.mjs';
import {translateSlice} from '../geom/slice.mjs';


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

// Expand construction and recipe constraints once to exact work-node keys.
export function prepareDepositionWork(contexts,constructions=[],work=[],dependencies=()=>({dependencies:[],notes:[]}),curveSources=[]){
  const baseNodes=contexts.flatMap(record=>{
    const units=record.referenceStack.constructTogether?[{index:null,rank:record.layerOrder[0]?.rank??0}]:record.layerOrder;
    return units.map((unit,i)=>({key:`slice:${record.spec.id}:${unit.index}`,kind:'slice',construction:record.spec.settings.construction??'slice',sourceId:record.owner.assignment.id,part:record.owner.part,
      construct:record.constructWork,providesSurface:record.providesSurface,nominalRank:unit.rank,index:unit.index,record,first:i===0,requires:i?[`slice:${record.spec.id}:${units[i-1].index}`]:[]}));
  }).concat(constructions.map(context=>({key:`${context.assignment.construction}:${context.assignment.id}`,kind:context.kind??assignmentFamily(context.assignment),construction:context.assignment.construction,
    construct:context.construct,providesSurface:context.providesSurface,sourceId:context.assignment.id,part:context.assignment.part??null,nominalRank:context.endMm??context.shell?.bounds.max[2]??0,context,requires:[]}))).concat(work);
  const followers=curveSources.flatMap(context=>{
    const source=context.assignment.source,matching=baseNodes.filter(node=>node.kind==='slice'&&(node.sourceId===source.assignment||node.record.spec.id===source.assignment)&&(context.assignment.part===null||context.assignment.part===node.part));
    if(!matching.length)return [{key:'curves:'+context.assignment.id,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:context.assignment.part,context,nominalRank:0,requires:[]}];
    return matching.map(parent=>({key:'curves:'+context.assignment.id+':'+parent.record.spec.id+':'+parent.index,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:parent.part,
      context:{...context,assignment:{...context.assignment,part:parent.part}},parentKey:parent.key,index:parent.index,nominalRank:parent.nominalRank,requires:[parent.key]}));
  });
  const nodes=baseNodes.map(node=>({...node,requires:[...node.requires,...followers.filter(follower=>node.requires.includes(follower.parentKey)).map(follower=>follower.key)]})).concat(followers);
  const declared=nodes.map(node=>assignmentWork(node,()=>{
    const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
    const needs=new Set(node.requires),defaults=new Set();
    const references=node.construction==='curves'?[assignment.repeat?.stack,...assignment.curves.map(curve=>curve.uv?.reference).filter(reference=>reference&&reference.kind!=='patch').map(reference=>reference.assignment)].filter(Boolean):[];
    for(const other of nodes){
      if(other===node)continue;
      const offers=other.kind==='slice'?other.record.spec.settings:other.context.assignment;
      if(other.sourceId!==node.sourceId&&(assignment.dependencies?.afterParts.includes(other.part)||offers.dependencies?.beforeParts.includes(node.part)))needs.add(other.key);
      if(node.kind==='slice'&&node.first&&node.record.contact){
        const source=node.record.contact.source;
        if(source!==null?other.sourceId===source&&other.part===node.part&&(other.kind!=='slice'||other.record.reference||other.nominalRank<=node.nominalRank+PRINT_RESOLUTION_MM):
          other.part===node.part&&other.sourceId!==node.sourceId&&!(other.kind==='slice'&&other.record.contact)&&other.nominalRank<=node.nominalRank+PRINT_RESOLUTION_MM)needs.add(other.key);
      }
      if(references.includes(other.sourceId)||references.includes(other.record?.spec.id))needs.add(other.key);
      if(node.kind==='slice'&&node.record.reference&&other.part===node.part){
        if(node.record.reference.source!==null&&other.sourceId===node.record.reference.source)needs.add(other.key);
        if(node.record.reference.source===null&&(other.providesSurface||other.kind==='slice'&&!other.record.reference))defaults.add(other.key);
      }
      if(node.kind==='trace'&&assignment.curves?.some(c=>c.contact)&&(other.kind!=='trace'||nodes.indexOf(other)<nodes.indexOf(node)))defaults.add(other.key);

    }
    if(node.kind==='slice'&&node.first&&node.record.contact?.source!==null&&node.record.contact?.source!==undefined)
      if(!nodes.some(other=>other.sourceId===node.record.contact.source&&other.part===node.part))throw new AssignmentFailure(node,Error('Contact source names an absent producer or a different part.'));
    const declaredDependencies=assignmentWork(node,()=>dependencies(node,nodes));
    for(const key of declaredDependencies.dependencies)needs.add(key);
    return {...node,requires:[...needs],defaults:[...defaults],dependencyNotes:declaredDependencies.notes};
  }));
  // Unnamed substrate/bridge inputs use available producers, excluding explicit
  // downstream consumers. Explicit recipe edges always retain their meaning.
  const dependsOn=(key,target,seen=new Set())=>{
    if(key===target)return true;if(seen.has(key))return false;seen.add(key);
    return (declared.find(node=>node.key===key)?.requires??[]).some(prior=>dependsOn(prior,target,seen));
  };
  return declared.map(({defaults,...node})=>({...node,requires:[...new Set([...node.requires,...defaults.filter(key=>!dependsOn(key,node.key))])]}));
}

export function constructDepositionWork(node,completed,{plan,onProgress,shells=[]}){
  const substrateAdaptation=plan.experimental.substrateAdaptation;
  const required=new Set();
  const collect=key=>{if(required.has(key))return;required.add(key);for(const prior of completed.get(key)?.node.requires??[])collect(prior);};
  node.requires.forEach(collect);
  const predecessors=[...completed.values()].filter(item=>required.has(item.node.key)),samePart=predecessors.filter(item=>item.node.part===node.part);
  const prerequisiteIds=key=>{const prior=completed.get(key);return prior.result.operations.length?prior.result.operations.map(op=>op.id):prior.node.requires.flatMap(prerequisiteIds);};
  const after=[...new Set(node.requires.flatMap(prerequisiteIds))];
  let result;
  if(node.construct)result=node.construct({node,predecessors,samePart,after,plan,onProgress,substrateAdaptation});
  else if(node.kind==='slice'){
    const record=node.record,layer=record.spec.layers.find(layer=>layer.index===node.index)??record.spec.layers[0];
    const own=samePart.filter(item=>item.node.kind==='slice'&&item.node.record.stackId===record.stackId&&item.node.index===node.index-1);
    const contacts=substrateAdaptation?own.filter(item=>item.result.report.modulation?.materialChanged).flatMap(item=>depositedBeadSegments(item.result.operations,{widthMm:item.node.record.context.process.lineWidthMm})):[];
    const source=node.first?record.contact?.source:null;
    // Point injection has no deposited surface chart. Its prerequisite is real,
    // but an empty reference must not change a following Slice's contact frame.
    const candidates=substrateAdaptation?samePart.filter(item=>item.node.kind!=='inject'&&item.node.sourceId!==node.sourceId&&(!source||item.node.sourceId===source)):[];
    const contactFragments=candidates.map(item=>({layers:(item.result.referenceStack?.layers??[]).map(layer=>({...layer,
      region:layer.region??(layer.slice?.kind==='plane'?layer.curves?.filter(curve=>curve.closed).map(curve=>curve.points.map(point=>{
        const relative=point.map((v,k)=>v-layer.slice.origin[k]);return [layer.slice.xAxis,layer.slice.yAxis].map(axis=>axis.reduce((sum,v,k)=>sum+v*relative[k],0));
      })):undefined)})),operations:item.result.operations,
      widthMm:item.node.kind==='slice'?item.node.record.context.process.lineWidthMm:(item.node.context.process??plan.process).lineWidthMm}));
    const seedSegments=record.spec.settings.fillOrder?.kind==='fronts'?samePart.filter(item=>item.node.sourceId!==node.sourceId||item.node.index===node.index-1).flatMap(item=>depositedBeadSegments(item.result.operations)):[];
    const predecessorReference=substrateAdaptation&&node.first&&record.contact?record.contact.predecessorReference:
      contactFragments.length&&layer.slice?translateSlice(layer.slice,(layer.direction??layer.slice.normal).map(v=>-v*layer.translationMm)):null;
    result=sliceContextResult(record,{layerIndex:node.index,priorResults:samePart.map(item=>item.result),contactSegments:contacts,contactFragments,predecessorReference,seedSegments,substrateAdaptation,requiredContact:node.first&&record.contact?.source!==null&&record.contact?.source!==undefined});
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
  const selected={...result,report:{...result.report,depositionFamily:node.kind,construction:result.report.construction??(node.kind==='slice'?undefined:node.construction),owner:node.sourceId,part:node.part,...(node.dependencyNotes?.length?{notes:[...(result.report.notes??[]),...node.dependencyNotes]}:{})},operations:result.operations.map(op=>({...op,part:node.part,...(motionIntent&&!result.depositionFinalized?{strokes:op.strokes.map(stroke=>({...stroke,motionIntent}))}:{}),
    after:[...new Set([...(op.after??[]),...(node.operationDependencies===false?[]:after),...(assignment.dependencies?.after??assignment.after??[])])],...(assignment.filament===null?{}:{filament:assignment.filament})}))};
  return selected;
}

export function publishDepositionWork(node,result){
  const publication=node.kind==='slice'&&node.record.reference?node.record.context:node.construction==='curves'?node.context:null;
  return publication?.shell?republishDepositedBoundary(publishFinishedBoundary(result,{shell:publication.shell}),{widthMm:publication.process.lineWidthMm}):result;
}

// One assignment's construction failing is that assignment's
// failure, named with its error.
export class AssignmentFailure extends Error {
  constructor(node,error){super(error.message,{cause:error});this.assignment=node.sourceId??node.key;this.family=node.kind;}
}
function assignmentWork(node,work){
  try{return work();}catch(error){throw error instanceof AssignmentFailure||error.name==='AbortError'?error:new AssignmentFailure(node,error);}
}
// A generation-time source consumes the actual completed layer, never a newly
// sliced approximation. The source owns curve geometry; Trace owns deposition.
function sourceCurveResult(node,completed,{plan,results,shells}){
  const assignment=node.context.assignment;
  validateCurveAssignment(assignment);
  if(node.context.sourceError)throw node.context.sourceError;
  requireThat(node.context.curveSource&&typeof node.context.curveSource.constructLayer==='function','Trace source entry must provide constructLayer.');
  const parent=completed.get(node.parentKey);
  requireThat(parent,'Trace source names an absent Slice assignment or different part.');
  const record=parent.node.record,result=parent.result,layer=result.referenceStack?.layers.find(layer=>layer.index===node.index);
  if(!layer)return {id:assignment.id,operations:[],report:{construction:'curves',source:assignment.source,sourceLayer:node.index,skippedLayer:node.index,skipReason:'source layer has no deposited reference'}};
  const selection=plan.geometry?geometrySelections(plan.geometry).get(node.part):null;
  const source={slice:layer.slice,region:layer.region,material:layer.material,perimeters:layer.perimeters,
    sectionReport:layer.sectionReport,solidRegion:layer.solidRegion,sparseRegion:layer.sparseRegion,
    denseRegion:result.report.modulation?.materialChanged?[]:layer.denseRegion??[],
    widthMm:layer.widthMm,pitchMm:layer.pitchMm,wallInsetMm:layer.wallInsetMm,heightMm:layer.heightMm,
    index:node.index,sourceId:parent.node.sourceId,stackId:record.spec.id,part:node.part,
    placement:{offset:selection?[selection.xMm,selection.yMm,selection.zMm]:[0,0,0]},
    settings:layer.settings??record.spec.settings,process:layer.process??record.context.process,
    key:record.spec.id+':'+node.index,ordinal:record.spec.layers.findIndex(item=>item.index===node.index),count:record.spec.totalLayerCount,
    rank:parent.node.nominalRank,layerId:result.operations[0]?.layerId,speedMmS:result.operations[0]?.strokes[0]?.speedMmS};
  const produced=node.context.curveSource.constructLayer({source,parameters:assignment.source.parameters});
  requireThat(produced&&Array.isArray(produced.curves),'Trace source must return {curves,report}.');
  const authored={...assignment,source:null,curves:produced.curves,filament:assignment.filament??record.spec.filament};
  if(authored.curves.length)validateCurveAssignment(authored);
  const traced=authoredCurveResult(authored,{plan,process:assignment.process?{...source.process,...assignment.process}:source.process,references:depositionReferences(shells,results),modelResults:results,sourceLayer:{...source,referenceStack:result.referenceStack}});
  return {...traced,report:{...traced.report,...produced.report,notes:[...(traced.report.notes??[]),...(produced.report?.notes??[])],source:assignment.source,sourceLayer:node.index,sourceStack:record.spec.id,...(source.sectionReport?{sourceSection:source.sectionReport}:{})}};
}

// Construction follows material prerequisites only. It has no nozzle,
// execution order, travel, cooling or motion-action state.
export function constructDepositionResults(args,contexts,excluded=new Set()){
  const constructions=(args.constructions??[]).filter(context=>!excluded.has(context.assignment.id)),work=(args.work??[]).filter(node=>!excluded.has(node.sourceId??node.key));
  const curveSources=(args.curveSources??[]).filter(context=>!excluded.has(context.assignment.id));
  const nodes=prepareDepositionWork(contexts,constructions,work,args.workDependencies,curveSources),completed=new Map();
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
        const constrained={...finalized,operations:finalized.operations.map(operation=>({...operation,
          after:[...new Set([...(operation.after??[]),...(args.operationDependencies?.(operation,excluded)??[])])]}))};
        return publishDepositionWork(node,republishDepositedBoundary(constrained,{widthMm:args.plan.process.lineWidthMm}));
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
  if(args.finishResults){
    const finished=args.finishResults({results,workResults:work.map(node=>completed.get(node.key).result)});
    const failure=finished.failures.find(failure=>!excluded.has(failure.assignment));
    if(failure)throw new AssignmentFailure({sourceId:failure.assignment,kind:'inject'},Error(failure.message));
    results.splice(0,results.length,...finished.results);
  }
  const resultLayers=new Set(results.flatMap(result=>result.operations.map(op=>op.layerId)));
  return {results,summary:{layers:resultLayers.size,instances:results.map(result=>({id:result.id,...result.report}))}};
}
