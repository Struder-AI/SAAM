// Prepared identities for authored inputs and their saved output, owned by Bundle.
import {canonicalHash} from '../canonical-json.mjs';
export function authoredWorkIdentity(plan,machine){
  return {inputKey:canonicalHash({plan,machine}),geometryKey:canonicalHash(plan.geometry??null)};
}
export function completedOutputIdentity(generation){
  return generation?canonicalHash({generationHash:generation.generationHash,exportHash:generation.exportHash,inputSnapshot:generation.inputSnapshot??null,mode:generation.mode}):null;
}
export function preparedWorkEvidence(identity,revision,generation){
  return {schema:'saam-work-evidence/1',revision,inputKey:identity.inputKey,geometryKey:identity.geometryKey,
    generationKey:completedOutputIdentity(generation),...(identity.editRevision?{editRevision:identity.editRevision}:{})};
}
