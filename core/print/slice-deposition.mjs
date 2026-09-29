// Resolve ownership and prerequisites before selecting work. Every construction
// consumes finalized predecessor beads; authored rank never becomes run order.
import {prepareSliceContexts,sliceContextResult,ownershipDependencies} from './slices.mjs';
import {finalizeDepositionResult} from './finalize.mjs';
import {sleeveResult,rimResult} from './sleeve-constructions.mjs';
import {publishFinishedBoundary} from '../path/finished-surface.mjs';
import {depositedBeadSegments} from '../path/deposited-curves.mjs';
import {translateSlice} from '../geom/slice.mjs';
import {requireThat} from '../geom/tolerance.mjs';

function combineCourses(record,courses){
  if(!courses.length)return {id:record.spec.id,report:record.context.report,operations:[],family:{...record.family,layers:[]}};
  if(courses.length===1)return courses[0];
  const report={...record.context.report};
  for(const key of ['layers','skippedLayers','areaMm2','loops','fillRows','solidAreaMm2'])report[key]=courses.reduce((sum,r)=>sum+(r.report[key]??0),0);
  const contacts=courses.filter(r=>r.report.contactSamples);
  if(contacts.length){report.contactSamples=contacts.reduce((n,r)=>n+r.report.contactSamples,0);report.minContactGapMm=Math.min(...contacts.map(r=>r.report.minContactGapMm));report.maxContactGapMm=Math.max(...contacts.map(r=>r.report.maxContactGapMm));}
  const modulations=courses.map(r=>r.report.modulation).filter(Boolean);
  if(modulations.length)report.modulation={changed:modulations.some(m=>m.changed),
    materialChanged:modulations.some(m=>m.materialChanged),materialChangedOperations:modulations.flatMap(m=>m.materialChangedOperations??[]),
    operationModifiers:Object.assign({},...modulations.map(m=>m.operationModifiers??{})),
    maxExcursionMm:Math.max(...modulations.map(m=>m.maxExcursionMm)),
    changedOperations:modulations.flatMap(m=>m.changedOperations),modifiers:[...new Set(modulations.flatMap(m=>m.modifiers))]};
  const layers=courses.flatMap(r=>r.family.layers);
  return {...courses[0],report,operations:courses.flatMap(r=>r.operations),familyLayers:layers,
    family:{...record.family,layers},finishedSurfaces:courses.flatMap(r=>r.finishedSurfaces??[])};
}

// Expand construction and recipe constraints once to exact work-node keys.
export function prepareDepositionWork(contexts,constructions=[]){
  const nodes=contexts.flatMap(record=>{
    const units=record.spec.settings.join?[{index:null,rank:record.layerOrder[0]?.rank??0}]:record.layerOrder;
    return units.map((unit,i)=>({key:`slice:${record.spec.id}:${unit.index}`,kind:'slice',sourceId:record.owner.assignment.id,part:record.owner.part,
      nominalRank:unit.rank,index:unit.index,record,first:i===0,requires:i?[`slice:${record.spec.id}:${units[i-1].index}`]:[]}));
  }).concat(constructions.map(context=>({key:`${context.assignment.construction}:${context.assignment.id}`,kind:context.assignment.construction,
    sourceId:context.assignment.id,part:context.assignment.part,nominalRank:context.endMm??context.shell?.bounds.max[2]??0,context,requires:[]})));
  const operationBelongs=(node,id)=>node.kind==='slice'?id.startsWith(`${node.record.spec.id}:${node.index===null?'spiral':node.index+':'}`):id.startsWith(node.sourceId+':');
  return nodes.map(node=>{
    const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
    const after=assignment.dependencies?.after??assignment.after??[],needs=new Set(node.requires);
    for(const other of nodes){
      if(other===node)continue;
      const offers=other.kind==='slice'?other.record.spec.settings:other.context.assignment;
      if(other.sourceId!==node.sourceId&&(assignment.dependencies?.afterParts.includes(other.part)||offers.dependencies?.beforeParts.includes(node.part)))needs.add(other.key);
      if(after.some(id=>operationBelongs(other,id)))needs.add(other.key);
      if(node.kind==='slice'&&node.first&&node.record.contact){
        const source=node.record.contact.source;
        if(source!==null?other.sourceId===source&&other.part===node.part:
          other.part===node.part&&other.sourceId!==node.sourceId&&!(other.kind==='slice'&&other.record.contact)&&other.nominalRank<=node.nominalRank+1e-8)needs.add(other.key);
      }
      if(node.kind==='rim'&&other.sourceId===assignment.source&&other.part===node.part)needs.add(other.key);
      if(node.kind==='sleeve'&&other.part===node.part){
        if(other.kind==='slice'&&other.nominalRank<=node.context.startMm+1e-8||other.kind==='sleeve'&&other.context.endMm<=node.context.startMm+1e-8)needs.add(other.key);
      }
      if(node.kind==='slice'&&other.kind==='sleeve'&&other.part===node.part&&node.nominalRank>other.context.endMm+1e-8){
        requireThat(other.context.assignment.endTransition==='level','Slices above a sleeve need its ending transition to be level.');needs.add(other.key);
      }
    }
    if(node.kind==='slice'&&node.first&&node.record.contact?.source!==null&&node.record.contact?.source!==undefined)
      requireThat(nodes.some(other=>other.sourceId===node.record.contact.source&&other.part===node.part),`Skin ${node.sourceId}: supportFrom names an absent producer or a different part.`);
    return {...node,requires:[...needs]};
  });
}

export function readyDepositionWork(nodes,completed){
  return nodes.filter(node=>!completed.has(node.key)&&node.requires.every(key=>completed.has(key)))
    .sort((a,b)=>a.nominalRank-b.nominalRank||nodes.indexOf(a)-nodes.indexOf(b))[0]??null;
}

export function executeDepositionWork(node,completed,{plan,machine,onProgress}){
  const predecessors=[...completed.values()],samePart=predecessors.filter(item=>item.node.part===node.part);
  const after=[...new Set(node.requires.flatMap(key=>completed.get(key).result.operations.map(op=>op.id)))];
  let result;
  if(node.kind==='slice'){
    const record=node.record,layer=record.spec.layers.find(layer=>layer.index===node.index)??record.spec.layers[0];
    const own=samePart.filter(item=>item.node.kind==='slice'&&item.node.record.familyId===record.familyId&&item.node.index===node.index-1);
    const contacts=own.filter(item=>item.result.report.modulation?.materialChanged).flatMap(item=>depositedBeadSegments(item.result.operations,{widthMm:item.node.record.context.process.lineWidthMm}));
    const source=node.first?record.contact?.source:null;
    const candidates=samePart.filter(item=>item.node.sourceId!==node.sourceId&&(!source||item.node.sourceId===source));
    const contactFragments=candidates.map(item=>({layers:item.result.family?.layers??[],operations:item.result.operations,
      widthMm:item.node.kind==='slice'?item.node.record.context.process.lineWidthMm:item.node.context.process.lineWidthMm}));
    const seedSegments=record.spec.settings.fillOrder?.kind==='fronts'?samePart.filter(item=>item.node.sourceId!==node.sourceId||item.node.index===node.index-1).flatMap(item=>depositedBeadSegments(item.result.operations)):[];
    const predecessorReference=node.first&&record.contact?record.contact.predecessorReference:
      contactFragments.length?translateSlice(layer.slice,(layer.direction??layer.slice.normal).map(v=>-v*layer.translationMm)):null;
    result=sliceContextResult(record,{layerIndex:node.index,contactSegments:contacts,contactFragments,predecessorReference,seedSegments,requiredContact:node.first&&!!record.contact?.required});
  }else if(node.kind==='sleeve'){
    const context=node.context,assignment=context.assignment;
    const foundations=samePart.filter(item=>item.node.nominalRank<=context.startMm+1e-8);
    if(assignment.zStartMm>0){
      const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
      requireThat(Math.abs(grid-Math.round(grid))<1e-8,'A raised sleeve must start on its resolved process layer grid.');
      requireThat(foundations.some(item=>item.result.operations.length),'A raised sleeve needs supporting deposition below its start.');
    }
    const foundationSegments=assignment.zStartMm>0?depositedBeadSegments(foundations.flatMap(item=>item.result.operations),{widthMm:context.process.lineWidthMm}):[];
    result=sleeveResult({...context,machine,after,onProgress,foundationSegments});
    if(assignment.pattern===null&&!assignment.meshSleeve)result=publishFinishedBoundary(result,{shell:context.shell,boundary:'side',startMm:result.report.baseTopMm,
      endMm:result.report.endMm-(assignment.endTransition==='level'?0:context.process.layerMm),toleranceMm:assignment.boundaryToleranceMm});
  }else if(node.kind==='rim'){
    const context=node.context,sourceResult=predecessors.find(item=>item.node.sourceId===context.assignment.source&&item.node.part===node.part)?.result;
    const sourceAssignment=plan.slices.assignments.find(a=>a.id===context.assignment.source);
    result=rimResult({...context,machine,sourceResult,sourceAssignment});
  }else throw new Error(`Unsupported deposition construction ${node.kind}.`);
  const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
  const selected={...result,report:{...result.report,owner:node.sourceId,part:node.part},operations:result.operations.map(op=>({...op,part:node.part,
    after:[...new Set([...(op.after??[]),...after,...(assignment.dependencies?.after??assignment.after??[])])],...(assignment.filament===null?{}:{filament:assignment.filament})}))};
  return finalizeDepositionResult(selected,plan,machine);
}

export function finalizedSliceResults(args){
  const contexts=args.contexts??prepareSliceContexts(args).contexts,constructions=args.constructions??[];
  if(!contexts.length&&!constructions.length)return {results:[],supports:[],summary:null};
  const nodes=prepareDepositionWork(contexts,constructions),completed=new Map();
  while(completed.size<nodes.length){
    const node=readyDepositionWork(nodes,completed);
    requireThat(node,`Deposition dependencies contain a cycle: ${nodes.filter(node=>!completed.has(node.key)).map(node=>node.key).join(', ')}.`);
    const result=executeDepositionWork(node,completed,args);completed.set(node.key,{node,result});
  }
  const results=[],supports=[];
  for(const record of contexts){
    const courses=nodes.filter(node=>node.kind==='slice'&&node.record===record).map(node=>completed.get(node.key).result);
    (record.owner.kind==='support'?supports:results).push(combineCourses(record,courses));
  }
  results.push(...nodes.filter(node=>node.kind!=='slice').map(node=>completed.get(node.key).result));
  requireThat([...results,...supports].some(result=>result.operations.length),'The assignments produced no material.');
  const layerIds=new Set([...results,...supports].flatMap(result=>result.operations.map(op=>op.layerId)));
  return {results:ownershipDependencies(results),supports,summary:{layers:layerIds.size,instances:[...results,...supports].map(result=>({id:result.id,...result.report}))}};
}
