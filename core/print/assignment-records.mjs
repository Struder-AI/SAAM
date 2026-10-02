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

export const recipeFamily=assignment=>ASSIGNMENT_RECORDS[assignment.construction]?.family(assignment)??assignmentFamily(assignment);
