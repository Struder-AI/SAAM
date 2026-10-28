import {tmpdir} from 'node:os';
import {schedulePath} from '../../path/schedule.mjs';
import {joinSaamPath} from '../../path/saampath.mjs';
import {pathActions} from '../../path/curve-path.mjs';
import {schedulingNozzleInputs} from '../../machine/nozzle.mjs';
import {settingsDefaults} from '../../machine/settings.mjs';
import {storedMachineSnapshot} from '../../machine/profile.mjs';
import {machineAdapter} from '../../export/registry.mjs';
import {PREPARED_PATH_CONTRACT} from '../../export/prepare-path.mjs';
import {createExportDirectory,createArtifactSink,ownExportArtifact} from '../../export/artifact-sink.mjs';

// Bundle names the work and qualifies the selected nozzles before Export joins
// the captured pair (core/application/generation-execution.mjs).
export function scheduled(work,{machine=null,plan=null,sourcePathId='fixture:'+(machine?.id??'neutral')}={}){
  const schedule=schedulePath(work,{sourcePathId,nozzleTypes:schedulingNozzleInputs(machine,plan)});
  return joinSaamPath({sourcePathId,deposition:work,schedule});
}
// The flat action list that a saampath/1 path once stored.
export const actionsOf=path=>[...(path.actions??pathActions(path))];

// Export accepts only joined compact paths. A hand-built machine-motion
// fixture is a prepared path, written by the selected adapter as exportArtifact does.
export async function writePrepared(prepared,plan,locked,release){
  const machine=storedMachineSnapshot(locked),adapter=await machineAdapter(plan,machine);
  const settings={machine,setup:plan.setup,process:plan.process,output:plan.output,release,defaultProcess:settingsDefaults(machine).process};
  const sink=await createArtifactSink(await createExportDirectory(tmpdir()));let owned;
  try{
    const {report}=await adapter.write({schema:PREPARED_PATH_CONTRACT,completion:{contract:PREPARED_PATH_CONTRACT},notes:[],...prepared},settings,sink.writer);
    owned=ownExportArtifact(await sink.finish());return {report,bytes:await owned.materialize()};
  }finally{if(owned)await owned.release();else await sink.abort();}
}
