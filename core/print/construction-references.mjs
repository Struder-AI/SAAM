// Resolve authored prerequisites against completed producers inside the assignment
// failure boundary, before source publication. Identity is never inferred from rank.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {operationPrerequisite} from './operation-references.mjs';
import {assignmentWork} from './assignment-failure.mjs';
import {assignmentFamily} from './slice-settings.mjs';
export function finalizeConstructionReferences(plan,results){
  return resolveOperationReferences(plan,applyDeclaredDependencies(plan,results));
}

// The recipe's dependency declarations apply to every construction, including
// ordinary slice stacks produced before their later-stage dependents.
function applyDeclaredDependencies(plan,results){
  const changes=new Map(results.map(result=>[result,[]]));
  for(const result of results){
    const assignment=plan.slices.assignments.find(a=>a.id===(result.report?.owner??result.id));
    const dependencies=assignment?.dependencies;if(!dependencies)continue;
    const prior=results.filter(other=>other!==result&&dependencies.afterParts.includes(other.report?.part));
    const completion=other=>({assignment:other.report?.owner??other.id,part:other.report?.part??null});
    const after=[...dependencies.after,...prior.map(completion)];
    for(const reference of after)changes.get(result).push(reference);
    const before=results.filter(other=>other!==result&&dependencies.beforeParts.includes(other.report?.part));
    for(const other of before)changes.get(other).push(completion(result));
  }
  return results.map(result=>({ ...result,logicalAfter:[...(result.logicalAfter??[]),...changes.get(result)],
    operations:result.operations.map(operation=>({...operation,after:[...new Set([...(operation.after??[]),...changes.get(result)])]}))}));
}

// Resolve operation identities here; compact completion references are published
// with the source, after the producer's exact native slices are known.
// No geometry, coordinate rank or construction order substitutes for identity.
function resolveOperationReferences(plan,results){
  const all=results.flatMap(result=>result.operations),ids=new Set(all.map(op=>op.id)),byAssignment=new Map();
  for(const result of results){
    const owner=result.report?.owner??result.id;
    if(!byAssignment.has(owner))byAssignment.set(owner,[]);
    byAssignment.get(owner).push(...result.operations.map(op=>op.id));
  }
  for(const assignment of plan.slices.assignments)assignmentWork({sourceId:assignment.id,kind:assignmentFamily(assignment)},()=>{
    if(assignment.construction==='curves'){
      for(const [name,after] of Object.entries(assignment.operationAfter??{}))if(after.length)
        requireThat(ids.has(assignment.id+':'+name),'Required Trace target was not constructed: '+assignment.id+':'+name);
    }else if(!assignment.construction){
      for(const [index,settings] of (assignment.sliceOverrides??[]).entries())for(const [group,after] of Object.entries(settings.operationAfter??{})){
        if(!after.length||JSON.stringify(after)===JSON.stringify(assignment.operationAfter?.[group]))continue;
        const targets=(byAssignment.get(assignment.id)??[]).filter(id=>group==='all'?id.includes(':'+assignment.id+':'+index+':')||id.startsWith(assignment.id+':'+index+':'):id.endsWith(':'+assignment.id+':'+index+':'+group)||id===assignment.id+':'+index+':'+group);
        const emptyMember=group==='all'&&results.some(result=>(result.report?.owner??result.id)===assignment.id&&result.referenceStack?.layers.some(layer=>layer.index===index));
        requireThat(targets.length||emptyMember,'Required Slice target was not constructed: '+assignment.id+':'+index+':'+group);
      }
    }
  });
  return results.map(result=>assignmentWork({sourceId:result.report?.owner??result.id,kind:result.report?.depositionFamily??'slice'},()=>{
    const resolve=references=>[...new Set((references??[]).flatMap(previous=>{
      requireThat(operationPrerequisite(previous),'Invalid operation prerequisite.');
      // A recipe may name a whole producer by its assignment id.
      if(typeof previous==='string'&&!ids.has(previous)&&byAssignment.has(previous))return [{assignment:previous}];
      if(typeof previous==='string'){requireThat(ids.has(previous),'Required operation was not constructed: '+previous);return [previous];}
      requireThat(byAssignment.has(previous.assignment),'Required assignment was not constructed: '+previous.assignment);
      return [previous];
    }))];
    return {...result,logicalAfter:resolve(result.logicalAfter),
      ...(result.referenceStack?{referenceStack:{...result.referenceStack,layers:result.referenceStack.layers.map(layer=>({...layer,logicalAfter:resolve(layer.logicalAfter)}))}}:{}),
      edgeAfter:result.edgeAfter??plan.slices.assignments.find(assignment=>assignment.id===(result.report?.owner??result.id))?.edgeAfter,operations:result.operations.map(operation=>{
    const after=resolve(operation.after);
    requireThat(!after.includes(operation.id),'An operation cannot require its own completion: '+operation.id);
    return {...operation,after};
  })};}));
}
