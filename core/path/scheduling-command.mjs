import {randomUUID} from 'node:crypto';
import {schedulePath} from './schedule.mjs';
import {joinSaamPath} from './saampath.mjs';
import {nozzleTypesContain,resolveSchedulingTools,sourceToolIndexes} from './scheduling-tools.mjs';

// 13: activation is a command; the numerical solver remains a pure query.
// The named receiver transfers the actual immutable value to the admitted job.
export async function startScheduling({work,sourcePathId,nozzleTypes={},requireSuppliedNozzles=false,
  schedule:previous=null,scheduleId:previousId=null},{results,signal,onProgress}={}){
  if(typeof results?.schedule!=='function')throw TypeError('Scheduling requires its schedule-value receiver.');
  signal?.throwIfAborted();
  let schedule,qualification;
  if(previous){
    try{joinSaamPath({sourcePathId,deposition:work,schedule:previous});}
    catch(error){return {status:'failed',message:error.message,workId:sourcePathId};}
  }
  try{
    if(requireSuppliedNozzles)for(const index of sourceToolIndexes(work))
      if(nozzleTypes[index]==null)throw Error('Selected logical tool '+index+' has no supplied nozzle geometry.');
    const actual=resolveSchedulingTools(work,nozzleTypes);
    const reuse=previous&&(!requireSuppliedNozzles&&!Object.keys(nozzleTypes).length||
      nozzleTypesContain(previous.completion?.nozzleTypes,actual,sourceToolIndexes(work)));
    schedule=reuse?previous:schedulePath(work,{sourcePathId,nozzleTypes,onProgress});
    qualification=requireSuppliedNozzles?{status:'qualified',reusedOrder:Boolean(reuse),nozzleTypes:actual}:{status:'neutral'};
  }catch(error){
    signal?.throwIfAborted();
    if(!requireSuppliedNozzles)return {status:'failed',message:error.message,workId:sourcePathId};
    const message='Selected-nozzle scheduling qualification failed: '+error.message;
    // Retain the existing neutral review behavior after a selected-tool finding.
    // A failure of the default solve still leaves delivered source work intact.
    try{schedule=schedulePath(work,{sourcePathId,onProgress});}
    catch(fallback){return {status:'failed',message:fallback.message,workId:sourcePathId};}
    qualification={status:'failed',message};
  }
  return publishScheduledWork({workId:sourcePathId,schedule,qualification,
    scheduleId:schedule===previous&&previousId?previousId:randomUUID()},{results,signal});
}

// 13.7: transfer the qualified pair; host failure never triggers a new solve.
export async function publishScheduledWork({workId,schedule,qualification,scheduleId},{results,signal}){
  signal?.throwIfAborted();
  await results.schedule({id:scheduleId,workId,value:schedule,qualification});
  return {status:'completed',workId,scheduleId};
}
