// Process-local provenance for a Studio worker's already checked machine source.
// There is deliberately no API accepting a caller's claim of verified output:
// ingestion listens only to the Worker instance created by the server.
import {Worker} from 'node:worker_threads';

let activeAttachment,checkedSource;

export function attachCheckedProgramWorker(worker,expectedPlanHash){
  if(!(worker instanceof Worker))throw new TypeError('Expected the Studio generation worker.');
  const attachment={};activeAttachment=attachment;
  const detach=()=>{
    worker.off('message',receive);worker.off('error',detach);worker.off('exit',detach);
    if(activeAttachment===attachment)activeAttachment=null;
  };
  const receive=message=>{
    if(message.type!=='generated'||message.error||activeAttachment!==attachment)return;
    const source=message.source;
    if(!source||source.planHash!==expectedPlanHash||source.planHash!==message.checks?.planHash
      ||source.exportHash!==message.checks?.exportHash)return;
    // Metadata and strings only. Full motion remains in the producing worker;
    // planHash already incorporates the machine, geometry and runtime identity.
    const {moves,events,...metadata}=source.metadata;
    checkedSource={planHash:source.planHash,exportHash:source.exportHash,
      metadata:structuredClone(metadata),code:source.code,sources:{...source.sources}};
    detach();
  };
  worker.on('message',receive);worker.once('error',detach);worker.once('exit',detach);
  return detach;
}

export function checkedSourceFor(planHash,exportHash){
  if(checkedSource?.planHash!==planHash||checkedSource.exportHash!==exportHash)return null;
  // No mutable cached data escapes to workflow consumers or their callers.
  return {metadata:structuredClone(checkedSource.metadata),code:checkedSource.code,sources:{...checkedSource.sources}};
}
