import {requireThat} from '../private/bundle/numeric.mjs';
import {resolveSettingsPatch} from '../machine/settings.mjs';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

// Shape selection happens once; only spatial solids change shape through a
// nested patch. Other geometry records retain their own declared fields.
export function mergeGeometryPatch(previous,changes,geometryTemplate,selectShape=true){
  requireThat(record(changes),'Adjustment must be an object.');
  const template=selectShape&&Object.hasOwn(previous,'shape')&&typeof changes.shape==='string'&&changes.shape!==previous.shape
    ?geometryTemplate(changes.shape,changes):null;
  const base=template?{...template,...Object.fromEntries(Object.entries(previous).filter(([name])=>name!=='shape'&&Object.hasOwn(template,name)))}:previous;
  const target={...base,...structuredClone(changes)};
  if(record(base.source)&&record(changes.source)){
    target.source={...base.source,...target.source};
    if(record(base.source.attribution)&&record(changes.source.attribution))target.source.attribution={...base.source.attribution,...target.source.attribution};
    if(record(base.source.repair)&&record(changes.source.repair))target.source.repair={...base.source.repair,...target.source.repair};
  }
  if(record(base.parameters)&&record(changes.parameters))target.parameters={...base.parameters,...target.parameters};
  if(record(base.extraction)&&record(changes.extraction))target.extraction={...base.extraction,...target.extraction};
  if(record(base.field)&&record(changes.field))target.field={...base.field,...target.field};
  if(record(base.base)&&record(changes.base))target.base=mergeGeometryPatch(base.base,target.base,geometryTemplate,false);
  if(record(base.solid)&&record(changes.solid))target.solid=mergeGeometryPatch(base.solid,target.solid,geometryTemplate);
  return target;
}

export function resolvePlanPatch(previous,patch,{geometryTemplate}){
  const {geometry,setup,process,output,placement,...recipe}=patch;
  const settings={...(Object.hasOwn(patch,'setup')?{setup}:{}),...(Object.hasOwn(patch,'process')?{process}:{}),
    ...(Object.hasOwn(patch,'output')?{output}:{}),...(Object.hasOwn(patch,'placement')?{placement}:{})};
  const plan={...previous,...structuredClone(recipe),...resolveSettingsPatch(previous,settings)};
  if(record(previous.experimental)&&record(recipe.experimental))plan.experimental={...previous.experimental,...plan.experimental};
  if(record(previous.composition)&&record(recipe.composition))plan.composition={...previous.composition,...plan.composition};
  if(record(previous.slices)&&record(recipe.slices))plan.slices={...previous.slices,...plan.slices};
  if(record(previous.modulations)&&record(recipe.modulations))plan.modulations={...previous.modulations,...plan.modulations};
  if(record(previous.skills)&&record(recipe.skills)){
    plan.skills={...previous.skills,...plan.skills};
    if(record(previous.skills.supports)&&record(recipe.skills.supports))plan.skills.supports={...previous.skills.supports,...plan.skills.supports};
    if(record(previous.skills['plastic-weld'])&&record(recipe.skills['plastic-weld']))plan.skills['plastic-weld']={...previous.skills['plastic-weld'],...plan.skills['plastic-weld']};
  }
  if(Object.hasOwn(patch,'geometry')){
    if(previous.geometry?.shape==='spatial'&&(geometry===null||geometry.shape!=='spatial'&&!Object.hasOwn(geometry,'solid')&&!Object.hasOwn(geometry,'curves')&&!Object.hasOwn(geometry,'points'))){
      const solid=geometry===null?null:previous.geometry.solid?mergeGeometryPatch(previous.geometry.solid,geometry,geometryTemplate):structuredClone(geometry);
      plan.geometry={...previous.geometry,solid};
    }
    else if(geometry===null)delete plan.geometry;
    else plan.geometry=previous.geometry?mergeGeometryPatch(previous.geometry,geometry,geometryTemplate):structuredClone(geometry);
  }
  return plan;
}
