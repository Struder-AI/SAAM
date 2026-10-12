import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
// Resolve ownership and prerequisites before selecting work. Every construction
// consumes finalized predecessor beads; authored rank never becomes run order.
import {prepareSliceContexts,sliceContextResult} from './slices.mjs';
import {finalizeDepositionResult,combineFinalizedResults} from './finalize.mjs';
import {injectionResult} from './injection.mjs';
import {curveAssignmentResult,depositionReferences} from './curves.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {publishFinishedBoundary,republishDepositedBoundary} from '../path/finished-surface.mjs';
import {depositedBeadSegments} from '../path/deposited-curves.mjs';
import {translateSlice} from '../geom/slice.mjs';

import {matchingModulations} from '../path/modulation.mjs';
import {planOperationEntry,planPreparedOperation} from '../path/compose.mjs';
import {ActionAccumulator,planLayerCooling} from '../path/planning.mjs';

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
export function prepareDepositionWork(contexts,constructions=[],work=[],dependencies=()=>({dependencies:[],notes:[]})){
  const nodes=contexts.flatMap(record=>{
    const units=record.referenceStack.constructTogether?[{index:null,rank:record.layerOrder[0]?.rank??0}]:record.layerOrder;
    return units.map((unit,i)=>({key:`slice:${record.spec.id}:${unit.index}`,kind:'slice',construction:record.spec.settings.construction??'slice',sourceId:record.owner.assignment.id,part:record.owner.part,
      construct:record.constructWork,providesSurface:record.providesSurface,nominalRank:unit.rank,index:unit.index,record,first:i===0,requires:i?[`slice:${record.spec.id}:${units[i-1].index}`]:[]}));
  }).concat(constructions.map(context=>({key:`${context.assignment.construction}:${context.assignment.id}`,kind:context.kind??assignmentFamily(context.assignment),construction:context.assignment.construction,
    construct:context.construct,providesSurface:context.providesSurface,sourceId:context.assignment.id,part:context.assignment.part??null,nominalRank:context.endMm??context.shell?.bounds.max[2]??0,context,requires:[]}))).concat(work);
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
    result=curveAssignmentResult(node.context.assignment,{plan,modelResults:results,
      references:depositionReferences(shells,results)});
  }else if(node.kind==='inject')result=injectionResult(node.context.assignment,{plan});
  else throw new Error(`Unsupported deposition construction ${node.kind}.`);
  const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
  const motionIntent=assignment.toolPose?{kind:'derived-pose',alignToSliceNormal:assignment.toolPose.alignToSliceNormal}:null;
  const selected={...result,report:{...result.report,depositionFamily:node.kind,construction:result.report.construction??(node.kind==='slice'?undefined:node.construction),owner:node.sourceId,part:node.part,...(node.dependencyNotes?.length?{notes:[...(result.report.notes??[]),...node.dependencyNotes]}:{})},operations:result.operations.map(op=>({...op,part:node.part,...(motionIntent?{strokes:op.strokes.map(stroke=>({...stroke,motionIntent}))}:{}),
    after:[...new Set([...(op.after??[]),...(node.operationDependencies===false?[]:after),...(assignment.dependencies?.after??assignment.after??[])])],...(assignment.filament===null?{}:{filament:assignment.filament})}))};
  return selected;
}

export function publishDepositionWork(node,result){
  const publication=node.kind==='slice'&&node.record.reference?node.record.context:node.construction==='curves'?node.context:null;
  return publication?.shell?republishDepositedBoundary(publishFinishedBoundary(result,{shell:publication.shell}),{widthMm:publication.process.lineWidthMm}):result;
}

// One assignment's construction or emission failing is that assignment's
// failure, named with its error.
class AssignmentFailure extends Error {
  constructor(node,error){super(error.message,{cause:error});this.assignment=node.sourceId??node.key;this.family=node.kind;}
}
function assignmentWork(node,work){
  try{return work();}catch(error){throw error instanceof AssignmentFailure||error.name==='AbortError'?error:new AssignmentFailure(node,error);}
}
// A language error is a SAAM bug, still reported as the assignment's.
const INTERNAL_ERRORS=['TypeError','RangeError','ReferenceError','SyntaxError'];
const failureNote=({assignment,family,cause})=>`${family[0].toUpperCase()+family.slice(1)} ${assignment} produced nothing: ${INTERNAL_ERRORS.includes(cause.name)
  ?`internal error (${cause.name}: ${cause.message}); this is a SAAM bug, report it with saam call report_bug`:cause.message}`;

// Deposition of every assignment. A failing assignment produces nothing and
// says why; the print is generated again without it, so what the others
// deposit never depends on its partial work. -> {results, execution,
// summary, notes}: notes are the slice stacks' notes, each result's report
// notes (such as its contact spans) and each failure.
export function finalizedSliceResults(args){
  const failures=[];
  for(;;){
    try{return finalizeAssignments(args,failures);}catch(error){
      if(error.name==='AbortError'||!error.assignment||failures.some(failure=>failure.assignment===error.assignment))throw error;
      failures.push(error instanceof AssignmentFailure?error:new AssignmentFailure({sourceId:error.assignment,kind:'slice'},error));
    }
  }
}
function finalizeAssignments(args,failures){
  const excluded=new Set(failures.map(failure=>failure.assignment));
  const plan={...args.plan,slices:{...args.plan.slices,assignments:args.plan.slices.assignments.filter(a=>!excluded.has(a.id))}};
  const sliced=prepareSliceContexts({...args,plan,bands:(args.bands??[]).filter(band=>!excluded.has(band.sourceId)),reserves:(args.reserves??[]).filter(reserve=>!excluded.has(reserve.sourceId)),envelopes:(args.envelopes??[]).filter(envelope=>!excluded.has(envelope.sourceId))});
  const contexts=sliced.contexts;
  const generated=executeDepositionWork(args,contexts,excluded);
  const produced=generated.results,nothing=!produced.some(result=>result.operations.length);
  return {...generated,notes:[...sliced.notes,...produced.flatMap(result=>result.report?.notes??[]),...failures.map(failureNote),...(nothing?['Nothing to print: no assignment produced material.']:[])]};
}

// Excluded assignments construct nothing. The rest is the one execution.
function executeDepositionWork(args,contexts,excluded){
  const constructions=(args.constructions??[]).filter(context=>!excluded.has(context.assignment.id)),work=(args.work??[]).filter(node=>!excluded.has(node.sourceId??node.key));
  // Nothing to deposit: the path is startup and finishing only.
  if(!contexts.length&&!constructions.length&&!work.length)return {results:[],summary:null,
    execution:{state:{...args.planningState,operationId:undefined},actions:new ActionAccumulator().finish(),summary:{operationOrder:[],layers:0}}};
  const nodes=prepareDepositionWork(contexts,constructions,work,args.workDependencies),completed=new Map(),prepared=new Map(),emitted=new Set(args.emittedIds??[]);
  const actions=new ActionAccumulator(),deposited=[],elapsed=new Map(),paid=new Map(),operationOrder=[],layerIds=new Set(),layerIndices=new Map();
  let state=args.planningState,last=null;
  requireThat(state,'Deposition execution needs the actual startup planning state.');
  const priority=node=>node.kind==='slice'?contexts.indexOf(node.record):contexts.length+nodes.indexOf(node);
  while(completed.size<nodes.length){
    for(const node of nodes)if(!prepared.has(node.key)&&!completed.has(node.key)&&node.requires.every(key=>completed.has(key))){
      const {raw,parts,empty}=assignmentWork(node,()=>{
        const raw=constructDepositionWork(node,completed,args),parts=raw.operations.map(sourceOperation=>{
          const operation=state.selections&&/^planar:[\d.e+-]+$/.test(sourceOperation.layerId)?{...sourceOperation,layerId:'planar:'+Number(Number(sourceOperation.layerId.slice(7)).toFixed(5))}:sourceOperation;
          const eligible=node.kind==='slice'&&['nearest','nearest-cells'].includes(operation.order)&&!operation.strokes.some(stroke=>matchingModulations(raw,stroke.role,args.plan.modulations,operation).length||stroke.motionIntent||stroke.poses);
          const result=eligible||node.context?.assignment.sequence||node.context?.assignment.curves?.some(c=>c.contact)?{...raw,operations:[operation]}:finalizeDepositionResult({...raw,operations:[operation]},args.plan);
          return {result,eligible,operation:result.operations[0],done:false};
        });
        return {raw,parts,empty:parts.length?null:publishDepositionWork(node,raw)};
      });
      prepared.set(node.key,{node,raw,parts});
      if(empty)completed.set(node.key,{node,result:empty});
    }
    // Recipe composition entries name operation IDs. Once nothing else is
    // ready, an entry naming no operation of this print matches nothing.
    const readyParts=known=>[...prepared.values()].flatMap(item=>item.parts.filter(part=>!part.done).map(part=>({...item,part}))).filter(({part})=>{
      const op=part.operation,after=[...(op.after??[])],named=id=>!known||known.has(id),order=args.plan.composition.order.filter(named);
      for(const edge of args.plan.composition.dependencies)if(edge.after===op.id&&named(edge.before))after.push(edge.before);
      const index=order.indexOf(op.id);if(index>0)after.push(order[index-1]);
      after.push(...(args.operationDependencies?.(op,excluded)??[]));
      return after.every(id=>emitted.has(id));
    }).map(item=>({...item,height:item.part.operation.strokes.reduce((z,stroke)=>stroke.points.reduce((z,p)=>Math.max(z,p[2]),z),-Infinity)}))
      .sort((a,b)=>a.height-b.height||priority(a.node)-priority(b.node)||a.part.operation.rank-b.part.operation.rank||a.parts.indexOf(a.part)-b.parts.indexOf(b.part));
    const scheduled=readyParts(null),ready=scheduled.length?scheduled:readyParts(new Set([...emitted,...[...prepared.values()].flatMap(item=>item.parts.map(part=>part.operation.id))]));
    if(!ready.length){
      if(completed.size===nodes.length)break;
      const blocked=nodes.find(node=>!completed.has(node.key));
      throw new AssignmentFailure(blocked,Error('Deposition dependencies are missing or cyclic: '+nodes.filter(node=>!completed.has(node.key)).map(node=>node.key).join(', ')));
    }
    const chosen=ready[0],op=chosen.part.operation;
    if(last&&last.layerId!==op.layerId&&!last.continuous){
      const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});
      state=cooling.state;actions.add(cooling.actions);paid.set(last.layerId,(paid.get(last.layerId)??0)+(cooling.coolingSeconds??0));
    }
    const layerId=state.selections&&/^planar:[\d.e+-]+$/.test(op.layerId)?'planar:'+Number(Number(op.layerId.slice(7)).toFixed(5)):op.layerId;
    if(!layerIndices.has(layerId))layerIndices.set(layerId,layerIndices.size);
    const effective=state.selections?{...op,layerId,layer:layerIndices.get(layerId)}:op;
    const {entered,emittedResult,finished,planned,whole}=assignmentWork(chosen.node,()=>{
      const entered=planOperationEntry(state,effective,elapsed.get(op.layerId)??0);
      const finalized=chosen.part.eligible?finalizeDepositionResult(chosen.part.result,args.plan,{entryPosition:entered.state.position}):chosen.part.result;
      const material=finalized.operations[0],finished={...material,after:[...new Set([...(material.after??[]),...(args.operationDependencies?.(material,excluded)??[])])]};
      const planned=planPreparedOperation(entered.state,state.selections?{...finished,layerId,layer:effective.layer}:finished,{deposited});
      // The node's last operation completes its result.
      const emittedResult={...finalized,operations:[finished]},complete=chosen.parts.every(part=>part.done||part===chosen.part);
      const whole=complete?publishDepositionWork(chosen.node,republishDepositedBoundary(combineFinalizedResults(chosen.raw,chosen.parts.map(part=>part===chosen.part?emittedResult:part.result)),{widthMm:args.plan.process.lineWidthMm})):null;
      return {entered,emittedResult,finished,planned,whole};
    });
    state=planned.state;actions.add(entered.actions);actions.add(planned.actions);elapsed.set(op.layerId,planned.operationSeconds);layerIds.add(op.layerId);last=finished;
    deposited.push(finished.travelPolicy);emitted.add(op.id);operationOrder.push(op.id);chosen.part.done=true;chosen.part.result=emittedResult;
    if(whole)completed.set(chosen.node.key,{node:chosen.node,result:whole});
  }
  if(last&&!last.continuous){const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});state=cooling.state;actions.add(cooling.actions);}
  const execution={state:{...state,operationId:undefined},actions:actions.finish(),summary:{operationOrder,layers:layerIds.size}};
  const results=[];
  for(const record of contexts){
    const sliceResults=nodes.filter(node=>node.kind==='slice'&&node.record===record).map(node=>completed.get(node.key).result);
    const result=combineSliceResults(record,sliceResults);
    results.push(result);
  }
  results.push(...nodes.filter(node=>node.kind!=='slice').map(node=>completed.get(node.key).result));
  if(args.finishResults){
    const finished=args.finishResults({results,workResults:work.map(node=>completed.get(node.key).result)});
    const failure=finished.failures.find(failure=>!excluded.has(failure.assignment));
    if(failure)throw new AssignmentFailure({sourceId:failure.assignment,kind:'inject'},Error(failure.message));
    results.splice(0,results.length,...finished.results);
  }
  const resultLayers=new Set(results.flatMap(result=>result.operations.map(op=>op.layerId)));
  return {results,execution,summary:{layers:resultLayers.size,instances:results.map(result=>({id:result.id,...result.report}))}};
}
