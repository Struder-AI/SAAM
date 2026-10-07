import {requireThat} from '../private/bundle/numeric.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {loadBundle,updatePlan} from './bundle.mjs';
import {depositionAssignment} from './assignment-records.mjs';


import {diagnoseDepositionPlan} from './deposition-diagnostics.mjs';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

function mergeAssignmentPatch(previous,changes){
  const target={...previous,...structuredClone(changes)};
  if(record(previous.process)&&record(changes.process))target.process={...previous.process,...target.process};
  if(record(previous.roles)&&record(changes.roles))target.roles={...previous.roles,...target.roles};
  if(record(previous.dependencies)&&record(changes.dependencies))target.dependencies={...previous.dependencies,...target.dependencies};
  if(record(previous.stack)&&record(changes.stack)&&!Object.hasOwn(changes.stack,'kind'))target.stack={...previous.stack,...target.stack};
  if(record(previous.join)&&record(changes.join))target.join={...previous.join,...target.join};
  if(record(previous.fillOrder)&&record(changes.fillOrder))target.fillOrder={...previous.fillOrder,...target.fillOrder};
  if(record(previous.contact)&&record(changes.contact))target.contact={...previous.contact,...target.contact};
  if(record(previous.toolPose)&&record(changes.toolPose))target.toolPose={...previous.toolPose,...target.toolPose};
  if(record(previous.repeat)&&record(changes.repeat))target.repeat={...previous.repeat,...target.repeat};
  if(record(previous.meshSleeve)&&record(changes.meshSleeve))target.meshSleeve={...previous.meshSleeve,...target.meshSleeve};
  if(record(previous.pattern)&&record(changes.pattern)&&Object.hasOwn(previous.pattern,'tile')===Object.hasOwn(changes.pattern,'tile'))target.pattern={...previous.pattern,...target.pattern};
  if(record(previous.surface)&&record(changes.surface)&&!Object.hasOwn(changes.surface,'kind')){
    target.surface={...previous.surface,...target.surface};
    if(record(previous.surface.patch)&&record(changes.surface.patch))target.surface.patch={...previous.surface.patch,...target.surface.patch};
  }
  return target;
}
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
    ?depositionAssignment({...assignment,id}):mergeAssignmentPatch(current,assignment);
  const destination=before===undefined?(action==='add'?entries.length:index):before===null?entries.length:entries.findIndex(item=>item.id===before);
  requireThat(destination>=0,'before must name another slice assignment or be null to append.');
  return {...slices,assignments:[...entries.slice(0,destination),next,...entries.slice(destination)]};
}

export async function applySlice(directory,request,{expectedRevision,expectedEditRevision}={}) {
  const previous=await loadBundle(directory,{program:false});
  requireEditRevision(previous,{expectedRevision,expectedEditRevision});
  const slices=editSliceAssignments(previous.plan.slices,request);
  const plan={...previous.plan,slices},diagnostics=await diagnoseDepositionPlan(plan);
  const state=await updatePlan(directory,plan,previous.revision,{expectedEditRevision});
  const changed=state.revision!==previous.revision;
  return {state,edit:{action:request.action,id:request.id,changed,assignment:state.plan.slices.assignments.find(a=>a.id===request.id)??null,
    order:state.plan.slices.assignments.map(a=>a.id),validated:['recipe','geometry'],
    generationRequired:changed||!state.review.generation,confirmationInvalidated:changed,
    diagnostics,deferredChecks:['exact exported program interpretation','physical acceptance']}};
}
