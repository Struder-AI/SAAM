// Recipe work references preserve native producer identity; they never use
// positions, execution order, or travel state to identify an operation.
import {requireThat} from '../private/toolpath/numeric.mjs';

export function operationPrerequisite(value){
  return typeof value==='string'&&value.length>0||Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).join()==='assignment'&&typeof value.assignment==='string'&&value.assignment.length);
}

function selectedOperation(assignments,target){
  requireThat(target&&typeof target==='object'&&!Array.isArray(target),'Select an operation by assignment and native slice or Trace repetition.');
  const assignment=assignments.find(a=>a.id===target.assignment);
  requireThat(assignment,'Operation reference names an absent assignment.');
  if(assignment.construction==='curves'){
    requireThat(!assignment.source&&Object.keys(target).sort().join()==='assignment,repetition','Select an explicit Trace repetition.');
    const count=assignment.repeat?.indices?.length??assignment.repeat?.count??1;
    const present=assignment.repetitionIds?assignment.repetitionIds.includes(target.repetition):Number.isSafeInteger(target.repetition)&&target.repetition>=0&&
      (assignment.repeat?.stack&&assignment.repeat.indices===null||target.repetition<count);
    requireThat(present,'Trace operation reference names an absent repetition.');
    return {assignment,key:target.repetition,id:assignment.id+':'+target.repetition};
  }
  requireThat(!assignment.construction&&!assignment.join&&!assignment.preset&&Object.keys(target).sort().join()==='assignment,group,index'&&
    Number.isSafeInteger(target.index)&&target.index>=0&&['walls','infill','fill'].includes(target.group),
    'Select an ordinary Slice operation by native index and walls, infill or fill.');
  return {assignment,key:target.group,index:target.index,id:(assignment.part===null||assignment.part===undefined?'':assignment.part+':')+assignment.id+':'+target.index+':'+target.group};
}

export function operationId(assignments,target){return selectedOperation(assignments,target).id;}

// A whole-assignment predecessor is resolved after construction, including
// dynamic Slice domains. Selected predecessors use their exact native IDs.
export function withOperationAfter(assignments,target,after){
  const selected=selectedOperation(assignments,target),assignment=structuredClone(selected.assignment);
  requireThat(Array.isArray(after)&&after.length,'Supply required predecessors.');
  const required=after.map(value=>operationPrerequisite(value)?value:operationId(assignments,value));
  requireThat(required.every(value=>value!==selected.id&&value?.assignment!==assignment.id),'An operation cannot depend on itself or its enclosing assignment.');
  const unique=values=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];
  if(assignment.construction==='curves'){
    const previous=assignment.operationAfter&&Object.hasOwn(assignment.operationAfter,selected.key)?assignment.operationAfter[selected.key]:[];
    assignment.operationAfter={...assignment.operationAfter,[selected.key]:unique([...previous,...required])};
  }else{
    const overrides=assignment.sliceOverrides??[];
    assignment.sliceOverrides=Array.from({length:Math.max(overrides.length,selected.index+1)},(_,i)=>({...overrides[i]}));
    const settings=assignment.sliceOverrides[selected.index],groups={...assignment.operationAfter,...settings.operationAfter};
    settings.operationAfter={...groups,[selected.key]:unique([...(assignment.operationAfter?.[selected.key]??[]),...(groups[selected.key]??[]),...required])};
  }
  return assignments.map(prior=>prior===selected.assignment?assignment:prior);
}
