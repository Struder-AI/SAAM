// What Studio and the result image draw: the SAAMpath itself, a completed
// output's else the saved one, current or not, at its recipe's placement.
// Bundle only stores the artifact; Studio prepares it for drawing in a
// cancellable worker. Paths made before part-frame deposition were built
// already placed.
import {runComputationJob} from '../core/print/computation-job.mjs';
import {PATH_CONTRACT} from '../core/path/dependencies.mjs';

const partFramePath=artifact=>artifact.contract===PATH_CONTRACT
  ||artifact.contract?.startsWith('saam-deposition/')&&Number(artifact.contract.slice('saam-deposition/'.length))>=14;

export async function readDrawnPath(state,{signal}={}){
  const output=state.completedOutput,artifact=output?output.path:state.review.path;
  if(!artifact)throw Error('No saved SAAMpath.');
  const bytes=await runComputationJob(new URL('../core/print/path-artifact-worker.mjs',import.meta.url),{
    directory:state.dir,artifact,placement:partFramePath(artifact)?(output?.plan??state.plan).placement:null,
  },{signal,subject:'Saved toolpath preview'});
  return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
}
