import {lifecycleReview} from './review-state.mjs';
import {assignmentFamily} from './slice-settings.mjs';
import {machinePresentation} from '../machine/settings-rows.mjs';
import {installedMachine} from '../machine/profile.mjs';

// The construction families and enabled extension skills a recipe names.
export function recipeSkills(plan){
  return [...new Set((plan.slices?.assignments??[]).map(assignment=>assignment.construction==='sleeve'?'trace':assignmentFamily(assignment))),
    ...Object.entries(plan.skills??{}).filter(([,settings])=>settings?.enabled).map(([name])=>name)];
}

export function summary(bundleId, state) {
  const programChecked=state.programChecked!==false;
  const lifecycle=lifecycleReview(state,{programChecked}),settings=machinePresentation(state.plan,installedMachine(state.machineId),state.geometry);
  return {
    bundleId, kind: state.kind, revision: state.revision, editRevision:state.editRevision, geometryId:state.geometryId,
    machineId: state.machineId??null, output: state.plan.output, skills: recipeSkills(state.plan),
    ...(state.placementOrigins!==undefined?{placementOrigins:structuredClone(state.placementOrigins)}:{}),
    programChecked,deferRememberSetup:state.deferRememberSetup===true,phaseColours:state.phaseColours??null,
    generation: state.review.generation ? { mode: state.review.generation.mode, current: lifecycle.current } : null,
    programError: state.programError ?? null, outputId: state.outputId ?? null,
    path:state.review.path?{id:state.review.path.id,current:state.artifacts.path==='current'}:null,
    shortTravel: state.program?.shortTravel ?? null,
    outputAvailability: state.outputAvailability??settings.outputAvailability, limitations: [...new Set([...settings.limitations,...state.limitations??[]])],
    nextStep: !state.machineId?(state.artifacts.path==='current'?'Review the toolpath in Studio; select a machine to write its program.':'Generate the toolpath from the recipe; select a machine to write its program.'):lifecycle.action==='check'?'Open Studio or check_bundle to check the current export.'
      : lifecycle.action==='generate'?'Generate the toolpath from the complete settings.'
      : 'Review settings and the exact toolpath together in Studio; the person exports from Studio.'
  };
}
