import {workSnapshot} from './agent-requests.mjs';
import {hasUnpreparedEdit} from './work-state.mjs';
import {downloadName} from './print-name.mjs';
import {TOUR_LESSONS as L} from './tour-catalog.mjs';

export function composeStudioState(bundleState,studioFacts){
  const {directory,printId,workId,instanceId,guide,records,importRepair,printName,fingerprint,
    presentationFingerprint,generationFailure,generationCancelled,now}=studioFacts;
  const {code,dir,...displayed}=bundleState;
  const work={printId:workId??printId,snapshot:{...workSnapshot(bundleState),studioInstanceId:instanceId},
    requests:workId?records.filter(record=>record.printId===workId):[]};
  const failed=generationFailure?.directory===directory&&generationFailure.generationHash===bundleState.generationHash&&!bundleState.program;
  const cancelled=generationCancelled?.directory===directory&&generationCancelled.generationHash===bundleState.generationHash;
  const response={...displayed,tour:guide,localPrintDirectory:directory,instanceId,importRepair,work,
    ...(failed?{generationError:generationFailure.message}:{}),generationCancelled:cancelled,
    presentationFingerprint,printName,downloadName:downloadName(printName,bundleState.exportName),printId,fingerprint};
  const shouldPrepare=!cancelled&&guide.active&&guide.directory===directory&&guide.step===L.import
    &&!hasUnpreparedEdit(work.requests,work.snapshot,{now});
  return {response,preparation:shouldPrepare?{state:response,directory}:null};
}
