import {saamPath} from '../path/saampath.mjs';
import {startScheduling} from '../path/scheduling-command.mjs';

// The numerical construction query remains usable without starting a job.
export async function generatePreparedPath(plan,options){
  const [{compileRecipe},{generatePath},{prepareModulationFields}]=await Promise.all([
    import('./plan.mjs'),import('./generate.mjs'),import('./modulation-fields.mjs')]);
  plan=compileRecipe(plan).plan;
  const fields=await prepareModulationFields(plan.modulations);
  return generatePath(plan,{...options,modulations:fields.record,modulationPreparation:fields.report});
}

// The generator is a numerical Construction port, not a provider callback with
// Bundle/Settings access. Production and geometry-specific fixtures use this
// same command. Results are named one-way work/schedule transfers to the job.
export function createConstructionCommand({generatePath:generate=generatePreparedPath}={}){
  return async function construct({plan,work,sourcePathId,nozzleTypes={},requireSuppliedNozzles=false,schedule,scheduleId},
    {results,signal,onProgress}={}){
    if(typeof sourcePathId!=='string'||!sourcePathId)throw TypeError('Construction requires its exact work identity.');
    if(typeof results?.work!=='function'||typeof results?.schedule!=='function')throw TypeError('Construction requires its work and schedule value receivers.');
    signal?.throwIfAborted();
    try{work=saamPath(work??await generate(plan,{onProgress}));}
    catch(error){signal?.throwIfAborted();return {status:'failed',message:error.message};}
    signal?.throwIfAborted();
    await results.work({id:sourcePathId,value:work});
    return handoffCompletedWork({work,sourcePathId,nozzleTypes,requireSuppliedNozzles,schedule,scheduleId},{results,signal,onProgress});
  };
}

// 3.6: Construction starts Scheduler once for this completed work selection.
export function handoffCompletedWork(request,scope){
  return startScheduling(request,scope);
}

export const construct=createConstructionCommand();
