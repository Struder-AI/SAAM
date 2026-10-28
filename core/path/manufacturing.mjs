// Construction publishes completion identities; consumers never expand a
// producer prerequisite into all of its courses or infer order from world Z.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {precedenceLookup} from './precedence.mjs';

// /4: a prerequisite founds only its declared scope (course `founded`
// intervals); /3 trusted every unit with any prerequisite, so its sources need
// regeneration before scheduling.
export const CONSTRUCTION_CONTRACT='saam-producer-validity/4';
export const RETIRED_CONSTRUCTION_CONTRACTS=['saam-producer-validity/3'];
export const completionId=(kind,id)=>'completion:'+kind+':'+id;

// Construction requirements identify trusted material history. Composition
// preferences never create that guarantee; geometric edges discovered during
// scheduling also remain outside this immutable graph.
export function constructionHistory(source){
  const graph=manufacturingDependencies(source,{includeComposition:false});
  const order=precedenceLookup([...graph.parents.keys()],
    [...graph.parents].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  requireThat(!order.cyclic,'Construction history must be acyclic.');
  const start=id=>graph.starts.get(id)??graph.courseStarts.get(id),end=id=>graph.ends.get(id)??graph.courseEnds.get(id);
  const endings=new Set([...graph.ends.values(),...graph.courseEnds.values()]),prerequisites=new Map();
  return {covers(before,after){
    const a=end(before),b=start(after);return a!==undefined&&b!==undefined&&before!==after&&order.has(a,b);
  },hasPrerequisites(id){
    const root=start(id);if(root===undefined)return null;
    if(prerequisites.has(root))return prerequisites.get(root);
    const pending=[...(graph.parents.get(root)??[])],seen=new Set();
    while(pending.length){
      const node=pending.pop();if(seen.has(node))continue;seen.add(node);
      if(endings.has(node)||prerequisites.get(node)===true){prerequisites.set(root,true);return true;}
      if(prerequisites.get(node)!==false)pending.push(...graph.parents.get(node));
    }
    for(const node of seen)prerequisites.set(node,false);prerequisites.set(root,false);return false;
  }};
}

export function publishManufacturing(results,operations,layers,nativeMembers=[]){
  const completions={},assignments=new Map(),parts=new Map(),stacks=new Map(),ownedLayers=new Set(),nativeByOwner=new Map(),afterByOwner=new Map();
  function ownerPart(owner,part){
    if(!assignments.has(owner))assignments.set(owner,new Set());
    if(!parts.has(owner))parts.set(owner,new Map());
    if(!parts.get(owner).has(part))parts.get(owner).set(part,new Set());
    return parts.get(owner).get(part);
  }
  const bound=(reference,part)=>typeof reference==='object'&&(reference.index!==undefined||reference.edge)&&!Object.hasOwn(reference,'part')?{...reference,part}:reference;
  for(const [id,layer] of Object.entries(layers)){
    layer.completionId=completionId('slice',id);
    completions[layer.completionId]={kind:'slice',members:[],after:[]};
    if(!stacks.has(layer.stackId))stacks.set(layer.stackId,[]);
    stacks.get(layer.stackId).push({id,...layer});
  }
  for(const stack of stacks.values()){
    stack.sort((a,b)=>(a.sequence??0)-(b.sequence??0));
    for(let i=1;i<stack.length;i++)completions[stack[i].completionId].after=[stack[i-1].completionId];
  }
  for(const result of results){
    const owner=result.report?.owner??result.id;
    if(!assignments.has(owner))assignments.set(owner,new Set());
    if(!result.operations.length)ownerPart(owner,result.report?.part??null);
    if(!afterByOwner.has(owner))afterByOwner.set(owner,[]);
    for(const reference of result.logicalAfter??[])afterByOwner.get(owner).push(bound(reference,result.report?.part??null));
    for(const authored of result.operations){
      const op=operations[authored.id];if(!op)continue;
      const layer=layers[op.layerId];
      if(layer)completions[layer.completionId].members.push(op.id);
      assignments.get(owner).add(op.id);
      ownerPart(owner,op.part??null).add(op.id);
      if(layer)ownedLayers.add(JSON.stringify([owner,op.part??null,op.layerId]));
    }
  }
  for(const member of nativeMembers){
    if(!nativeByOwner.has(member.owner))nativeByOwner.set(member.owner,[]);
    nativeByOwner.get(member.owner).push(member);
    if(ownedLayers.has(JSON.stringify([member.owner,member.part,member.id])))continue;
    // Own empty work remains distinct from the collective native slice, which
    // can also contain another producer's explicitly joined Trace courses.
    const id=completionId('empty',JSON.stringify([member.owner,member.part,member.id]));
    completions[id]={kind:'assignment',members:[],after:member.after.map(reference=>bound(reference,member.part))};
    completions[layers[member.id].completionId].members.push(id);
    ownerPart(member.owner,member.part).add(id);assignments.get(member.owner).add(id);
  }
  for(const [owner,members] of assignments)completions[completionId('assignment',owner)]={kind:'assignment',members:[...members],after:afterByOwner.get(owner)};
  function resolve(reference,consumer){
    if(typeof reference==='string'){
      requireThat(operations[reference]||completions[reference],'Manufacturing prerequisite names absent work: '+reference);
      return reference;
    }
    const members=assignments.get(reference.assignment);
    requireThat(members,'Manufacturing prerequisite names an absent producer: '+reference.assignment);
    if(reference.edge){
      const selected=[...members].flatMap(id=>{
        const operation=operations[id];if(!operation)return [];
        const layer=layers[operation.layerId];
        if((operation.part??null)!==(Object.hasOwn(reference,'part')?reference.part:consumer.part??null))return [];
        const matches=reference.index===undefined?operation.id===reference.assignment+':'+reference.repetition:layer?.index===reference.index;
        if(!matches)return [];
        return (operation.courses??[]).filter(course=>Object.hasOwn(reference.edge,'curve')?course.sourceCurve===reference.edge.curve:
          course.edge?.loop===reference.edge.loop&&course.edge?.ring===(reference.edge.ring??0)).map(course=>course.id);
      });
      requireThat(selected.length,'Manufactured edge has no emitted supporting curve: '+JSON.stringify(reference));
      const id=completionId('edge',JSON.stringify([reference.assignment,reference.index===undefined?['repetition',String(reference.repetition)]:['slice',reference.index],
        Object.hasOwn(reference,'part')?reference.part:consumer.part??null,
        Object.hasOwn(reference.edge,'curve')?['curve',reference.edge.curve]:['loop',reference.edge.loop,reference.edge.ring??0]]));
      completions[id]??={kind:'edge',members:selected,after:[]};return id;
    }
    if(reference.index===undefined){
      if(reference.part===undefined)return completionId('assignment',reference.assignment);
      const selected=parts.get(reference.assignment)?.get(reference.part);
      requireThat(selected,'Manufacturing prerequisite names an absent producer part.');
      const id=completionId('part',JSON.stringify([reference.assignment,reference.part]));
      completions[id]??={kind:'assignment',members:[...selected],after:[...(completions[completionId('assignment',reference.assignment)].after)]};return id;
    }
    const selected=new Set([...members].filter(id=>{
      const operation=operations[id];if(!operation)return false;
      const layer=layers[operation.layerId];
      return layer&&layer.index===reference.index&&(operation.part??null)===(Object.hasOwn(reference,'part')?reference.part:consumer.part??null);
    }).map(id=>layers[operations[id].layerId].completionId));
    for(const member of nativeByOwner.get(reference.assignment)??[])if(layers[member.id].index===reference.index&&
      member.part===(Object.hasOwn(reference,'part')?reference.part:consumer.part??null))selected.add(layers[member.id].completionId);
    requireThat(selected.size===1,'Slice prerequisite must select one native slice: '+reference.assignment+' / '+reference.index);
    return [...selected][0];
  }
  for(const op of Object.values(operations))op.after=[...new Set(op.after.map(reference=>resolve(reference,op)))];
  // Resolving a reference can add a part/edge completion. Its copied reference
  // list is also resolved, without treating empty work as an absent producer.
  const resolved=new Set();
  for(;;){const pending=Object.entries(completions).filter(([id])=>!resolved.has(id));if(!pending.length)break;
    for(const [id,record] of pending){record.after=[...new Set(record.after.map(reference=>resolve(reference,{})))];resolved.add(id);}}
  for(const result of results)for(const requirement of result.edgeAfter??[]){
    const consumer={part:requirement.target.part??result.report?.part??null},target=resolve(requirement.target,consumer);
    completions[target].after=[...new Set([...completions[target].after,...requirement.after.map(reference=>resolve(reference,consumer))])];
  }
  reduceManufacturing({operations,completions});
  return {completions};
}

export function reduceManufacturing(source){
  validateManufacturing(source);
  const graph=manufacturingDependencies(source),lookup=precedenceLookup([...graph.parents.keys()],
    [...graph.parents].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  const end=id=>graph.ends.get(id);
  for(const [id,record] of [...Object.entries(source.operations),...Object.entries(source.completions)]){
    const parents=graph.parents.get(graph.starts.get(id));
    record.after=[...new Set(record.after)].filter(previous=>![...parents].some(parent=>parent!==end(previous)&&lookup.has(end(previous),parent)));
  }
  for(const operation of Object.values(source.operations)){
    let changedCourses;
    for(const [index,course] of (operation.courses??[]).entries())if(course.after){
      const after=course.after.filter(previous=>![...graph.parents.get(graph.courseStarts.get(course.id))].some(parent=>
        parent!==graph.courseEnds.get(previous)&&lookup.has(graph.courseEnds.get(previous),parent)));
      if(after.length!==course.after.length){
        changedCourses??=operation.courses.slice();changedCourses[index]={...course,after};
      }
    }
    if(changedCourses)operation.courses=changedCourses;
  }
}

// Begin/end nodes express containment without copying every inherited
// prerequisite onto each member. A completion can itself contain completions.
export function manufacturingDependencies(source,{includeComposition=true}={}){
  const parents=new Map(),completions=source.completions??{},starts=new Map(),ends=new Map(),courseStarts=new Map(),courseEnds=new Map();
  const referenced=new Set(),owners=new Map();
  for(const completion of Object.values(completions))if(completion.kind==='edge')for(const member of completion.members)referenced.add(member);
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
    requireThat(Array.isArray(record.members)&&(record.members.length||record.kind==='slice'||record.kind==='assignment')&&Array.isArray(record.after),'Completion needs members and prerequisites.');
    edge(starts.get(id),ends.get(id));
    for(const member of record.members){edge(starts.get(id),starts.get(member)??courseStarts.get(member));edge(ends.get(member)??courseEnds.get(member),ends.get(id));}
    for(const previous of record.after)edge(ends.get(previous),starts.get(id));
  }
  if(includeComposition){
    const known=id=>starts.has(id),order=[...new Set(source.composition?.order??[])].filter(known);
    for(const {before,after} of source.composition?.dependencies??[])if(before!==after&&known(before)&&known(after))edge(ends.get(before),starts.get(after));
    for(let i=1;i<order.length;i++)edge(ends.get(order[i-1]),starts.get(order[i]));
  }
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
