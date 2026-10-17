// Construction publishes completion identities; consumers never expand a
// producer prerequisite into all of its courses or infer order from world Z.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {precedenceLookup} from './precedence.mjs';

export const completionId=(kind,id)=>'completion:'+kind+':'+id;

export function publishManufacturing(results,operations,layers){
  const completions={},assignments=new Map(),stacks=new Map();
  for(const [id,layer] of Object.entries(layers)){
    layer.completionId=completionId('slice',id);
    completions[layer.completionId]={kind:'slice',members:[],after:[]};
    if(!stacks.has(layer.stackId))stacks.set(layer.stackId,[]);
    stacks.get(layer.stackId).push({id,...layer});
  }
  for(const stack of stacks.values()){
    stack.sort((a,b)=>a.index-b.index);
    for(let i=1;i<stack.length;i++)completions[stack[i].completionId].after=[stack[i-1].completionId];
  }
  for(const result of results){
    const owner=result.report?.owner??result.id;
    for(const authored of result.operations){
      const op=operations[authored.id];if(!op)continue;
      if(!assignments.has(owner))assignments.set(owner,new Set());
      const layer=layers[op.layerId];
      if(layer)completions[layer.completionId].members.push(op.id);
      assignments.get(owner).add(op.id);
    }
  }
  for(const [owner,members] of assignments)completions[completionId('assignment',owner)]={kind:'assignment',members:[...members],after:[]};
  function resolve(reference,consumer){
    if(typeof reference==='string'){
      requireThat(operations[reference]||completions[reference],'Manufacturing prerequisite names absent work: '+reference);
      return reference;
    }
    const members=assignments.get(reference.assignment);
    requireThat(members?.size,'Manufacturing prerequisite names an absent producer: '+reference.assignment);
    if(reference.index===undefined){
      if(reference.part===undefined)return completionId('assignment',reference.assignment);
      const selected=[...members].filter(id=>(operations[id].part??null)===reference.part);
      requireThat(selected.length,'Manufacturing prerequisite names an absent producer part.');
      const id=completionId('part',JSON.stringify([reference.assignment,reference.part]));
      completions[id]={kind:'assignment',members:selected,after:[]};return id;
    }
    const selected=new Set([...members].filter(id=>{
      const operation=operations[id],layer=layers[operation.layerId];
      return layer&&layer.index===reference.index&&(operation.part??null)===(Object.hasOwn(reference,'part')?reference.part:consumer.part??null);
    }).map(id=>layers[operations[id].layerId].completionId));
    requireThat(selected.size===1,'Slice prerequisite must select one native slice: '+reference.assignment+' / '+reference.index);
    return [...selected][0];
  }
  for(const op of Object.values(operations))op.after=[...new Set(op.after.map(reference=>resolve(reference,op)))];
  reduceManufacturing({operations,completions});
  return {completions};
}

export function reduceManufacturing(source){
  validateManufacturing(source);
  const graph=manufacturingDependencies(source),lookup=precedenceLookup([...graph.parents.keys()],
    [...graph.parents].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  const end=id=>graph.ends.get(id);
  function independent(ids){
    const unique=[...new Set(ids)];if(unique.length<2)return unique;
    if(unique.length*unique.length<=graph.parents.size)return unique.filter(previous=>!unique.some(other=>other!==previous&&lookup.has(end(previous),end(other))));
    // Large completions need one reverse walk, not one closure per member pair.
    const candidates=new Map(unique.map(id=>[end(id),id])),covered=new Set(),seen=new Set(),pending=[];
    for(const id of unique)for(const parent of graph.parents.get(end(id)))pending.push(parent);
    while(pending.length){const node=pending.pop();if(seen.has(node))continue;seen.add(node);
      if(candidates.has(node))covered.add(candidates.get(node));for(const parent of graph.parents.get(node))pending.push(parent);
    }
    return unique.filter(id=>!covered.has(id));
  }
  for(const [id,record] of [...Object.entries(source.operations),...Object.entries(source.completions)]){
    const parents=graph.parents.get(graph.starts.get(id));
    record.after=[...new Set(record.after)].filter(previous=>![...parents].some(parent=>parent!==end(previous)&&lookup.has(end(previous),parent)));
  }
  for(const record of Object.values(source.completions))if(record.kind==='assignment')record.members=independent(record.members);
  for(const operation of Object.values(source.operations))for(const course of operation.courses??[])if(course.after)
    course.after=course.after.filter(previous=>!course.after.some(other=>other!==previous&&lookup.has(graph.courseEnds.get(previous),graph.courseEnds.get(other))));
}

// Begin/end nodes express containment without copying every inherited
// prerequisite onto each member. A completion can itself contain completions.
export function manufacturingDependencies(source){
  const parents=new Map(),completions=source.completions??{},starts=new Map(),ends=new Map(),courseStarts=new Map(),courseEnds=new Map();
  const referenced=new Set(),owners=new Map();
  for(const operation of Object.values(source.operations))for(const course of operation.courses??[]){
    if(course.after?.length){referenced.add(course.id);for(const previous of course.after)referenced.add(previous);}
  }
  for(const operation of Object.values(source.operations))for(const [index,course] of (operation.courses??[]).entries())if(referenced.has(course.id)){
    requireThat(!owners.has(course.id),'Duplicate manufacturing course identity.');owners.set(course.id,{operation,index});
  }
  function item(id,beginnings,completions){
    requireThat(!beginnings.has(id),'Duplicate manufacturing identity.');
    const begin=Symbol(id+' begin'),end=Symbol(id+' end');
    beginnings.set(id,begin);completions.set(id,end);parents.set(begin,new Set());parents.set(end,new Set());
  }
  for(const operation of Object.values(source.operations)){
    item(operation.id,starts,ends);
    for(const course of operation.courses??[])if(referenced.has(course.id)){
      if(operation.interruptible===false||operation.continuous){courseStarts.set(course.id,starts.get(operation.id));courseEnds.set(course.id,ends.get(operation.id));}
      else item(course.id,courseStarts,courseEnds);
    }
  }
  for(const id of Object.keys(completions))item(id,starts,ends);
  function edge(before,after){
    requireThat(parents.has(before)&&parents.has(after),'Manufacturing prerequisite names absent work.');
    if(before!==after)parents.get(after).add(before);
  }
  for(const operation of Object.values(source.operations)){
    edge(starts.get(operation.id),ends.get(operation.id));
    for(const course of operation.courses??[])if(referenced.has(course.id)){
      edge(starts.get(operation.id),courseStarts.get(course.id));edge(courseStarts.get(course.id),courseEnds.get(course.id));edge(courseEnds.get(course.id),ends.get(operation.id));
      for(const previous of course.after??[]){
        const prior=owners.get(previous);
        requireThat(prior&&previous!==course.id,'Course prerequisite names absent or identical work.');
        if((operation.interruptible===false||operation.continuous)&&prior.operation===operation){
          requireThat(prior.index<owners.get(course.id).index,'Atomic work must retain its required course sequence.');continue;
        }
        edge(courseEnds.get(previous),courseStarts.get(course.id));
      }
    }
    for(const previous of operation.after)edge(ends.get(previous),starts.get(operation.id));
  }
  for(const [id,record] of Object.entries(completions)){
    requireThat(Array.isArray(record.members)&&record.members.length&&Array.isArray(record.after),'Completion needs members and prerequisites.');
    edge(starts.get(id),ends.get(id));
    for(const member of record.members){edge(starts.get(id),starts.get(member));edge(ends.get(member),ends.get(id));}
    for(const previous of record.after)edge(ends.get(previous),starts.get(id));
  }
  const known=id=>starts.has(id),order=[...new Set(source.composition?.order??[])].filter(known);
  for(const {before,after} of source.composition?.dependencies??[])if(before!==after&&known(before)&&known(after))edge(ends.get(before),starts.get(after));
  for(let i=1;i<order.length;i++)edge(ends.get(order[i-1]),starts.get(order[i]));
  return {parents,starts,ends,courseStarts,courseEnds};
}

export function validateManufacturing(source){
  const graph=manufacturingDependencies(source),following=new Map([...graph.parents.keys()].map(id=>[id,[]]));
  const remaining=new Map(),ready=[];
  for(const [id,parents] of graph.parents){remaining.set(id,parents.size);if(!parents.size)ready.push(id);for(const parent of parents)following.get(parent).push(id);}
  for(let i=0;i<ready.length;i++)for(const next of following.get(ready[i])){
    remaining.set(next,remaining.get(next)-1);if(!remaining.get(next))ready.push(next);
  }
  requireThat(ready.length===remaining.size,'Manufacturing prerequisites or completion membership contain a cycle.');
}
