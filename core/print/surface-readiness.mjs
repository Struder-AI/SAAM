// Named relationships become completion identities. What lies beneath a
// member's material is never searched here; the Scheduler finds it.
export function traceSurfaceReadiness(assignment,contexts){
  const edgeAfter=(assignment.edgeAfter??[]).map(entry=>({...entry,after:[...entry.after]}));
  const indices=assignment.repeat?.stack?(assignment.repeat.indices??contexts.find(record=>record.owner.assignment.id===assignment.repeat.stack)?.spec.layers.map(layer=>layer.index)):null;
  const count=indices?.length??assignment.repeat?.count??1;
  for(let repetition=0;repetition<count;repetition++){
    const index=indices?.[repetition]??repetition;
    for(const [ordinal,curve] of assignment.curves.entries()){
      if(curve.repetitions&&!curve.repetitions.includes(index))continue;
      const reference=curve.uv?.reference;if(!reference)continue;
      let required=[];
      if(reference.kind==='slice'){
        const host=contexts.find(record=>record.owner.assignment.id===reference.assignment&&record.owner.part===(assignment.part??null));
        const selected=reference.index??(assignment.repeat?.stack?index:host?.spec.layers.findLast(layer=>layer.slice)?.index);
        if(selected===undefined)throw Error('Prepared slice surface is absent: '+reference.assignment+'.');
        required=[{assignment:reference.assignment,part:host?.owner.part??assignment.part??null,index:selected}];
      }
      // A Trace on a part surface declares no producer. Whatever lies beneath it
      // is undeclared, so the Scheduler qualifies its foundation and access.
      if(required.length){
        const target={assignment:assignment.id,part:assignment.part??null,repetition:assignment.repetitionIds?.[repetition]??repetition,edge:{curve:curve.id??ordinal}};
        const prior=edgeAfter.find(entry=>JSON.stringify(entry.target)===JSON.stringify(target));
        if(prior)prior.after=[...prior.after,...required];else edgeAfter.push({target,after:required});
      }
    }
  }
  return {...assignment,...(edgeAfter.length?{edgeAfter}:{})};
}

// A declared contact names the producers a stack rests on; it declares the
// whole named producer. Which of its slices lie beneath is the Scheduler's.
export function contactDeclaration(record,contexts){
  const contact=record.spec.settings.contact,explicit=contact?.source!==null&&contact?.source!==undefined;
  if(!contact?.surfaces?.length&&!explicit)return record;
  const sources=contact.surfaces?contact.surfaces.filter(surface=>surface.part===record.owner.part).map(surface=>surface.source):
    [typeof contact.source==='string'?{assignment:contact.source}:contact.source];
  const prerequisites=sources.map(reference=>{
    const part=Object.hasOwn(reference,'part')?reference.part:record.owner.part;
    if(!contexts.some(other=>other.owner.assignment.id===reference.assignment&&other.owner.part===part))
      throw Error('Contact surface names an absent support producer or different part: '+reference.assignment);
    return {assignment:reference.assignment,part};
  });
  return {...record,prerequisites:[...(record.prerequisites??[]),...prerequisites],
    spec:{...record.spec,layers:record.spec.layers.map(layer=>({...layer,onSubstrate:layer.onSubstrate??true}))}};
}
