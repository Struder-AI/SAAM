import {loadBundle,updatePlan} from './bundle.mjs';
import {sliceAssignment} from './slices.mjs';
import {mergeRecord} from './resolve-plan.mjs';
import {requireThat} from '../geom/tolerance.mjs';

// One assignment editor; bulk adjust_recipe writes this same plan.slices list.
export function editSliceAssignments(slices,{action,id,assignment,before}) {
  requireThat(['add','edit','remove'].includes(action),'Slice action must be add, edit or remove.');
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Invalid slice assignment id.');
  const index=slices.assignments.findIndex(item=>item.id===id);
  requireThat(action==='add'?index<0:index>=0,action==='add'?'Slice assignment already exists.':'Slice assignment not found.');
  requireThat(action==='remove'?assignment===undefined&&before===undefined:assignment&&typeof assignment==='object'&&!Array.isArray(assignment),'Add/edit needs assignment settings; remove takes no assignment or before.');
  requireThat(assignment?.id===undefined||assignment.id===id,'Assignment id must match id; remove/add to rename.');
  const entries=slices.assignments.filter(item=>item.id!==id);
  if(action==='remove')return {...slices,assignments:entries};
  const current=slices.assignments[index];
  const next=action==='add'||assignment.construction!==undefined&&assignment.construction!==current.construction
    ?sliceAssignment({...assignment,id}):mergeRecord(current,assignment);
  const destination=before===undefined?(action==='add'?entries.length:index):before===null?entries.length:entries.findIndex(item=>item.id===before);
  requireThat(destination>=0,'before must name another slice assignment or be null to append.');
  return {...slices,assignments:[...entries.slice(0,destination),next,...entries.slice(destination)]};
}

export async function applySlice(directory,request,{expectedRevision}={}) {
  const previous=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===previous.revision,'This review is stale. Reload before changing slices.');
  const slices=editSliceAssignments(previous.plan.slices,request);
  const state=await updatePlan(directory,{...previous.plan,slices},previous.revision);
  const changed=state.revision!==previous.revision;
  return {state,edit:{action:request.action,id:request.id,changed,assignment:state.plan.slices.assignments.find(a=>a.id===request.id)??null,
    order:state.plan.slices.assignments.map(a=>a.id),validated:['recipe','geometry'],
    generationRequired:changed||!state.review.generation,confirmationInvalidated:changed,
    deferredChecks:['slice crossings and local thickness','ownership and support dependencies','machine path feasibility']}};
}
