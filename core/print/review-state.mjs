// Derive review decisions from state whose persisted validity was established by
// the bundle workflow. This projection never validates output or grants approval.
export function completedOutputState(state,{generating=state.outputGenerating===true}={}){
  const output=state.completedOutput;
  const geometryMatches=Boolean(output)&&(state.geometryInputHash??state.geometryHash??null)===(output.geometryInputHash??output.geometryHash??null);
  const available=geometryMatches&&Boolean(state.program)&&!state.programError&&!state.programViewError;
  const current=available&&output.current;
  const phase=generating?'generating':!geometryMatches&&output?'geometry-changed':available?(current?'current':'previous'):'empty';
  return {phase,available,current:Boolean(current),previous:available&&!current,
    exportable:available&&!generating&&output.review.generation.mode==='production',
    receipt:available&&!generating&&Boolean(current)};
}

export function lifecycleReview(state,{programChecked=state.programChecked!==false}={}){
  const generation=state.review?.generation??null;
  const current=programChecked?Boolean(state.program)&&!state.programError&&state.completedOutput?.current!==false:null;
  const productionReady=current===true&&generation?.mode==='production';
  const toolpathApproved=programChecked?productionReady&&Boolean(state.toolpathApproved):null;
  const action=!programChecked?'check'
    :!productionReady?'generate'
    :!toolpathApproved?'review':'deliver';
  return {programChecked,current,productionReady,toolpathApproved,action};
}
