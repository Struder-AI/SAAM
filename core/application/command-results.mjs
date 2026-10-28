// Bundle owns these durable business reports. Runtime observations may be absent
// without affecting work; they must never stand in for a command's saved result.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {replaceFile} from '../file-write.mjs';
import {bundleIdSchema} from '../print/identity.mjs';

const schema='saam-bundle-command-result/1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const statuses=new Set(['completed','failed','cancelled','running']);

// The code owner supplies one home-scoped Bundle result directory. No report
// reference or caller input can choose a filesystem path or executable provider.
export function createBundleCommandResults(directory){
  const root=resolve(directory);
  function file(id){
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw TypeError('Supply the exact Bundle command result id.');
    return resolve(root,id+'.json');
  }
  return Object.freeze({
    async complete({operation,bundleId,outcome,report,invocationId=randomUUID()}){
      bundleIdSchema.parse(bundleId);
      if(typeof operation!=='string'||!operation||typeof invocationId!=='string'||!invocationId||!statuses.has(outcome?.status))
        throw TypeError('A Bundle command supplies its operation, invocation identity and explicit completion status.');
      const identity={operation,bundleId,invocationId};
      try{
        // Serialize once at the owner boundary. Queries return this snapshot even
        // after the part changes, is renamed, fails creation, or is removed.
        const bytes=Buffer.from(JSON.stringify({schema,...identity,createdAt:new Date().toISOString(),outcome,report}));
        const id=digest(bytes),reference={status:'available',id,...identity,sha256:id,byteLength:bytes.length};
        await replaceFile(file(id),bytes);
        return {...outcome,bundleId,invocationId,commandResult:reference};
      }catch(error){
        // This runs after the domain decision. A report storage failure cannot
        // turn a committed edit into a reported failed edit or trigger a retry.
        return {...outcome,bundleId,invocationId,commandResult:{status:'unavailable',...identity,reason:'retention-failed',message:error.message}};
      }
    },
    async read({bundleId,id}){
      bundleIdSchema.parse(bundleId);
      const path=file(id);
      let bytes;
      try{bytes=await readFile(path);}
      catch(error){return {status:'unavailable',id,bundleId,reason:error.code==='ENOENT'?'not-retained':'read-failed',message:error.message};}
      if(digest(bytes)!==id)return {status:'unavailable',id,bundleId,reason:'identity-mismatch'};
      let record;
      try{record=JSON.parse(bytes.toString('utf8'));}catch{return {status:'unavailable',id,bundleId,reason:'invalid-record'};}
      if(record.schema!==schema||record.bundleId!==bundleId||!statuses.has(record.outcome?.status))
        return {status:'unavailable',id,bundleId,reason:record.bundleId!==bundleId?'target-mismatch':'invalid-record'};
      return {status:'available',id,sha256:id,byteLength:bytes.length,...record};
    }
  });
}
