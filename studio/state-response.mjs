import {workSnapshot} from './agent-requests.mjs';
import {downloadName} from './print-name.mjs';

export function composeStudioState(bundleState,studioFacts){
  const {directory,printId,workId,instanceId,guide,records,importRepair,printName,fingerprint,
    presentationFingerprint,generationFailure,generationCancelled}=studioFacts;
  const {code,dir,...displayed}=bundleState;
  const work={printId:workId??printId,snapshot:{...workSnapshot(bundleState),studioInstanceId:instanceId},
    requests:workId?records.filter(record=>record.printId===workId):[]};
  const failed=generationFailure?.directory===directory&&generationFailure.generationHash===bundleState.generationHash&&!bundleState.program;
  const cancelled=generationCancelled?.directory===directory&&generationCancelled.generationHash===bundleState.generationHash;
  return {...displayed,tour:guide,localPrintDirectory:directory,instanceId,importRepair,work,
    ...(failed?{generationError:generationFailure.message}:{}),generationCancelled:cancelled,
    presentationFingerprint,printName,downloadName:downloadName(printName,bundleState.exportName),printId,fingerprint};
}
