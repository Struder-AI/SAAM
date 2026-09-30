import {skinAssignment,frontAssignment} from './surface-constructions.mjs';
import {rimAssignment} from './sleeve-constructions.mjs';
import {bridgeAssignment} from '../../skills/bridging/scripts/prepare.mjs';
import {sliceAssignment} from './slices.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {validateSleevePattern} from '../path/sleeve-pattern.mjs';

// Retired cell layouts expand only during an explicitly requested migration.
function explicitSleevePaths(pattern){
  const {tile,cellsPerTurn,courseRiseMm,repeats,tiltDeg}=pattern;
  requireThat(Number.isSafeInteger(cellsPerTurn)&&cellsPerTurn>0&&Number.isFinite(courseRiseMm)&&courseRiseMm>0&&Number.isFinite(tiltDeg),'Invalid legacy sleeve tile layout.');
  requireThat(tile?.points?.length>=2&&Number.isSafeInteger(cellsPerTurn*(tile.points.length-1)+1),'Legacy sleeve course exceeds the representable point count.');
  const at=(value,i)=>Array.isArray(value)?value[i]:value;
  const first=tile.points[0],last=tile.points.at(-1),height=tile.beadHeightMm;
  requireThat(first[0]===0&&last[0]===1&&first[1]===last[1]&&at(tile.offsetMm??0,0)===at(tile.offsetMm??0,tile.points.length-1)&&(!Array.isArray(height)||height[0]===height.at(-1)),'Legacy tile endpoints must agree before migration.');
  const points=[],offsetMm=[],beadHeightMm=[],angle=tiltDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const originOffset=at(tile.offsetMm??0,0),originHeight=first[1];
  for(let cell=0;cell<cellsPerTurn;cell++)for(let i=cell?1:0;i<tile.points.length;i++){
    const [u,height]=tile.points[i],phase=(cell+u)/cellsPerTurn,depth=at(tile.offsetMm??0,i)-originOffset,h=height-originHeight;
    points.push([phase,originHeight+depth*s+h*c+phase*courseRiseMm]);offsetMm.push(originOffset+depth*c-h*s);beadHeightMm.push(at(tile.beadHeightMm,i));
  }
  const expanded={paths:[{points,offsetMm,beadHeightMm}],advance:[1,courseRiseMm],repeats};
  validateSleevePattern(expanded);return expanded;
}

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
    if(assignment.construction==='sleeve'&&assignment.pattern&&Object.hasOwn(assignment.pattern,'tile')){
      source={...source,pattern:explicitSleevePaths(assignment.pattern)};
      changes.push({path:`slices.assignments.${index}.pattern`,before:assignment.pattern,after:source.pattern,meaning:'Expand legacy cell layout into identical explicit paths; no geometry, bead height or repetition change.'});
    }
    if(assignment.construction==='skin'&&Object.hasOwn(assignment,'normalMm')){
      requireThat(!Object.hasOwn(assignment,'pitchMm'),'Skin has both normalMm and pitchMm; choose one target normal gap before migration.');
      const {normalMm,...retained}=assignment;source={...retained,pitchMm:normalMm};
      changes.push({path:`slices.assignments.${index}`,assignment:assignment.id,from:'normalMm',to:'pitchMm',value:normalMm,
        meaning:'Numeric value retained as target mean normal gap; translation is derived over the full reference, local normal gaps vary.'});
    }
    const {construction,...legacy}=source;
    requireThat(construction!=='cladding','Legacy cladding pose cannot be migrated automatically: author normal-band Slice with optional derived pose and field tilt, then review.');
    const canonical=construction==='bridges'?bridgeAssignment({...legacy,process:{...legacy.process,firstLayerMm:legacy.process?.layerMm??plan.process.layerMm}}):construction==='skin'?skinAssignment({...legacy,process:{...legacy.process,planarSpeedMmS:plan.process.skinSpeedMmS,firstLayerSpeedMmS:plan.process.skinSpeedMmS}}):construction==='fronts'?frontAssignment(legacy):construction==='rim'?rimAssignment(legacy):sliceAssignment(source);
    for(const key of new Set([...Object.keys(source),...Object.keys(canonical)]))if(JSON.stringify(source[key])!==JSON.stringify(canonical[key]))changes.push({path:`slices.assignments.${index}.${key}`,assignment:assignment.id,before:source[key]??null,after:canonical[key]??null,meaning:Object.hasOwn(source,key)?'Explicit shared-construction migration.':'Explicitly added current shared default.'});
    return canonical;
  });
  return {plan:changes.length?{...plan,composition,experimental:plan.experimental??{substrateAdaptation:false},slices:{...plan.slices,assignments}}:plan,changes};
}
