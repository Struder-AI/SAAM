// Generation retains authored prerequisite identities when producers fail.
// Failure closure lives here; operation scheduling and geometry policy do not.
import {AssignmentFailure,assignmentFailureNote} from './assignment-failure.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {assemblyComponents} from '../geom/selections.mjs';
const list=value=>Array.isArray(value)?value:[];
function requiredReferences(a){
  const settings=[a,...list(a.sliceOverrides)],source=value=>typeof value==='string'?{assignment:value}:value;
  return [...list(a.after),...list(a.dependencies?.after),
    ...settings.flatMap(s=>[...Object.values(s.operationAfter??{}).flatMap(list),...list(s.edgeAfter).flatMap(e=>list(e.after))]),
    a.substrate,a.source?.assignment&&{assignment:a.source.assignment},a.repeat?.stack&&{assignment:a.repeat.stack},
    ['slice','terminal'].includes(a.surface?.kind)&&{assignment:a.surface.assignment},source(a.contact?.source),
    ...list(a.contact?.surfaces).map(s=>source(s.source)),
    ...list(a.curves).flatMap(c=>[c.uv?.reference?.assignment&&{assignment:c.uv.reference.assignment},source(c.contact?.source)])].filter(Boolean);
}
export function assignmentGeneration(intent,failures=[]){
  const records=new Map(),owners=new Map(),requirements=new Map(),dependents=new Map(),pending=new Map(),failed=new Map(),queue=[],operationOwners=new Map();
  let aliases=[];
  const owner=id=>owners.get(id)??id;
  const fail=(id,error)=>{
    id=owner(id);if(failed.has(id))return;
    failed.set(id,error instanceof AssignmentFailure&&error.assignment===id?error:new AssignmentFailure({sourceId:id,kind:assignmentFamily(records.get(id)?.assignment??{})},error));queue.push(id);
  };
  const flush=()=>{
    for(let i=0;i<queue.length;i++)for(const consumer of dependents.get(queue[i])??[])
      fail(consumer,Error('Required producer '+queue[i]+' failed.'));
    queue.length=0;
  };
  const requireProducer=(consumer,producer)=>{
    consumer=owner(consumer);producer=owner(producer);if(consumer===producer)return;
    if(!requirements.has(consumer))requirements.set(consumer,new Set());
    if(requirements.get(consumer).has(producer))return;
    requirements.get(consumer).add(producer);
    if(!dependents.has(producer))dependents.set(producer,new Set());
    dependents.get(producer).add(consumer);
    if(failed.has(producer))fail(consumer,Error('Required producer '+producer+' failed.'));
  };
  const resolve=reference=>{
    const id=typeof reference==='string'?reference:reference?.assignment;
    if(typeof id!=='string')return null;
    if(operationOwners.has(id))return owner(operationOwners.get(id));
    if(records.has(id))return owner(id);
    return aliases.find(([alias])=>id===alias||typeof reference==='string'&&id.startsWith(alias+':'))?.[1]??null;
  };
  const link=(consumer,reference)=>{
    const producer=resolve(reference);
    if(producer!==null)requireProducer(consumer,producer);
    else pending.set(JSON.stringify([consumer,reference]),[consumer,reference]);
  };
  const resolvePending=()=>{for(const [key,[consumer,reference]] of pending){const producer=resolve(reference);if(producer!==null){requireProducer(consumer,producer);pending.delete(key);}}};
  const register=(plan,assignmentOwners=new Map())=>{
    flush();
    for(const [id,primary] of assignmentOwners)owners.set(id,primary);
    const geometry=plan.geometry?.shape==='spatial'?plan.geometry.solid:plan.geometry;
    for(const assignment of list(plan.slices?.assignments)){
      if(typeof assignment?.id!=='string')continue;
      const parts=!assignment.construction&&!assignment.geometry&&assignment.part===null&&geometry?.shape==='assembly'
        ?assemblyComponents(geometry.parts).map(part=>part.id):[assignment.part??null];
      records.set(assignment.id,{assignment,parts:new Set([...(records.get(assignment.id)?.parts??[]),...parts])});
    }
    aliases=[...records].flatMap(([id,{parts}])=>[id,...[...parts].filter(p=>p!==null).map(p=>p+':'+id)].map(alias=>[alias,owner(id)])).sort((a,b)=>b[0].length-a[0].length);
    // Atomic contribution ownership may arrive after an earlier geometry failure.
    for(const [id,failure] of [...failed])if(owner(id)!==id){failed.delete(id);fail(owner(id),failure.cause);}
    const prior=[...requirements].flatMap(([id,required])=>[...required].map(producer=>[id,producer]));
    requirements.clear();dependents.clear();for(const [id,producer] of prior)requireProducer(id,producer);
    for(const [id,{assignment:a,parts}] of records){
      for(const reference of requiredReferences(a))link(id,reference);
      for(const [other,{assignment:b,parts:otherParts}] of records)if(id!==other&&
        (list(a.dependencies?.afterParts).some(p=>otherParts.has(p))||list(b.dependencies?.beforeParts).some(p=>parts.has(p))))requireProducer(id,other);
    }
    for(const edge of list(plan.composition?.dependencies)){const consumer=resolve(edge.after);if(consumer!==null)link(consumer,edge.before);}
    resolvePending();flush();
  };
  const retain=plan=>{flush();return {...plan,slices:{...plan.slices,assignments:list(plan.slices?.assignments).filter(a=>!failed.has(owner(a?.id)))}};};
  const seal=()=>{
    resolvePending();
    for(const [consumer,reference] of pending.values())fail(consumer,Error('Required producer is absent: '+(typeof reference==='string'?reference:reference.assignment)+'.'));
    for(const [id,{assignment:a}] of records)for(const part of list(a.dependencies?.afterParts))
      if(![...records].some(([other,record])=>other!==id&&record.parts.has(part)))fail(id,Error('Required part has no producer: '+part+'.'));
    flush();
  };
  // All preparation consumers admit declared intent before actual records and
  // failures. Callers do not reproduce the ordering needed by failure closure.
  const admit=({plan,declarations=[],assignmentOwners=new Map(),failures=[]})=>{
    const authored=list(plan.slices?.assignments).filter(a=>!assignmentOwners.has(a.id));
    register({...plan,slices:{...plan.slices,assignments:[...authored,...declarations]}},assignmentOwners);
    register(plan,assignmentOwners);
    for(const [id,error] of failures)fail(id,error);
    seal();
  };
  const captureWork=nodes=>{
    const byKey=new Map(nodes.map(node=>[node.key,owner(node.sourceId??node.key)]));
    for(const node of nodes){
      const id=owner(node.sourceId??node.key);
      for(const key of node.requires){const producer=byKey.get(key);if(producer!==undefined)requireProducer(id,producer);}
      const layers=node.record?(node.index===null?node.record.spec.layers:[node.record.preparedLayers.get(node.index)]):[];
      for(const ref of [...(node.record?.prerequisites??[]),...layers.flatMap(l=>l?.prerequisites??[])])link(id,ref);
    }
    flush();
  };
  const captureResult=(node,result)=>{
    const id=owner(node.sourceId??node.key);
    for(const op of result.operations){operationOwners.set(op.id,id);for(const ref of list(op.after))link(id,ref);}
    for(const edge of result.edgeAfter??[])for(const ref of list(edge.after))link(id,ref);
    flush();
  };
  register(intent);
  for(const failure of failures)fail(failure.assignment,Error(failure.message));
  flush();
  return {register,admit,fail,retain,seal,captureWork,captureResult,hasFailed:id=>failed.has(owner(id)),
    notes:()=>[...failed.values()].map(assignmentFailureNote)};
}
