// Application prepares work and extension dependencies before Toolpath runs.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {isDeepStrictEqual} from 'node:util';
import {constructSliceStack} from './slice-preparation.mjs';
import {prepareReferenceSliceStack} from './slice-stacks.mjs';
import {prepareOwnedSliceRegions} from '../region/masks.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareTraceSourceLayer} from './trace-source-preparation.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {AssignmentFailure,assignmentWork} from './assignment-failure.mjs';
import {traceSurfaceReadiness,contactDeclaration} from './surface-readiness.mjs';
// The producer a Slice member's prepared-surface reference names: another Slice
// member on the same part, or a construction or curve source on it.
export function referenceSource(record,contexts,producers=[]){
  if(record.reference?.selection.kind!=='slice')return null;
  return contexts.find(other=>other!==record&&other.owner.assignment.id===record.reference.source&&other.owner.part===record.owner.part)??
    producers.find(other=>other.assignment.id===record.reference.source&&other.assignment.part===record.owner.part)??null;
}
// Member layers: a Slice member's owned material on each of its surfaces,
// resolved through the prepared surface it references. Construction slices
// exactly these layers; Recipe.slices returns them.
export function memberLayers(record,{source,references,preparedReferences}={}){
  return record.reference?prepareOwnedSliceRegions(prepareReferenceSliceStack(record,{source,references,preparedReferences})):record;
}
// Expand construction and recipe constraints once to exact work-node keys.
export function prepareDepositionWork(contexts,constructions=[],curveSources=[],{plan,shells=[],onProgress,preparedConstructions=new Map(),preparedLayouts=new Map(),preparedReferences}={}){
  constructions=constructions.map(context=>{
    if(!context.prepare)return context;
    if(!preparedConstructions.has(context))preparedConstructions.set(context,
      assignmentWork({sourceId:context.assignment.id,kind:context.kind??'trace'},()=>context.prepare(context)));
    return preparedConstructions.get(context);
  });
  const materialReferences=constructions.flatMap(context=>(context.materialSurfaces??[]).map(surface=>({
    owner:{assignment:{id:surface.reference.assignment},part:surface.part,shell:context.shell},
    spec:{layers:surface.layers},prerequisite:surface.reference})));
  const materials=[...contexts,...materialReferences];
  const references={},active=new Set(),resolvedRecords=new Set();
  for(const [part,shell] of shells)references['part:'+(part??'')]={shell};
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
  // Construct Slice: the operation's recipe, process and members, with the
  // identity its finalized work is associated with.
  const constructSlice=(record,{onProgress}={})=>constructSliceStack(record.spec,{...record.context,onSubstrate:Boolean(record.contact),reference:Boolean(record.reference)},{plan,onProgress,
    work:{owner:record.owner.assignment.id,part:record.owner.part,stackId:record.stackId,referenceStack:record.referenceStack,
      toolPose:record.spec.settings.toolPose??null,filament:record.spec.settings.filament===null?record.spec.filament??null:record.spec.settings.filament}});
  const resolve=record=>{
    if(resolvedRecords.has(record))return;
    const assignment=record.owner.assignment;
    requireThat(!active.has(record),'Slice reference dependencies form a cycle.');active.add(record);
    const source=referenceSource(record,contexts,[...constructions,...curveSources]);
    if(source?.spec)resolve(source);
    else if(source?.assignment.construction==='curves')resolveTrace(source);
    if(record.reference)Object.assign(record,assignmentWork({sourceId:assignment.id,kind:'slice'},()=>memberLayers(record,{source,references,preparedReferences})));
    Object.assign(record,assignmentWork({sourceId:assignment.id,kind:'slice'},()=>contactDeclaration(record,contexts)));
    const layoutInputs={spec:record.spec,context:record.context,referenceStack:record.referenceStack,contact:record.contact};
    const prior=preparedLayouts.get(record.spec.id);
    if(prior&&isDeepStrictEqual(prior.inputs,layoutInputs)){
      record.preparedLayers=prior.layers;record.sliceWork=prior.finalized;
      onProgress?.({stage:'Reusing Slice work',assignment:assignment.id,completed:record.spec.layers.length,total:record.spec.layers.length});
    }else{
      const slice=assignmentWork({sourceId:assignment.id,kind:'slice'},()=>constructSlice(record,
        {onProgress:progress=>onProgress?.({...progress,assignment:assignment.id})}));
      record.preparedLayers=slice.layers;record.sliceWork=slice.finalized;
      preparedLayouts.set(record.spec.id,{inputs:layoutInputs,layers:slice.layers,finalized:slice.finalized});
    }
    record.spec={...record.spec,layers:record.spec.layers.map(layer=>record.preparedLayers.get(layer.index))};
    record.referenceStack={...record.referenceStack,layers:record.spec.layers};
    references['slice:'+record.spec.id]=record.referenceStack;
    if(record.owner.part===null||!references['slice:'+assignment.id])references['slice:'+assignment.id]=record.referenceStack;
    active.delete(record);resolvedRecords.add(record);
  };
  for(const record of contexts)assignmentWork({sourceId:record.owner.assignment.id,kind:'slice'},()=>resolve(record));
  constructions=constructions.map(context=>context.assignment.construction==='curves'&&!context.assignment.source?
    {...context,assignment:assignmentWork({sourceId:context.assignment.id,kind:'trace'},()=>traceSurfaceReadiness(context.assignment,materials))}:context);
  // Construction publishes declared relations only. Material entering a member
  // over another producer's work is not declared here; the Scheduler qualifies it.
  for(const context of curveSources)assignmentWork({sourceId:context.assignment.id,kind:'trace'},()=>resolveTrace(context));
  const baseNodes=contexts.flatMap(record=>{
    const layers=new Map(record.spec.layers.map(layer=>[layer.index,layer]));
    return record.layerOrder.map((unit,i)=>({key:`slice:${record.spec.id}:${unit.index}`,kind:'slice',construction:record.spec.settings.construction??'slice',sourceId:record.owner.assignment.id,part:record.owner.part,
      index:unit.index,layer:layers.get(unit.index),record,first:i===0,requires:[]}));
  }).concat(constructions.map(context=>({key:`${context.assignment.construction}:${context.assignment.id}`,kind:context.kind??assignmentFamily(context.assignment),construction:context.assignment.construction,
    construct:context.construct,sourceId:context.assignment.id,part:context.assignment.part??null,context,materialContexts:materials,requires:[]})));
  const sourceSlices=new Map();
  for(const node of baseNodes.filter(node=>node.kind==='slice'))for(const name of new Set([node.sourceId,node.record.spec.id])){
    if(!sourceSlices.has(name))sourceSlices.set(name,[]);sourceSlices.get(name).push(node);
  }
  const followers=curveSources.flatMap(context=>{
    const source=context.assignment.source,matching=(sourceSlices.get(source.assignment)??[]).filter(node=>context.assignment.part===null||context.assignment.part===node.part);
    if(!matching.length)return [{key:'curves:'+context.assignment.id,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:context.assignment.part,context,requires:[]}];
    return matching.map(parent=>({key:'curves:'+context.assignment.id+':'+parent.record.spec.id+':'+parent.index,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:parent.part,
      context:{...context,assignment:{...context.assignment,part:parent.part}},parentKey:parent.key,index:parent.index,requires:[parent.key]}));
  });
  const nodes=baseNodes.concat(followers);
  const workCompletions=new Map(),completionKey=node=>'work-completion:'+JSON.stringify([node.sourceId,node.part]);
  const byPart=new Map(),beforePart=new Map(),byReference=new Map();
  const addCompletion=(index,part,completion)=>{if(!index.has(part))index.set(part,new Set());index.get(part).add(completion);};
  for(const node of nodes){
    const key=completionKey(node);
    if(!workCompletions.has(key))workCompletions.set(key,{key,kind:'completion',sourceId:node.sourceId,part:node.part,requires:[]});
    const completion=workCompletions.get(key);completion.requires.push(node.key);
    addCompletion(byPart,node.part,completion);
    const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
    for(const part of assignment.dependencies?.beforeParts??[])addCompletion(beforePart,part,completion);
    for(const name of new Set([node.sourceId,node.record?.spec.id].filter(name=>name!==undefined))){
      if(!byReference.has(name))byReference.set(name,{all:[],indices:new Map()});
      const index=byReference.get(name);index.all.push(node);
      if(!index.indices.has(node.index))index.indices.set(node.index,[]);index.indices.get(node.index).push(node);
    }
  }
  const referenced=(name,index)=>index===undefined?byReference.get(name)?.all??[]:byReference.get(name)?.indices.get(index)??[];
  const declared=nodes.map(node=>assignmentWork(node,()=>{
    const assignment=node.kind==='slice'?node.record.spec.settings:node.context.assignment;
    const needs=new Set(node.requires);
    const references=node.construction==='curves'?[
      ...(assignment.repeat?.stack?(assignment.repeat.indices??[undefined]).map(index=>({assignment:assignment.repeat.stack,index})):[]),
      ...assignment.curves.map(curve=>curve.uv?.reference).filter(reference=>reference?.assignment),
      ...assignment.curves.filter(curve=>typeof curve.contact?.source==='string').map(curve=>({assignment:curve.contact.source}))]:[];
    for(const part of assignment.dependencies?.afterParts??[])for(const other of byPart.get(part)??[])
      if(other.sourceId!==node.sourceId)needs.add(other.key);
    for(const other of beforePart.get(node.part)??[])if(other.sourceId!==node.sourceId)needs.add(other.key);
    for(const reference of references)for(const other of referenced(reference.assignment,reference.index))if(other!==node)needs.add(other.key);
    if(node.kind==='slice'&&node.record.reference?.selection.kind==='slice')
      for(const other of referenced(node.record.reference.source,node.record.reference.selection.index))if(other!==node&&other.part===node.part&&other.sourceId===node.record.reference.source)needs.add(other.key);
    if(node.kind==='slice'&&node.first&&typeof node.record.contact?.source==='string')
      if(!workCompletions.has(completionKey({sourceId:node.record.contact.source,part:node.part})))throw new AssignmentFailure(node,Error('Contact source names an absent producer or a different part.'));
    return {...node,requires:[...needs]};
  }));
  return declared.concat([...workCompletions.values()]);
}
