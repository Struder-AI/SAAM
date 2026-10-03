import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {runComputationJob} from './computation-job.mjs';

// The caller owns this private workspace even if a native worker is terminated.
// Preparing next to the destination keeps import directory moves on one volume.
export async function runPortableBundleJob(operation,directory,packageFile,{signal,progress,beforeCommit,...options}={}){
  if(!['share','import'].includes(operation))throw Error('Unknown portable bundle operation.');
  signal?.throwIfAborted();
  const requestedParent=dirname(resolve(operation==='share'?packageFile:directory));
  if(operation==='import')await mkdir(requestedParent,{recursive:true});
  const parent=await realpath(requestedParent);
  const workspace=await mkdtemp(resolve(parent,'.saam-portable-'));
  let result,failure;
  try{
    result=await runComputationJob(new URL('./portable-bundle-worker.mjs',import.meta.url),
      {operation,directory:resolve(directory),packageFile:resolve(packageFile),options:{...options,workspace}},
      {signal,progress,beforeCommit});
  }catch(error){failure=error;}
  try{
    const actual=await realpath(workspace),same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
    if(!same(actual,workspace)||!same(dirname(actual),parent)||!basename(actual).startsWith('.saam-portable-'))
      throw Error('Portable bundle workspace changed; cleanup refused.');
    await rm(actual,{recursive:true,force:true});
  }catch(error){
    const warning=`Portable workspace cleanup: ${error.message}`;
    if(failure){failure.cleanupError=warning;failure.message+=' '+warning;}
    else result={...result,cleanupWarning:warning};
  }
  if(failure)throw failure;
  return result;
}
