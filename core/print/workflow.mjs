import {requireThat} from '../private/bundle/numeric.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {retainCompletedOutput,readCompletedOutput} from './completed-output.mjs';
import {saamPathText,joinSaamPath} from '../path/saampath.mjs';
import {readPathArtifact,readMotionArtifact} from './path-artifact.mjs';
import {pathSummary} from '../path/curve-path.mjs';
import {schedulePath} from '../path/schedule.mjs';
import {checkedPhaseColours} from './phase-colours.mjs';
// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, access, copyFile,readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {settingsRows} from '../machine/settings-rows.mjs';
import {summarizePath} from '../path/motion-report.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {loadMachine,storedMachineSnapshot} from '../machine/profile.mjs';
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
  // Bundle is the only writer: a commit that changes plan, machine or geometry
  // mints a new edit revision, and new geometry-input and path-input ids when
  // those parts changed. Programs and paths record the ids they were made from.
  const pathInput=plan=>canonicalJson(adapter.pathDependencies?adapter.pathDependencies({...plan,geometry:null}):{...plan,geometry:null});
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
        path:kept&&oldPath?{id:oldPath.hash,file:oldPath.file,inputId:id,contract,...(oldPath.scheduleFile?{scheduleFile:oldPath.scheduleFile}:{}),...(oldPath.source?{source:oldPath.source}:{})}:null,
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

const manifestDocument=({plan,machine,review,geometry,ids,deferRememberSetup,phaseColours})=>({...plan,bundle:{schema:BUNDLE_SCHEMA,machine:storedMachineSnapshot(machine),review,geometry:storedGeometryArtifact(geometry),...ids,
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
  const review={...state.review,path:restored.path,generation:restored.generation,
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
  // Compiled records of older prints carried a digest of their own mesh.
  if(!saved.editRevision)for(const geometry of geometryTree(terms.geometry))delete geometry.compiledHash;
  if(terms.setup)terms.setup=neutralMaterials(terms.setup);
  // The recipe is read as a current one, with generic defaults without a machine, and setup blocks the
  // machine's profile gained since the snapshot was locked; its notes join the limitations.
  const machine=storedMachineSnapshot(bundle.machine??null),machineNotes=[];
  const savedGeometry=bundle.geometry?.descriptor??null;
  const {plan,notes:recipeNotes,geometryFromSaved}=adapter.readRecipe?await adapter.readRecipe(terms,machine,{savedGeometry}):{plan:terms,notes:[]};
  // A geometry read from the saved artifact describes that artifact; a recipe without geometry has none.
  const geometryArtifact=bundle.geometry&&plan.geometry?{...bundle.geometry,descriptor:await geometryDescriptor(plan.geometry,geometryFromSaved?{...savedGeometry,parameters:plan.geometry}:savedGeometry)}:null;
  const last=bundle.review.history?.at(-1);
  const recorded=Array.isArray(last?.notes)?last.notes.filter(note=>typeof note==='string'):[];
  const unshown=saved.review?.generation&&!bundle.review.generation?[UNSHOWN_PROGRAM_NOTE]:[];
  return {dir,plan,machine,review:bundle.review,geometryArtifact,revision:bundle.revision,
    editRevision:bundle.editRevision,geometryInputId:bundle.geometryInputId,pathInputId:bundle.pathInputId,deferRememberSetup:bundle.deferRememberSetup===true,
    phaseColours:checkedPhaseColours(bundle.phaseColours),recipeNotes:[...unshown,...recorded,...machineNotes,...recipeNotes]};
}

async function describeBundle(input,program) {
  const {dir,plan,machine,geometryArtifact,review,revision,editRevision,geometryInputId,pathInputId,deferRememberSetup,phaseColours,recipeNotes}=input;
  const geometry=adapter.presentGeometry?await adapter.presentGeometry(plan,geometryArtifact?.descriptor??null):geometryArtifact?.descriptor??null;
  const pathCurrent=Boolean(review.path)&&review.path.inputId===pathInputId&&review.path.contract===contract;
  const artifacts={geometry:geometry?'current':'absent',path:!review.path?'absent':pathCurrent?'current':'stale',
    program:!review.generation?'absent':pathCurrent&&review.generation.editRevision===editRevision&&review.generation.contract===contract?'current':'stale'};
  const geometryId=geometryArtifact?.id??null;
  const workEvidence={schema:'saam-work-evidence/1',revision,inputKey:editRevision,geometryKey:geometryId,generationKey:review.generation?.id??review.path?.id??null,editRevision};
  const history={canUndo:Boolean(review.navigation?.past.length),canRedo:Boolean(review.navigation?.future.length)};
  const state={kind,dir,plan,machine,geometry,geometryChecks:[],review,geometryId,geometryInputId,editRevision,pathInputId,revision,artifacts,history,workEvidence,deferRememberSetup,phaseColours};
  Object.defineProperty(state,'geometryArtifact',{value:geometryArtifact,enumerable:false});
  // Settings presentation reads saved data; executable adapters load at Export.
  return Object.assign(state,{programChecked:Boolean(machine&&program),
    exportName:machine?exportName(plan,machine):null,limitations:[...(machine?bedFit(plan,machine,geometry):[]),...recipeNotes,...(geometry?.notes??geometryArtifact?.descriptor?.notes??[]),...(pathCurrent?review.path.limitations??[]:[])],
    settingsRows:machine?settingsRows(plan,machine):[],outputAvailability:machine?null:'Select a printer before Export.',
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

// Reopen reads the completed neutral path's report and captured inputs.
// Older stored machine reports/bytes are not required for viewing or Export.
async function restoreBundleProgram(input,program) {
  const state={...input},{review}=state;
  Object.defineProperty(state,'geometryArtifact',{value:input.geometryArtifact,enumerable:false});
  if (!program || !review.generation) return state;
  try {
    const output=await readCompletedOutput(input,adapter.presentGeometry);
    state.programChecked=true;
    const checks=output.generation.checks??{};
    state.program={...(output.generation.pathReport??{}),limitations:checks.limitations??[],
      notice:'Neutral SAAMpath estimates. Export adds machine startup, priming and physical transfers.'};
    state.limitations=[...new Set([...state.limitations,...state.program.limitations])];
    state.pathSummary = currentPathSummary(review.generation.summary);
    state.outputId = output.id;
    // Reviewed neutral source and execution retain one immutable identity.
    const {scheduleFile:neutralSchedule,...pathSource}=review.path??{};
    const {scheduleFile:machineSchedule,...outputSource}=output.path??{};
    state.completedOutput={id:output.id,current:state.artifacts.program==='current'&&canonicalJson(pathSource)===canonicalJson(outputSource),
      plan:output.plan,machine:output.machine,geometry:output.geometry,geometryId:output.geometryId,geometryInputId:output.geometryInputId,editRevision:output.generation.editRevision,
      outputId:output.id,inputRevision:output.generation.inputRevision??null,exportName:output.machine?exportName(output.plan,output.machine):null,review:{generation:output.generation},
      settingsRows:settingsRows(output.plan,output.machine),path:output.path,pathId:output.path?.id??null};
    state.exportName=state.completedOutput.exportName;
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

// Generation constructs and reviews only neutral SAAMpath. Machine writing
// belongs to Export, so missing or broken adapters cannot affect this outcome.
async function prepareGeneration(directory,{onProgress}={}){
  const state=await loadBundle(directory,{program:false}),source=await generationSource(state.plan);
  onProgress?.({stage:'Preparing geometry'});
  const {path,artifact}=await prepareToolpath(state,{onProgress,source});
  const pathReport=summarizePath(path,state.plan.process.lineWidthMm);
  const result={pathArtifact:artifact,summary:pathSummary(path),pathReport};
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
  return {...review,history:[...review.history,
    {event:'generation-invalidated',reason:'generation-source-changed',time:new Date().toISOString()}]};
}

async function activeGenerationState(directory){
  const state=await loadBundle(directory,{program:false});
  const source=await generationSource(state.plan);
  return {state,source};
}

async function requireGenerationSource(state,expected){
  if(!adapter.pathSource)return;
  const source=await generationSource(state.plan);
  if(source.release===expected?.release&&source.hash===expected?.hash)return;
  if(source.missing)throw source.missing;
  throw Error('Generation source changed during calculation. Generate again using the current scripts.');
}

async function prepareToolpath(state,{onProgress,source}={}){
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
  const schedule=schedulePath(stored,{sourcePathId:id,onProgress});
  joinSaamPath({sourcePathId:id,deposition:stored,schedule});
  await save(resolve(state.dir,scheduleFile),saamPathText(schedule));
  const artifact={id,file,scheduleFile,inputId:state.pathInputId,contract,
    ...(source.hash!==null?{source:{release:source.release,hash:source.hash}}:{}),
    ...(stored.summary.limitations?.length?{limitations:stored.summary.limitations}:{})};
  return {path:await readMotionArtifact(state.dir,artifact),artifact};
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
// never satisfy the final reviewed-export delivery gate. A current neutral
// result is reused (and promoted for production); otherwise the generation
// worker computes and commits under the caller's held reservation. The signal
// cancels until beforeCommit is acknowledged.
async function generateBundle(directory, { development = false, signal, onProgress, beforeCommit } = {}) {
  const {state,source} = await activeGenerationState(directory);
  signal?.throwIfAborted();
  const current=await currentGenerationCandidate(directory,state,source);
  if(current){
    await requireGenerationSource(state,source);
    if(development||current.checks.mode==='production')return current.checks;
    await beforeCommit?.();
    await requireGenerationSource(state,source);
    const confirmed=await currentGenerationCandidate(directory,state,source);
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
  return persistGeneratedPath(state,result,generationChecks(state,result,development));
}

async function currentGenerationCandidate(directory,state,source){
  if(!state.review.generation||staleGenerationSource(state,source))return null;
  const current=await loadBundle(directory,{program:true});
  if(!current.program||current.programError||!current.completedOutput?.current)return null;
  // Checks that do not match their path are stale: generation replaces them.
  const checks=current.review.generation.checks;
  return checks?.schema==='saam-path-checks/1'&&checks.result==='pass'&&checks.mode===current.review.generation?.mode?{checks,current}:null;
}

async function promoteReviewedGeneration(dir,{checks,current}){
  const promoted={...checks,mode:'production'};
  const review={...current.review,generation:{...current.review.generation,mode:'production',checks:promoted},
    history:[...current.review.history,{event:'generation-reused',mode:'production',time:new Date().toISOString(),outputId:current.outputId}]};
  await commitState(current,{review});
  return promoted;
}

function generationChecks(state,{pathReport:report,summary},development){
  return {
    schema: 'saam-path-checks/1', result: 'pass', mode: development ? 'development' : 'production',
    generatorVersion: VERSION,
    moves: report.moves,
    volumeMm3: Number(report.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((report.seconds / 60).toFixed(1)),
    travel: summary.travel,
    shortTravel: report.shortTravel,
    surfaceDomain: summary.surfaceDomain ?? null,
    limitations: [...new Set([...(summary.limitations??[]),...(report.limitations??[])])],
  };
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

// The person's Export in Studio is the one confirmation: it writes the displayed
// result, and later edits do not change that snapshot.
async function exportReviewed(state,{machineSetups}={}){
  const output=state.completedOutput;
  requireThat(output?.path&&output.machine&&output.review.generation.mode==='production','Review a saved toolpath and select a printer before Export.');
  const result=await runComputationJob(new URL('./export-worker.mjs',import.meta.url),
    {directory:state.dir,path:output.path,plan:output.plan,machine:output.machine,
      release:{generatorVersion:VERSION,buildDate:BUILD_DATE}}, {subject:'Machine Export'});
  const bytes=Buffer.from(result.bytes);
  const receipt={time:new Date().toISOString(),outputId:output.id,inputRevision:output.inputRevision??null,
    output:output.plan.output,bytes:bytes.length,report:result.report};
  // Receipts and remembered settings describe the captured output, never live currency.
  const remember=async()=>{
    try{await recordDelivery(state.dir,{...receipt,attribution:originalSource(output.plan.geometry)?.attribution??null});}
    catch(error){result.report.limitations.push('Export prepared; its receipt could not be recorded: '+error.message);}
    if(machineSetups&&!state.deferRememberSetup)try{await saveSetup(output.machine,output.plan.setup,
      {machineSetups,exportReceipt:{directory:state.dir,outputId:output.id,inputRevision:output.inputRevision??null}});}
    catch(error){result.report.limitations.push('Export prepared; its setup could not be remembered: '+error.message);}
  };
  try{
    if(machineSetups&&!state.deferRememberSetup)await withMachineSetupExport(machineSetups,output.machine,remember);
    else await remember();
  }catch(error){result.report.limitations.push('Export prepared; recording/remembering it failed: '+error.message);}
  return {bytes,outputId:output.id,report:result.report,attribution:originalSource(output.plan.geometry)?.attribution??null};
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
  migrateBundle,readDrawnPath,readConstructedPath,prepareGeneration,commitGeneration,restoreRevision,adjustBundle,updatePlan,generateBundle,exportReviewed,setDeferredSetupSave,setPhaseColours,applySettingsSnapshot};
}
