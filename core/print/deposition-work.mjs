// Application prepares work and extension dependencies before Toolpath runs.
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {prepareSliceLayer} from './slices.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {AssignmentFailure,assignmentWork} from './assignment-failure.mjs';
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
    for(const parent of matching){
      const record=parent.record,layer=record.spec.layers.find(layer=>layer.index===parent.index);
      record.prepareForSource=true;
      record.preparedLayers??=new Map();
      // A source consumes the same nominal layout as Slice, prepared once.
      if(layer?.region&&layer.slice){
        record.preparedLayers.set(parent.index,assignmentWork(parent,()=>prepareSliceLayer(record.spec,record.context,layer)));
      }
    }
    return matching.map(parent=>({key:'curves:'+context.assignment.id+':'+parent.record.spec.id+':'+parent.index,kind:'trace',construction:'curves',sourceId:context.assignment.id,part:parent.part,
      context:{...context,assignment:{...context.assignment,part:parent.part}},parentKey:parent.key,index:parent.index,nominalRank:parent.nominalRank,requires:[parent.key]}));
  });
  const nodes=baseNodes.map(node=>({...node,requires:[...node.requires,...followers.filter(follower=>node.requires.includes(follower.parentKey)).map(follower=>follower.key)]})).concat(followers);
  const descriptions=nodes.map(node=>assignmentWork(node,()=>depositionWorkDescription(node)));
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
    const declaredDependencies=assignmentWork(node,()=>dependencies(descriptions[nodes.indexOf(node)],descriptions));
    for(const key of declaredDependencies.dependencies)needs.add(key);
    return {...node,requires:[...needs],defaults:[...defaults],dependencyNotes:declaredDependencies.notes};
  }));
  // Unnamed substrate/bridge inputs use available producers, excluding explicit
  // downstream consumers. Explicit recipe edges always retain their meaning.
  const dependsOn=(key,target,seen=new Set())=>{
    if(key===target)return true;if(seen.has(key))return false;seen.add(key);
    return (declared.find(node=>node.key===key)?.requires??[]).some(prior=>dependsOn(prior,target,seen));
  };
  const prepared=declared.map(({defaults,...node})=>({...node,requires:[...new Set([...node.requires,...defaults.filter(key=>!dependsOn(key,node.key))])]}));
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
