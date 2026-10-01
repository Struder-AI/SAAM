import {requireThat} from '../private/bundle/numeric.mjs';
import {SETTINGS_FIELDS,resolveSettingsPatch} from '../machine/settings.mjs';


const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

export function mergeRecord(previous,changes,{geometryTemplate,key}={}){
  requireThat(record(changes),'Adjustment must be an object.');
  const target={...previous};
  for(const [field,value] of Object.entries(changes)){
    if(!Object.hasOwn(target,field)){target[field]=structuredClone(value);continue;}
    const current=target[field];
    if(key==='geometry'&&field==='shape'&&typeof value==='string'&&value!==previous.shape){
      const template=geometryTemplate(value,changes);
      const shared=Object.fromEntries(Object.entries(previous).filter(([name])=>name!=='shape'&&Object.hasOwn(template,name)));
      return mergeRecord({...template,...shared},changes,{geometryTemplate,key:'geometry'});
    }
    const variant=(field==='surface'||field==='stack')&&record(value)&&Object.hasOwn(value,'kind')
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
  const {geometry,...fields}=patch;
  const settings=Object.fromEntries(Object.entries(fields).filter(([key])=>SETTINGS_FIELDS.includes(key)));
  const recipe=Object.fromEntries(Object.entries(fields).filter(([key])=>!SETTINGS_FIELDS.includes(key)));
  let plan={...mergeRecord(previous,recipe,{geometryTemplate}),...resolveSettingsPatch(previous,settings)};
  if(Object.hasOwn(patch,'geometry')){
    if(geometry===null){const {geometry:removed,...withoutGeometry}=plan;plan=withoutGeometry;}
    else plan={...plan,geometry:previous.geometry?mergeRecord(previous.geometry,geometry,{geometryTemplate,key:'geometry'}):structuredClone(geometry)};
  }
  return plan;
}
