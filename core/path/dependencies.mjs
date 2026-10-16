import {resolveSpatialPlan} from '../print/spatial-inputs.mjs';
import {assignedFilaments} from '../machine/filaments.mjs';

// 14: built in the part's frame; placement applies at display and program writing.
// Poses are {toolAxis, toolUp}; reorientation is ordinary travel (no rotary angle).
// 15: Bundle retains finalized operation geometry/dependencies before scheduling.
// 16: extensions consume prepared material/work; process cavities are Boolean geometry.
// 17: Slice consumes prepared surfaces/regions and stack-derived local gaps;
// terminal regions are not widened, and no Slice reads completed deposition.
export const PATH_CONTRACT='saam-deposition/24'; // Required course dependencies and retained fill-cell identity.
export const NEUTRAL_PATH_CONTRACT='saam-neutral-motion/12'; // Manufacturing constraints and relaxable local traversal.
// Only authored deposition inputs affect the saved path. Output, placement and
// installed machine settings are applied while writing the selected machine program.
export function pathDependencies(plan){
  plan=resolveSpatialPlan(plan);
  const {output,setup,placement:_placement,...authored}=plan;
  // The default filament matters only when assignments select filaments (generatePath).
  const assigned=assignedFilaments(plan);
  const materialIntent={nozzleC:setup?.nozzleC,
    defaultFilament:assigned.length?setup?.filament??assigned[0]:null,
    filaments:setup?.filaments?.map(entry=>entry?{nozzleC:entry.nozzleC??null,process:entry.process??{}}:null)??null};
  const skills=Object.fromEntries(Object.entries(plan.skills??{}).filter(([,config])=>config?.enabled));
  return {plan:{...authored,skills,materialIntent},contract:PATH_CONTRACT,completion:NEUTRAL_PATH_CONTRACT};
}
