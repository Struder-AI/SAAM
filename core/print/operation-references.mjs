// Recipe work references preserve native producer identity; they never use
// positions, execution order, or travel state to identify an operation.
import {requireThat} from '../private/toolpath/numeric.mjs';

export function edgeReference(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.assignment!=='string'||!value.assignment.length||
    value.part!==undefined&&value.part!==null&&typeof value.part!=='string'||!value.edge||typeof value.edge!=='object'||Array.isArray(value.edge))return false;
  const curve=Object.keys(value.edge).join()==='curve'&&(typeof value.edge.curve==='string'&&value.edge.curve.length>0||Number.isSafeInteger(value.edge.curve)&&value.edge.curve>=0);
  if(value.index!==undefined)return Object.keys(value).every(key=>['assignment','index','part','edge'].includes(key))&&
    Number.isSafeInteger(value.index)&&value.index>=0&&(curve||Object.keys(value.edge).every(key=>['loop','ring'].includes(key))&&
    Number.isSafeInteger(value.edge.loop)&&value.edge.loop>=0&&(value.edge.ring===undefined||Number.isSafeInteger(value.edge.ring)&&value.edge.ring>=0));
  return Object.keys(value).every(key=>['assignment','repetition','part','edge'].includes(key))&&
    (typeof value.repetition==='string'&&value.repetition.length>0||Number.isSafeInteger(value.repetition)&&value.repetition>=0)&&curve;
}

export function operationPrerequisite(value){
  if(edgeReference(value))return true;
  return typeof value==='string'&&value.length>0||Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>['assignment','index','part'].includes(key))&&typeof value.assignment==='string'&&value.assignment.length&&
    (value.index===undefined||Number.isSafeInteger(value.index)&&value.index>=0)&&(value.part===undefined||value.part===null||typeof value.part==='string'));
}

export function validateEdgeAfter(value,assignment){
  requireThat(value===undefined||Array.isArray(value)&&value.every(entry=>entry&&Object.keys(entry).sort().join()==='after,target'&&
    edgeReference(entry.target)&&entry.target.assignment===assignment&&Array.isArray(entry.after)&&entry.after.length&&entry.after.every(operationPrerequisite)),
    'edgeAfter binds symbolic course targets in this assignment to required manufacturing work.');
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
  if(edgeReference(target)){
    const selected=assignments.find(assignment=>assignment.id===target.assignment);requireThat(selected,'Edge target names an absent assignment.');
    requireThat(Array.isArray(after)&&after.length,'Supply required predecessors.');
    const required=after.map(value=>operationPrerequisite(value)?value:operationId(assignments,value));
    requireThat(required.every(value=>value?.assignment!==selected.id||value.index!==undefined||value.edge),'An edge cannot require its enclosing assignment.');
    const entries=[...(selected.edgeAfter??[])],index=entries.findIndex(entry=>JSON.stringify(entry.target)===JSON.stringify(target));
    const record={target,after:[...new Map([...(index<0?[]:entries[index].after),...required].map(value=>[JSON.stringify(value),value])).values()]};
    if(index<0)entries.push(record);else entries[index]=record;
    const assignment={...selected,edgeAfter:entries};validateEdgeAfter(entries,selected.id);
    return assignments.map(prior=>prior===selected?assignment:prior);
  }
  const wholeSlice=target&&typeof target==='object'&&Number.isSafeInteger(target.index)&&target.index>=0&&
    Object.keys(target).every(key=>['assignment','index','part'].includes(key));
  const owner=wholeSlice?assignments.find(a=>a.id===target.assignment):null;
  if(wholeSlice)requireThat(owner&&!owner.construction&&!owner.join&&(target.part??owner.part)===(owner.part??null),
    'Select an ordinary, part-specific Slice target.');
  const selected=wholeSlice?{assignment:owner,key:'all',index:target.index,id:null}:selectedOperation(assignments,target),assignment=structuredClone(selected.assignment);
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
