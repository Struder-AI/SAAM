// Derive review decisions from state whose persisted validity was established by
// the bundle workflow. This projection never validates output or grants approval.
// The shown toolpath is the completed output when it loads, else the saved SAAMpath.
// After any edit it stays shown, marked previous (not current), until replaced.
export function completedOutputState(state,{generating=state.outputGenerating===true}={}){
  const output=state.completedOutput;
  const available=Boolean(output)&&Boolean(state.program)&&!state.programError&&!state.programViewError;
  const current=available&&output.current;
  const savedPath=!output&&Boolean(state.review?.path)&&!state.neutralPathError;
  return {generating:Boolean(generating),available,current:Boolean(current),
    previous:available?!current:savedPath&&state.artifacts?.path!=='current',
    exportable:available&&!generating&&output.review.generation.mode==='production',
    inspectable:available||savedPath,
    receipt:!generating&&(Boolean(current)||savedPath&&state.artifacts?.path==='current')};
}

export function lifecycleReview(state,{programChecked=state.programChecked!==false}={}){
  const generation=state.review?.generation??null;
  const current=programChecked?Boolean(state.program)&&!state.programError&&state.completedOutput?.current!==false:null;
  const productionReady=current===true&&generation?.mode==='production';
  const action=!programChecked?'check':!productionReady?'generate':'review';
  return {programChecked,current,productionReady,action};
}
