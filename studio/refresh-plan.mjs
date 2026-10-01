import {TOUR_LESSONS as L} from './tour-catalog.mjs';

export const presentationIdentity=state=>({printId:state.printId,geometryHash:state.geometryHash,
  generationHash:state.generationHash,exportHash:state.exportHash??null,pathHash:state.review?.path?.hash??null});

export function planPresentation(previous,next,{follow,pathMoves,materialMoves}){
  const identity=presentationIdentity(next);
  const visible=next.program??next.neutralProgram;
  if(visible)return {model:{identity,presentedState:next.program?next:{...next,program:visible},program:visible,retained:false},
    effects:{program:'replace',buildPath:pathMoves!==visible.moves,buildMaterial:!visible.neutral&&materialMoves!==visible.moves}};
  const samePrint=previous?.identity.printId===identity.printId,hasProgram=Boolean(previous?.program);
  const replacing=follow&&samePrint&&hasProgram;
  const tourRetains=next.tour?.active&&next.tour.step<L.playback&&samePrint&&hasProgram
    &&previous.identity.generationHash===identity.generationHash;
  if(replacing||tourRetains)return {model:{identity:previous.identity,presentedState:previous.presentedState,program:previous.program,
    retained:true,reason:replacing?'replacement':'tour'},effects:{program:'retain',buildPath:false,buildMaterial:false}};
  return {model:{identity,presentedState:next,program:null,retained:false},
    effects:{program:'clear',buildPath:false,buildMaterial:false}};
}

export function planRefreshNavigation(previous,next,{follow,tab,seconds,duration,selected,hasSelectedEdge,tourInitialTab}){
  const resetExport=previous?.exportHash!==next.exportHash,resetView=!previous;
  let nextTab=tab,notice=null;
  if(resetView)nextTab=next.tourExample?(tourInitialTab??'geometry'):next.program||next.neutralProgram?'toolpath':'geometry';
  else if(follow&&previous.generationHash!==next.generationHash){nextTab=previous.geometryHash!==next.geometryHash?'geometry':'toolpath';notice='Updated from chat.';}
  else if(follow&&next.toolpathApproved&&!previous.program&&next.program)nextTab='toolpath';
  const resetSelection=resetView||!selected||!next.geometry?.labels.includes(selected)&&(!hasSelectedEdge||previous?.geometry?.geometryVersion!==next.geometry?.geometryVersion);
  return {resetExport,resetView,tab:nextTab,seconds:resetExport||resetView?duration:seconds,resetSelection,
    restoreSavedView:resetView&&!next.tourExample,surfaceDrape:resetView&&next.tourExample?.id==='surface-drape',notice};
}
