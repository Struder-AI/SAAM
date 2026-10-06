// Bundle-owned immutable records and the single manifest commit boundary.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {replaceFile} from '../file-write.mjs';
import {canonicalJson} from '../canonical-json.mjs';
import {requireBundleInstance} from './studio-ownership.mjs';
import {withBundleWriteLock} from './bundle-lock.mjs';
import {recordBundleRuntime} from './bundle-runtime.mjs';

export const digest=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
export async function storeRecord(dir,value){
  const bytes=JSON.stringify(value),id=digest(bytes),file=resolve(dir,`history/${id}.json`);
  try{if(digest(await readFile(file))!==id)throw Error('Bundle history record changed.');}
  catch(error){if(error.code!=='ENOENT')throw error;await replaceFile(file,bytes);}
  return id;
}
export async function readRecord(dir,id){
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid bundle history reference.');
  const bytes=await readFile(resolve(dir,`history/${id}.json`));
  if(digest(bytes)!==id)throw Error('Bundle history record changed.');
  return JSON.parse(bytes);
}
export async function retainContent(dir,{plan,machine,geometry,review}){
  const {geometry:shape,...recipe}=plan;
  return storeRecord(dir,{recipe:await storeRecord(dir,recipe),shape:shape?await storeRecord(dir,shape):null,
    machine:machine?await storeRecord(dir,machine):null,geometry:geometry?await storeRecord(dir,geometry):null,
    path:review.path??null,generation:review.generation?await storeRecord(dir,review.generation):null});
}
export async function restoreContent(dir,id){
  const saved=await readRecord(dir,id),plan=await readRecord(dir,saved.recipe);
  if(saved.shape)plan.geometry=await readRecord(dir,saved.shape);
  return {...saved,plan,machine:saved.machine?await readRecord(dir,saved.machine):null,
    geometry:saved.geometry?await readRecord(dir,saved.geometry):null,generation:saved.generation?await readRecord(dir,saved.generation):null};
}
export function revisionOf(document){
  return digest(canonicalJson(document));
}
// Fail closed on a competing/crashed writer. The lock records its process for
// explicit recovery; never guess that a slow live writer has expired.
export async function commitManifest(dir,document,expected){
  return withBundleWriteLock(dir,async()=>{
    await requireBundleInstance(dir);
    let current=null;
    try{current=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(expected===null?current!==null:!current||revisionOf(current)!==expected)throw Error('This revision is stale. Reload before changing the print.');
    const next={...document,bundle:{...document.bundle,revision:randomUUID()}};
    await replaceFile(resolve(dir,'plan.json'),JSON.stringify(next)+'\n');
    await recordBundleRuntime(dir);
    return next;
  });
}

// Delivery records an observed fact against the latest manifest, never an old
// reviewed snapshot. The artifact's original inputs remain its own identity.
export async function recordDelivery(dir,receipt){
  return withBundleWriteLock(dir,async()=>{
    await requireBundleInstance(dir);
    const current=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));
    const review=current.bundle.review;
    const next={...current,bundle:{...current.bundle,revision:randomUUID(),review:{...review,
      history:[...(review.history??[]),{event:'delivered',...receipt}]}}};
    await replaceFile(resolve(dir,'plan.json'),JSON.stringify(next)+'\n');
    await recordBundleRuntime(dir);
    return next;
  });
}
