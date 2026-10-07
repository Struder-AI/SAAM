import {lifecycleReview,completedOutputState} from '../core/print/review-state.mjs';

export function studioControls(state,ui){
  const {tab,busy,generating,exported,currentExportKey,inspection,machineView}=ui;
  const review=lifecycleReview(state),output=completedOutputState(state,{generating:generating||state.outputGenerating===true});
  const pending=output.phase==='generating';
  const toolpathViewable=output.available||Boolean(!state.completedOutput&&state.neutralProgram);
  const programReady=output.available,productionReady=output.exportable;
  const exportReady=output.exportable&&!busy;
  const nextDisabled=busy;
  const canvasLabel=tab==='toolpath'?'Toolpath viewer. Previous layer opacity is adjustable. Drag or use arrow keys to rotate; scroll to zoom.'
    :'Part viewer. Drag or use arrow keys to rotate; scroll to zoom; click a surface or edge to see its name.';
  return {
    flags:{programReady,productionReady,pending,exportReady,exported:Boolean(exported),toolpathViewable},
    next:{label:state.programViewError?'Load saved toolpath':output.previous?'Generate replacement':'Next',
      hidden:!state.programViewError&&(Boolean(inspection)||!state.machine||!state.plan.slices||tab!=='geometry'&&!output.previous),disabled:nextDisabled},
    confirm:{label:output.previous?'Export previous toolpath — recent edits are not included':exported?'Export again':'Export print file',
      hidden:tab!=='toolpath'||Boolean(inspection)||!output.available,disabled:!exportReady,'aria-disabled':String(!exportReady)},
    exportName:{hidden:tab!=='toolpath'||!output.available||Boolean(inspection),disabled:busy||pending},
    playback:{hidden:tab!=='toolpath'||!toolpathViewable,playDisabled:busy||pending||!toolpathViewable},
    selection:{hidden:tab==='toolpath'},canvas:{label:canvasLabel,stale:tab==='toolpath'&&pending&&output.available},
    tabs:{geometry:{disabled:busy&&!pending},toolpath:{disabled:(busy&&!pending)||!toolpathViewable,done:Boolean(exported)}},
    reviewedDownload:{hidden:!exportReady||ui.reviewedExportKey!==currentExportKey},fitProgram:{hidden:Boolean(machineView)}
  };
}
