// Application prepares work and extension dependencies before Toolpath runs.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {prepareSliceLayer} from './slice-preparation.mjs';
import {prepareReferenceSliceStack} from './slice-stacks.mjs';
import {prepareOwnedSliceRegions} from './slice-material.mjs';
import {layerStrokes} from '../region/layer-strokes.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareTraceSourceLayer} from './trace-source-preparation.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {AssignmentFailure,assignmentWork} from './assignment-failure.mjs';
import {traceSurfaceReadiness,referenceSliceReadiness,contactSliceReadiness,nativeBaseReadiness} from './surface-readiness.mjs';
// Extensions see prepared work only. Core retains the translation from work
// keys to whichever operations construction actually emits.
export function depositionWorkDescription(node){
  const record=node.record,context=node.context??record.context,assignment=context.assignment??record.spec.settings;
  const layers=record?record.spec.layers.filter(layer=>node.index===null||layer.index===node.index):[];
  const heights=layers.flatMap(layer=>layer.slice?layer.region?.flatMap(loop=>loop.map(uv=>evaluateSurface(layer.slice,uv).point[2]))??[]:[]);
  const points=assignment.curves?.flatMap(curve=>curve.points??[])??assignment.points?.map(record=>record.point)??[];
  const repeat=assignment.repeat?.translation?.[2]??0,repetitions=assignment.repeat?.count??1;
  const authored=points.flatMap(point=>[point[2],point[2]+repeat*(repetitions-1)]);
  const range=values=>values.reduce(([low,high],value)=>[Math.min(low,value),Math.max(high,value)],[Infinity,-Infinity]);
  const heightRange=heights.length?range([...heights,node.nominalRank]):authored.length?range(authored):
    [context.startMm??node.nominalRank,context.endMm??node.nominalRank];
  return {key:node.key,kind:node.kind,construction:node.construction,sourceId:node.sourceId,part:node.part,index:node.index,
    rank:node.nominalRank,startMm:context.startMm??context.shell?.bounds.min[2]??node.nominalRank,
    endMm:context.endMm??context.shell?.bounds.max[2]??node.nominalRank,assignment,process:context.process,
    reference:record?.reference?.selection??null,layers,
    heightRange,
    details:context.details??null};
}

// Expand construction and recipe constraints once to exact work-node keys.
export function prepareDepositionWork(contexts,constructions=[],work=[],dependencies=()=>({dependencies:[],notes:[]}),curveSources=[],{plan,shells=[]}={}){
  constructions=constructions.map(context=>context.prepare?assignmentWork({sourceId:context.assignment.id,kind:context.kind??'trace'},()=>context.prepare(context)):context);
  const materialReferences=constructions.flatMap(context=>(context.materialSurfaces??[]).map(surface=>({
    owner:{assignment:{id:surface.reference.assignment},part:surface.part,shell:context.shell},
    spec:{layers:surface.layers},prerequisite:surface.reference})));
  const materials=[...contexts,...materialReferences];
  const references={},active=new Set(),resolvedRecords=new Set();
  for(const [part,shell] of shells)for(const patch of shell.patches??[])references['patch:'+(part??'')+':'+patch.name]={patch};
  const resolveTrace=context=>{
    if(resolvedRecords.has(context))return;
    const a=context.assignment;
    requireThat(!active.has(context),'Prepared reference dependencies form a cycle.');active.add(context);
    const names=[a.source?.assignment,a.substrate?.assignment,a.repeat?.stack,...(a.curves??[]).map(curve=>curve.uv?.reference?.assignment)].filter(Boolean);
    const hosts=contexts.filter(record=>names.includes(record.owner.assignment.id)||names.includes(record.spec.id));
    for(const host of hosts)resolve(host);
    if(a.source){
      context.preparedLayers=new Map();
      const sourceHosts=hosts.filter(record=>(record.owner.assignment.id===a.source.assignment||record.spec.id===a.source.assignment)&&(a.part===null||a.part===record.owner.part));
      for(const host of sourceHosts)for(const layer of host.spec.layers){
        const prepared=assignmentWork({sourceId:a.id,kind:'trace'},()=>prepareTraceSourceLayer({...context,assignment:{...a,part:host.owner.part}},host,layer,plan));
        context.preparedLayers.set(host.spec.id+':'+layer.index,prepared);
      }
      context.preparedCurves=[...context.preparedLayers.values()].flatMap(prepared=>prepared.authored.curves);
    }
    active.delete(context);resolvedRecords.add(context);
  };
  const resolve=record=>{
    if(resolvedRecords.has(record))return;
    const assignment=record.owner.assignment;
    requireThat(!active.has(record),'Slice reference dependencies form a cycle.');active.add(record);
    const source=record.reference?.selection.kind==='terminal'?contexts.find(other=>other!==record&&other.owner.assignment.id===record.reference.source&&other.owner.part===record.owner.part)??
      [...constructions,...curveSources].find(other=>other.assignment.id===record.reference.source&&other.assignment.part===record.owner.part):null;
    if(source?.spec)resolve(source);
    else if(source?.assignment.construction==='curves')resolveTrace(source);
    if(record.reference)Object.assign(record,assignmentWork({sourceId:assignment.id,kind:'slice'},()=>prepareOwnedSliceRegions(prepareReferenceSliceStack(record,{source,references}))));
    const contactSources=[...(assignment.contact?.surfaces??[]).map(surface=>surface.source),...(assignment.contact?.source&&typeof assignment.contact.source==='object'?[assignment.contact.source]:[])];
    for(const contact of contactSources)for(const supporting of contexts.filter(other=>other!==record&&other.owner.assignment.id===contact.assignment&&
      other.owner.part===(Object.hasOwn(contact,'part')?contact.part:record.owner.part)))if(supporting.spec.layers.some(layer=>!layer.slice))resolve(supporting);
    Object.assign(record,assignmentWork({sourceId:assignment.id,kind:'slice'},()=>contactSliceReadiness(record,contexts,plan)));
    let fillState;
    record.preparedLayers=new Map();
    for(const [ordinal,layer] of record.spec.layers.entries()){
      const onSubstrate=layer.onSubstrate??Boolean(record.contact);
      const input={...layer,onSubstrate,fillState,gap:layer.gap??{advanceMm:layer.translationMm??layer.heightMm,direction:layer.direction,substrate:onSubstrate?null:record.context.substrate??null}};
      const nominal=assignmentWork({sourceId:assignment.id,kind:'slice'},()=>prepareSliceLayer(record.spec,record.context,input));
      const strokes=assignmentWork({sourceId:assignment.id,kind:'slice'},()=>layerStrokes(layer.region,{...nominal.strokeSettings,preparedLayout:nominal.preparedLayout}));
      fillState=strokes.nextFillState;
      record.preparedLayers.set(layer.index,{...nominal,preparedStrokes:strokes,ordinal,firstBedLayer:!onSubstrate&&ordinal===0});
    }
    record.spec={...record.spec,layers:record.spec.layers.map(layer=>record.preparedLayers.get(layer.index))};
    record.referenceStack={...record.referenceStack,layers:record.spec.layers};
    references['slice:'+record.spec.id]=record.referenceStack;
    if(record.owner.part===null||!references['slice:'+assignment.id])references['slice:'+assignment.id]=record.referenceStack;
    active.delete(record);resolvedRecords.add(record);
  };
  for(const record of contexts)assignmentWork({sourceId:record.owner.assignment.id,kind:'slice'},()=>resolve(record));
  for(const context of curveSources)assignmentWork({sourceId:context.assignment.id,kind:'trace'},()=>resolveTrace(context));
  for(const record of contexts)record.prerequisites=assignmentWork({sourceId:record.owner.assignment.id,kind:'slice'},()=>referenceSliceReadiness(record,materials));
  constructions=constructions.map(context=>context.assignment.construction==='curves'&&!context.assignment.source?
    {...context,assignment:assignmentWork({sourceId:context.assignment.id,kind:'trace'},()=>traceSurfaceReadiness(context.assignment,materials,shells))}:context);
  for(const record of contexts)Object.assign(record,assignmentWork({sourceId:record.owner.assignment.id,kind:'slice'},()=>nativeBaseReadiness(record,materials)));
  const baseNodes=contexts.flatMap(record=>{
    const units=record.referenceStack.constructTogether?[{index:null,rank:record.layerOrder[0]?.rank??0}]:record.layerOrder;
    return units.map((unit,i)=>({key:`slice:${record.spec.id}:${unit.index}`,kind:'slice',construction:record.spec.settings.construction??'slice',sourceId:record.owner.assignment.id,part:record.owner.part,
      construct:record.constructWork,providesSurface:record.providesSurface,nominalRank:unit.rank,index:unit.index,record,first:i===0,requires:[]}));
  }).concat(constructions.map(context=>({key:`${context.assignment.construction}:${context.assignment.id}`,kind:context.kind??assignmentFamily(context.assignment),construction:context.assignment.construction,
    construct:context.construct,providesSurface:context.providesSurface,sourceId:context.assignment.id,part:context.assignment.part??null,nominalRank:context.endMm??context.shell?.bounds.max[2]??0,context,materialContexts:materials,requires:[]}))).concat(work);
  const followers=curveSources.flatMap(context=>{
    const source=context.assignment.source,matching=baseNodes.filter(node=>node.kind==='slice'&&(node.sourceId===source.assignment||node.record.spec.id===source.assignment)&&(context.assignment.part===null||context.assignment.part===node.part));
    if(!matching.length)return [{key:'curves:'+context.assignment.id,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:context.assignment.part,context,nominalRank:0,requires:[]}];
    return matching.map(parent=>({key:'curves:'+context.assignment.id+':'+parent.record.spec.id+':'+parent.index,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:parent.part,
      context:{...context,assignment:{...context.assignment,part:parent.part}},parentKey:parent.key,index:parent.index,nominalRank:parent.nominalRank,requires:[parent.key]}));
  });
  const nodes=baseNodes.map(node=>({...node,requires:[...node.requires,...followers.filter(follower=>node.requires.includes(follower.parentKey)).map(follower=>follower.key)]})).concat(followers);
  const descriptions=nodes.map(node=>assignmentWork(node,()=>depositionWorkDescription(node)));
  const workCompletions=new Map(),completionKey=node=>'work-completion:'+JSON.stringify([node.sourceId,node.part]);
  for(const node of nodes){
    const key=completionKey(node);
    if(!workCompletions.has(key))workCompletions.set(key,{key,kind:'completion',sourceId:node.sourceId,part:node.part,requires:[]});
    workCompletions.get(key).requires.push(node.key);
  }
  const declared=nodes.map(node=>assignmentWork(node,()=>{
    const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
    const needs=new Set(node.requires),execution=new Set(node.kind==='slice'?[]:node.requires.filter(key=>key!==node.parentKey)),defaults=new Set();
    const references=node.construction==='curves'?[
      ...(assignment.repeat?.stack?(assignment.repeat.indices??[undefined]).map(index=>({assignment:assignment.repeat.stack,index})):[]),
      ...assignment.curves.map(curve=>curve.uv?.reference).filter(reference=>reference?.assignment)]:[];
    for(const other of nodes){
      if(other===node)continue;
      const offers=other.kind==='slice'?other.record.spec.settings:other.context.assignment;
      if(other.sourceId!==node.sourceId&&(assignment.dependencies?.afterParts.includes(other.part)||offers.dependencies?.beforeParts.includes(node.part)))needs.add(completionKey(other));
      if(references.some(reference=>(reference.assignment===other.sourceId||reference.assignment===other.record?.spec.id)&&
        (reference.index===undefined||reference.index===other.index)))needs.add(other.key);
      if(node.kind==='slice'&&node.record.reference?.selection.kind==='terminal'&&other.part===node.part&&
        node.record.reference.source===other.sourceId)needs.add(other.key);
      if(node.kind==='trace'&&assignment.curves?.some(c=>c.contact)&&(other.kind!=='trace'||nodes.indexOf(other)<nodes.indexOf(node)))defaults.add(other.key);

    }
    if(node.kind==='slice'&&node.first&&typeof node.record.contact?.source==='string')
      if(!nodes.some(other=>other.sourceId===node.record.contact.source&&other.part===node.part))throw new AssignmentFailure(node,Error('Contact source names an absent producer or a different part.'));
    const declaredDependencies=assignmentWork(node,()=>dependencies(descriptions[nodes.indexOf(node)],descriptions));
    for(const key of declaredDependencies.dependencies){needs.add(key);execution.add(key);}
    return {...node,requires:[...needs],executionRequires:[...execution],defaults:[...defaults],dependencyNotes:declaredDependencies.notes};
  }));
  declared.push(...workCompletions.values());
  // Unnamed substrate/bridge inputs use available producers, excluding explicit
  // downstream consumers. Explicit recipe edges always retain their meaning.
  const dependsOn=(key,target,seen=new Set())=>{
    if(key===target)return true;if(seen.has(key))return false;seen.add(key);
    return (declared.find(node=>node.key===key)?.requires??[]).some(prior=>dependsOn(prior,target,seen));
  };
  const prepared=declared.map(({defaults=[],...node})=>({...node,requires:[...new Set([...node.requires,...defaults.filter(key=>!dependsOn(key,node.key))])]}));
  const byKey=new Map(prepared.map(node=>[node.key,node]));
  const reaches=(key,target,seen=new Set())=>{
    if(key===target)return true;if(seen.has(key))return false;seen.add(key);
    return (byKey.get(key)?.requires??[]).some(prior=>reaches(prior,target,seen));
  };
  // A completion already includes its predecessors. Retain only independent
  // prerequisites; preserve cyclic edges so construction reports the real error.
  return prepared.map(node=>({...node,requires:node.requires.filter(key=>!node.requires.some(other=>
    other!==key&&reaches(other,key)&&!reaches(key,other)))}));
}
