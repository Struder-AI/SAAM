import {requireThat} from '../private/bundle/numeric.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {retainCompletedOutput,readCompletedOutput} from './completed-output.mjs';
import {admittedPathChunks} from '../path/source-admission.mjs';
import {readPathArtifact,readMotionArtifact} from './path-artifact.mjs';
import {checkedPhaseColours} from './phase-colours.mjs';
// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, access, copyFile,readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {requireBundleInstance} from './studio-ownership.mjs';
import {replaceFile,replaceJsonFile} from '../file-write.mjs';
import {canonicalJson} from '../canonical-json.mjs';
import {neutralMaterials} from '../machine/settings.mjs';
import {commitManifest,manifestRevision,retainContent,restoreContent,saveDescriptor} from './revisions.mjs';
import {geometryTree} from '../../skills/records.mjs';
import {currentRecipeTerms} from './assignment-records.mjs';
import {geometryDescriptor,storedGeometryArtifact} from './geometry.mjs';
import {checkedPlacementOrigins} from './placement-intent.mjs';

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
const KEEPS_INPUTS=new Set(['generated','generation-reused','export-prepared','delivered','human-approval','converted']);
const UNSHOWN_PROGRAM_NOTE='Its program from an older SAAM is kept in exports/ but not shown or exported; generate to see the toolpath.';
const originalSource=geometry=>geometry?.source??(geometry?.solid?originalSource(geometry.solid):geometry?.base?originalSource(geometry.base):null);
async function save(file,value){
  await replaceFile(file,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
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
  const {kind,version:VERSION}=adapter;
  const contract=adapter.generationContract??null;
  // Bundle is the only writer: a commit that changes plan, machine label or geometry
  // mints a new edit revision, and new geometry-input and path-input ids when
  // those parts changed. Programs and paths record the ids they were made from.
  const pathInput=plan=>canonicalJson(adapter.pathDependencies?adapter.pathDependencies({...plan,geometry:null}):{...plan,geometry:null});
  const manufacturingKey=plan=>canonicalJson(adapter.manufacturingInput?.(plan)??null);
  function inputIds(state,next){
    const current={editRevision:state.editRevision,geometryInputId:state.geometryInputId,pathInputId:state.pathInputId};
    if(next.plan===undefined&&next.machineId===undefined&&next.geometry===undefined)return current;
    const plan=next.plan??state.plan,geometry=next.geometry===undefined?state.geometryArtifact:next.geometry;
    const geometryChanged=(geometry?.id??null)!==(state.geometryArtifact?.id??null);
    return {editRevision:randomUUID(),
      geometryInputId:geometryChanged||manufacturingKey(plan)!==manufacturingKey(state.plan)?randomUUID():current.geometryInputId,
      pathInputId:geometryChanged||pathInput(plan)!==pathInput(state.plan)?randomUUID():current.pathInputId};
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
        path:kept&&oldPath?{id:oldPath.hash,file:oldPath.file,inputId:id,contract,...(oldPath.scheduleFile?{scheduleFile:oldPath.scheduleFile}:{}),...(oldPath.source?{source:oldPath.source}:{})}:null,
        generation:kept&&old&&oldPath?{...generation,id:exportHash,editRevision:id,geometryInputId:id,contract,checks:checks?keptChecks:null}:null}};
  }
// Store a new part: its complete recipe, the geometry artifact already built
// from that recipe, and its machine label. Nothing is built, selected or
// resolved here. Notes about how the print was made show until its next
// recorded change.
async function initBundle(directory, plan, { machineId=null,geometry=null,placementOrigins,sourceBytes,sourcePath,attachments=[],notes=[],deferRememberSetup=false,phaseColours,signal,beforeCommit,editProvenance } = {}) {
  signal?.throwIfAborted();
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan)&&!Object.hasOwn(plan,'bundle'),'Bundle stores a recipe; supply its saved bundle fields as options.');
  requireThat(machineId===null||typeof machineId==='string'&&machineId.length>0,'A machine label is a machine ID.');
  requireBuiltGeometry(plan.geometry,geometry);
  const dir = resolve(directory),origins=checkedPlacementOrigins(placementOrigins),colours=checkedPhaseColours(phaseColours);
  try {
    await access(resolve(dir, 'plan.json'));
    throw new Error('Print already exists. Open it or choose another directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  signal?.throwIfAborted();
  await beforeCommit?.();
  signal?.throwIfAborted();
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
  await saveManifest(dir,{plan:structuredClone(plan),machineId,placementOrigins:origins,review,geometry:geometryArtifact,ids:{editRevision:id,geometryInputId:id,pathInputId:id},deferRememberSetup:deferRememberSetup===true,phaseColours:colours},null,{editProvenance});
  return dir;
}

// Stored geometry is the artifact built from exactly the recipe's geometry.
function requireBuiltGeometry(parameters,geometry){
  if(!parameters){requireThat(!geometry,'A recipe without geometry stores no geometry artifact.');return null;}
  requireThat(geometry?.descriptor&&canonicalJson(geometry.descriptor.parameters)===canonicalJson(parameters),
    'Changed geometry needs the artifact built from it; create or edit the part through its part execution.');
  return geometry;
}

async function saveGeometry(dir, geometry) {
  if(!geometry)return null;
  const id=randomUUID();
  if(!geometry.bytes)return {id,descriptor:geometry.descriptor};
  const file=`geometry/${id}${nativeSuffix(geometry.descriptor)}`;
  await save(resolve(dir,file),geometry.bytes);return {id,file,descriptor:geometry.descriptor};
}

const manifestDocument=({plan,machineId,placementOrigins,review,geometry,ids,deferRememberSetup,phaseColours,editProvenance})=>({...plan,bundle:{schema:BUNDLE_SCHEMA,machineId:machineId??null,review,geometry:storedGeometryArtifact(geometry),...ids,
  ...(placementOrigins!==undefined?{placementOrigins:checkedPlacementOrigins(placementOrigins)}:{}),
  ...(deferRememberSetup?{deferRememberSetup:true}:{}),...(phaseColours?{phaseColours}:{}),...(editProvenance?{editProvenance}:{})}});
const saveManifest=(dir,state,expected,options)=>commitManifest(dir,manifestDocument(state),expected,options);
const stateIds=state=>({editRevision:state.editRevision,geometryInputId:state.geometryInputId,pathInputId:state.pathInputId});

// ids: the input ids to record, when restoring them from history.
async function commitState(state,next,{edit=false,history,ids=inputIds(state,next),editProvenance}={}){
  const previous={plan:state.plan,machineId:state.machineId,placementOrigins:state.placementOrigins,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:state.deferRememberSetup,phaseColours:state.phaseColours,editProvenance:state.editProvenance};
  const navigation=state.review.navigation??{past:[],future:[]};
  const nextHistory=history??(edit?{past:[...navigation.past,await retainContent(state.dir,{...previous,ids:stateIds(state),revision:state.revision})],future:[]}:navigation);
  const generation=next.review?.generation===state.review.generation&&state.artifacts?.program==='current'
    ?await retainCompletedOutput(state,state.review.generation):next.review?.generation;
  const review={...next.review,generation,navigation:nextHistory};
  return saveManifest(state.dir,{...previous,...next,review,ids},state.revision,{editProvenance});
}

async function restoreRevision(directory,{direction,expectedRevision}={}){
  requireThat(['undo','redo'].includes(direction),'Choose undo or redo.');
  const state=await loadBundle(directory,{program:false});
  requireThat(typeof expectedRevision==='string'&&expectedRevision===state.revision,'This revision is stale. Reload before restoring the print.');
  const navigation=state.review.navigation??{past:[],future:[]},source=direction==='undo'?'past':'future',destination=direction==='undo'?'future':'past';
  requireThat(navigation[source].length>0,`Nothing to ${direction}.`);
  const id=navigation[source].at(-1),restored=await restoreContent(state.dir,id,state.geometryArtifact);
  const current=await retainContent(state.dir,{plan:state.plan,machineId:state.machineId,placementOrigins:state.placementOrigins,geometry:state.geometryArtifact,review:state.review,ids:stateIds(state),revision:state.revision,editProvenance:state.editProvenance});
  const history={...navigation,[source]:navigation[source].slice(0,-1),[destination]:[...navigation[destination],current]};
  const review={...state.review,path:restored.path,generation:restored.generation,
    history:[...state.review.history,{event:direction,time:new Date().toISOString(),restored:id,previousRevision:state.revision}]};
  await commitState(state,{plan:restored.plan,machineId:restored.machineId,placementOrigins:restored.placementOrigins,geometry:restored.geometry,review,editProvenance:restored.editProvenance??null},{history,ids:restored.ids});
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

const readManifest=dir=>json(resolve(dir,'plan.json'));
function requireBundleFormat(document){
  const schema=document.bundle?.schema;
  requireThat(currentBundleSchema(schema),schema?`Unsupported print bundle format: ${schema}.`:'Deprecated split-file print bundle.');
}

// Explicit recipe tidy-up for a supported manifest; no artifact conversion.
async function migrateBundle(directory,{beforeCommit}={}){
  const dir=resolve(directory);
  requireBundleFormat(await readManifest(dir));
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
  requireBundleFormat(read);
  const document=read;
  const {bundle:saved,...stored}=document,bundle=savedBundle({...saved,revision:manifestRevision(document)}),terms=currentRecipeTerms(stored);
  const placementOrigins=checkedPlacementOrigins(bundle.placementOrigins);
  // Compiled records of older prints carried a digest of their own mesh.
  if(!saved.editRevision)for(const geometry of geometryTree(terms.geometry))delete geometry.compiledHash;
  if(terms.setup)terms.setup=neutralMaterials(terms.setup);
  // The machine is a label; a print saved with a profile snapshot keeps only its ID.
  const machineId=bundle.machineId??bundle.machine?.id??null;
  const savedGeometry=bundle.geometry?.descriptor??null;
  const {plan,notes:recipeNotes,geometryFromSaved}=adapter.readRecipe?await adapter.readRecipe(terms,{savedGeometry}):{plan:terms,notes:[]};
  // A geometry read from the saved artifact describes that artifact; a recipe without geometry has none.
  const geometryArtifact=bundle.geometry&&plan.geometry?{...bundle.geometry,descriptor:await geometryDescriptor(plan.geometry,geometryFromSaved?{...savedGeometry,parameters:plan.geometry}:savedGeometry)}:null;
  const last=bundle.review.history?.at(-1);
  const recorded=Array.isArray(last?.notes)?last.notes.filter(note=>typeof note==='string'):[];
  const unshown=saved.review?.generation&&!bundle.review.generation?[UNSHOWN_PROGRAM_NOTE]:[];
  return {dir,plan,machineId,placementOrigins,review:bundle.review,geometryArtifact,revision:bundle.revision,editProvenance:bundle.editProvenance??null,
    editRevision:bundle.editRevision,geometryInputId:bundle.geometryInputId,pathInputId:bundle.pathInputId,deferRememberSetup:bundle.deferRememberSetup===true,
    phaseColours:checkedPhaseColours(bundle.phaseColours),recipeNotes:[...unshown,...recorded,...recipeNotes]};
}

// A read of stored state: currency of saved artifacts against the current input
// ids and the notes recorded with them. Presentation belongs to its consumers.
function describeBundle(input,program) {
  const {dir,plan,machineId,placementOrigins,geometryArtifact,review,revision,editRevision,geometryInputId,pathInputId,deferRememberSetup,phaseColours,recipeNotes,editProvenance}=input;
  const geometry=geometryArtifact?.descriptor??null;
  const pathCurrent=Boolean(review.path)&&review.path.inputId===pathInputId&&review.path.contract===contract;
  const artifacts={geometry:geometry?'current':'absent',path:!review.path?'absent':pathCurrent?'current':'stale',
    program:!review.generation?'absent':pathCurrent&&review.generation.editRevision===editRevision&&review.generation.contract===contract?'current':'stale'};
  const geometryId=geometryArtifact?.id??null;
  const workEvidence={schema:'saam-work-evidence/1',revision,inputKey:editRevision,geometryKey:geometryId,generationKey:review.generation?.id??review.path?.id??null,editRevision};
  const history={canUndo:Boolean(review.navigation?.past.length),canRedo:Boolean(review.navigation?.future.length)};
  const state={kind,dir,plan,machineId,placementOrigins,geometry,geometryChecks:[],review,geometryId,geometryInputId,editRevision,pathInputId,revision,artifacts,history,workEvidence,deferRememberSetup,phaseColours,editProvenance,
    programChecked:Boolean(machineId&&program),outputAvailability:null,
    limitations:[...recipeNotes,...(geometry?.notes??[]),...(pathCurrent?review.path.limitations??[]:[])]};
  Object.defineProperty(state,'geometryArtifact',{value:geometryArtifact,enumerable:false});
  return state;
}

// Reopen reads the completed neutral path's report and captured inputs.
// Older stored machine reports/bytes are not required for viewing or Export.
async function restoreBundleProgram(input,program) {
  const state={...input},{review}=state;
  Object.defineProperty(state,'geometryArtifact',{value:input.geometryArtifact,enumerable:false});
  if (!program || !review.generation) return state;
  try {
    const output=await readCompletedOutput(input);
    state.programChecked=true;
    const checks=output.generation.checks??{};
    state.program={...(output.generation.pathReport??{}),limitations:checks.limitations??[],
      notice:'Neutral SAAMpath estimates. Export adds machine startup, priming and physical transfers.'};
    state.limitations=[...new Set([...state.limitations,...state.program.limitations])];
    state.pathSummary = currentPathSummary(review.generation.summary);
    state.outputId = output.id;
    // Reviewed neutral source and execution retain one immutable identity.
    state.completedOutput={id:output.id,current:state.artifacts.program==='current'&&canonicalJson(review.path)===canonicalJson(output.path),
      plan:output.plan,machineId:output.machineId,placementOrigins:output.placementOrigins,geometry:output.geometry,geometryId:output.geometryId,geometryInputId:output.geometryInputId,editRevision:output.generation.editRevision,
      outputId:output.id,inputRevision:output.generation.inputRevision??null,review:{generation:output.generation},
      path:output.path,pathId:output.path?.id??null};
    if(output.path?.contract!==contract)state.outputAvailability='Deprecated saved toolpath contract.';
    else if(output.path.qualification?.status==='failed')state.outputAvailability=output.path.qualification.message;
  } catch (error) { state.programError = error.message; }
  return state;
}

async function loadBundle(directory, { program = true } = {}) {
  return restoreBundleProgram(describeBundle(await readBundleInput(directory),program),program);
}

// Change tags for viewer updates: any commit changes the revision; the
// presentation tag changes only with inputs, geometry or program, so delivery
// history and mode changes update controls without replacing mesh/motion.
async function loadBundleSnapshot(directory,options){
  const state=await loadBundle(directory,options);
  return {schema:'saam-bundle-snapshot/1',state,fingerprint:state.revision,
    presentationFingerprint:JSON.stringify([state.editRevision,state.geometryId,state.review.generation?.id??null])};
}

// Capture saved inputs only; execution and source discovery belong to Runtime.
async function readGenerationInputs(directory){
  return loadBundle(directory,{program:true});
}
async function readGenerationPath(state){
  return readMotionArtifact(state.dir,state.review.path);
}
// Supplied immutable artifacts may be retained before manifest publication.
// They become selected part state only at the guarded manifest commit.
async function retainGenerationArtifact(directory,{file,value}){
  requireThat(/^paths\/[a-zA-Z0-9.-]+\.json$/.test(file),'Invalid generation artifact path.');
  return replaceJsonFile(resolve(directory,file),admittedPathChunks(value));
}


async function readConstructedPath(state){
  const artifact=state.completedOutput?.path??state.review.path;
  requireThat(artifact,'No saved SAAMpath.');
  const path=await readPathArtifact(state.dir,artifact);
  requireThat(path.operations,'This saved SAAMpath has no deposition operation records; regenerate to use them.');
  return path;
}
// Store the complete next recipe. When its geometry changed, geometry is the
// artifact already built from it; nothing is normalized or built here.
async function updatePlan(directory, plan, revision, {expectedEditRevision,signal,beforeCommit,editProvenance,geometry=null,placementOrigins} = {}) {
  signal?.throwIfAborted();
  const suppliedOrigins=checkedPlacementOrigins(placementOrigins);
  await requireBundleInstance(directory);
  const state = await loadBundle(directory, { program: false });
  const origins=placementOrigins===undefined?state.placementOrigins:suppliedOrigins,originChanged=canonicalJson(origins)!==canonicalJson(state.placementOrigins);
  requireEditRevision(state,{expectedRevision:revision,expectedEditRevision});
  if(plan&&typeof plan==='object'&&!Object.hasOwn(plan,'workspace')&&Object.hasOwn(state.plan,'workspace'))plan={...plan,workspace:state.plan.workspace};
  const change = validatePlanUpdate(state, plan);
  if (!change.changed&&!originChanged) return state;
  const built=change.geometryChanged?requireBuiltGeometry(change.plan.geometry,geometry):null;
  const changes=planChanges(state.plan,change.plan);
  if(originChanged)changes.push({path:'bundle.placementOrigins',before:state.placementOrigins??null,after:origins??null});
  const review = editedPlanReview(state.review, change.geometryChanged, changes);
  signal?.throwIfAborted();
  await beforeCommit?.();
  signal?.throwIfAborted();
  await requireBundleInstance(directory);
  requireThat(manifestRevision(await readManifest(directory))===state.revision,'This revision is stale. Reload before changing the print.');
  await persistPlanUpdate(state,change.plan,built,review,editProvenance,origins);
  return loadBundle(directory);
}

function validatePlanUpdate(state, candidate) {
  const plan = structuredClone(candidate);
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  const changed = canonicalJson(plan) !== canonicalJson(state.plan);
  const geometryChanged = changed && canonicalJson(plan.geometry) !== canonicalJson(state.plan.geometry);
  return {plan, changed, geometryChanged};
}

async function persistPlanUpdate(state,plan,geometry,review,editProvenance,placementOrigins) {
  const geometryArtifact=!plan.geometry?null:geometry?await saveGeometry(state.dir,geometry):state.geometryArtifact;
  await commitState(state,{plan,placementOrigins,review,geometry:geometryArtifact},{edit:true,editProvenance});
}

// Publish supplied results against the independently checked captured state.
async function publishGenerationResults(directory,prepared){
  await requireBundleInstance(directory);
  const state=await loadBundle(directory,{program:false});
  requireThat(state.dir===prepared.directory&&state.editRevision===prepared.editRevision&&state.revision===prepared.revision,
    'The print changed during generation. Review the updated print.');
  const {result,checks,promoteOutputId}=prepared;
  if(promoteOutputId){
    requireThat(state.review.generation?.id===promoteOutputId,'The reviewed export changed before promotion. Generate it again.');
    const review={...state.review,generation:{...state.review.generation,mode:'production',checks},
      history:[...state.review.history,{event:'generation-reused',mode:'production',time:new Date().toISOString(),outputId:promoteOutputId}]};
    await commitState(state,{review});
  }else await persistGeneratedPath(state,result,checks);
  const committed=await loadBundle(directory,{program:false});
  return {status:'completed',id:committed.review.generation.id,revision:committed.revision};
}

async function persistGeneratedPath(state,{pathReport,summary,pathArtifact},checks){
  const id=randomUUID();
  const generation=await retainCompletedOutput(state,{id,mode:checks.mode,editRevision:state.editRevision,geometryInputId:state.geometryInputId,contract,
    summary,version:VERSION,checks,pathReport},pathArtifact);
  const review={...state.review,path:pathArtifact,generation,
    history:[...state.review.history,{event:'generated',mode:checks.mode,time:new Date().toISOString(),outputId:id}]};
  await commitState(state,{review});
  return checks;
}

async function setDeferredSetupSave(directory,{defer,expectedRevision}){
  requireThat(typeof defer==='boolean','Supply whether this bundle defers remembering its exported machine setup.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This revision is stale. Reload before changing setup remembering.');
  if(state.deferRememberSetup===defer)return {directory:state.dir,revision:state.revision,deferRememberSetup:defer};
  // This preference is metadata, not a recipe migration or a new input identity.
  const document=await readManifest(state.dir),bundle={...document.bundle};
  if(defer)bundle.deferRememberSetup=true;else delete bundle.deferRememberSetup;
  const committed=await commitManifest(state.dir,{...document,bundle},state.revision);
  return {directory:state.dir,revision:committed.bundle.revision,deferRememberSetup:defer};
}

// Display only: the choice replaces the print's previous one and changes no
// recipe, path or program identity.
async function setPhaseColours(directory,{phaseColours,expectedRevision}){
  const choice=checkedPhaseColours(phaseColours),state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This revision is stale. Reload before changing phase colours.');
  if(canonicalJson(choice)===canonicalJson(state.phaseColours))return {directory:state.dir,revision:state.revision,phaseColours:choice};
  const document=await readManifest(state.dir),bundle={...document.bundle};
  if(choice)bundle.phaseColours=choice;else delete bundle.phaseColours;
  const committed=await commitManifest(state.dir,{...document,bundle},state.revision);
  return {directory:state.dir,revision:committed.bundle.revision,phaseColours:choice};
}

// selection: the machine label and resolved settings the commanding caller chose.
async function applySettingsSnapshot(directory,selection,expectedRevision,{expectedEditRevision}={}) {
  const captured=structuredClone(selection);
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const {machineId=state.machineId,settings,notes=[]}=captured,origins=Object.hasOwn(captured,'placementOrigins')?checkedPlacementOrigins(captured.placementOrigins):state.placementOrigins;
  const originChanged=canonicalJson(origins)!==canonicalJson(state.placementOrigins);
  requireThat((machineId===null||typeof machineId==='string'&&machineId.length>0)
    &&settings&&typeof settings==='object'&&!Array.isArray(settings)
    &&Object.keys(settings).every(k=>['setup','process','output','placement','skills'].includes(k)),'Invalid selected settings snapshot.');
  const plan={...state.plan,...settings};
  if(machineId===state.machineId&&canonicalJson(plan)===canonicalJson(state.plan)&&!originChanged)return state;
  const changes=planChanges(state.plan,plan);
  if(originChanged)changes.push({path:'bundle.placementOrigins',before:state.placementOrigins??null,after:origins??null});
  const changed=machineId===state.machineId
    ?editedPlanReview(state.review,false,changes)
    :machineChangedReview(state.review,state.machineId,machineId);
  // The selection's notes ride on the change it records.
  const review=notes.length?{...changed,history:[...changed.history.slice(0,-1),{...changed.history.at(-1),notes}]}:changed;
  await commitState(state,{plan,machineId,placementOrigins:origins,review},{edit:true});
  return loadBundle(directory,{program:false});
}

return {root,initBundle,loadBundle,loadBundleSnapshot,
  migrateBundle,readConstructedPath,readGenerationInputs,readGenerationPath,retainGenerationArtifact,publishGenerationResults,restoreRevision,updatePlan,setDeferredSetupSave,setPhaseColours,applySettingsSnapshot};
}
