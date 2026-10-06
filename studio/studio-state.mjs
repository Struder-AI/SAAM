import {planPresentation,outputView,presentationIdentity} from './refresh-plan.mjs';
import {completedOutputState} from '../core/print/review-state.mjs';

async function adoptProgramState(next,{presentation,decode,bind}){
  if(!next.program)return next;
  if(!completedOutputState(next).available)return {...next,program:null};
  const identity=presentationIdentity(next),shown=outputView(next);
  const reusable=presentation?.identity.printId===identity.printId&&presentation.identity.outputId===identity.outputId
    &&presentation.identity.editRevision===identity.editRevision&&presentation.program;
  try{
    if(reusable){
      await bind?.(shown);
      return {...next,program:presentation.program};
    }
    const decoded=await decode(shown);
    return {...next,program:{...next.program,...decoded,summary:{...decoded.summary,...next.program.summary}}};
  }catch(error){
    const {program,...withoutProgram}=next;
    return {...withoutProgram,programViewError:'Could not load the saved toolpath view: '+error.message};
  }
}

async function adoptNeutralPath(next,{presentation,decodeNeutral}){
  if(next.completedOutput||next.program||next.programViewError||next.artifacts?.path!=='current'||!next.review?.path)return next;
  const reusable=presentation?.identity.printId===next.printId
    &&presentation.identity.pathId===next.review.path.id&&presentation.program?.neutral;
  if(reusable)return {...next,neutralProgram:presentation.program};
  try{return {...next,neutralProgram:await decodeNeutral(next)};}
  catch(error){return {...next,neutralPathError:error.message};}
}

export async function prepareStudioState(next,context){
  const state=await adoptNeutralPath(await adoptProgramState(next,context),context);
  return {state,presentation:planPresentation(context.presentation,state,context)};
}

export function withoutPreviewMaterial(state){
  if(!state.program?.previewMaterial)return state;
  const {previewMaterial,...program}=state.program;
  return {...state,program};
}
