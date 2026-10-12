import {requireThat} from '../private/toolpath/numeric.mjs';
import {skinAssignment} from '../../skills/draped-skin/scripts/prepare.mjs';
import {frontAssignment} from '../../skills/wave-overhangs/scripts/prepare.mjs';
import {rimAssignment} from '../../skills/thick-lip/scripts/prepare.mjs';
import {bridgeAssignment} from '../../skills/bridging/scripts/prepare.mjs';
import {depositionAssignment,currentAssignmentTerms} from './assignment-records.mjs';

import {advancedVaseRecordRuntime} from '../../skills/advanced-vase-wall/scripts/record.mjs';
const {validateSleevePattern}=advancedVaseRecordRuntime();

// A retired cell layout is read as identical explicit paths.
function explicitSleevePaths(pattern){
  const {tile,cellsPerTurn,courseRiseMm,repeats,tiltDeg}=pattern;
  requireThat(Number.isSafeInteger(cellsPerTurn)&&cellsPerTurn>0&&Number.isFinite(courseRiseMm)&&courseRiseMm>0&&Number.isFinite(tiltDeg),'Invalid legacy sleeve tile layout.');
  requireThat(tile?.points?.length>=2&&Number.isSafeInteger(cellsPerTurn*(tile.points.length-1)+1),'Legacy sleeve pattern exceeds the representable point count.');
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

// Renamed fields are read by their current names; both spellings together have no reading.
function migrateAssignmentTerms(assignment){
  const {assignment:current,conflicts:[conflict]}=currentAssignmentTerms(assignment);
  requireThat(!conflict,`Both ${conflict?.[0]} and ${conflict?.[1]} are present; resolve the conflicting fields before migration.`);
  return structuredClone(current);
}

// One assignment in its current form, with what changed; throws when an old
// form has no automatic reading.
function currentAssignmentForm(assignment,index,process){
  const changes=[];
  let source=assignment;
  if(assignment.construction==='sleeve'&&assignment.pattern&&Object.hasOwn(assignment.pattern,'tile')){
    source={...source,pattern:explicitSleevePaths(assignment.pattern)};
    changes.push({path:`slices.assignments.${index}.pattern`,before:assignment.pattern,after:source.pattern,meaning:'Expand legacy cell layout into identical explicit paths; no geometry, bead height or repetition change.'});
  }
  if(assignment.construction==='skin'&&Object.hasOwn(assignment,'normalMm')){
    requireThat(!Object.hasOwn(assignment,'pitchMm'),'Skin has both normalMm and pitchMm; choose one target normal gap.');
    const {normalMm,...retained}=assignment;source={...retained,pitchMm:normalMm};
    changes.push({path:`slices.assignments.${index}`,assignment:assignment.id,from:'normalMm',to:'pitchMm',value:normalMm,
      meaning:'Numeric value retained as target mean normal gap; translation is derived over the full reference, local normal gaps vary.'});
  }
  const renamed=migrateAssignmentTerms(source),{construction,...legacy}=renamed;
  requireThat(construction!=='cladding','Legacy cladding pose has no automatic reading: author normal-band Slice with optional derived pose and field tilt, then review.');
  const canonical=construction==='bridges'?bridgeAssignment({...legacy,process:{...legacy.process,firstLayerMm:legacy.process?.layerMm??process.layerMm}}):construction==='skin'?skinAssignment({...legacy,process:{...legacy.process,planarSpeedMmS:process.skinSpeedMmS,firstLayerSpeedMmS:process.skinSpeedMmS}}):construction==='fronts'?frontAssignment(legacy):construction==='rim'?rimAssignment(legacy):depositionAssignment(renamed);
  for(const key of new Set([...Object.keys(source),...Object.keys(canonical)]))if(JSON.stringify(source[key])!==JSON.stringify(canonical[key]))changes.push({path:`slices.assignments.${index}.${key}`,assignment:assignment.id,before:source[key]??null,after:canonical[key]??null,meaning:Object.hasOwn(source,key)?'Shared-construction form.':'Current shared default.'});
  return {assignment:changes.length?canonical:assignment,changes};
}

// Every assignment read in its current form when its recipe is read. Old
// construction forms are rewritten (one note each); one without an automatic
// reading stays as authored, is named in unread, and produces nothing.
export function currentAssignmentForms(plan){
  const authored=plan.slices?.assignments;
  if(!Array.isArray(authored))return {plan,changes:[],notes:[],unread:[]};
  const changes=[],notes=[],unread=[];
  const assignments=authored.map((assignment,index)=>{
    try{
      const read=currentAssignmentForm(assignment,index,plan.process);
      if(read.changes.length){changes.push(...read.changes);notes.push(`${assignment.id} is read in its current form (${[...new Set(read.changes.map(change=>change.path.split('.').slice(3).join('.')||change.to))].join(', ')}); the next save or migrate_bundle records it.`);}
      return read.assignment;
    }catch(error){
      unread.push(assignment?.id);notes.push(`${assignment?.id??'An assignment'} has an old form with no automatic reading, so it produces nothing: ${error.message}`);
      return assignment;
    }
  });
  return {plan:changes.length?{...plan,slices:{...plan.slices,assignments}}:plan,changes,notes,unread};
}
