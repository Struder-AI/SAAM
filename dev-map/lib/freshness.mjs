// Live status for an already drawn snapshot. This only reads/hashes generation
// inputs; it never scans source, regenerates maps or replaces the viewer shell.
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {readIndex,repoRoot,storeDir,storedFreshness} from './store.mjs';
import {replaceFile} from '../../core/file-write.mjs';

export const snapshotIdentity=held=>createHash('sha256').update(JSON.stringify(held)).digest('hex');
export const freshnessLifetimeMs=10_000;

export async function readFreshness({repo=repoRoot,readSource,files,
  readSnapshot=()=>readIndex(storeDir(repo)),now=()=>new Date()}={}) {
  let held,snapshotId=null;
  const result=details=>({schema:1,checkedAt:now().toISOString(),validForMs:freshnessLifetimeMs,
    snapshotId,generated:held?.generated??null,stale:null,...details});
  try {
    held=await readSnapshot();
    if(!held)return result({state:'missing'});
    snapshotId=snapshotIdentity(held);
    const stale=await storedFreshness(held,{repo,...(readSource?{readSource}:{}),...(files?{files}:{})});
    const after=await readSnapshot();
    if(!after||snapshotIdentity(after)!==snapshotId)
      return result({state:'changing',snapshotId:null});
    return result({state:stale?'stale':'current',stale});
  } catch(error) {
    return result({state:'error',error:{message:String(error.message??error),...(error.code?{code:error.code}:{})}});
  }
}

export async function writeFreshness({repo=repoRoot,out=resolve(repo,'dev-map/view/freshness.js'),...options}={}) {
  const status=await readFreshness({repo,...options});
  // Atomic replacement retains either a complete old heartbeat or a complete new
  // one. If writing fails, clients expire the previous heartbeat rather than
  // treating it as permanently current.
  await replaceFile(out,`globalThis.freshnessAt?.(${JSON.stringify(status)});\n`);
  return status;
}

export async function watchFreshness({intervalMs=2000,signal,onStatus=()=>{},...options}={}) {
  if(!Number.isInteger(intervalMs)||intervalMs<250||intervalMs>60_000)
    throw Error('Freshness interval must be an integer from 250 to 60000 milliseconds.');
  // Await each check before scheduling the next: slow disks cannot accumulate
  // overlapping fingerprint reads. An unavailable/stopped watcher is detected by
  // the viewer heartbeat expiry, independently of this process.
  while(!signal?.aborted) {
    const status=await writeFreshness(options);
    onStatus(status);
    try{await delay(intervalMs,undefined,{signal});}
    catch(error){if(signal?.aborted)break;throw error;}
  }
}
