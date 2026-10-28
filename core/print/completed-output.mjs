// A completed neutral toolpath and its captured inputs. Programs exist at Export.
import {requireThat} from '../private/bundle/numeric.mjs';
import {retainContent,restoreContent} from './revisions.mjs';

// Called only for a generation made from the state's current inputs.
export async function retainCompletedOutput(state,generation,path=state.review.path){
  if(!generation||generation.inputSnapshot)return generation;
  const inputSnapshot=await retainContent(state.dir,{plan:state.plan,machineId:state.machineId,geometry:state.geometryArtifact,
    placementOrigins:state.placementOrigins,
    review:{path,generation:null},revision:state.revision,editProvenance:state.editProvenance});
  return {...generation,inputSnapshot,inputRevision:generation.inputRevision??state.revision};
}

export async function readCompletedOutput(state){
  const generation=state.review.generation;
  if(!generation)return null;
  const input=generation.inputSnapshot?await restoreContent(state.dir,generation.inputSnapshot,state.geometryArtifact):null;
  requireThat(input||state.artifacts.program==='current','Deprecated completed output without saved inputs.');
  const plan=input?.plan??state.plan,machineId=input?input.machineId:state.machineId,geometryArtifact=input?input.geometry:state.geometryArtifact;
  requireThat(plan,'Completed toolpath settings are unavailable.');
  const path=input?input.path:state.review.path;
  return {id:generation.id,plan,machineId,geometry:geometryArtifact?.descriptor??null,
    placementOrigins:input?input.placementOrigins:state.placementOrigins,
    geometryId:geometryArtifact?.id??null,geometryInputId:generation.geometryInputId,path,generation};
}
