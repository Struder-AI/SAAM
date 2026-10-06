// A checked machine artifact and the immutable inputs it was made from.
// Editable inputs never supply settings for interpreting an older artifact.
import {completedOutputIdentity} from './work-evidence.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {canonicalHash} from '../canonical-json.mjs';
import {requireThat} from '../private/bundle/numeric.mjs';
import {retainContent,restoreContent} from './revisions.mjs';

export async function retainCompletedOutput(state,generation,path=state.review.path){
  if(!generation||generation.inputSnapshot)return generation;
  requireThat(generation.generationHash===state.generationHash,'Cannot recover settings for a previous output without its saved input snapshot.');
  const inputSnapshot=await retainContent(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,
    review:{path,generation:null}});
  return {...generation,inputSnapshot,inputRevision:generation.inputRevision??state.revision};
}

export async function readCompletedOutput(state,geometryInput,presentGeometry){
  const generation=state.review.generation;
  if(!generation)return null;
  const input=generation.inputSnapshot?await restoreContent(state.dir,generation.inputSnapshot):null;
  requireThat(input||generation.generationHash===state.generationHash,'Previous output has no saved settings snapshot. Generate a replacement to continue.');
  const plan=input?.plan??state.plan,machine=input?.machine??state.machine,geometryArtifact=input?input.geometry:state.geometryArtifact;
  requireThat(machine&&plan,'Completed output settings are unavailable.');
  if(geometryArtifact){
    requireThat(/^[a-f0-9]{64}$/.test(geometryArtifact.hash)&&new RegExp(`^geometry/${geometryArtifact.hash}\\.(?:3dm|mesh\\.json)$`).test(geometryArtifact.file),'Invalid completed geometry reference.');
    const bytes=await readFile(resolve(state.dir,geometryArtifact.file));
    requireThat(canonicalHash({file:canonicalHash(bytes),descriptor:geometryArtifact.descriptor})===geometryArtifact.hash,'Completed output geometry changed.');
    requireThat(canonicalHash(plan.geometry)===canonicalHash(geometryArtifact.descriptor.parameters),'Completed output geometry and settings disagree.');
  }
  const pathReference=input?input.path:state.review.path;
  if(pathReference)await verifyCompletedPath(state.dir,pathReference);
  requireThat(/^[a-f0-9]{64}$/.test(generation.exportHash)&&new RegExp(`^exports/[a-z0-9-]+/${generation.exportHash}-[a-z0-9.-]+$`).test(generation.file),'Invalid completed program reference.');
  const bytes=await readFile(resolve(state.dir,generation.file));
  requireThat(canonicalHash(bytes)===generation.exportHash,'Generated files changed; regenerate and review again.');
  const checks=generation.checks;
  requireThat(checks?.schema==='saam-checks/1'&&checks.result==='pass'&&checks.generationHash===generation.generationHash
    &&checks.exportHash===generation.exportHash&&checks.mode===generation.mode,'Saved checks do not match the completed export.');
  return {id:completedOutputIdentity(generation),
    plan,machine,geometry:presentGeometry?await presentGeometry(plan,geometryArtifact?.descriptor??null):geometryArtifact?.descriptor??null,geometryHash:geometryArtifact?.hash??canonicalHash(null),geometryInputHash:geometryInput?canonicalHash(geometryInput(plan)):geometryArtifact?.hash??canonicalHash(null),path:pathReference,generation,bytes};
}

async function verifyCompletedPath(dir,artifact){
  requireThat(/^[a-f0-9]{64}$/.test(artifact.hash)&&artifact.file===`paths/${artifact.hash}.json`,'Invalid completed SAAMpath reference.');
  const bytes=await readFile(resolve(dir,artifact.file));
  requireThat(canonicalHash(bytes)===artifact.hash,'Completed SAAMpath changed.');
}
