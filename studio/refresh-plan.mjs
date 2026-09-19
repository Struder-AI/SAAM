import {TOUR_LESSONS as L} from './tour-catalog.mjs';

export function planProgramPresentation(next,{previous,follow,stalePresentation,playbackCache,pathMoves,materialMoves}){
  if(next.program)return {action:'replace',stalePresentation:null,
    playbackCache:{printId:next.printId,planHash:next.planHash,exportHash:next.exportHash,program:next.program},
    buildPath:pathMoves!==next.program.moves,buildMaterial:materialMoves!==next.program.moves};
  const replacing=follow&&previous?.printId===next.printId&&Boolean(previous.program||stalePresentation?.program);
  if(replacing)return {action:'retain-replacement',stalePresentation:previous.program?previous:stalePresentation,playbackCache,buildPath:false,buildMaterial:false};
  const tourRetains=next.tour?.active&&next.tour.step<L.playback&&playbackCache?.printId===next.printId&&playbackCache.planHash===next.planHash;
  if(tourRetains)return {action:'retain-tour',stalePresentation,playbackCache,buildPath:false,buildMaterial:false};
  return {action:'clear',stalePresentation:null,playbackCache:null,buildPath:false,buildMaterial:false};
}

export function planRefreshNavigation(previous,next,{follow,tab,seconds,duration,selected,hasSelectedEdge,tourInitialTab}){
  const resetExport=previous?.exportHash!==next.exportHash,resetView=!previous;
  let nextTab=tab,notice=null;
  if(resetView)nextTab=next.tourExample?(tourInitialTab??'geometry'):next.program?'toolpath':'geometry';
  else if(follow&&previous.planHash!==next.planHash){nextTab=previous.geometryHash!==next.geometryHash?'geometry':'toolpath';notice='Updated from chat.';}
  else if(follow&&next.toolpathApproved&&!previous.program&&next.program)nextTab='toolpath';
  const resetSelection=resetView||!selected||!next.geometry.labels.includes(selected)&&(!hasSelectedEdge||previous?.geometry.geometryVersion!==next.geometry.geometryVersion);
  return {resetExport,resetView,tab:nextTab,seconds:resetExport||resetView?duration:seconds,resetSelection,
    restoreSavedView:resetView&&!next.tourExample,surfaceDrape:resetView&&next.tourExample?.id==='surface-drape',notice};
}
