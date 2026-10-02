import {generatePreparedPath} from './bundle.mjs';
import {validatePlan} from './plan.mjs';

// Schema failures reject an edit. A structurally valid recipe may still be an
// incomplete authoring step; report its first production blocker without hiding
// it or preventing the next dependency/assignment edit. No artifact is written.
export async function diagnoseDepositionPlan(plan){
  validatePlan(plan);
  try{
    const path=await generatePreparedPath(plan);
    const summary=path.summary;
    return {status:'checked',scope:'deposition generation; no export, review or physical approval',
      sampledMoves:path.actions.filter(action=>action.kind==='move').length,
      slices:summary.slices??null,ownership:summary.slices?.ownership??null,
      constructions:Object.fromEntries(['vaseWall','curves'].filter(key=>summary[key]).map(key=>[key,summary[key]])),
      modulationGeometry:summary.modulationGeometry??[],referenceFamilies:summary.referenceFamilies??{},surfaceDomain:summary.surfaceDomain??null};
  }catch(error){
    return {status:'blocked',scope:'deposition generation',message:error.message,
      implication:'Recipe is structurally valid and saved for further authoring; this finding must be resolved before generation can succeed.'};
  }
}
