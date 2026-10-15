import {generatePreparedPath} from './bundle.mjs';
import {validatePlan} from './plan.mjs';

// Schema failures reject an edit. A structurally valid recipe may still be an
// incomplete authoring step; report its first production blocker without hiding
// it or preventing the next dependency/assignment edit. No artifact is written.
export async function diagnoseDepositionPlan(plan){
  validatePlan(plan);
  return depositionFinding(plan);
}

// What generation makes of a saved recipe, reported rather than refused.
export async function depositionFinding(plan){
  try{
    const path=await generatePreparedPath(plan);
    const summary=path.summary;
    return {status:'checked',scope:'deposition generation; no export, review or physical approval',
      sampledMoves:path.actions.filter(action=>action.kind==='move').length,
      slices:summary.slices??null,
      constructions:Object.fromEntries(['vaseWall','curves'].filter(key=>summary[key]).map(key=>[key,summary[key]])),
      modulationGeometry:summary.modulationGeometry??[],referenceStacks:summary.referenceStacks??{},surfaceDomain:summary.surfaceDomain??null,
      limitations:summary.limitations??[]};
  }catch(error){
    return {status:'blocked',scope:'deposition generation',message:error.message,
      implication:'The recipe is saved for further authoring; resolve this finding for generation to succeed.'};
  }
}
