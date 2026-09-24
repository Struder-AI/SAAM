import {requireThat} from '../geom/tolerance.mjs';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

function mergeRecord(previous,changes,{geometryTemplate,key}={}){
  requireThat(record(changes),'Adjustment must be an object.');
  const target={...previous};
  for(const [field,value] of Object.entries(changes)){
    requireThat(Object.hasOwn(target,field),`Unknown setting: ${field}`);
    const current=target[field];
    if(key==='geometry'&&field==='shape'&&typeof value==='string'&&value!==previous.shape){
      const template=geometryTemplate(value,changes);
      const shared=Object.fromEntries(Object.entries(previous).filter(([name])=>name!=='shape'&&Object.hasOwn(template,name)));
      return mergeRecord({...template,...shared},changes,{geometryTemplate,key:'geometry'});
    }
    const variant=field==='surface'&&record(value)&&Object.hasOwn(value,'kind')
      ||field==='primeLine'&&record(value)
      ||field==='pattern'&&record(value)&&record(current)
        &&(Object.hasOwn(value,'tile')!==Object.hasOwn(current,'tile'));
    if(record(value)&&(variant||current===null||current===undefined))target[field]=structuredClone(value);
    else if(record(value))target[field]=mergeRecord(current,value,{geometryTemplate,key:field});
    else target[field]=structuredClone(value);
  }
  return target;
}

export function resolvePlanPatch(previous,patch,{geometryTemplate}){
  let plan=mergeRecord(previous,patch,{geometryTemplate});
  if(patch.setup?.firmwareVersion!==undefined
    &&patch.setup.firmwareVersion!==previous.setup.firmwareVersion
    &&patch.setup.startupVerified===undefined)
    plan={...plan,setup:{...plan.setup,startupVerified:false}};
  return plan;
}

export function resolveInitialPlan(machine,{defaults,rememberedSetup,fit}){
  const plan=defaults(machine);
  if(rememberedSetup)plan.setup={...plan.setup,...rememberedSetup,
    materialGuid:rememberedSetup.materialGuid||plan.setup.materialGuid};
  return fit(plan,machine);
}

export function resolveMachinePlan(previous,previousMachine,machine,{defaults,rememberedSetup,fit}){
  const proposal=resolveInitialPlan(machine,{defaults,rememberedSetup,fit});
  const process={...previous.process};
  for(const key of new Set([...Object.keys(previousMachine.defaultProcess??{}),...Object.keys(machine.defaultProcess??{})]))
    process[key]=proposal.process[key];
  const plan={...structuredClone(previous),setup:proposal.setup,output:proposal.output,process};
  return fit(plan,machine);
}
