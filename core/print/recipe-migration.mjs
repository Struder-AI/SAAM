import {sliceAssignment} from './slices.mjs';
import {requireThat} from '../geom/tolerance.mjs';

// Explicit migration only. Loading never changes a recipe or its meaning.
export function migrateRecipeFields(plan){
  const changes=[];
  const retiredBatch=plan.composition&&Object.hasOwn(plan.composition,'batchLayers');
  const retainedComposition=retiredBatch?Object.fromEntries(Object.entries(plan.composition).filter(([key])=>key!=='batchLayers')):plan.composition;
  const composition={...retainedComposition,filaments:retainedComposition.filaments??[]};
  if(!Object.hasOwn(retainedComposition,'filaments'))changes.push({path:'composition.filaments',before:null,after:[],meaning:'Preserve print-wide nozzle selection and existing assignment overrides; no part routes added.'});
  if(retiredBatch){
    const {batchLayers}=plan.composition;
    changes.push({path:'composition.batchLayers',before:batchLayers,after:null,meaning:batchLayers===1?'Remove retired default batching field; ascending actual-height scheduling is unchanged. Regenerate before review.':'Remove retired batching choice; ready operations now use ascending actual height instead of grouped height bands. Regenerate before review.'});
  }
  if(!Object.hasOwn(plan,'experimental'))changes.push({path:'experimental',before:null,after:{substrateAdaptation:false},meaning:'Explicitly default experimental substrate adaptation off; regenerate before review.'});
  const assignments=plan.slices.assignments.map((assignment,index)=>{
    let source=assignment;
    if(assignment.construction==='skin'&&Object.hasOwn(assignment,'normalMm')){
      requireThat(!Object.hasOwn(assignment,'pitchMm'),'Skin has both normalMm and pitchMm; choose one target normal gap before migration.');
      const {normalMm,...retained}=assignment;source={...retained,pitchMm:normalMm};
      changes.push({path:`slices.assignments.${index}`,assignment:assignment.id,from:'normalMm',to:'pitchMm',value:normalMm,
        meaning:'Numeric value retained as target mean normal gap; translation is derived over the full reference, local normal gaps vary.'});
    }
    const canonical=sliceAssignment(source);
    for(const key of new Set([...Object.keys(source),...Object.keys(canonical)]))if(JSON.stringify(source[key])!==JSON.stringify(canonical[key]))changes.push({path:`slices.assignments.${index}.${key}`,assignment:assignment.id,before:source[key]??null,after:canonical[key]??null,meaning:Object.hasOwn(source,key)?'Explicit shared-construction migration.':'Explicitly added current shared default.'});
    return canonical;
  });
  return {plan:changes.length?{...plan,composition,experimental:plan.experimental??{substrateAdaptation:false},slices:{...plan.slices,assignments}}:plan,changes};
}
