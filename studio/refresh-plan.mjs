import {completedOutputState} from '../core/print/review-state.mjs';

export function outputView(state){
  if(!state?.completedOutput)return state;
  if(!completedOutputState(state).available)return {...state,program:null};
  return {...state,...state.completedOutput,revision:state.completedOutput.id,outputAvailability:null};
}
export const presentationIdentity=state=>{const shown=outputView(state);return {printId:shown.printId,geometryHash:shown.geometryHash,
  generationHash:shown.generationHash,exportHash:shown.exportHash??null,pathHash:shown.review?.path?.hash??null};};

export function planPresentation(previous,next,{follow,pathMoves,materialMoves}){
  const identity=presentationIdentity(next);
  const output=completedOutputState(next);
  const visible=output.available?next.program:!next.completedOutput?next.neutralProgram:null;
  if(visible)return {model:{identity,presentedState:next.program?outputView(next):{...next,program:visible},program:visible,retained:false},
    effects:{program:'replace',buildPath:pathMoves!==visible.moves,buildMaterial:!visible.neutral&&materialMoves!==visible.moves}};
  return {model:{identity,presentedState:outputView(next),program:null,retained:false},
    effects:{program:'clear',buildPath:false,buildMaterial:false}};
}

export function planRefreshNavigation(previous,next,{follow,tab,seconds,duration,selected,hasSelectedEdge,tourInitialTab}){
  const resetExport=previous?.exportHash!==next.exportHash||previous?.completedOutput?.id!==next.completedOutput?.id,resetView=!previous;
  let nextTab=tab,notice=null;
  if(resetView)nextTab=next.tourExample?(tourInitialTab??'geometry'):next.program||next.neutralProgram?'toolpath':'geometry';
  else if(follow&&previous.generationHash!==next.generationHash){nextTab=(previous.geometryInputHash??previous.geometryHash)!==(next.geometryInputHash??next.geometryHash)?'geometry':'toolpath';notice='Updated from chat.';}
  else if(follow&&next.toolpathApproved&&!previous.program&&next.program)nextTab='toolpath';
  if(next.completedOutput&& !completedOutputState(next).available)nextTab='geometry';
  const resetSelection=resetView||!selected||!next.geometry?.labels?.includes(selected)&&!next.geometry?.features?.some(feature=>feature.id===selected)&&(!hasSelectedEdge||previous?.geometry?.geometryVersion!==next.geometry?.geometryVersion);
  return {resetExport,resetView,tab:nextTab,seconds:resetExport||resetView?duration:seconds,resetSelection,
    restoreSavedView:resetView&&!next.tourExample,surfaceDrape:resetView&&next.tourExample?.id==='surface-drape',notice};
}
