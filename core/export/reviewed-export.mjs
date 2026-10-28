// The person's Export in Studio is the one confirmation: Export translates the
// displayed completed output, which later edits do not change. Export reads the
// saved Paath from Bundle, writes the program, then records its receipt in Bundle
// and the exported setup in Settings. Bundle stores state; it does not run Export.
import {requireThat} from '../private/export/numeric.mjs';
import {runComputationJob} from '../print/computation-job.mjs';
import {createExportDirectory,ownExportArtifact,removeExportDirectory} from './artifact-sink.mjs';
import {recordExportPrepared} from '../print/revisions.mjs';
import {rememberPreparedSetup} from '../machine/settings-memory.mjs';
import {VERSION,BUILD_DATE} from '../print/version.mjs';
import {homePaths} from '../application/home.mjs';
import {installedMachine} from '../machine/profile.mjs';

const originalSource=geometry=>geometry?.source??(geometry?.solid?originalSource(geometry.solid):geometry?.base?originalSource(geometry.base):null);

// state: the Bundle read the person reviewed; only its completed output is used.
export async function exportReviewed(state,{machineSetups,paths,signal,progress,beforeCommit}={}){
  // Studio offers Export only for an exportable completed output (completedOutputState).
  const output=state.completedOutput;
  signal?.throwIfAborted();
  const exportPaths=paths??homePaths(),dataRoot=exportPaths.home;
  // Settings resolves the part's machine label to the
  // currently installed profile; Bundle stores only the label.
  const machine=installedMachine(output.machineId,{dataRoot});
  requireThat(machine,`The ${output.machineId} machine is not installed here. Install it to export this toolpath.`);
  const preparation=await createExportDirectory(exportPaths.tmp);let artifact;
  try{
  const plan={setup:output.plan.setup,process:output.plan.process,output:output.plan.output,placement:output.plan.placement};
  const result=await runComputationJob(new URL('./export-worker.mjs',import.meta.url),
    {directory:state.dir,path:output.path,plan,machine,preparation,dataRoot,
      release:{generatorVersion:VERSION,buildDate:BUILD_DATE}}, {signal,progress,beforeCommit:beforeCommit??(()=>{}),subject:'Machine Export'});
  requireThat(result.artifact.directory===preparation,'Export artifact ownership differs from its preparation.');
  artifact=ownExportArtifact(result.artifact);
  const attribution=originalSource(output.plan.geometry)?.attribution??null;
  const receipt={time:new Date().toISOString(),outputId:output.id,inputRevision:output.inputRevision??output.generation?.inputRevision??null,
    output:output.plan.output,bytes:artifact.byteLength,report:result.report};
  // Preparation receipts and remembered settings describe the captured output,
  // not client retrieval, browser save completion or machine execution.
  // Issue memory in preparation order; Bundle receipt I/O cannot postpone it.
  const remembering=machineSetups&&!state.deferRememberSetup?rememberPreparedSetup({machineId:output.machineId,setup:output.plan.setup,
    receipt:{directory:state.dir,outputId:output.id,inputRevision:receipt.inputRevision,preparedAt:receipt.time,output:receipt.output,bytes:receipt.bytes}},{machineSetups}):null;
  try{await recordExportPrepared(state.dir,{...receipt,attribution});}
  catch(error){result.report.limitations.push('Export prepared; its receipt could not be recorded: '+error.message);}
  if(remembering){
    const remembered=await remembering;
    if(remembered.status==='failed')result.report.limitations.push('Export prepared; its setup could not be remembered: '+remembered.message);
  }
  return {artifact,outputId:output.id,report:result.report,attribution};
  }catch(error){try{if(artifact)await artifact.release();else await removeExportDirectory(preparation);}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}
}
