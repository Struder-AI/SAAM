// Bundle-owned immutable records and the single manifest commit boundary.
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {replaceFile} from '../file-write.mjs';
import {requireBundleInstance} from './studio-ownership.mjs';
import {withBundleWriteLock} from './bundle-lock.mjs';
import {recordBundleRuntime} from './bundle-runtime.mjs';
import {neutralMaterials} from '../machine/settings.mjs';
import {currentRecipeTerms} from './assignment-records.mjs';
import {geometryDescriptor,storedGeometryDescriptor} from './geometry.mjs';

const exists=file=>access(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
// A geometry artifact's descriptor, written once beside it, so history refers to
// the artifact instead of copying its mesh.
export const descriptorFile=geometry=>geometry.file?geometry.file.replace(/\.(?:3dm|mesh\.json)$/,'.descriptor.json'):`geometry/${geometry.id}.descriptor.json`;
export async function saveDescriptor(dir,geometry){
  const file=resolve(dir,descriptorFile(geometry));
  if(!await exists(file))await replaceFile(file,JSON.stringify(storedGeometryDescriptor(geometry.descriptor,{snapshot:true})));
}

// One history record per snapshot: the recipe without its shape, the machine,
// a reference to the geometry artifact, the path and program, and the input ids.
export async function retainContent(dir,{plan,machine,geometry,review,ids}){
  const {geometry:_shape,...recipe}=plan,id=randomUUID();
  if(geometry)await saveDescriptor(dir,geometry);
  await replaceFile(resolve(dir,`history/${id}.json`),JSON.stringify({recipe,machine,
    geometry:geometry?{id:geometry.id,file:geometry.file}:null,path:review.path??null,generation:review.generation??null,ids}));
  return id;
}
// current: the bundle's geometry artifact, reused when the snapshot refers to it.
export async function restoreContent(dir,id,current){
  const saved=JSON.parse(await readFile(resolve(dir,`history/${id}.json`),'utf8'));
  saved.recipe=currentRecipeTerms(saved.recipe);
  if(saved.recipe?.setup)saved.recipe.setup=neutralMaterials(saved.recipe.setup);
  const descriptor=saved.geometry&&saved.geometry.id!==current?.id?JSON.parse(await readFile(resolve(dir,descriptorFile(saved.geometry)),'utf8')):null;
  const geometry=!saved.geometry?null:saved.geometry.id===current?.id?current
    :{...saved.geometry,descriptor:await geometryDescriptor(descriptor.parameters,descriptor)};
  return {...saved,plan:geometry?{...saved.recipe,geometry:geometry.descriptor.parameters}:saved.recipe,geometry};
}
// A manifest's revision. One saved without a revision is identified by its
// content until its next commit records one.
export function manifestRevision(document){
  if(!document?.bundle)return undefined;
  return document.bundle.revision??'saved-'+createHash('sha256').update(JSON.stringify(document)).digest('hex');
}
// Fail closed on a competing/crashed writer. The lock records its process for
// explicit recovery; never guess that a slow live writer has expired.
// expected: the revision the change was made from, or null to create the print.
// wait: wait for a live writer instead of failing, as a conversion on read does.
export async function commitManifest(dir,document,expected,{wait=false}={}){
  return withBundleWriteLock(dir,async()=>{
    await requireBundleInstance(dir);
    let current=null;
    try{current=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(expected===null?current!==null:!current||manifestRevision(current)!==expected)throw Error('This revision is stale. Reload before changing the print.');
    const next={...document,bundle:{...document.bundle,revision:randomUUID()}};
    await replaceFile(resolve(dir,'plan.json'),JSON.stringify(next)+'\n');
    await recordBundleRuntime(dir);
    return next;
  },{wait});
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
