// A producer establishes its internal access once, after all geometry/profile
// edits. The same solver used for composition is scoped to each producer here.
import {prepareCurvePath} from './curve-path.mjs';
import {resolveSourceOrder} from './compose.mjs';
import {reduceManufacturing,CONSTRUCTION_CONTRACT} from './manufacturing.mjs';
import {DEFAULT_NOZZLE_GEOMETRY} from '../geom/convex-clearance.mjs';
import {sliceNozzleProofs} from './physical-order.mjs';
import {manufacturingDependencies} from './manufacturing.mjs';
import {precedenceLookup} from './precedence.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';

function permittedTraversal(scene,unit,ref){
  const group=unit.layerId??unit.sourceOperation;
  const independent=scene.proofs.clear(group,group)||scene.proofs.unitClear(unit,unit);
  if(independent)return {directions:ref.directionRequired===false?[false,true]:[false],seamFree:ref.seamRequired===false};
  const body=scene.byId.get(unit.id),original=body.records,directions=[];
  for(const reverse of ref.directionRequired===false?[false,true]:[false]){
    const view={...ref,reverse},candidate={...unit,ranges:[view]};
    body.records=[scene.interval(view)];
    try{scene.verifySelf(candidate);directions.push(reverse);}catch(error){if(error.code!=='CONTINUOUS_NOZZLE_CONFLICT')throw error;}
  }
  body.records=original;
  requireThat(directions.length,'Construction has no valid traversal for course '+ref.id);
  return {directions,seamFree:false};
}

function wholeProducerProofs(source,reader){
  const proofs=sliceNozzleProofs(source,{reader}),producers=new Map(),known=new Set(),graph=manufacturingDependencies(source);
  const order=precedenceLookup([...graph.parents.keys()],[...graph.parents].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  for(const operation of Object.values(source.operations)){
    const producer=source.layers[operation.layerId]?.stackId??operation.construction,id=operation.layerId??operation.id;
    if(!producers.has(producer))producers.set(producer,new Map());
    const groups=producers.get(producer);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(operation);
  }
  for(const [producer,groups] of producers){
    const ids=[...groups.keys()],moving=ids.every(id=>groups.get(id).every(operation=>operation.kind==='deposit'&&!operation.occupied&&!operation.requiredMaterial?.length));
    if(!moving)continue;
    if(proofs.producerClear(producer,producer)){known.add(producer);continue;}
    const sequence=ids.every(id=>source.layers[id])?ids.toSorted((a,b)=>source.layers[a].index-source.layers[b].index):ids;
    const ordered=sequence.every((id,i)=>{
      if(!i)return true;
      const previous=sequence[i-1],a=source.layers[previous]?.completionId,b=source.layers[id]?.completionId;
      return a&&b?order.has(graph.ends.get(a),graph.starts.get(b)):
        groups.get(previous).every(before=>groups.get(id).every(after=>order.has(graph.ends.get(before.id),graph.starts.get(after.id))));
    });
    if(ordered&&proofs.orderedClear(sequence)){known.add(producer);continue;}
    const clear=ids.every(id=>ids.every(other=>{
      if(proofs.clear(id,other))return true;
      const a=source.layers[id],b=source.layers[other];
      if(a&&b&&a.stackId===b.stackId&&a.index<b.index)return true;
      return id!==other&&groups.get(id).every(before=>groups.get(other).every(after=>order.has(graph.ends.get(before.id),graph.starts.get(after.id))));
    }));
    if(clear)known.add(producer);
  }
  return {known,count:producers.size};
}

export function certifyConstruction(source,{onProgress}={}){
  const reader=prepareCurvePath(source),whole=wholeProducerProofs(source,reader);
  if(whole.known.size===whole.count&&!Object.values(source.operations).some(op=>op.resolveSubstrate||op.resolveInternalSubstrate||op.suppliesSubstrate)){
    source.manufacturing={contract:CONSTRUCTION_CONTRACT,accessGeometry:DEFAULT_NOZZLE_GEOMETRY,courseTraversal:{},
      summary:{wholeProducers:whole.count,refinedProducers:0,internalDependencies:0}};
    return source;
  }
  const solved=resolveSourceOrder(source,reader,{scope:'construction',constructionProofs:whole.known,onProgress,
    start:source.planning.start,nozzleGeometry:DEFAULT_NOZZLE_GEOMETRY});
  const references=new Map(),policies=new Map();
  const policyKey=ref=>JSON.stringify([ref.id,ref.from,ref.to]);
  for(const unit of solved.units)for(const ref of unit.ranges){
    if(!references.has(ref.id))references.set(ref.id,[]);
    references.get(ref.id).push(ref);
    const producer=source.layers[unit.layerId]?.stackId??unit.operation.construction;
    if(!policies.has(policyKey(ref)))policies.set(policyKey(ref),whole.known.has(producer)?
      {directions:ref.directionRequired===false?[false,true]:[false],seamFree:ref.seamRequired===false}:permittedTraversal(solved.scene,unit,ref));
  }
  const pieces=new Map(),courseTraversal={};
  for(const operation of Object.values(source.operations))if(operation.kind==='deposit'){
    const courses=operation.courses.flatMap(course=>{
      const refs=references.get(course.id).toSorted((a,b)=>a.from-b.from),unique=refs.filter((ref,i)=>!i||ref.from!==refs[i-1].from||ref.to!==refs[i-1].to);
      const parts=unique.map((ref,i)=>{
        const {seamRequired,...rest}=course;
        return {...rest,...(unique.length===1&&seamRequired!==undefined?{seamRequired}:{}),
          id:unique.length===1?course.id:course.id+':interval:'+i,from:ref.from,to:ref.to};
      });
      if(course.seamRequired&&parts.length>1){
        parts[0].directionRequired=true;
        for(const part of parts.slice(1))part.after=[...(part.after??[]),parts[0].id];
      }
      if(course.directionRequired!==false)for(let i=1;i<parts.length;i++)parts[i].after=[...(parts[i].after??[]),parts[i-1].id];
      pieces.set(course.id,parts);
      for(const [i,part] of parts.entries()){
        const permitted=policies.get(policyKey(unique[i])),policy={...permitted,directions:permitted.directions.filter(reverse=>!reverse||part.directionRequired===false)},expected=part.directionRequired===false?2:1;
        if(policy.directions.length!==expected||part.seamRequired===false&&!policy.seamFree)courseTraversal[part.id]=policy;
      }
      return parts;
    });
    operation.courses=courses;
  }
  for(const operation of Object.values(source.operations))for(const course of operation.courses??[])
    if(course.after)course.after=[...new Set(course.after.flatMap(id=>pieces.get(id)?.map(part=>part.id)??[id]))];
  for(const completion of Object.values(source.completions))if(completion.kind==='edge')
    completion.members=[...new Set(completion.members.flatMap(id=>pieces.get(id)?.map(part=>part.id)??[id]))];
  function touched(ref){
    return (pieces.get(ref.id)??[]).filter(part=>ref.at!==undefined?ref.at>=part.from&&ref.at<=part.to:part.from<ref.to&&part.to>ref.from);
  }
  for(const edge of solved.edges){
    if(edge.kind==='required-material'){
      source.operations[edge.afterOperation].after.push(edge.beforeOperation);continue;
    }
    const witness=edge.witness;
    requireThat(witness&&!witness.provisional,'Construction prerequisites need actual contact evidence.');
    if(!witness.receiver||!witness.material){source.operations[edge.afterOperation].after.push(edge.beforeOperation);continue;}
    const [beforeRef,afterRef]=edge.kind==='substrate'?[witness.material,witness.receiver]:[witness.receiver,witness.material];
    for(const before of touched(beforeRef))for(const after of touched(afterRef))if(before.id!==after.id)
      after.after=[...new Set([...(after.after??[]),before.id])];
  }
  reduceManufacturing(source);
  source.manufacturing={contract:CONSTRUCTION_CONTRACT,accessGeometry:DEFAULT_NOZZLE_GEOMETRY,courseTraversal,
    summary:{wholeProducers:whole.known.size,refinedProducers:whole.count-whole.known.size,internalDependencies:solved.edges.length,refinement:solved.refinement,queries:solved.scene.stats}};
  return source;
}
