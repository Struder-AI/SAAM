// Toolpath constructs complete recipe assignments from authoring requests.
// Bundle stores those supplied records; generation resolves their work.
import {ordinarySliceAssignment,assignmentFamily} from './slice-settings.mjs';
import {curveAssignment} from './curves.mjs';
import {injectionAssignment} from './injection.mjs';
import {ASSIGNMENT_RECORDS} from '../../skills/records.mjs';

export function depositionAssignment(options){
  if(ASSIGNMENT_RECORDS[options.construction])return ASSIGNMENT_RECORDS[options.construction].make(options);
  if(options.construction==='inject')return injectionAssignment(options);
  if(options.construction)return curveAssignment(options);
  return ordinarySliceAssignment(options);
}

// Field names retired after 0.3.6 read as their current names: Trace courseIds,
// curve courses and repeat.family become repetitionIds, repetitions and
// repeat.stack; Slice courses become sliceOverrides. A record holding both
// spellings stays as it is, its conflicts listed, and validation refuses it.
export function currentAssignmentTerms(assignment){
  const conflicts=[];
  const rename=(record,from,to)=>{
    if(!record||typeof record!=='object'||!Object.hasOwn(record,from))return record;
    if(Object.hasOwn(record,to)){conflicts.push([from,to]);return record;}
    const {[from]:value,...rest}=record;return {...rest,[to]:value};
  };
  let current=assignment;
  if(current?.construction==='curves'){
    current=rename(current,'courseIds','repetitionIds');
    const curves=Array.isArray(current.curves)?current.curves.map(curve=>rename(curve,'courses','repetitions')):current.curves;
    const repeat=rename(current.repeat,'family','stack');
    if(curves!==current.curves&&curves.some((curve,i)=>curve!==current.curves[i])||repeat!==current.repeat)current={...current,curves,repeat};
  }else if(current&&typeof current==='object'&&!current.construction)current=rename(current,'courses','sliceOverrides');
  return {assignment:current,conflicts};
}
// Applied wherever a recipe is read or authored; the next ordinary save writes the current names.
export function currentRecipeTerms(plan){
  const assignments=plan?.slices?.assignments;if(!Array.isArray(assignments))return plan;
  const current=assignments.map(assignment=>currentAssignmentTerms(assignment).assignment);
  return current.every((assignment,i)=>assignment===assignments[i])?plan:{...plan,slices:{...plan.slices,assignments:current}};
}

export const recipeFamily=assignment=>ASSIGNMENT_RECORDS[assignment.construction]?.family(assignment)??assignmentFamily(assignment);
