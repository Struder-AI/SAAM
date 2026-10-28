// Bundle-owned immutable records and the single manifest commit boundary.
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {replaceFile,replaceJsonFile} from '../file-write.mjs';
import {requireBundleInstance} from './studio-ownership.mjs';
import {withBundleWriteLock} from './bundle-lock.mjs';
import {recordBundleRuntime} from './bundle-runtime.mjs';
import {neutralMaterials} from '../machine/settings.mjs';
import {currentRecipeTerms} from './assignment-records.mjs';
import {geometryDescriptor,storedGeometryDescriptor} from './geometry.mjs';
import {checkedPlacementOrigins} from './placement-intent.mjs';
import {recipeDataChunks} from './operation-recipes.mjs';
import {manifestRevision} from './manifest-identity.mjs';
export {manifestRevision};

const exists=file=>access(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
// A geometry artifact's descriptor, written once beside it, so history refers to
// the artifact instead of copying its mesh.
export const descriptorFile=geometry=>geometry.file?geometry.file.replace(/\.(?:3dm|mesh\.json)$/,'.descriptor.json'):`geometry/${geometry.id}.descriptor.json`;
export async function saveDescriptor(dir,geometry){
  const file=resolve(dir,descriptorFile(geometry));
  if(!await exists(file))await replaceFile(file,JSON.stringify(storedGeometryDescriptor(geometry.descriptor,{snapshot:true})));
}

// A saved bundle record names its machine by label. A record written with a
// profile snapshot keeps only that snapshot's ID (trivial migration).
export const machineLabel=record=>record?.machineId??record?.machine?.id??null;
function labelledBundle(bundle){
  if(!bundle||!Object.hasOwn(bundle,'machine'))return bundle;
  const {machine:_snapshot,...rest}=bundle;
  return {...rest,machineId:machineLabel(bundle)};
}

// One history record per snapshot: the recipe without its shape, the machine
// label, a reference to the geometry artifact, the path and program, and the input ids.
export async function retainContent(dir,{plan,machineId,placementOrigins,geometry,review,ids,revision,editProvenance}){
  placementOrigins=checkedPlacementOrigins(placementOrigins);
  const {geometry:_shape,...recipe}=plan,id=randomUUID();
  if(geometry)await saveDescriptor(dir,geometry);
  await replaceFile(resolve(dir,`history/${id}.json`),JSON.stringify({recipe,machineId:machineId??null,
    ...(placementOrigins!==undefined?{placementOrigins}:{}),
    geometry:geometry?{id:geometry.id,file:geometry.file}:null,path:review.path??null,generation:review.generation??null,ids,
    ...(revision?{revision}:{}),...(editProvenance?{editProvenance}:{})}));
  return id;
}
// current: the bundle's geometry artifact, reused when the snapshot refers to it.
export async function restoreContent(dir,id,current){
  const saved=JSON.parse(await readFile(resolve(dir,`history/${id}.json`),'utf8'));
  const placementOrigins=checkedPlacementOrigins(saved.placementOrigins);
  saved.recipe=currentRecipeTerms(saved.recipe);
  if(saved.recipe?.setup)saved.recipe.setup=neutralMaterials(saved.recipe.setup);
  const descriptor=saved.geometry&&saved.geometry.id!==current?.id?JSON.parse(await readFile(resolve(dir,descriptorFile(saved.geometry)),'utf8')):null;
  const geometry=!saved.geometry?null:saved.geometry.id===current?.id?current
    :{...saved.geometry,descriptor:await geometryDescriptor(descriptor.parameters,descriptor)};
  const {machine:_snapshot,...record}=saved;
  return {...record,machineId:machineLabel(saved),placementOrigins,plan:geometry?{...saved.recipe,geometry:geometry.descriptor.parameters}:saved.recipe,geometry};
}
// Fail closed on a competing/crashed writer. The lock records its process for
// explicit recovery; never guess that a slow live writer has expired.
// expected: the revision the change was made from, or null to create the print.
// wait: wait for a live writer instead of failing, as a conversion on read does.
export async function commitManifest(dir,document,expected,{wait=false,editProvenance}={}){
  const placementOrigins=checkedPlacementOrigins(document.bundle?.placementOrigins);
  return withBundleWriteLock(dir,async()=>{
    await requireBundleInstance(dir);
    let current=null;
    try{current=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    checkedPlacementOrigins(current?.bundle?.placementOrigins);
    if(expected===null?current!==null:!current||manifestRevision(current)!==expected)throw Error('This revision is stale. Reload before changing the print.');
    if(current?.bundle?.operationRecipes&&!document.bundle?.operationRecipes)throw Error('Whole-part recipe editing is deprecated for operation recipes.');
    const revision=randomUUID(),bundle={...labelledBundle(document.bundle),revision};
    if(placementOrigins!==undefined)bundle.placementOrigins=placementOrigins;else delete bundle.placementOrigins;
    // Only a new host proposal binds a new provenance event. Ordinary commits
    // and restoration retain the original event's result revision unchanged.
    if(editProvenance)bundle.editProvenance={...structuredClone(editProvenance),schema:'saam-edit-provenance/1',baseRevision:expected,
      result:{revision,editRevision:bundle.editRevision,geometryInputId:bundle.geometryInputId,pathInputId:bundle.pathInputId,
        geometryArtifactId:bundle.geometry?.id??null}};
    const next={...document,bundle};
    if(next.bundle.operationRecipes)await replaceJsonFile(resolve(dir,'plan.json'),recipeDataChunks(next));
    else await replaceFile(resolve(dir,'plan.json'),JSON.stringify(next)+'\n');
    await recordBundleRuntime(dir);
    return next;
  },{wait});
}

// Preparation records an observed fact against the latest manifest, never an
// old reviewed snapshot. It establishes neither client receipt nor execution.
// Bundle keeps only the machine-agnostic receipt fields; a writer's report
// belongs to Export's result.
const RECEIPT_FIELDS=['time','outputId','inputRevision','output','bytes'];
export async function recordExportPrepared(dir,supplied){
  const receipt=Object.fromEntries(RECEIPT_FIELDS.filter(field=>Object.hasOwn(supplied,field)).map(field=>[field,structuredClone(supplied[field])]));
  return withBundleWriteLock(dir,async()=>{
    await requireBundleInstance(dir);
    const current=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));
    checkedPlacementOrigins(current.bundle?.placementOrigins);
    const review=current.bundle.review;
    const next={...current,bundle:{...labelledBundle(current.bundle),revision:randomUUID(),review:{...review,
      history:[...(review.history??[]),{event:'export-prepared',...receipt}]}}};
    if(next.bundle.operationRecipes)await replaceJsonFile(resolve(dir,'plan.json'),recipeDataChunks(next));
    else await replaceFile(resolve(dir,'plan.json'),JSON.stringify(next)+'\n');
    await recordBundleRuntime(dir);
    return next;
  });
}
