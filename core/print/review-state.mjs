// Derive review decisions from state whose persisted validity was established by
// the bundle workflow. This projection never validates output or grants approval.
export function lifecycleReview(state,{programChecked=state.programChecked!==false}={}){
  const generation=state.review?.generation??null;
  const current=programChecked?Boolean(state.program)&&!state.programError:null;
  const productionReady=current===true&&generation?.mode==='production';
  const toolpathApproved=programChecked?productionReady&&Boolean(state.toolpathApproved):null;
  const action=!programChecked?'check'
    :!productionReady?'generate'
    :!toolpathApproved?'review':'deliver';
  return {programChecked,current,productionReady,toolpathApproved,action};
}
