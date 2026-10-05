import {downloadName} from './print-name.mjs';

export function composeStudioState(bundleState,studioFacts){
  const {directory,printId,workId,instanceId,guide,example,records,importRepair,printName,fingerprint,
    presentationFingerprint,generationFailure,generationCancelled,outputGenerating=false,phasePalette,phasePaletteProblem}=studioFacts;
  const {code,dir,...displayed}=bundleState;
  const work={printId:workId??printId,snapshot:{...bundleState.workEvidence,studioInstanceId:instanceId},
    requests:workId?records.filter(record=>record.printId===workId):[]};
  const failed=generationFailure?.directory===directory&&generationFailure.generationHash===bundleState.generationHash;
  const cancelled=generationCancelled?.directory===directory&&generationCancelled.generationHash===bundleState.generationHash;
  return {...displayed,outputGenerating,...(example?{tourExample:example}:{}),tour:guide,localPrintDirectory:directory,instanceId,importRepair,work,
    ...(failed?{generationError:generationFailure.message}:{}),generationCancelled:cancelled,phasePalette,...(phasePaletteProblem?{phasePaletteProblem}:{}),
    presentationFingerprint,printName,downloadName:downloadName(printName,bundleState.exportName),printId,fingerprint};
}
