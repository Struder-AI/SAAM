import {planPresentation} from './refresh-plan.mjs';

async function adoptProgramState(next,{presentation,decode,bind}){
  if(!next.program)return next;
  const reusable=presentation?.identity.printId===next.printId&&presentation.identity.exportHash===next.exportHash
    &&presentation.identity.generationHash===next.generationHash&&presentation.program;
  if(reusable){
    await bind?.(next);
    return {...next,program:presentation.program};
  }
  try{
    const decoded=await decode(next);
    return {...next,program:{...next.program,...decoded,summary:{...decoded.summary,...next.program.summary}}};
  }catch(error){
    const {program,...withoutProgram}=next;
    return {...withoutProgram,programError:error.message,toolpathApproved:false};
  }
}

async function adoptNeutralPath(next,{presentation,decodeNeutral}){
  if(next.program||next.artifacts?.path!=='current'||!next.review?.path)return next;
  const reusable=presentation?.identity.printId===next.printId
    &&presentation.identity.pathHash===next.review.path.hash&&presentation.program?.neutral;
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
