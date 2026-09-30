// Resolve ownership and prerequisites before selecting work. Every construction
// consumes finalized predecessor beads; authored rank never becomes run order.
import {prepareSliceContexts,sliceContextResult,ownershipDependencies} from './slices.mjs';
import {finalizeDepositionResult,combineFinalizedResults} from './finalize.mjs';
import {injectionResult} from './injection.mjs';
import {curveAssignmentResult,depositionReferences,sleeveTraceResult} from './curves.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {publishFinishedBoundary,consumeFinishedSurface,republishDepositedBoundary} from '../path/finished-surface.mjs';
import {depositedBeadSegments} from '../path/deposited-curves.mjs';
import {translateSlice,slicePoint} from '../geom/slice.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {intersect} from '../region/boolean.mjs';
import {regionArea} from '../region/region2d.mjs';
import {matchingModulations} from '../path/modulation.mjs';
import {planOperationEntry,planPreparedOperation} from '../path/compose.mjs';
import {ActionAccumulator,planLayerCooling} from '../path/planning.mjs';
import {rivetInjectionResult,rivetEnclosureLayers,validateRivetClearance} from '../../skills/plastic-weld/scripts/weld.mjs';

function combineCourses(record,courses){
  if(!courses.length)return {id:record.spec.id,report:record.context.report,operations:[],family:{...record.family,layers:[]}};
  if(courses.length===1&&record.regionField?.kind!=='boundary-offsets')return courses[0];
  const report={...courses[0].report,...record.context.report};
  if(record.regionField?.kind==='boundary-offsets')report.topMm=courses.reduce((top,result)=>result.operations.reduce((top,operation)=>operation.strokes.reduce((top,stroke)=>stroke.points.reduce((top,p)=>Math.max(top,p[2]),top),top),top),-Infinity);
  for(const key of ['layers','skippedLayers','areaMm2','loops','fillRows','solidAreaMm2','uncoveredContactSamples','substrateContactQueries'])report[key]=courses.reduce((sum,r)=>sum+(r.report[key]??0),0);
  if(record.regionField?.courses){
    report.shells=courses.length;
    for(const key of ['points','partialAxialPasses','fullAxialPasses','axialPasses'])report[key]=courses.reduce((sum,r)=>sum+(r.report[key]??0),0);
    report.minBeadWidthMm=Math.min(...courses.map(r=>r.report.minBeadWidthMm));report.maxBeadWidthMm=Math.max(...courses.map(r=>r.report.maxBeadWidthMm));
  }
  const contacts=courses.filter(r=>r.report.contactSamples);
  if(contacts.length){report.contactSamples=contacts.reduce((n,r)=>n+r.report.contactSamples,0);report.minContactGapMm=Math.min(...contacts.map(r=>r.report.minContactGapMm));report.maxContactGapMm=Math.max(...contacts.map(r=>r.report.maxContactGapMm));}
  const layers=courses.flatMap(r=>r.family.layers);
  return combineFinalizedResults({...courses[0],report,familyLayers:layers,
    family:{...record.family,layers},finishedSurfaces:courses.flatMap(r=>r.finishedSurfaces??[])},courses);
}

// Expand construction and recipe constraints once to exact work-node keys.
export function prepareDepositionWork(contexts,constructions=[],weldSites=[]){
  const nodes=contexts.flatMap(record=>{
    const units=record.spec.settings.join||record.family.constructTogether?[{index:null,rank:record.layerOrder[0]?.rank??0}]:record.layerOrder;
    return units.map((unit,i)=>({key:`slice:${record.spec.id}:${unit.index}`,kind:'slice',construction:record.spec.settings.construction??'slice',sourceId:record.owner.assignment.id,part:record.owner.part,
      nominalRank:unit.rank,ownershipRank:unit.ownershipRank??unit.rank,index:unit.index,record,first:i===0,requires:i?[`slice:${record.spec.id}:${units[i-1].index}`]:[]}));
  }).concat(constructions.map(context=>({key:`${context.assignment.construction}:${context.assignment.id}`,kind:assignmentFamily(context.assignment),construction:context.assignment.construction,
    sourceId:context.assignment.id,part:context.assignment.part??null,nominalRank:context.endMm??context.shell?.bounds.max[2]??0,context,requires:[]}))).concat(weldSites.map((site,index)=>({
      key:`rivet:${site.id}`,kind:'inject',construction:'rivet',sourceId:'plastic-weld',part:site.part,nominalRank:site.top,index,
      context:{site,siteCount:weldSites.length,assignment:site.assignment},requires:[]})));
  const declared=nodes.map(node=>{
    const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
    const needs=new Set(node.requires),defaults=new Set();
    const references=node.construction==='curves'?[assignment.repeat?.family,...assignment.curves.map(curve=>curve.uv?.reference).filter(reference=>reference&&reference.kind!=='patch').map(reference=>reference.assignment)].filter(Boolean):[];
    for(const other of nodes){
      if(other===node)continue;
      // Enclosure construction precedes injection; cover construction may then
      // consume its completed action. Exact physical barriers are checked again
      // against finalized heights, rather than trusting this construction rank.
      if(node.construction==='rivet'&&other.kind==='slice'&&!other.record.reference){
        const layers=other.record.spec.layers.filter(layer=>other.index===null||layer.index===other.index);
        const enclosure=rivetEnclosureLayers(node.context.site,node.context.site.process);
        if(layers.some(layer=>{
          const points=layer.region.map(loop=>loop.map(uv=>slicePoint(layer.slice,uv))),flat=points.flat();
          return flat.length&&enclosure.some(({z,required})=>z>=Math.min(...flat.map(p=>p[2]))-1e-8&&z<=Math.max(...flat.map(p=>p[2]))+1e-8&&Math.abs(regionArea(intersect(points.map(loop=>loop.map(p=>p.slice(0,2))),required)))>1e-8);
        }))needs.add(other.key);
      }
      const offers=other.kind==='slice'?other.record.spec.settings:other.context.assignment;
      if(other.sourceId!==node.sourceId&&(assignment.dependencies?.afterParts.includes(other.part)||offers.dependencies?.beforeParts.includes(node.part)))needs.add(other.key);
      if(node.kind==='slice'&&node.first&&node.record.contact){
        const source=node.record.contact.source;
        if(source!==null?other.sourceId===source&&other.part===node.part&&(other.kind!=='slice'||other.record.reference||other.nominalRank<=node.nominalRank+1e-8):
          other.part===node.part&&other.sourceId!==node.sourceId&&!(other.kind==='slice'&&other.record.contact)&&other.nominalRank<=node.nominalRank+1e-8)needs.add(other.key);
      }
      if(references.includes(other.sourceId)||references.includes(other.record?.spec.id))needs.add(other.key);
      if(node.kind==='slice'&&node.record.reference&&other.part===node.part){
        if(node.record.reference.source!==null&&other.sourceId===node.record.reference.source)needs.add(other.key);
        if(node.record.reference.source===null&&(['sleeve','rim'].includes(other.construction)||other.kind==='slice'&&!other.record.reference))defaults.add(other.key);
      }
      if(node.kind==='trace'&&assignment.curves?.some(c=>c.contact)&&(other.kind!=='trace'||nodes.indexOf(other)<nodes.indexOf(node)))defaults.add(other.key);
      if(node.construction==='sleeve'&&other.part===node.part){
        if(other.kind==='slice'&&!other.record.reference&&other.nominalRank<=(node.context??node.record.context).startMm+1e-8||other.construction==='sleeve'&&(other.context??other.record.context).endMm<=(node.context??node.record.context).startMm+1e-8)needs.add(other.key);
      }
      if(node.kind==='slice'&&!node.record.reference&&other.construction==='sleeve'&&other.part===node.part&&node.nominalRank>(other.context??other.record.context).endMm+1e-8){
        requireThat((other.context?.assignment??other.record.spec.settings).endTransition==='level','Slices above a sleeve need its ending transition to be level.');needs.add(other.key);
      }
    }
    if(node.kind==='slice'&&node.first&&node.record.contact?.source!==null&&node.record.contact?.source!==undefined)
      requireThat(nodes.some(other=>other.sourceId===node.record.contact.source&&other.part===node.part),`Slice ${node.sourceId}: contact source names an absent producer or a different part.`);
    if(node.kind==='slice'&&node.record.owner.ownershipGroup){
      const group=nodes.filter(other=>other.kind==='slice'&&other.record.owner.ownershipGroup===node.record.owner.ownershipGroup)
        .sort((a,b)=>a.ownershipRank-b.ownershipRank||nodes.indexOf(a)-nodes.indexOf(b));
      const previous=group[group.indexOf(node)-1];if(previous)needs.add(previous.key);
    }
    return {...node,requires:[...needs],defaults:[...defaults]};
  });
  // Unnamed substrate/bridge inputs use available producers, excluding explicit
  // downstream consumers. Explicit recipe edges always retain their meaning.
  const dependsOn=(key,target,seen=new Set())=>{
    if(key===target)return true;if(seen.has(key))return false;seen.add(key);
    return declared.find(node=>node.key===key).requires.some(prior=>dependsOn(prior,target,seen));
  };
  return declared.map(({defaults,...node})=>({...node,requires:[...new Set([...node.requires,...defaults.filter(key=>!dependsOn(key,node.key))])]}));
}

export function constructDepositionWork(node,completed,{plan,machine,onProgress,shells=[]}){
  const substrateAdaptation=plan.experimental.substrateAdaptation;
  const required=new Set();
  const collect=key=>{if(required.has(key))return;required.add(key);for(const prior of completed.get(key)?.node.requires??[])collect(prior);};
  node.requires.forEach(collect);
  const predecessors=[...completed.values()].filter(item=>required.has(item.node.key)),samePart=predecessors.filter(item=>item.node.part===node.part);
  const prerequisiteIds=key=>{const prior=completed.get(key);return prior.result.operations.length?prior.result.operations.map(op=>op.id):prior.node.requires.flatMap(prerequisiteIds);};
  const after=[...new Set(node.requires.flatMap(prerequisiteIds))];
  let result;
  if(node.construction==='sleeve'){
    const context=node.context??node.record.context,assignment=node.context?.assignment??node.record.spec.settings;
    const foundations=samePart.filter(item=>item.node.nominalRank<=context.startMm+1e-8);
    if(assignment.zStartMm>0){
      const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
      requireThat(Math.abs(grid-Math.round(grid))<1e-8,'A raised sleeve must start on its resolved process layer grid.');
      requireThat(foundations.some(item=>item.result.operations.length),'A raised sleeve needs supporting deposition below its start.');
    }
    const foundationSegments=substrateAdaptation&&assignment.zStartMm>0?depositedBeadSegments(foundations.flatMap(item=>item.result.operations),{widthMm:context.process.lineWidthMm}):[];
    result=node.kind==='slice'?sliceContextResult(node.record,{foundationSegments,substrateAdaptation}):sleeveTraceResult({...context,machine,after,onProgress,foundationSegments,substrateAdaptation});
  }else if(node.kind==='slice'&&node.record.reference?.kind==='terminal'){
    const record=node.record,sourceParts=samePart.filter(item=>item.node.sourceId===record.reference.source).map(item=>item.result),sourceResult=sourceParts.length?combineFinalizedResults({...sourceParts.at(-1),levelBoundary:sourceParts.find(r=>r.levelBoundary)?.levelBoundary},sourceParts):null;
    const sourceAssignment=plan.slices.assignments.find(assignment=>assignment.id===record.reference.source);
    const predecessorResults=samePart.filter(item=>item.node.sourceId===node.sourceId).map(item=>item.result);
    result=sliceContextResult(record,{layerIndex:node.index,sourceResult,sourceAssignment,predecessorResults,substrateAdaptation});
  }else if(node.kind==='slice'&&node.record.reference){
    const record=node.record,sources=samePart.filter(item=>(record.reference.source===null||item.node.sourceId===record.reference.source)&&(!record.owner.ownershipGroup||item.node.record?.owner.ownershipGroup!==record.owner.ownershipGroup)).map(item=>item.result);
    requireThat(sources.length,`Reference family ${node.sourceId}: source names an absent producer or a different part.`);
    const shared=record.owner.ownershipGroup?samePart.filter(item=>item.node.record?.owner.ownershipGroup===record.owner.ownershipGroup):[];
    const previous=shared.at(-1),ownPrevious=shared.filter(item=>item.node.sourceId===node.sourceId).at(-1);
    const course=record.regionField?.courses?.find(course=>course.index===node.index);
    const reference=consumeFinishedSurface({shell:record.context.shell,selection:record.reference.selection,results:sources,substrateAdaptation});
    result=sliceContextResult(record,{layerIndex:node.index,reference,
      layoutReference:course?consumeFinishedSurface({shell:record.context.shell,selection:record.reference.selection,results:sources,substrateAdaptation:false}):reference,
      substrateAdaptation,requiredContact:substrateAdaptation&&!!previous,fieldState:ownPrevious?.result.fieldState,
      contactSegments:substrateAdaptation&&previous?depositedBeadSegments(previous.result.operations,{widthMm:previous.node.record.context.process.lineWidthMm}):[]});
  }else if(node.kind==='slice'){
    const record=node.record,layer=record.spec.layers.find(layer=>layer.index===node.index)??record.spec.layers[0];
    const own=samePart.filter(item=>item.node.kind==='slice'&&item.node.record.familyId===record.familyId&&item.node.index===node.index-1);
    const contacts=substrateAdaptation?own.filter(item=>item.result.report.modulation?.materialChanged).flatMap(item=>depositedBeadSegments(item.result.operations,{widthMm:item.node.record.context.process.lineWidthMm})):[];
    const source=node.first?record.contact?.source:null;
    // Point injection has no deposited surface chart. Its prerequisite is real,
    // but an empty reference must not change a following Slice's contact frame.
    const candidates=substrateAdaptation?samePart.filter(item=>item.node.kind!=='inject'&&item.node.sourceId!==node.sourceId&&(!source||item.node.sourceId===source)):[];
    const contactFragments=candidates.map(item=>({layers:(item.result.family?.layers??[]).map(layer=>({...layer,
      region:layer.region??(layer.slice?.kind==='plane'?layer.curves?.filter(curve=>curve.closed).map(curve=>curve.points.map(point=>{
        const relative=point.map((v,k)=>v-layer.slice.origin[k]);return [layer.slice.xAxis,layer.slice.yAxis].map(axis=>axis.reduce((sum,v,k)=>sum+v*relative[k],0));
      })):undefined)})),operations:item.result.operations,
      widthMm:item.node.kind==='slice'?item.node.record.context.process.lineWidthMm:(item.node.context.process??plan.process).lineWidthMm}));
    const seedSegments=record.spec.settings.fillOrder?.kind==='fronts'?samePart.filter(item=>item.node.sourceId!==node.sourceId||item.node.index===node.index-1).flatMap(item=>depositedBeadSegments(item.result.operations)):[];
    const predecessorReference=substrateAdaptation&&node.first&&record.contact?record.contact.predecessorReference:
      contactFragments.length?translateSlice(layer.slice,(layer.direction??layer.slice.normal).map(v=>-v*layer.translationMm)):null;
    result=sliceContextResult(record,{layerIndex:node.index,contactSegments:contacts,contactFragments,predecessorReference,seedSegments,substrateAdaptation,requiredContact:node.first&&record.contact?.source!==null&&record.contact?.source!==undefined});
  }else if(node.kind==='trace'){
    const results=predecessors.map(item=>item.result);
    result=curveAssignmentResult(node.context.assignment,{plan,machine,modelResults:results,
      references:depositionReferences(shells,results)});
  }else if(node.construction==='rivet')result=rivetInjectionResult({plan:assignmentPlan(plan,machine,node.context.assignment),machine,site:node.context.site,siteIndex:node.index,siteCount:node.context.siteCount,modelResults:predecessors.filter(item=>item.node.construction!=='rivet').map(item=>item.result)});
  else if(node.kind==='inject')result=injectionResult(node.context.assignment,{plan,machine});
  else throw new Error(`Unsupported deposition construction ${node.kind}.`);
  const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
  const motionIntent=assignment.toolPose?{kind:'derived-pose',alignToSliceNormal:assignment.toolPose.alignToSliceNormal}:null;
  const selected={...result,report:{...result.report,depositionFamily:node.kind,construction:result.report.construction??(node.kind==='slice'?undefined:node.construction),owner:node.sourceId,part:node.part},operations:result.operations.map(op=>({...op,part:node.part,...(motionIntent?{strokes:op.strokes.map(stroke=>({...stroke,motionIntent}))}:{}),
    after:[...new Set([...(op.after??[]),...(node.construction==='rivet'?[]:after),...(assignment.dependencies?.after??assignment.after??[])])],...(assignment.filament===null?{}:{filament:assignment.filament})}))};
  return selected;
}

export function publishDepositionWork(node,result){
  const publication=node.kind==='slice'&&node.record.reference?node.record.context:node.construction==='curves'?node.context:null;
  return publication?.shell?republishDepositedBoundary(publishFinishedBoundary(result,{shell:publication.shell}),{widthMm:publication.process.lineWidthMm}):result;
}


export function finalizedSliceResults(args){
  const contexts=args.contexts??[...prepareSliceContexts(args).contexts,...(args.supportContexts??[])],constructions=args.constructions??[],weldSites=args.weldSites??[];
  if(!contexts.length&&!constructions.length&&!weldSites.length)return {results:[],supports:[],summary:null};
  const nodes=prepareDepositionWork(contexts,constructions,weldSites),completed=new Map(),prepared=new Map(),emitted=new Set(args.emittedIds??[]);
  const actions=new ActionAccumulator(),deposited=[],elapsed=new Map(),paid=new Map(),operationOrder=[],layerIds=new Set(),layerIndices=new Map();
  let state=args.planningState,last=null;
  requireThat(state,'Deposition execution needs the actual startup planning state.');
  const priority=node=>node.kind==='slice'?(node.record.owner.kind==='support'?-contexts.length:0)+contexts.indexOf(node.record):contexts.length+nodes.indexOf(node);
  while(completed.size<nodes.length){
    for(const node of nodes)if(!prepared.has(node.key)&&!completed.has(node.key)&&node.requires.every(key=>completed.has(key))){
      const raw=constructDepositionWork(node,completed,args),parts=raw.operations.map(sourceOperation=>{
        const operation=state.selections&&/^planar:[\d.e+-]+$/.test(sourceOperation.layerId)?{...sourceOperation,layerId:'planar:'+Number(Number(sourceOperation.layerId.slice(7)).toFixed(5))}:sourceOperation;
        const eligible=node.kind==='slice'&&['nearest','nearest-cells'].includes(operation.order)&&!operation.strokes.some(stroke=>matchingModulations(raw,stroke.role,args.plan.modulations,operation).length||stroke.motionIntent||stroke.poses);
        const result=eligible||node.context?.assignment.sequence||node.context?.assignment.curves?.some(c=>c.contact)?{...raw,operations:[operation]}:finalizeDepositionResult({...raw,operations:[operation]},args.plan,args.machine);
        return {result,eligible,operation:result.operations[0],done:false};
      });
      prepared.set(node.key,{node,raw,parts});
      if(!parts.length)completed.set(node.key,{node,result:publishDepositionWork(node,raw)});
    }
    const ready=[...prepared.values()].flatMap(item=>item.parts.filter(part=>!part.done).map(part=>({...item,part}))).filter(({part})=>{
      const op=part.operation,after=[...(op.after??[])];
      for(const edge of args.plan.composition.dependencies)if(edge.after===op.id)after.push(edge.before);
      const index=args.plan.composition.order.indexOf(op.id);if(index>0)after.push(args.plan.composition.order[index-1]);
      for(const site of weldSites)if(op.id!==site.reservation.completion.operationId&&op.strokes.some(stroke=>stroke.points.some(p=>p[2]>site.top+1e-8)))after.push(site.reservation.completion.operationId);
      return after.every(id=>emitted.has(id));
    }).map(item=>({...item,height:item.part.operation.strokes.reduce((z,stroke)=>stroke.points.reduce((z,p)=>Math.max(z,p[2]),z),-Infinity)}))
      .sort((a,b)=>a.height-b.height||priority(a.node)-priority(b.node)||a.part.operation.rank-b.part.operation.rank||a.parts.indexOf(a.part)-b.parts.indexOf(b.part));
    if(!ready.length){if(completed.size===nodes.length)break;throw Error('Deposition dependencies are missing or cyclic: '+nodes.filter(node=>!completed.has(node.key)).map(node=>node.key).join(', '));}
    const chosen=ready[0],op=chosen.part.operation;
    if(last&&last.layerId!==op.layerId&&!last.continuous){
      const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});
      state=cooling.state;actions.add(cooling.actions);paid.set(last.layerId,(paid.get(last.layerId)??0)+(cooling.coolingSeconds??0));
    }
    const layerId=state.selections&&/^planar:[\d.e+-]+$/.test(op.layerId)?'planar:'+Number(Number(op.layerId.slice(7)).toFixed(5)):op.layerId;
    if(!layerIndices.has(layerId))layerIndices.set(layerId,layerIndices.size);
    const effective=state.selections?{...op,layerId,layer:layerIndices.get(layerId)}:op;
    const entered=planOperationEntry(state,effective,elapsed.get(op.layerId)??0);
    const finalized=chosen.part.eligible?finalizeDepositionResult(chosen.part.result,args.plan,args.machine,{entryPosition:entered.state.position}):chosen.part.result;
    const finished=finalized.operations[0],planned=planPreparedOperation(entered.state,state.selections?{...finished,layerId,layer:effective.layer}:finished,{deposited});
    state=planned.state;actions.add(entered.actions);actions.add(planned.actions);elapsed.set(op.layerId,planned.operationSeconds);layerIds.add(op.layerId);last=finished;
    deposited.push(finished.travelPolicy);emitted.add(op.id);operationOrder.push(op.id);chosen.part.done=true;chosen.part.result=finalized;
    if(chosen.parts.every(part=>part.done)){
      const result=combineFinalizedResults(chosen.raw,chosen.parts.map(part=>part.result));
      completed.set(chosen.node.key,{node:chosen.node,result:publishDepositionWork(chosen.node,republishDepositedBoundary(result,{widthMm:args.plan.process.lineWidthMm}))});
    }
  }
  if(last&&!last.continuous){const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)});state=cooling.state;actions.add(cooling.actions);}
  const execution={state:{...state,operationId:undefined},actions:actions.finish(),summary:{operationOrder,layers:layerIds.size}};
  const results=[],supports=[];
  for(const record of contexts){
    const courses=nodes.filter(node=>node.kind==='slice'&&node.record===record).map(node=>completed.get(node.key).result);
    const result=combineCourses(record,courses);
    if(record.spec.id==='supports')requireThat(result.operations.length>0,'Assigned tree support produced no strokes; enlarge its branches.');
    (record.owner.kind==='support'?supports:results).push(result);
  }
  results.push(...nodes.filter(node=>node.kind!=='slice'&&node.construction!=='rivet').map(node=>completed.get(node.key).result));
  validateRivetClearance({plan:args.plan,sites:weldSites,modelResults:[...supports,...results]});
  const injections=nodes.filter(node=>node.construction==='rivet').map(node=>completed.get(node.key).result);
  if(injections.length)results.push({id:'plastic-weld',operations:injections.flatMap(result=>result.operations),report:{depositionFamily:'inject',sites:injections.flatMap(result=>result.report.sites),physicalValidation:'not performed'}});
  requireThat([...results,...supports].some(result=>result.operations.length),'The assignments produced no material.');
  const resultLayers=new Set([...results,...supports].flatMap(result=>result.operations.map(op=>op.layerId)));
  return {results:ownershipDependencies(results),supports,execution,summary:{layers:resultLayers.size,instances:[...results,...supports].map(result=>({id:result.id,...result.report}))}};
}
