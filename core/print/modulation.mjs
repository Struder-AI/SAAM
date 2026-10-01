import {requireThat} from '../private/bundle/numeric.mjs';
import {loadBundle,updatePlan} from './bundle.mjs';
import {mergeRecord} from './resolve-plan.mjs';

import {diagnoseDepositionPlan} from './deposition-diagnostics.mjs';

export function editModulations(record,{action,id,modifier}) {
  requireThat(['add','edit','remove'].includes(action),'Modulation action must be add, edit or remove.');
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Invalid modulation id.');
  const index=record.modifiers.findIndex(item=>item.id===id);
  requireThat(action==='add'?index<0:index>=0,action==='add'?'Modulation already exists.':'Modulation not found.');
  requireThat(action==='remove'?modifier===undefined:modifier&&typeof modifier==='object'&&!Array.isArray(modifier),'Add/edit needs modifier settings; remove takes no modifier.');
  requireThat(modifier?.id===undefined||modifier.id===id,'Modifier id must match id; remove/add to rename.');
  if(action==='remove')return {...record,modifiers:record.modifiers.filter(item=>item.id!==id)};
  const defaults={id,assignments:null,roles:null,sampleStepMm:.2,tolerance:.01,frame:'world',layers:null,topN:null,phasePerLayerRad:0};
  const current=record.modifiers[index]?{...defaults,...record.modifiers[index]}:undefined;
  const replacement=action==='add'||modifier.channel!==undefined&&modifier.channel!==current.channel;
  const base=replacement?defaults:modifier.field?.kind!==undefined?{...current,field:structuredClone(modifier.field)}:current;
  const next=replacement?{...base,...structuredClone(modifier),id}:mergeRecord(base,modifier);
  return {...record,modifiers:action==='add'?[...record.modifiers,next]:record.modifiers.map((item,i)=>i===index?next:item)};
}

export async function applyModulation(directory,request,{expectedRevision}={}) {
  const previous=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===previous.revision,'This review is stale. Reload before changing modulation.');
  const modulations=editModulations(previous.plan.modulations,request);
  const plan={...previous.plan,modulations},diagnostics=await diagnoseDepositionPlan(plan,previous.machine);
  const state=await updatePlan(directory,plan,previous.revision),changed=state.revision!==previous.revision;
  return {state,edit:{action:request.action,id:request.id,changed,modifier:state.plan.modulations.modifiers.find(m=>m.id===request.id)??null,
    generationRequired:changed||!state.review.generation,confirmationInvalidated:changed,
    diagnostics,deferredChecks:['exact exported program interpretation','physical acceptance']}};
}
