import {requireThat} from '../private/bundle/numeric.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {retainCompletedOutput,readCompletedOutput} from './completed-output.mjs';
import {saamPathText,joinSaamPath} from '../path/saampath.mjs';
import {readPathArtifact,readMotionArtifact} from './path-artifact.mjs';
import {pathSummary} from '../path/curve-path.mjs';
import {schedulePath} from '../path/schedule.mjs';
import {completedOutputState} from './review-state.mjs';
import {checkedPhaseColours} from './phase-colours.mjs';
// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, access, copyFile,readdir,rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { exportProgram, programReadiness, settingsRows } from '../export/registry.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import { loadMachine,currentMachineSnapshot } from '../machine/profile.mjs';
import {resolveNozzleGeometry} from '../machine/nozzle.mjs';
import {runComputationJob} from './computation-job.mjs';
import {heldBundleInstance} from './studio-ownership.mjs';
import {replaceFile} from '../file-write.mjs';
import {canonicalJson} from '../canonical-json.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {selectSettings,saveSetup,withMachineSetupExport,neutralMaterials} from '../machine/settings.mjs';
import {assignmentFamily as ordinaryAssignmentFamily} from './slice-settings.mjs';
import {commitManifest,manifestRevision,retainContent,restoreContent,recordDelivery,saveDescriptor} from './revisions.mjs';
import {geometryTree} from '../../skills/records.mjs';
import {currentRecipeTerms} from './assignment-records.mjs';
import {geometryDescriptor,storedGeometryArtifact} from './geometry.mjs';

// Present old generation reports with current terminology without rewriting artifacts.
function currentPathSummary(summary){
  const current=structuredClone(summary??{});
  if(current.referenceFamilies&&!current.referenceStacks)current.referenceStacks=current.referenceFamilies;
  delete current.referenceFamilies;
  for(const stacks of Object.values(current.referenceStacks??{}))for(const stack of stacks){
    stack.referenceStackKind??=stack.referenceFamily;delete stack.referenceFamily;
    stack.layers??=stack.normalOwnership?.courseCount??stack.courses;
    delete stack.courses;
    if(stack.normalOwnership){stack.normalOwnership.sliceCount??=stack.normalOwnership.courseCount;delete stack.normalOwnership.courseCount;}
  }
  for(const slice of current.slices?.instances??[]){
    if(slice.referenceFamily){slice.referenceStackKind??=slice.referenceFamily;delete slice.referenceFamily;}
    if(slice.fillOrder&&Object.hasOwn(slice.fillOrder,'courses')){slice.fillOrder.slices??=slice.fillOrder.courses;delete slice.fillOrder.courses;}
  }
  for(const trace of current.curves??[]){trace.repetitions??=trace.courses;delete trace.courses;}
  for(const vase of current.vaseWall?[current.vaseWall,...(current.vaseWall.instances??[])]:[]){
    if(Object.hasOwn(vase,'boundaryCourses')){vase.boundaryRepetitions??=vase.boundaryCourses;delete vase.boundaryCourses;}
    if(vase.sizedCourses&&!vase.sizedTiles)vase.sizedTiles=vase.sizedCourses;
    delete vase.sizedCourses;
    if(vase.sizedTiles){vase.sizedTiles.tileCount??=vase.sizedTiles.courses;delete vase.sizedTiles.courses;vase.sizedTiles.tileWidthRangeMm??=vase.sizedTiles.courseWidthRangeMm;delete vase.sizedTiles.courseWidthRangeMm;}
    for(const change of vase.sizedTiles?.countChanges??[]){change.tileCount??=change.courses;delete change.courses;}
  }
  return current;
}

export const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_SCHEMA='saam-print-bundle/3';
const currentBundleSchema=schema=>schema===BUNDLE_SCHEMA||schema==='saam-print-bundle/2';
const nativeSuffix=geometry=>{const name=geometry.nativeFile??'model.3dm';requireThat(['model.3dm','model.mesh.json'].includes(name),'Unsupported native geometry file.');return name==='model.3dm'?'.3dm':'.mesh.json';};
const json=async file=>JSON.parse(await readFile(file,'utf8'));
// Events after a program that leave its inputs unchanged.
const KEEPS_INPUTS=new Set(['generated','generation-reused','delivered','human-approval','converted']);
const CONVERTED_NOTE='Converted from the old bundle format; originals kept.';
const UNSHOWN_PROGRAM_NOTE='Its program from an older SAAM is kept in exports/ but not shown or exported; generate to see the toolpath.';
const originalSource=geometry=>geometry?.source??(geometry?.solid?originalSource(geometry.solid):geometry?.base?originalSource(geometry.base):null);
async function save(file,value){
  await replaceFile(file,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
}

export function applyPlanPatch(previous, patch, geometryTemplate) {
  return resolvePlanPatch(previous,patch,{geometryTemplate});
}

// changes: each recipe value the edit changed, from planChanges.
export function editedPlanReview(review, geometryChanged, changes = [], time = new Date().toISOString()) {
  const event = {event:'plan-edited', time, geometryChanged, changes, invalidated:['toolpath']};
  return invalidateReview(review,event);
}

// The recipe values that differ between two plans, as {path, before, after};
// objects are compared key by key and arrays whole. Geometry is reported by
// geometryChanged rather than listed.
export function planChanges(before, after, path = []) {
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  if(object(before)&&object(after))
    return [...new Set([...Object.keys(before),...Object.keys(after)])].sort()
      .filter(key=>!(path.length===0&&key==='geometry'))
      .flatMap(key=>planChanges(before[key],after[key],[...path,key]));
  return canonicalJson(before)===canonicalJson(after)?[]:[{path:path.join('.'),before:before??null,after:after??null}];
}

function invalidateReview(review,event) {
  return {...review, history:[...review.history,event]};
}

export function machineChangedReview(review, from, to, time = new Date().toISOString()) {
  return invalidateReview(review,{event:'machine-changed',from,to,time});
}

export function createBundleWorkflow(adapter) {
  const {kind,defaults,createGeometry,generatePath,geometryTemplate,patchPlan,
    version:VERSION,buildDate:BUILD_DATE,exportName:EXPORT_NAME}=adapter;
  const contract=adapter.generationContract??null;
  const exportName=(plan,machine)=>{
    const extension=machine.outputs.find(o=>o.id===plan.output)?.extension??'.gcode';
    requireThat(/^\.[a-z0-9.]+$/.test(extension),'Invalid export extension.');
    return EXPORT_NAME.replace(/\.gcode$/,extension);
  };
  const legacyExportPath=(plan,machine)=>{requireThat(/^[a-z0-9-]+$/.test(plan.output),'Invalid output ID.');return `exports/${plan.output}/${exportName(plan,machine)}`;};
  const exportArtifactPath=(plan,machine,id)=>`exports/${plan.output}/${id}-${exportName(plan,machine)}`;
  // One preparation serves checking and saving unchanged inputs.
  let preparation, pathPreparation;
  // Concurrent first reads of a split-file bundle in this process share one conversion.
  const conversions=new Map();
  // Bundle is the only writer: a commit that changes plan, machine or geometry
  // mints a new edit revision, and new geometry-input and path-input ids when
  // those parts changed. Programs and paths record the ids they were made from.
  const pathInput=(plan,machine)=>canonicalJson({deposition:adapter.pathDependencies?adapter.pathDependencies({...plan,geometry:null}):{...plan,geometry:null},nozzleGeometry:resolveNozzleGeometry(machine,plan)});
  const manufacturingKey=plan=>canonicalJson(adapter.manufacturingInput?.(plan)??null);
  function inputIds(state,next){
    const current={editRevision:state.editRevision,geometryInputId:state.geometryInputId,pathInputId:state.pathInputId};
    if(next.plan===undefined&&next.machine===undefined&&next.geometry===undefined)return current;
    const plan=next.plan??state.plan,geometry=next.geometry===undefined?state.geometryArtifact:next.geometry;
    const geometryChanged=(geometry?.id??null)!==(state.geometryArtifact?.id??null);
    return {editRevision:randomUUID(),
      geometryInputId:geometryChanged||manufacturingKey(plan)!==manufacturingKey(state.plan)?randomUUID():current.geometryInputId,
      pathInputId:geometryChanged||pathInput(plan,next.machine===undefined?state.machine:next.machine)!==pathInput(state.plan,state.machine)?randomUUID():current.pathInputId};
  }
  // The one reading of prints saved before input ids: hashes, approvals and
  // undo history are dropped; a program is kept with its saved SAAMpath when no
  // recorded event after its last generation changed its inputs. Otherwise the
  // print shows its geometry and no toolpath until it is generated.
  function savedBundle(bundle){
    if(bundle.editRevision)return bundle;
    const {approvals:_approvals,navigation:_navigation,generation:old,path:oldPath,...review}=bundle.review??{};
    const history=review.history??[],last=history.findLastIndex(event=>event.event==='generated');
    const kept=last>=0&&history.slice(last+1).every(event=>KEEPS_INPUTS.has(event.event)),id=bundle.revision;
    const {generationHash:_g,exportHash,inputSnapshot:_s,checks,...generation}=old??{};
    const {generationHash:_cg,exportHash:_ce,planHash:_cp,...keptChecks}=checks??{};
    return {...bundle,editRevision:id,geometryInputId:id,pathInputId:id,
      geometry:bundle.geometry&&{id:bundle.geometry.hash,file:bundle.geometry.file,descriptor:bundle.geometry.descriptor},
      review:{...review,history,
        path:kept&&oldPath?{id:oldPath.hash,file:oldPath.file,inputId:id,contract,...(oldPath.source?{source:oldPath.source}:{})}:null,
        generation:kept&&old&&oldPath?{...generation,id:exportHash,editRevision:id,geometryInputId:id,contract,checks:checks?keptChecks:null}:null}};
  }
// A new print's recipe defaults and the notes from selecting its settings.
async function proposedPlan(machineId, options={}) {
  if(!machineId)return {plan:await defaults(null),notes:[]};
  const {machine,settings,notes}=await selectSettings(machineId,options);
  return {plan:{...await defaults(machine),...settings},notes};
}
// Notes about how the print was made show until its next recorded change.
async function initBundle(directory, plan = {schema:'saam-shell-plan/1'}, { machineId, sourceBytes,sourcePath,attachments=[],notes=[] } = {}) {
  const dir = resolve(directory);
  try {
    await access(resolve(dir, 'plan.json'));
    throw new Error('Print already exists. Open it or choose another directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const deferRememberSetup=plan?.bundle?.deferRememberSetup===true,phaseColours=checkedPhaseColours(plan?.bundle?.phaseColours);
  let machineSnapshot;
  if(plan?.bundle){
    const {bundle,...recipe}=plan;
    plan=recipe;
    machineSnapshot=bundle.machine;
  }
  const normalized=adapter.normalizePlan?await adapter.normalizePlan(plan):{plan};
  plan=normalized.plan;
  const machine = machineId?loadMachine(machineId):machineSnapshot??null;
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  const geometry = plan.geometry?await createGeometry(plan.geometry):null;
  if(geometry)plan={...plan,geometry:geometry.descriptor.parameters};
  for(const attachment of attachments){
    requireThat(['repair/original.stl','repair/repaired.stl','repair/repair.json'].includes(attachment.file),'Unsupported import attachment.');
    const target=resolve(dir,attachment.file);await mkdir(dirname(target),{recursive:true});await copyFile(attachment.sourcePath,target);
  }
  if(originalSource(plan.geometry)||sourcePath||sourceBytes){
    const target=resolve(dir,'geometry/source.stl');
    if(sourcePath){await mkdir(dirname(target),{recursive:true});await copyFile(sourcePath,target);}
    else{requireThat(sourceBytes,'STL source bytes are required; use import-stl.');await save(target,sourceBytes);}
    const emptiedSource=geometry?.descriptor.meshNormalization?.find(report=>report.empty&&report.source)?.source;
    if(emptiedSource)await save(resolve(dir,'geometry/source.json'),JSON.stringify(emptiedSource));
  }
  const geometryArtifact=await saveGeometry(dir,geometry),id=randomUUID();
  const review={schema:'saam-review/1',history:notes.length?[{event:'created',time:new Date().toISOString(),notes}]:[],generation:null};
  await saveManifest(dir,{plan,machine,review,geometry:geometryArtifact,ids:{editRevision:id,geometryInputId:id,pathInputId:id},deferRememberSetup,phaseColours},null);
  return dir;
}

async function saveGeometry(dir, geometry) {
  if(!geometry)return null;
  const id=randomUUID();
  if(!geometry.bytes)return {id,descriptor:geometry.descriptor};
  const file=`geometry/${id}${nativeSuffix(geometry.descriptor)}`;
  await save(resolve(dir,file),geometry.bytes);return {id,file,descriptor:geometry.descriptor};
}

const manifestDocument=({plan,machine,review,geometry,ids,deferRememberSetup,phaseColours})=>({...plan,bundle:{schema:BUNDLE_SCHEMA,machine,review,geometry:storedGeometryArtifact(geometry),...ids,
  ...(deferRememberSetup?{deferRememberSetup:true}:{}),...(phaseColours?{phaseColours}:{})}});
const saveManifest=(dir,state,expected)=>commitManifest(dir,manifestDocument(state),expected);
const stateIds=state=>({editRevision:state.editRevision,geometryInputId:state.geometryInputId,pathInputId:state.pathInputId});

// ids: the input ids to record, when restoring them from history.
async function commitState(state,next,{edit=false,history,ids=inputIds(state,next)}={}){
  const previous={plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:state.deferRememberSetup,phaseColours:state.phaseColours};
  const navigation=state.review.navigation??{past:[],future:[]};
  const nextHistory=history??(edit?{past:[...navigation.past,await retainContent(state.dir,{...previous,ids:stateIds(state)})],future:[]}:navigation);
  const generation=next.review?.generation===state.review.generation&&state.artifacts?.program==='current'
    ?await retainCompletedOutput(state,state.review.generation):next.review?.generation;
  const review={...next.review,generation,navigation:nextHistory};
  return saveManifest(state.dir,{...previous,...next,review,ids},state.revision);
}

async function restoreRevision(directory,{direction,expectedRevision}={}){
  requireThat(['undo','redo'].includes(direction),'Choose undo or redo.');
  const state=await loadBundle(directory,{program:false});
  requireThat(typeof expectedRevision==='string'&&expectedRevision===state.revision,'This revision is stale. Reload before restoring the print.');
  const navigation=state.review.navigation??{past:[],future:[]},source=direction==='undo'?'past':'future',destination=direction==='undo'?'future':'past';
  requireThat(navigation[source].length>0,`Nothing to ${direction}.`);
  const id=navigation[source].at(-1),restored=await restoreContent(state.dir,id,state.geometryArtifact);
  const current=await retainContent(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,ids:stateIds(state)});
  const history={...navigation,[source]:navigation[source].slice(0,-1),[destination]:[...navigation[destination],current]};
  const review={...state.review,path:restored.path,
    history:[...state.review.history,{event:direction,time:new Date().toISOString(),restored:id,previousRevision:state.revision}]};
  await commitState(state,{plan:restored.plan,machine:restored.machine,geometry:restored.geometry,review},{history,ids:restored.ids});
  return loadBundle(directory);
}

async function bundleFiles(dir,at=dir){
  const files=[];
  for(const entry of await readdir(at,{withFileTypes:true})){
    const path=resolve(at,entry.name);
    if(entry.isDirectory())files.push(...await bundleFiles(dir,path));
    else files.push(path.slice(dir.length+1).replaceAll('\\','/'));
  }
  return files.sort();
}

// A split-file bundle from before saam-print-bundle/2 becomes one manifest in
// the saved format savedBundle reads; its history records the files kept.
async function prepareLegacyMigration(dir,document,planText){
  const optional=name=>readFile(resolve(dir,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const [machineBytes,reviewBytes,descriptorBytes,checksBytes]=await Promise.all([readFile(resolve(dir,'machine.json')),readFile(resolve(dir,'review.json')),optional('geometry/model.json'),optional('checks.json')]);
  const machine=JSON.parse(machineBytes),review=JSON.parse(reviewBytes);
  const inputs=new Map([['plan.json',Buffer.from(planText)],['machine.json',machineBytes],['review.json',reviewBytes],['geometry/model.json',descriptorBytes],['checks.json',checksBytes]]);
  const artifacts=new Map(),missing=descriptorBytes?[]:['geometry/model.json'];
  const {geometry,parameters,error}=await legacyGeometry(dir,document,descriptorBytes&&JSON.parse(descriptorBytes),inputs,artifacts);
  if(review.generation){
    const oldProgram=legacyExportPath(document,machine),code=await optional(oldProgram),exportHash=randomUUID();
    inputs.set(oldProgram,code);
    const file=exportArtifactPath(document,machine,exportHash);if(code)artifacts.set(file,code);else missing.push(oldProgram);
    review.generation=code?{...review.generation,exportHash,file,checks:checksBytes?JSON.parse(checksBytes):null}:null;
  }
  const source=originalSource(document.geometry);
  if(source)inputs.set('geometry/source.stl',await readFile(resolve(dir,'geometry/source.stl')));
  const retained=[...inputs].filter(([name,bytes])=>name!=='plan.json'&&bytes!==null).map(([name])=>name);
  review.history=[...(review.history??[]),{event:'converted',time:new Date().toISOString(),from:'split-file bundle',retained,
    ...(missing.length?{missing}:{}),...(error?{geometryError:error}:{})}];
  const manifest={...document,...(parameters?{geometry:parameters}:{}),bundle:{schema:BUNDLE_SCHEMA,machine,review,geometry,revision:randomUUID()}};
  return {manifest,artifacts,inputs};
}
// The saved geometry, copied into the current layout; a bundle saved without
// one builds it from its recipe when it can, and otherwise has none.
async function legacyGeometry(dir,document,descriptor,inputs,artifacts){
  if(descriptor){
    const legacyFile=nativeSuffix(descriptor)==='.3dm'?'geometry/model.3dm':'geometry/model.mesh.json';
    const bytes=await readFile(resolve(dir,legacyFile)),id=randomUUID(),file=`geometry/${id}${nativeSuffix(descriptor)}`;
    inputs.set(legacyFile,bytes);artifacts.set(file,bytes);
    return {geometry:{hash:id,file,descriptor}};
  }
  if(!document.geometry)return {geometry:null};
  const built=await createGeometry(document.geometry).catch(error=>({error}));
  if(built.error)return {geometry:null,error:built.error.message};
  const id=randomUUID(),file=built.bytes?`geometry/${id}${nativeSuffix(built.descriptor)}`:null;
  if(file)artifacts.set(file,built.bytes);
  return {geometry:{hash:id,...(file?{file}:{}),descriptor:built.descriptor},parameters:built.descriptor.parameters};
}

async function requireLegacyCurrent(dir,inputs){
  for(const [name,expected] of inputs){
    const actual=await readFile(resolve(dir,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    requireThat(expected===null?actual===null:actual?.equals(expected),`Legacy bundle changed during migration: ${name}. Open it again.`);
  }
}

// The conversion commits like any write: under the bundle write lock, waiting
// for another writer, and only where no other Studio holds the reservation.
async function convertLegacyBundle(dir,document,planText,{beforeCommit}){
  const prepared=await prepareLegacyMigration(dir,document,planText);
  await requireLegacyCurrent(dir,prepared.inputs);
  // A conversion that does not commit removes the copies it made (their names
  // are its own) unless the saved manifest refers to them.
  try{
    for(const [name,bytes] of prepared.artifacts)await save(resolve(dir,name),bytes);
    await beforeCommit?.();
    await requireLegacyCurrent(dir,prepared.inputs);
    await commitManifest(dir,prepared.manifest,undefined,{wait:true});
  }catch(error){
    const saved=await readManifest(dir).then(manifest=>JSON.stringify(manifest.bundle??null),()=>null);
    if(saved!==null)await Promise.all([...prepared.artifacts.keys()].filter(name=>!saved.includes(name)).map(name=>rm(resolve(dir,name),{force:true})));
    throw error;
  }
}

const readManifest=dir=>json(resolve(dir,'plan.json'));
// A split-file bundle converts on its first read, when work on it resumes; a
// read that loses to another converting writer reads that writer's result.
async function convertOnRead(dir,{beforeCommit}={}){
  const planText=await readFile(resolve(dir,'plan.json'),'utf8'),document=JSON.parse(planText);
  if(currentBundleSchema(document.bundle?.schema))return;
  const conversion=conversions.get(dir)??convertLegacyBundle(dir,document,planText,{beforeCommit}).finally(()=>conversions.delete(dir));
  conversions.set(dir,conversion);
  const failure=await conversion.then(()=>null,error=>error);
  if(failure&&!currentBundleSchema((await readManifest(dir)).bundle?.schema))
    throw Error(`This print is in the old split-file bundle format and converting it failed: ${failure.message}`,{cause:failure});
}

// The recipe tidy-up; a split-file bundle converts first, as on any read.
async function migrateBundle(directory,{beforeCommit}={}){
  const dir=resolve(directory);
  await convertOnRead(dir,{beforeCommit});
  return migrateCurrentRecipe(dir,await bundleFiles(dir),await readManifest(dir),{beforeCommit});
}

// A tidy-up: saves the recipe as it is read (defaults filled, unread fields
// removed, assignments in their current form), which clears those notes.
// Generation never requires it.
async function migrateCurrentRecipe(dir,before,{bundle:_bundle,...stored},{beforeCommit}){
  const state=await loadBundle(dir,{program:false}),plan=state.plan;
  const changes=planChanges(currentRecipeTerms(stored),plan).map(change=>({...change,meaning:'Recipe read as current: default filled, unread field removed or assignment in its current form.'}));
  if(!changes.length)return {status:'current',directory:dir,created:[],updated:[],removed:[],retained:before};
  const review=invalidateReview(state.review,{event:'recipe-migrated',time:new Date().toISOString(),changes,invalidated:['generation','toolpath']});
  await beforeCommit?.();
  await commitState(state,{plan,review},{edit:true});
  const reopened=await loadBundle(dir,{program:false});
  return {status:'migrated',directory:dir,changes,created:[],updated:['plan.json'],removed:[],retained:before.filter(name=>name!=='plan.json'),
      verification:{geometryId:reopened.geometryId,generation:reopened.review.generation,revision:reopened.revision}};
}

async function readBundleInput(directory) {
  const dir = resolve(directory),read=await readManifest(dir);
  if(!currentBundleSchema(read.bundle?.schema))await convertOnRead(dir);
  const document=currentBundleSchema(read.bundle?.schema)?read:await readManifest(dir);
  const {bundle:saved,...stored}=document,bundle=savedBundle({...saved,revision:manifestRevision(document)}),terms=currentRecipeTerms(stored);
  // Compiled records of older prints carried a digest of their own mesh.
  if(!saved.editRevision)for(const geometry of geometryTree(terms.geometry))delete geometry.compiledHash;
  if(terms.setup)terms.setup=neutralMaterials(terms.setup);
  // The recipe is read as a current one, with generic defaults without a machine, and setup blocks the
  // machine's profile gained since the snapshot was locked; its notes join the limitations.
  const {machine,notes:machineNotes}=currentMachineSnapshot(bundle.machine??null);
  const savedGeometry=bundle.geometry?.descriptor??null;
  const {plan,notes:recipeNotes,geometryFromSaved}=adapter.readRecipe?await adapter.readRecipe(terms,machine,{savedGeometry}):{plan:terms,notes:[]};
  // A geometry read from the saved artifact describes that artifact; a recipe without geometry has none.
  const geometryArtifact=bundle.geometry&&plan.geometry?{...bundle.geometry,descriptor:await geometryDescriptor(plan.geometry,geometryFromSaved?{...savedGeometry,parameters:plan.geometry}:savedGeometry)}:null;
  // A conversion, and any change recorded with notes, is noted until the print's next recorded change.
  const last=bundle.review.history?.at(-1),converted=last?.event==='converted'?[CONVERTED_NOTE]:[];
  const recorded=Array.isArray(last?.notes)?last.notes.filter(note=>typeof note==='string'):[];
  const unshown=saved.review?.generation&&!bundle.review.generation?[UNSHOWN_PROGRAM_NOTE]:[];
  return {dir,plan,machine,review:bundle.review,geometryArtifact,revision:bundle.revision,
    editRevision:bundle.editRevision,geometryInputId:bundle.geometryInputId,pathInputId:bundle.pathInputId,deferRememberSetup:bundle.deferRememberSetup===true,
    phaseColours:checkedPhaseColours(bundle.phaseColours),recipeNotes:[...converted,...unshown,...recorded,...machineNotes,...recipeNotes]};
}

async function describeBundle(input,program) {
  const {dir,plan,machine,geometryArtifact,review,revision,editRevision,geometryInputId,pathInputId,deferRememberSetup,phaseColours,recipeNotes}=input;
  const geometry=adapter.presentGeometry?await adapter.presentGeometry(plan,geometryArtifact?.descriptor??null):geometryArtifact?.descriptor??null;
  const pathCurrent=Boolean(review.path)&&review.path.inputId===pathInputId&&review.path.contract===contract&&
    canonicalJson(review.path.nozzleGeometry??null)===canonicalJson(resolveNozzleGeometry(machine,plan));
  const artifacts={geometry:geometry?'current':'absent',path:!review.path?'absent':pathCurrent?'current':'stale',
    program:!review.generation?'absent':pathCurrent&&review.generation.editRevision===editRevision&&review.generation.contract===contract?'current':'stale'};
  const geometryId=geometryArtifact?.id??null;
  const workEvidence={schema:'saam-work-evidence/1',revision,inputKey:editRevision,geometryKey:geometryId,generationKey:review.generation?.id??review.path?.id??null,editRevision};
  const history={canUndo:Boolean(review.navigation?.past.length),canRedo:Boolean(review.navigation?.future.length)};
  const state={kind,dir,plan,machine,geometry,geometryChecks:[],review,geometryId,geometryInputId,editRevision,pathInputId,revision,artifacts,history,workEvidence,deferRememberSetup,phaseColours};
  Object.defineProperty(state,'geometryArtifact',{value:geometryArtifact,enumerable:false});
  // What the program writer still needs; the toolpath never waits for it. A read
  // that looked for the program and found none has checked it: generation is next.
  return Object.assign(state,{programChecked:Boolean(machine&&program),
    exportName:machine?exportName(plan,machine):null,limitations:[...(machine?bedFit(plan,machine,geometry):[]),...recipeNotes,...(geometry?.notes??geometryArtifact?.descriptor?.notes??[]),...(pathCurrent?review.path.limitations??[]:[])],
    settingsRows:machine?await settingsRows(plan,machine):[],outputAvailability:await programReadiness(plan,machine),
    skills: [...new Set((plan.slices?.assignments??[]).map(assignment=>assignment.construction==='sleeve'
      ?'trace':ordinaryAssignmentFamily(assignment))),
      ...Object.entries(plan.skills??{}).filter(([,settings])=>settings?.enabled).map(([name])=>name)],
    setupBasis:!machine?null:plan.setup?.startupVerified?'Confirmed startup behavior':machine.startup?.validation});
}

// A warning only: the part at its placement overhangs the selected tool's bed.
function bedFit(plan,machine,geometry){
  const part=geometry?.boundsMm,bed=machine.tools.find(t=>t.index===plan.setup?.tool)?.bounds??machine.bounds,offset=[plan.placement?.xMm??0,plan.placement?.yMm??0];
  if(!part||!bed||[0,1].every(i=>part.min[i]+offset[i]>=bed.min[i]-ROUNDING_MM&&part.max[i]+offset[i]<=bed.max[i]+ROUNDING_MM))return [];
  return [`The part at placement X ${offset[0]} / Y ${offset[1]} mm does not fit the ${machine.name} bed.`];
}

// The adapter's report, stored at generation; its limitations are the program's
// own. Older prints stored decoded metadata, which kept the relay estimate in its
// summary; their checks, when saved, hold the rest. Older checks also hold the
// print's notes of that time, which the read recomputes, so they are not shown.
function storedReport({programMetadata,checks}){
  const {summary,...report}=programMetadata??{},saved=checks??{};
  return {limitations:[],...(Number.isFinite(saved.estimatedMinutes)?{seconds:saved.estimatedMinutes*60}:{}),volumeMm3:saved.volumeMm3,shortTravel:saved.shortTravel,
    ...report,...(summary?.materialModel?{materialModel:summary.materialModel,estimatedRelayVolumeMm3:summary.estimatedRelayVolumeMm3}:{})};
}

// Reopen reads the stored report and the exact bytes; it runs no adapter code.
async function restoreBundleProgram(input,program) {
  const state={...input},{review}=state;
  Object.defineProperty(state,'geometryArtifact',{value:input.geometryArtifact,enumerable:false});
  if (!program || !review.generation) return state;
  try {
    const output=await readCompletedOutput(input,adapter.presentGeometry);
    state.programChecked=true;
    state.program=storedReport(output.generation);
    state.limitations=[...new Set([...state.limitations,...state.program.limitations])];
    state.pathSummary = currentPathSummary(review.generation.summary);
    state.outputId = output.id;
    state.completedOutput={id:output.id,current:state.artifacts.program==='current'&&canonicalJson(review.path)===canonicalJson(output.path),
      plan:output.plan,machine:output.machine,geometry:output.geometry,geometryId:output.geometryId,geometryInputId:output.geometryInputId,editRevision:output.generation.editRevision,
      outputId:output.id,inputRevision:output.generation.inputRevision??null,exportName:exportName(output.plan,output.machine),review:{generation:output.generation},
      settingsRows:await settingsRows(output.plan,output.machine),path:output.path,pathId:output.path?.id??null};
    state.exportName=state.completedOutput.exportName;
    Object.defineProperty(state,'checkedBytes',{value:output.bytes,enumerable:false});
  } catch (error) { state.programError = error.message; }
  return state;
}

async function loadBundle(directory, { program = true } = {}) {
  return restoreBundleProgram(await describeBundle(await readBundleInput(directory),program),program);
}

// Change tags for viewer updates: any commit changes the revision; the
// presentation tag changes only with inputs, geometry or program, so delivery
// history and mode changes update controls without replacing mesh/motion.
async function loadBundleSnapshot(directory,options){
  const state=await loadBundle(directory,options);
  return {schema:'saam-bundle-snapshot/1',state,fingerprint:state.revision,
    presentationFingerprint:JSON.stringify([state.editRevision,state.geometryId,state.review.generation?.id??null])};
}

// Feasibility inspection through the same generator, without persisted output.
async function checkPathBundle(directory, {onProgress} = {}) {
  const candidate=await prepareGeneration(directory,{onProgress}),result=candidate.result;
  if(result.exportError)throw result.exportError;
  return {mode:'development-check-only',revision:candidate.revision,
    ...structuredClone(result.summary),exportSummary:result.report?structuredClone(result.report):{program:null,missing:result.missing}};
}

// The one generation: the SAAMpath needs only the recipe; the program is
// written when a machine, its exporter and its installation are all supplied.
// Otherwise the result names what is missing. A writing failure keeps the path.
async function prepareGeneration(directory,{onProgress}={}){
  const state=await loadBundle(directory,{program:false}),source=await generationSource(state.plan);
  const key=JSON.stringify([state.dir,state.editRevision,source.release,source.hash??state.review.path?.source?.hash]);
  if(preparation?.key!==key)preparation={key};
  const candidate=preparation;
  if(!candidate.result)candidate.result=Promise.resolve().then(async()=>{
    onProgress?.({stage:'Preparing geometry'});
    const {path,artifact}=await prepareToolpath(state,{onProgress,source});
    const missing=await programReadiness(state.plan,state.machine);
    if(missing)return {pathArtifact:artifact,summary:pathSummary(path),missing};
    onProgress?.({stage:'Writing machine commands'});
    try{return {pathArtifact:artifact,summary:pathSummary(path),...await exportProgram(path,state.plan,state.machine,{generatorVersion:VERSION,buildDate:BUILD_DATE})};}
    catch(error){error.stage='export';return {pathArtifact:artifact,summary:pathSummary(path),exportError:error};}
  }).catch(error=>{candidate.result=null;throw error;});
  const result=await candidate.result;
  return {directory:state.dir,revision:state.revision,editRevision:state.editRevision,source:{release:source.release,hash:source.hash},result};
}

// Generation-source currency is checked only when working on a print. Saved
// viewing and delivery do not load extensions or reinterpret source versions.
async function generationSource(plan){
  return adapter.pathSource?adapter.pathSource(plan):{release:null,hash:null};
}

function staleGenerationSource(state,source){
  const saved=state.review.path?.source;
  return Boolean(state.review.path
    &&(source.release!==null&&saved?.release!==source.release||source.hash!==null&&saved?.hash!==source.hash));
}

function sourceInvalidatedReview(review){
  return {...review,path:null,history:[...review.history,
    {event:'generation-invalidated',reason:'generation-source-changed',time:new Date().toISOString()}]};
}

async function activeGenerationState(directory){
  let state=await loadBundle(directory,{program:false});
  const source=await generationSource(state.plan);
  if(staleGenerationSource(state,source)){
    await commitState(state,{review:sourceInvalidatedReview(state.review)},{edit:true});
    state=await loadBundle(directory,{program:false});
  }
  return {state,source};
}

async function requireGenerationSource(state,expected){
  if(!adapter.pathSource)return;
  const source=await generationSource(state.plan);
  if(source.release===expected?.release&&source.hash===expected?.hash)return;
  if(state.review.path||state.review.generation)
    await commitState(state,{review:sourceInvalidatedReview(state.review)},{edit:true});
  if(source.missing)throw source.missing;
  throw Error('Generation source changed during calculation. Generate again using the current scripts.');
}

async function prepareToolpath(state,{onProgress,source}={}){
  const nozzleGeometry=resolveNozzleGeometry(state.machine,state.plan);
  const key=JSON.stringify([state.dir,state.pathInputId,nozzleGeometry,source.release,source.hash??state.review.path?.source?.hash]);
  if(pathPreparation?.key===key){onProgress?.({stage:'Reusing neutral SAAMpath'});return pathPreparation.result;}
  const result=(async()=>{
    const saved=state.review.path;
    if(state.artifacts.path==='current'&&!staleGenerationSource(state,source)){
      const path=await readMotionArtifact(state.dir,saved);
      onProgress?.({stage:'Reusing saved SAAMpath'});
      return {path,artifact:saved};
    }
    if(source.missing)throw source.missing;
    const id=randomUUID(),file=`paths/${id}.json`;
    await save(resolve(state.dir,file),saamPathText(await generatePath(state.plan,{onProgress})));
    const stored=await readPathArtifact(state.dir,{file});
    const scheduleFile=`paths/${id}.schedule.json`;
    onProgress?.({stage:'Scheduling saved deposition'});
    const schedule=schedulePath(stored,{sourcePathId:id,onProgress,nozzleGeometry});
    joinSaamPath({sourcePathId:id,deposition:stored,schedule});
    await save(resolve(state.dir,scheduleFile),saamPathText(schedule));
    const artifact={id,file,scheduleFile,inputId:state.pathInputId,contract,nozzleGeometry,
      ...(source.hash!==null?{source:{release:source.release,hash:source.hash}}:{}),
      ...(stored.summary.limitations?.length?{limitations:stored.summary.limitations}:{})};
    return {path:await readMotionArtifact(state.dir,artifact),artifact};
  })();
  pathPreparation={key,result};
  try{return await result;}catch(error){if(pathPreparation?.result===result)pathPreparation=null;throw error;}
}

async function readConstructedPath(state){
  const artifact=state.completedOutput?.path??state.review.path;
  requireThat(artifact,'No saved SAAMpath.');
  const path=await readPathArtifact(state.dir,artifact);
  requireThat(path.operations,'This saved SAAMpath has no deposition operation records; regenerate to use them.');
  return path;
}
function partFramePath(artifact){return artifact.contract===contract||artifact.contract?.startsWith('saam-deposition/')&&Number(artifact.contract.slice('saam-deposition/'.length))>=14;}
// What Studio and the result image draw: the SAAMpath itself, a completed
// output's else the saved one, current or not, at its recipe's placement.
// Paths made before part-frame deposition were built already placed.
async function readDrawnPath(state,{signal}={}){
  const output=state.completedOutput,artifact=output?output.path:state.review.path;
  requireThat(artifact,'No saved SAAMpath.');
  const bytes=await runComputationJob(new URL('./path-artifact-worker.mjs',import.meta.url),{
    directory:state.dir,artifact,placement:partFramePath(artifact)?(output?.plan??state.plan).placement:null,
  },{signal,subject:'Saved toolpath preview'});
  return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
}

// Chat-driven adjustment: the agent applies a patch and dependent output
// becomes stale. A misspelled setting is ignored and named in the recipe notes.
async function adjustBundle(directory, patch, { expectedRevision, expectedEditRevision } = {}) {
  const state = await loadBundle(directory, { program: false });
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const plan = patchPlan?await patchPlan(state.plan,patch):applyPlanPatch(state.plan, patch, geometryTemplate);
  const updated=await updatePlan(directory, plan, state.revision,{expectedEditRevision});
  return updated;
}


async function updatePlan(directory, plan, revision, {expectedEditRevision} = {}) {
  const state = await loadBundle(directory, { program: false });
  requireEditRevision(state,{expectedRevision:revision,expectedEditRevision});
  const normalized=adapter.normalizePlan?await adapter.normalizePlan(plan):{plan};
  plan=normalized.plan;
  if(!Object.hasOwn(plan,'workspace')&&Object.hasOwn(state.plan,'workspace'))plan={...plan,workspace:state.plan.workspace};
  const change = validatePlanUpdate(state, plan);
  const source=await generationSource(change.plan),sourceChanged=staleGenerationSource(state,source);
  if (!change.changed&&!sourceChanged) return state;

  // Build before committing anything; plan.json remains the edit commit point.
  const geometry = change.geometryChanged&&change.plan.geometry ? await createGeometry(change.plan.geometry,{previousGeometry:state.plan.geometry}) : null;
  if(geometry)change.plan={...change.plan,geometry:geometry.descriptor.parameters};
  const review = editedPlanReview(sourceChanged?sourceInvalidatedReview(state.review):state.review, change.geometryChanged, planChanges(state.plan, change.plan));
  await persistPlanUpdate(state,change.plan,geometry,review);
  return loadBundle(directory);
}

function validatePlanUpdate(state, candidate) {
  const plan = structuredClone(candidate);
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  const changed = canonicalJson(plan) !== canonicalJson(state.plan);
  const geometryChanged = changed && canonicalJson(plan.geometry) !== canonicalJson(state.plan.geometry);
  return {plan, changed, geometryChanged};
}

async function persistPlanUpdate(state,plan,geometry,review) {
  const geometryArtifact=!plan.geometry?null:geometry?await saveGeometry(state.dir,geometry):state.geometryArtifact;
  await commitState(state,{plan,review,geometry:geometryArtifact},{edit:true});
}

// Generation performs the calculations the locked plan specifies. Both modes
// may be inspected freely; development output is recorded as a preview and can
// never satisfy the final reviewed-export delivery gate. A current checked
// program is reused (and promoted for production); otherwise the generation
// worker computes and commits under the caller's held reservation. The signal
// cancels until beforeCommit is acknowledged.
async function generateBundle(directory, { development = false, signal, onProgress, beforeCommit } = {}) {
  const {state,source} = await activeGenerationState(directory);
  const current=await currentGenerationCandidate(directory,state);
  if(current){
    await requireGenerationSource(state,source);
    if(development||current.checks.mode==='production')return current.checks;
    await beforeCommit?.();
    await requireGenerationSource(state,source);
    const confirmed=await currentGenerationCandidate(directory,state);
    requireThat(confirmed&&confirmed.checks.mode==='development'
      &&confirmed.current.outputId===current.current.outputId
      &&confirmed.current.revision===current.current.revision,
    'The reviewed export changed before promotion. Generate it again.');
    return promoteReviewedGeneration(state.dir,confirmed);
  }
  return runComputationJob(new URL('./generation-worker.mjs',import.meta.url),
    {directory:state.dir,editRevision:state.editRevision,development,instance:heldBundleInstance(state.dir)},
    {signal,progress:onProgress,beforeCommit:beforeCommit??(()=>{}),subject:'Generation'});
}

async function commitGeneration(directory,prepared,{development=false,onProgress,beforeCommit}={}){
  const {result}=prepared;
  const state=await loadBundle(directory,{program:false});
  requireThat(state.dir===prepared.directory&&state.editRevision===prepared.editRevision&&state.revision===prepared.revision,
    'The print changed during generation. Review the updated print.');
  await beforeCommit?.();
  await requireGenerationSource(state,prepared.source);
  onProgress?.({stage:'Saving your toolpath'});
  if(result.bytes)return persistGeneratedProgram(state,result,generationChecks(state,result,development));
  await persistPath(state,result.pathArtifact);
  if(result.exportError)throw result.exportError;
  return {result:'toolpath',program:null,message:'Toolpath ready. '+result.missing,limitations:result.summary.limitations??[]};
}

// A SAAMpath without a program. A reused saved path changes nothing; a new one
// replaces the completed output made from the old, so the newest is shown.
async function persistPath(state,artifact){
  if(state.review.path?.id===artifact.id)return;
  await commitState(state,{review:{...state.review,path:artifact,generation:null,
    history:[...state.review.history,{event:'path-generated',time:new Date().toISOString(),pathId:artifact.id}]}});
}

async function currentGenerationCandidate(directory,state){
  if(!state.review.generation)return null;
  const current=await loadBundle(directory,{program:true});
  if(!current.program||current.programError||!current.completedOutput?.current)return null;
  // Checks that do not match their program are stale: generation replaces them.
  const checks=current.review.generation.checks;
  return checks?.schema==='saam-checks/1'&&checks.result==='pass'&&checks.mode===current.review.generation?.mode?{checks,current}:null;
}

async function promoteReviewedGeneration(dir,{checks,current}){
  const promoted={...checks,mode:'production'};
  const review={...current.review,generation:{...current.review.generation,mode:'production',checks:promoted},
    history:[...current.review.history,{event:'generation-reused',mode:'production',time:new Date().toISOString(),outputId:current.outputId}]};
  await commitState(current,{review});
  return promoted;
}

function generationChecks(state,{report,summary},development){
  return {
    schema: 'saam-checks/1', result: 'pass', mode: development ? 'development' : 'production',
    generatorVersion: VERSION,
    moves: report.moves,
    volumeMm3: Number(report.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((report.seconds / 60).toFixed(1)),
    travel: summary.travel,
    shortTravel: report.shortTravel,
    surfaceDomain: summary.surfaceDomain ?? null,
    limitations: [...new Set([...(summary.limitations??[]),...report.limitations])],
    ...(report.materialModel==='relay-estimate'?{materialModel:'relay-estimate',commandedVolumeMm3:report.volumeMm3,estimatedRelayVolumeMm3:report.estimatedRelayVolumeMm3,relayEstimateDifferenceMm3:report.estimatedRelayVolumeMm3-report.volumeMm3}:{})
  };
}

async function persistGeneratedProgram(state,{bytes,report,summary,pathArtifact},checks){
  const id=randomUUID(),file=exportArtifactPath(state.plan,state.machine,id);
  await save(resolve(state.dir,file),bytes);
  const generation=await retainCompletedOutput(state,{id,mode:checks.mode,editRevision:state.editRevision,geometryInputId:state.geometryInputId,contract,
    summary,version:VERSION,file,checks,programMetadata:report},pathArtifact);
  const review={...state.review,path:pathArtifact,generation,
    history:[...state.review.history,{event:'generated',mode:checks.mode,time:new Date().toISOString(),outputId:id}]};
  await commitState(state,{review});
  return checks;
}

// The person's Export in Studio is the one confirmation: it writes the displayed
// result, and later edits do not change that snapshot.
async function exportReviewed(state,{machineSetups}={}){
  const live=await loadBundle(state.dir,{program:true});
  requireThat(completedOutputState(live).exportable&&state.completedOutput?.id===live.completedOutput.id
    &&state.checkedBytes,'The displayed program changed. Reload before exporting.');
  return writeDelivery({...state,checkedBytes:state.checkedBytes,plan:live.completedOutput.plan,machine:live.completedOutput.machine,
    exportName:live.completedOutput.exportName,outputId:live.outputId,deferRememberSetup:live.deferRememberSetup},true,machineSetups);
}

// The setup store (machineSetups) remembers the delivered setup unless the bundle defers it.
async function writeDelivery(state,artifact,machineSetups){
  if(state.deferRememberSetup||!machineSetups)return writeAndRememberDelivery(state,artifact,null);
  return withMachineSetupExport(machineSetups,state.machine,()=>writeAndRememberDelivery(state,artifact,machineSetups));
}
async function writeAndRememberDelivery(state,artifact,machineSetups){
  const bytes = state.checkedBytes;
  const destination = resolve(state.dir, `delivery/${state.exportName}`);
  await save(destination, bytes);
  const attribution=originalSource(state.plan.geometry)?.attribution;
  if(attribution)await save(resolve(state.dir,'delivery/source-attribution.json'),{
    ...attribution,
    changes:'SAAM imported and positioned/scaled the source for printing. The saved plan records the current geometry and printing settings; consult it and any repair reports for subsequent changes.',
    planRevision:state.revision
  });
  const output=state.completedOutput;
  try{await recordDelivery(state.dir,{time:new Date().toISOString(),file:`delivery/${state.exportName}`,
    outputId:output.id,inputRevision:output.inputRevision??null});}
  catch(error){const failure=Error('The export was copied to '+destination+', but recording its delivery failed: '+error.message,{cause:error});
    failure.code='DELIVERY_RECORD_FAILED';failure.delivered={file:destination,outputId:output.id};throw failure;}
  if(machineSetups)try{await saveSetup(output.machine,output.plan.setup,{machineSetups,exportReceipt:{
    directory:state.dir,outputId:output.id,inputRevision:output.inputRevision??null}});}
  catch(error){const failure=Error('The export was copied to '+destination+', but remembering its machine setup failed: '+error.message,{cause:error});
    failure.code='EXPORTED_SETUP_SAVE_FAILED';failure.delivered={file:destination,outputId:output.id};throw failure;}
  return artifact?{file:destination,bytes,outputId:output.id}:destination;
}

async function setDeferredSetupSave(directory,{defer,expectedRevision}){
  requireThat(typeof defer==='boolean','Supply whether this bundle defers remembering its exported machine setup.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This revision is stale. Reload before changing setup remembering.');
  if(state.deferRememberSetup===defer)return {directory:state.dir,revision:state.revision,deferRememberSetup:defer};
  const committed=await saveManifest(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:defer,phaseColours:state.phaseColours},state.revision);
  return {directory:state.dir,revision:committed.bundle.revision,deferRememberSetup:defer};
}

// Display only: the choice replaces the print's previous one and changes no
// recipe, path or program identity.
async function setPhaseColours(directory,{phaseColours,expectedRevision}){
  const choice=checkedPhaseColours(phaseColours),state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This revision is stale. Reload before changing phase colours.');
  if(canonicalJson(choice)===canonicalJson(state.phaseColours))return {directory:state.dir,revision:state.revision,phaseColours:choice};
  const committed=await saveManifest(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:state.deferRememberSetup,phaseColours:choice},state.revision);
  return {directory:state.dir,revision:committed.bundle.revision,phaseColours:choice};
}

async function applySettingsSnapshot(directory,selection,expectedRevision,{expectedEditRevision}={}) {
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const {machine,settings,notes=[]}=structuredClone(selection);
  requireThat((machine===null||machine&&typeof machine==='object'&&!Array.isArray(machine))
    &&settings&&typeof settings==='object'&&!Array.isArray(settings)
    &&Object.keys(settings).every(k=>['setup','process','output','placement','skills'].includes(k)),'Invalid selected settings snapshot.');
  const plan={...state.plan,...settings};
  const source=await generationSource(plan),sourceChanged=staleGenerationSource(state,source);
  if(canonicalJson(machine)===canonicalJson(state.machine)&&canonicalJson(plan)===canonicalJson(state.plan)&&!sourceChanged)return state;
  const previousReview=sourceChanged?sourceInvalidatedReview(state.review):state.review;
  const changed=canonicalJson(machine)===canonicalJson(state.machine)
    ?editedPlanReview(previousReview,false,planChanges(state.plan,plan))
    :machineChangedReview(previousReview,state.machine?.id??null,machine?.id??null);
  // The selection's notes ride on the change it records.
  const review=notes.length?{...changed,history:[...changed.history.slice(0,-1),{...changed.history.at(-1),notes}]}:changed;
  await commitState(state,{plan,machine,review},{edit:true});
  return loadBundle(directory,{program:false});
}

return {root,EXPORT_NAME,proposedPlan,initBundle,loadBundle,loadBundleSnapshot,
  migrateBundle,readDrawnPath,readConstructedPath,prepareGeneration,commitGeneration,restoreRevision,checkPathBundle,adjustBundle,updatePlan,generateBundle,exportReviewed,setDeferredSetupSave,setPhaseColours,applySettingsSnapshot};
}
