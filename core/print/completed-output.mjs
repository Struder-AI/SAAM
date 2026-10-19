// A completed neutral toolpath and its captured inputs. Programs exist at Export.
import {requireThat} from '../private/bundle/numeric.mjs';
import {retainContent,restoreContent} from './revisions.mjs';
import {storedMachineSnapshot} from '../machine/profile.mjs';

// Called only for a generation made from the state's current inputs.
export async function retainCompletedOutput(state,generation,path=state.review.path){
  if(!generation||generation.inputSnapshot)return generation;
  const inputSnapshot=await retainContent(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,
    review:{path,generation:null}});
  return {...generation,inputSnapshot,inputRevision:generation.inputRevision??state.revision};
}

export async function readCompletedOutput(state,presentGeometry){
  const generation=state.review.generation;
  if(!generation)return null;
  const input=generation.inputSnapshot?await restoreContent(state.dir,generation.inputSnapshot,state.geometryArtifact):null;
  requireThat(input||state.artifacts.program==='current','Deprecated completed output without saved inputs.');
  const plan=input?.plan??state.plan,machine=storedMachineSnapshot(input?input.machine:state.machine),geometryArtifact=input?input.geometry:state.geometryArtifact;
  requireThat(plan,'Completed toolpath settings are unavailable.');
  const descriptor=geometryArtifact?.descriptor??null;
  const savedPath=input?input.path:state.review.path;
  const path=savedPath?.scheduleFile?.endsWith('.machine.schedule.json')?
    {...savedPath,scheduleFile:`paths/${savedPath.id}.schedule.json`}:savedPath;
  return {id:generation.id,plan,machine,geometry:presentGeometry?await presentGeometry(plan,descriptor):descriptor,
    geometryId:geometryArtifact?.id??null,geometryInputId:generation.geometryInputId,path,generation};
}
