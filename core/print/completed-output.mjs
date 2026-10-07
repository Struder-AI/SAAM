// A checked machine artifact and the inputs it was made from. Editable inputs
// never supply settings for interpreting an older artifact.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {requireThat} from '../private/bundle/numeric.mjs';
import {retainContent,restoreContent} from './revisions.mjs';

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
  requireThat(input||state.artifacts.program==='current','Previous output has no saved settings snapshot. Generate a replacement to continue.');
  const plan=input?.plan??state.plan,machine=input?.machine??state.machine,geometryArtifact=input?input.geometry:state.geometryArtifact;
  requireThat(machine&&plan,'Completed output settings are unavailable.');
  const descriptor=geometryArtifact?.descriptor??null;
  return {id:generation.id,plan,machine,geometry:presentGeometry?await presentGeometry(plan,descriptor):descriptor,
    geometryId:geometryArtifact?.id??null,geometryInputId:generation.geometryInputId,path:input?input.path:state.review.path,generation,
    bytes:await readFile(resolve(state.dir,generation.file))};
}
