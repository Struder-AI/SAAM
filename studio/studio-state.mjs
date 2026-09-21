import {planProgramPresentation} from './refresh-plan.mjs';

async function adoptProgramState(next,{playbackCache,decode,bind}){
  if(!next.program)return next;
  const reusable=playbackCache?.printId===next.printId&&playbackCache.exportHash===next.exportHash&&playbackCache.generationHash===next.generationHash;
  if(reusable){
    await bind?.(next);
    return {...next,program:playbackCache.program};
  }
  try{
    const decoded=await decode(next);
    return {...next,program:{...next.program,...decoded,summary:{...decoded.summary,...next.program.summary}}};
  }catch(error){
    const {program,...withoutProgram}=next;
    return {...withoutProgram,programError:error.message,toolpathApproved:false};
  }
}

export async function prepareStudioState(next,context){
  const state=await adoptProgramState(next,context);
  const presentation=planProgramPresentation(state,context);
  return {state,presentation};
}

export function withoutPreviewMaterial(state){
  if(!state.program?.previewMaterial)return state;
  const {previewMaterial,...program}=state.program;
  return {...state,program};
}
