import {generatePreparedPath} from './bundle.mjs';
import {validatePlan} from './plan.mjs';

// Schema failures reject an edit. A structurally valid recipe may still be an
// incomplete authoring step; report its first production blocker without hiding
// it or preventing the next dependency/assignment edit. No artifact is written.
export async function diagnoseDepositionPlan(plan,machine){
  validatePlan(plan,machine);
  try{
    const path=await generatePreparedPath(plan,machine);
    const summary=path.summary;
    return {status:'checked',scope:'deposition generation; no export, review or physical approval',
      sampledMoves:path.actions.filter(action=>action.kind==='move').length,
      slices:summary.slices??null,ownership:summary.slices?.ownership??null,
      constructions:Object.fromEntries(['drapedSkin','waveOverhangs','vaseWall','thickLip','pipeCladding','curves','bridging'].filter(key=>summary[key]).map(key=>[key,summary[key]])),
      modulationGeometry:summary.modulationGeometry??[],nonplanar:summary.nonplanarLimit??null};
  }catch(error){
    return {status:'blocked',scope:'deposition generation',message:error.message,
      implication:'Recipe is structurally valid and saved for further authoring; this finding must be resolved before generation can succeed.'};
  }
}
