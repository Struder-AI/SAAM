import {lifecycleReview} from '../core/print/review-state.mjs';

export function studioControls(state,ui){
  const {tab,busy,generating,staleProgram,exported,currentExportKey,inspection,machineView}=ui;
  const review=lifecycleReview(state);
  const programReady=review.current===true;
  const productionReady=review.productionReady;
  const pending=Boolean(ui.pending);
  const toolpathViewable=Boolean(state.program||staleProgram||pending);
  const approved=review.toolpathApproved===true;
  const exportReady=programReady&&!busy&&!pending;
  const nextDisabled=busy&&!(generating&&toolpathViewable);
  const canvasLabel=tab==='toolpath'?(state.program
    ?'Toolpath viewer. Previous layer opacity is adjustable. Drag or use arrow keys to rotate; scroll to zoom.'
    :staleProgram?'Previous toolpath shown while its replacement is prepared.':'Part geometry shown while its toolpath is prepared.')
    :'Part viewer. Drag or use arrow keys to rotate; scroll to zoom; click a surface or edge to see its name.';
  return {
    flags:{programReady,productionReady,pending,approved,exportReady,exported:Boolean(exported),toolpathViewable},
    next:{hidden:tab!=='geometry'||Boolean(inspection)||!state.machine||!state.plan.slices,disabled:nextDisabled},
    confirm:{label:exported?'Export again':'Export print file',hidden:tab!=='toolpath'||Boolean(inspection)||pending,disabled:!exportReady,'aria-disabled':String(!exportReady)},
    exportName:{hidden:tab!=='toolpath'||!state.program||Boolean(inspection),disabled:busy},
    playback:{hidden:tab!=='toolpath'||!state.program,playDisabled:busy||!programReady},
    selection:{hidden:tab==='toolpath'},canvas:{label:canvasLabel,stale:tab==='toolpath'&&!state.program&&Boolean(staleProgram)},
    tabs:{geometry:{disabled:busy&&!generating},toolpath:{disabled:(busy&&!generating)||!toolpathViewable,done:approved}},
    reviewedDownload:{hidden:pending||ui.reviewedExportKey!==currentExportKey},fitProgram:{hidden:Boolean(machineView)}
  };
}
