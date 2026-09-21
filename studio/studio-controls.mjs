export function studioControls(state,ui){
  const {tab,busy,generating,staleProgram,tourActive,exported,currentExportKey,inspection,machineView}=ui;
  const programReady=Boolean(state.program&&!state.programError);
  const productionReady=programReady&&state.review.generation?.mode==='production';
  const pending=Boolean(ui.pending);
  const toolpathViewable=Boolean(state.program||staleProgram||pending);
  const approved=productionReady&&Boolean(state.toolpathApproved);
  const confirmLabel=tab==='geometry'
    ? tourActive?(productionReady?'View toolpath':'Generate toolpath'):'Next'
    : !productionReady?'Generate toolpath':approved?(exported?'Export again':'Export print file'):'Confirm settings & export';
  const canvasLabel=tab==='toolpath'?(state.program
    ?'Toolpath viewer. Previous layer opacity is adjustable. Drag or use arrow keys to rotate; scroll to zoom.'
    :staleProgram?'Previous toolpath shown while its replacement is prepared.':'Part geometry shown while its toolpath is prepared.')
    :'Part viewer. Drag or use arrow keys to rotate; scroll to zoom; click a surface or edge to see its name.';
  return {
    flags:{programReady,productionReady,pending,approved,exportReady:approved,exported:Boolean(exported),toolpathViewable},
    confirm:{label:confirmLabel,hidden:Boolean(inspection),disabled:busy&&!(generating&&toolpathViewable),'aria-disabled':String(busy&&!(generating&&toolpathViewable))},
    exportName:{hidden:tab!=='toolpath'||!state.program||Boolean(inspection),disabled:busy},
    playback:{hidden:tab!=='toolpath'||!state.program,playDisabled:busy||!programReady},
    selection:{hidden:tab==='toolpath'},canvas:{label:canvasLabel,stale:tab==='toolpath'&&!state.program&&Boolean(staleProgram)},
    tabs:{geometry:{disabled:busy&&!generating},toolpath:{disabled:(busy&&!generating)||!toolpathViewable,done:Boolean(state.toolpathApproved)}},
    reviewedDownload:{hidden:ui.reviewedExportKey!==currentExportKey},fitProgram:{hidden:Boolean(machineView)}
  };
}
