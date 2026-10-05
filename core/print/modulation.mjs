import {requireThat} from '../private/bundle/numeric.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {loadBundle,updatePlan} from './bundle.mjs';
import {mergeGeometryPatch} from './resolve-plan.mjs';

import {diagnoseDepositionPlan} from './deposition-diagnostics.mjs';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

function mergeFieldPatch(previous,changes){
  const target={...previous,...structuredClone(changes)};
  if(record(previous.field)&&record(changes.field))target.field={...previous.field,...target.field};
  if(record(previous.source)&&record(changes.source))target.source=mergeFieldPatch(previous.source,target.source);
  if(record(previous.geometry)&&record(changes.geometry))target.geometry=mergeGeometryPatch(previous.geometry,target.geometry);
  return target;
}

function mergeModifierPatch(previous,changes){
  const target={...previous,...structuredClone(changes)};
  if(record(previous.layers)&&record(changes.layers))target.layers={...previous.layers,...target.layers};
  if(record(previous.field)&&record(changes.field))target.field=mergeFieldPatch(previous.field,target.field);
  return target;
}
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
  const next=replacement?{...base,...structuredClone(modifier),id}:mergeModifierPatch(base,modifier);
  return {...record,modifiers:action==='add'?[...record.modifiers,next]:record.modifiers.map((item,i)=>i===index?next:item)};
}

export async function applyModulation(directory,request,{expectedRevision,expectedEditRevision}={}) {
  const previous=await loadBundle(directory,{program:false});
  requireEditRevision(previous,{expectedRevision,expectedEditRevision});
  const modulations=editModulations(previous.plan.modulations,request);
  const plan={...previous.plan,modulations},diagnostics=await diagnoseDepositionPlan(plan);
  const state=await updatePlan(directory,plan,previous.revision,{expectedEditRevision}),changed=state.revision!==previous.revision;
  return {state,edit:{action:request.action,id:request.id,changed,modifier:state.plan.modulations.modifiers.find(m=>m.id===request.id)??null,
    generationRequired:changed||!state.review.generation,confirmationInvalidated:changed,
    diagnostics,deferredChecks:['exact exported program interpretation','physical acceptance']}};
}
