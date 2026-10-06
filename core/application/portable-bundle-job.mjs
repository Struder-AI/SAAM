import {resolve} from 'node:path';
import {createTemporaryWorkspace} from './temporary-workspace.mjs';
import {runComputationJob} from '../print/computation-job.mjs';

// The caller owns this private workspace even if a native worker is terminated.
// Prepared input data lives in the home; publication belongs to the destination.
export async function runPortableBundleJob(operation,directory,packageFile,{signal,progress,beforeCommit,...options}={}){
  if(!['share','import'].includes(operation))throw Error('Unknown portable bundle operation.');
  signal?.throwIfAborted();
  const owned=await createTemporaryWorkspace('portable'),workspace=owned.directory;
  let result,failure;
  try{
    result=await runComputationJob(new URL('./portable-bundle-worker.mjs',import.meta.url),
      {operation,directory:resolve(directory),packageFile:resolve(packageFile),options:{...options,workspace}},
      {signal,progress,beforeCommit});
  }catch(error){failure=error;}
  try{
    await owned.release();
  }catch(error){
    const warning=`Portable workspace cleanup: ${error.message}`;
    if(failure){failure.cleanupError=warning;failure.message+=' '+warning;}
    else result={...result,cleanupWarning:warning};
  }
  if(failure)throw failure;
  return result;
}
