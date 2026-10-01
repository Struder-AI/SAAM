import {requireThat} from '../private/bundle/numeric.mjs';
// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, rename, access, rm,copyFile,readdir } from 'node:fs/promises';
import {createReadStream} from 'node:fs';
async function hashFile(path){const sha=createHash('sha256');for await(const chunk of createReadStream(path))sha.update(chunk);return sha.digest('hex');}
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportAndInterpretProgram, interpretProgram } from '../export/registry.mjs';
import { loadMachine } from '../machine/profile.mjs';
import {consumeCheckedProgram,createPendingCheckedProgramStore} from './program-handoff.mjs';
import {replaceFile} from '../file-write.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {selectSettings,saveSetup} from '../machine/settings.mjs';
import {assignmentFamily as ordinaryAssignmentFamily} from './slice-settings.mjs';
import {commitManifest,revisionOf,retainContent,restoreContent} from './revisions.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_SCHEMA='saam-print-bundle/2';
const nativeSuffix=geometry=>{const name=geometry.nativeFile??'model.3dm';requireThat(['model.3dm','model.mesh.json'].includes(name),'Unsupported native geometry file.');return name==='model.3dm'?'.3dm':'.mesh.json';};
const canonical=value=>JSON.stringify(value,function(_key,item){return item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item;});
const hash=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:canonical(value)).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
function migratedIdentity(record,newName,oldName,scope) {
  if(!record||typeof record!=='object')return record;
  const hasNew=Object.hasOwn(record,newName),hasOld=Object.hasOwn(record,oldName);
  if(hasNew&&hasOld&&record[newName]!==record[oldName])throw Error(`Conflicting generation identity in ${scope}.`);
  if(!hasOld)return record;
  const next={...record,[newName]:record[newName]??record[oldName]};delete next[oldName];return next;
}
function migrateReview(review) {
  const approvals={...review?.approvals};
  if(Object.hasOwn(approvals,'toolpath'))approvals.toolpath=migratedIdentity(approvals.toolpath,'generationHash','planHash','toolpath approval');
  return {...review,
    generation:migratedIdentity(review?.generation,'generationHash','planHash','review generation'),
    approvals,
    history:(review?.history??[]).map((event,index)=>migratedIdentity(
      migratedIdentity(event,'generationHash','planHash',`review history ${index}`),
      'previousGenerationHash','previousPlanHash',`review history ${index}`))};
}
const migrateChecks=checks=>migratedIdentity(checks,'generationHash','planHash','saved checks');
const originalSource=geometry=>geometry?.source??(geometry?.base?originalSource(geometry.base):null);
async function save(file,value){
  await replaceFile(file,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
}

export function programCacheEntry(key,program,code) {
  // Retain the large motion arrays once; only the outer record is separated
  // from the producer. Removing source fields must not mutate an earlier stage.
  const {code:sourceText,sources:sourceFiles,...motion}=program;
  const text=sourceText??code.toString('utf8');
  const sources=sourceFiles??{program:text};
  const {moves,events,...metadata}=motion;
  const sourceInfo=Object.entries(sources).map(([name,source])=>({name,sha256:hash(source)}));
  return {key,bytes:Buffer.from(code),program:motion,code:text,sources,metadata:{...metadata,sources:sourceInfo}};
}

export function applyPlanPatch(previous, patch, geometryTemplate) {
  return resolvePlanPatch(previous,patch,{geometryTemplate});
}

// changes: each recipe value the edit changed, from planChanges.
export function editedPlanReview(review, previousGenerationHash, geometryChanged, changes = [], time = new Date().toISOString()) {
  const event = {event:'plan-edited', time, previousGenerationHash, geometryChanged, changes, invalidated:['toolpath']};
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
  return canonical(before)===canonical(after)?[]:[{path:path.join('.'),before:before??null,after:after??null}];
}

function invalidateReview(review,event) {
  return {...review, history:[...review.history,event], approvals:{}};
}

export function approvedReview(review, record) {
  return {
    ...review,
    approvals:{toolpath:record},
    history:[...review.history,{event:'human-approval',...record}]
  };
}

export function machineChangedReview(review, from, to, time = new Date().toISOString()) {
  return invalidateReview(review,{event:'machine-changed',from,to,time});
}

export function createBundleWorkflow(adapter) {
  const {kind,defaults,createGeometry,generatePath,geometryTemplate,patchPlan,
    version:VERSION,buildDate:BUILD_DATE,exportName:EXPORT_NAME,limitations:limitationsFor}=adapter;
  const exportName=(plan,machine)=>{
    const extension=machine.outputs.find(o=>o.id===plan.output)?.extension??'.gcode';
    requireThat(/^\.[a-z0-9.]+$/.test(extension),'Invalid export extension.');
    return EXPORT_NAME.replace(/\.gcode$/,extension);
  };
  const legacyExportPath=(plan,machine)=>{requireThat(/^[a-z0-9-]+$/.test(plan.output),'Invalid output ID.');return `exports/${plan.output}/${exportName(plan,machine)}`;};
  const exportArtifactPath=(plan,machine,exportHash)=>{requireThat(/^[a-z0-9-]+$/.test(plan.output)&&/^[a-f0-9]{64}$/.test(exportHash),'Invalid generated program reference.');return `exports/${plan.output}/${exportHash}-${exportName(plan,machine)}`;};
  // Retain only the latest verified program per adapter. Identity includes the
  // actual file bytes, not mtimes or editable review claims. Approval state is
  // always read afresh; callers receive copies so they cannot alter this cache.
  let verifiedProgram;
  const pendingCheckedPrograms=createPendingCheckedProgramStore();
  let inputCache={};
  // One preparation serves checking and saving unchanged inputs.
  let preparation, pathPreparation;
  const programKey=(generationHash,exportHash)=>hash([generationHash,exportHash]);
async function proposedPlan(machineId, options={}) {
  const {machine,settings}=await selectSettings(machineId,options);
  return {...await defaults(machine),...settings};
}
async function initBundle(directory, plan = {schema:'saam-shell-plan/1'}, { setupFile, machineId, sourceBytes,sourcePath,preparedGeometry,attachments=[] } = {}) {
  const dir = resolve(directory);
  try {
    await access(resolve(dir, 'plan.json'));
    throw new Error('Print already exists. Open it or choose another directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  let machineSnapshot;
  if(plan?.bundle){
    const {bundle,...recipe}=plan;
    plan=recipe;
    machineSnapshot=bundle.machine;
  }
  const machine = machineId?loadMachine(machineId):machineSnapshot??null;
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  const geometry = preparedGeometry??(plan.geometry?await createGeometry(plan.geometry):null);
  if(preparedGeometry)requireThat(hash(preparedGeometry.descriptor.parameters)===hash(plan.geometry)&&hash(preparedGeometry.bytes)===preparedGeometry.descriptor.fileHash,'Prepared geometry does not match the bundle recipe.');
  for(const attachment of attachments){
    requireThat(['repair/original.stl','repair/repaired.stl','repair/repair.json'].includes(attachment.file),'Unsupported import attachment.');
    const target=resolve(dir,attachment.file);await mkdir(dirname(target),{recursive:true});await copyFile(attachment.sourcePath,target);
  }
  if(originalSource(plan.geometry)){
    if(sourcePath){
      const target=resolve(dir,'geometry/source.stl'),temporary=target+'.tmp';await mkdir(dirname(target),{recursive:true});
      try{await copyFile(sourcePath,temporary);requireThat(await hashFile(temporary)===originalSource(plan.geometry).sha256,'STL source changed during import.');await rename(temporary,target);}finally{await rm(temporary,{force:true});}
    }else{requireThat(sourceBytes&&hash(sourceBytes)===originalSource(plan.geometry).sha256,'STL source bytes are required; use import-stl.');await save(resolve(dir,'geometry/source.stl'),sourceBytes);}
  }
  const geometryArtifact=await saveGeometry(dir,geometry);
  const review={schema:'saam-review/1',approvals:{},history:[],generation:null};
  await saveManifest(dir,{plan,machine,review,geometry:geometryArtifact},null);
  return dir;
}

async function saveGeometry(dir, geometry) {
  if(!geometry)return null;
  const geometryHash=hash({file:hash(geometry.bytes),descriptor:geometry.descriptor});
  const file=`geometry/${geometryHash}${nativeSuffix(geometry.descriptor)}`;
  try{await access(resolve(dir,file));}catch(error){if(error.code!=='ENOENT')throw error;await save(resolve(dir,file),geometry.bytes);}
  return {hash:geometryHash,file,descriptor:geometry.descriptor};
}

const manifestDocument=({plan,machine,review,geometry})=>({...plan,bundle:{schema:BUNDLE_SCHEMA,machine,review,geometry}});
const saveManifest=(dir,state,expected)=>commitManifest(dir,manifestDocument(state),expected);

async function commitState(state,next,{edit=false,history}={}){
  const previous={plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review};
  const navigation=state.review.navigation??{past:[],future:[]};
  const nextHistory=history??(edit?{past:[...navigation.past,await retainContent(state.dir,previous)],future:[]}:navigation);
  const review={...next.review,navigation:nextHistory};
  return saveManifest(state.dir,{...previous,...next,review},state.revision);
}

async function restoreRevision(directory,{direction,expectedRevision}={}){
  requireThat(['undo','redo'].includes(direction),'Choose undo or redo.');
  const state=await loadBundle(directory,{program:false});
  requireThat(typeof expectedRevision==='string'&&expectedRevision===state.revision,'This revision is stale. Reload before restoring the print.');
  const navigation=state.review.navigation??{past:[],future:[]},source=direction==='undo'?'past':'future',destination=direction==='undo'?'future':'past';
  requireThat(navigation[source].length>0,`Nothing to ${direction}.`);
  const id=navigation[source].at(-1),restored=await restoreContent(state.dir,id);
  const current=await retainContent(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review});
  const history={...navigation,[source]:navigation[source].slice(0,-1),[destination]:[...navigation[destination],current]};
  const review={...state.review,approvals:{},path:restored.path,generation:restored.generation,
    history:[...state.review.history,{event:direction,time:new Date().toISOString(),restored:id,previousRevision:state.revision}]};
  // Validate the restored references before publishing a new revision.
  const candidate={dir:state.dir,plan:restored.plan,machine:restored.machine,geometry:restored.geometry,review};
  const bytes=candidate.geometry?await readFile(resolve(state.dir,candidate.geometry.file)):null;
  const checked=await validateBundleInput({...candidate,bytes,planText:JSON.stringify(manifestDocument(candidate))},{});
  if(checked.error)throw checked.error;
  await commitState(state,{plan:restored.plan,machine:restored.machine,geometry:restored.geometry,review},{history});
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

async function prepareLegacyMigration(dir,document,planText){
  const inputNames=['plan.json','machine.json','review.json','geometry/model.json'],inputBytes=await Promise.all(inputNames.slice(1).map(name=>readFile(resolve(dir,name))));
  const checksBytes=await readFile(resolve(dir,'checks.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const machine=JSON.parse(inputBytes[0]),storedReview=JSON.parse(inputBytes[1]),descriptor=JSON.parse(inputBytes[2]),legacyChecks=checksBytes?JSON.parse(checksBytes):null;
  const inputs=new Map([['plan.json',Buffer.from(planText)],...inputNames.slice(1).map((name,index)=>[name,inputBytes[index]])]);
  if(checksBytes)inputs.set('checks.json',checksBytes);
  else inputs.set('checks.json',null);
  const review=migrateReview(storedReview),legacyFile=nativeSuffix(descriptor)==='.3dm'?'geometry/model.3dm':'geometry/model.mesh.json';
  const bytes=await readFile(resolve(dir,legacyFile)),geometryHash=hash({file:hash(bytes),descriptor});
  inputs.set(legacyFile,bytes);
  const geometry={hash:geometryHash,file:`geometry/${geometryHash}${nativeSuffix(descriptor)}`,descriptor};
  const artifacts=new Map([[geometry.file,bytes]]);let programBytes=null;
  if(review.generation){
    const oldProgram=resolve(dir,legacyExportPath(document,machine)),code=await readFile(oldProgram),exportHash=hash(code);
    inputs.set(legacyExportPath(document,machine),code);programBytes=code;
    requireThat(exportHash===review.generation.exportHash,'Legacy generated files changed; regenerate before migration.');
    const file=exportArtifactPath(document,machine,exportHash);artifacts.set(file,code);
    review.generation={...review.generation,file,checks:legacyChecks?migrateChecks(legacyChecks):null};
  }
  const state={plan:document,machine,review,geometry};
  const manifest=manifestDocument(state),preflight=await validateBundleInput({dir,planText:JSON.stringify(manifest),...state,bytes},{});
  if(preflight.error)throw preflight.error;
  const source=originalSource(document.geometry);
  if(source){const sourceBytes=await readFile(resolve(dir,'geometry/source.stl'));inputs.set('geometry/source.stl',sourceBytes);requireThat(hash(sourceBytes)===source.sha256,'Imported STL source changed; repair it before migration.');}
  const programStatus=!review.generation?'none':review.generation.generationHash===preflight.identity.generationHash?'current':'stale';
  if(programStatus==='current'){
    const path=review.path?await readPathArtifact(dir,review.path):null;
    interpretProgram(programBytes,document,machine,{authoredNozzleTemperatures:path?.completion?.authoredNozzleTemperatures});
  }
  return {state,manifest,artifacts,planText,inputs,programStatus};
}

async function requireLegacyCurrent(dir,inputs){
  for(const [name,expected] of inputs){
    const actual=await readFile(resolve(dir,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    requireThat(expected===null?actual===null:actual?.equals(expected),`Legacy bundle changed during migration: ${name}. Run migration again.`);
  }
}

async function migrateBundle(directory,{beforeCommit}={}){
  const dir=resolve(directory),planFile=resolve(dir,'plan.json'),planText=await readFile(planFile,'utf8'),document=JSON.parse(planText);
  const before=await bundleFiles(dir);
  if(document.bundle?.schema===BUNDLE_SCHEMA)return migrateCurrentRecipe(dir,document,planText,before,{beforeCommit});
  const prepared=await prepareLegacyMigration(dir,document,planText),created=[],retained=new Set(before);
  await requireLegacyCurrent(dir,prepared.inputs);
  for(const [name,bytes] of prepared.artifacts){
    try{
      const existing=await readFile(resolve(dir,name));
      requireThat(existing.equals(bytes),`Migration target already exists with different bytes: ${name}.`);
    }catch(error){if(error.code!=='ENOENT')throw error;created.push(name);}
  }
  for(const name of created)await save(resolve(dir,name),prepared.artifacts.get(name));
  await beforeCommit?.();
  await requireLegacyCurrent(dir,prepared.inputs);
  await commitManifest(dir,prepared.manifest,revisionOf(document));
  const state=await loadBundle(dir,{program:'source'});
  return {status:'migrated',directory:dir,created,updated:['plan.json'],removed:[],retained:[...retained].filter(name=>name!=='plan.json'),
    legacyProgram:prepared.programStatus,
    verification:{geometryHash:state.geometryHash,exportHash:state.exportHash??null,toolpathApproved:state.toolpathApproved,programError:state.programError??null}};
}

async function migrateCurrentRecipe(dir,document,planText,before,{beforeCommit}){
  const {migrateRecipeFields}=await import('./recipe-migration.mjs');
  const {bundle,...previous}=document,{plan,changes}=migrateRecipeFields(previous,bundle.machine);
  if(!changes.length)return {status:'current',directory:dir,created:[],updated:[],removed:[],retained:before};
  const geometry=bundle.geometry;
  requireThat(geometry===null&&!plan.geometry||geometry&&/^[a-f0-9]{64}$/.test(geometry.hash)&&geometry.file===`geometry/${geometry.hash}${nativeSuffix(geometry.descriptor)}`,'Invalid geometry artifact reference.');
  const bytes=geometry?await readFile(resolve(dir,geometry.file)):null,machine=bundle.machine;
  const review=invalidateReview(migrateReview(bundle.review),{event:'recipe-migrated',time:new Date().toISOString(),changes,previousGenerationHash:bundle.review.generation?.generationHash??null,invalidated:['generation','toolpath']});
  const state={plan,machine,geometry,review},manifest=manifestDocument(state);
  const checked=await validateBundleInput({dir,planText:JSON.stringify(manifest),...state,bytes},{});
  if(checked.error)throw checked.error;
  const inputs=new Map([['plan.json',Buffer.from(planText)],...(geometry?[[geometry.file,bytes]]:[])]),source=originalSource(plan.geometry);
  if(source){const sourceBytes=await readFile(resolve(dir,'geometry/source.stl'));requireThat(hash(sourceBytes)===source.sha256,'Imported source changed; repair it before recipe migration.');inputs.set('geometry/source.stl',sourceBytes);}
  await beforeCommit?.();await requireLegacyCurrent(dir,inputs);
  await commitState({dir,plan:previous,machine,geometryArtifact:geometry,review:migrateReview(bundle.review),revision:revisionOf(document)},state,{edit:true});
  const reopened=await loadBundle(dir,{program:false});
  return {status:'migrated',directory:dir,changes,created:[],updated:['plan.json'],removed:[],retained:before.filter(name=>name!=='plan.json'),
      verification:{geometryHash:reopened.geometryHash,toolpathApproved:reopened.toolpathApproved,generation:reopened.review.generation,revision:reopened.revision}};
}

async function readBundleInput(directory) {
  const dir = resolve(directory);
  let planText=await readFile(resolve(dir,'plan.json'),'utf8'),document=JSON.parse(planText),state;
  if(document.bundle?.schema===BUNDLE_SCHEMA){
    const {bundle,...plan}=document,review=migrateReview(bundle.review);
    if(review.generation?.checks)review.generation={...review.generation,checks:migrateChecks(review.generation.checks)};
    state={plan,machine:bundle.machine,review,geometry:bundle.geometry,revision:revisionOf(document)};
  }else{
    throw Error(`Legacy split-file bundle requires explicit migration. Run: node core/print/cli.mjs migrate ${JSON.stringify(dir)}`);
  }
  requireThat(state.geometry===null&&!state.plan.geometry||state.geometry&&/^[a-f0-9]{64}$/.test(state.geometry.hash)
    &&new RegExp(`^geometry/${state.geometry.hash.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.(?:3dm|mesh\\.json)$`).test(state.geometry.file),
  'Invalid geometry artifact reference.');
  const bytes=state.geometry?await readFile(resolve(dir,state.geometry.file)):null;
  return {dir,planText,...state,bytes};
}

async function validateBundleInput(input,previousCache) {
  const {dir,planText,plan,review,machine,geometry,bytes,revision}=input;
  const cache={...previousCache};
  try {
    // Read current bytes at every boundary, but canonicalize large mesh/plan
    // trees only when those bytes change. Keep the established semantic hashes
    // so formatting alone does not invalidate a person's recorded approval.
    const fileHash=hash(bytes),identityKey=hash([hash(planText),fileHash]);
    let identity=cache.identity;
    if(identity?.key!==identityKey){
      const geometryHash=geometry?hash({file:fileHash,descriptor:geometry.descriptor}):hash(null);
      requireThat(!geometry||geometryHash===geometry.hash,'Saved geometry artifact changed; rebuild the print geometry.');
      requireThat(!geometry||geometry.file===`geometry/${geometry.hash}${nativeSuffix(geometry.descriptor)}`,'Invalid geometry artifact reference.');
      if(review.generation)requireThat(/^[a-f0-9]{64}$/.test(review.generation.exportHash)&&new RegExp(`^exports/[a-z0-9-]+/${review.generation.exportHash}-[a-z0-9.-]+$`).test(review.generation.file),
        'Invalid generated program reference. Regenerate the print.');
      requireThat(canonical(plan.geometry)===canonical(geometry?.descriptor.parameters),'Plan and geometry disagree. Rebuild the print geometry.');
      identity={key:identityKey,geometryHash,pathHash:hash(adapter.pathDependencies?adapter.pathDependencies(plan,machine):{plan,machine}),generationHash:hash({plan,machine,geometryHash,...(adapter.generationContract?{generationContract:adapter.generationContract}:{})})};
      cache.identity=identity;
    }
    return {dir,plan,machine,geometry:geometry?.descriptor??null,geometryArtifact:geometry,geometryChecks:[],review,identity,cache,revision};
  } catch(error) {return {cache,error};}
}

async function describeBundle({dir,plan,machine,geometry,geometryArtifact,geometryChecks,review,identity,revision},program) {
  const {geometryHash,generationHash,pathHash}=identity;
  const artifacts={geometry:geometry?'current':'absent',path:!review.path?'absent':review.path.inputHash===pathHash?'current':'stale',program:!review.generation?'absent':review.generation.generationHash===generationHash?'current':'stale'};
  const history={canUndo:Boolean(review.navigation?.past.length),canRedo:Boolean(review.navigation?.future.length)};
  if(!machine){
    const state={kind,dir,plan,machine:null,geometry,geometryChecks,review,geometryHash,generationHash,programChecked:false,exportName:null,limitations:[],skills:[],toolpathApproved:false,setupBasis:null,outputAvailability:'Ask the agent to supply a printer, material and toolpath recipe.'};
    Object.assign(state,{revision,pathHash,artifacts,history});Object.defineProperty(state,'geometryArtifact',{value:geometryArtifact,enumerable:false});return state;
  }
  const state = {
    kind, dir, plan, machine, geometry, geometryChecks, review, geometryHash, generationHash, programChecked:Boolean(program&&review.generation),
    exportName: exportName(plan,machine), limitations: limitationsFor(plan, machine),
    outputAvailability:machine.outputs.find(o=>o.id===plan.output)?.implemented===false?`Machine-file export for ${machine.name} is not available yet; geometry and settings can be reviewed.`:null,
    skills: [...new Set((plan.slices?.assignments??[]).map(assignment=>assignment.construction==='sleeve'
      ?assignment.pattern===null?'slice':'trace':ordinaryAssignmentFamily(assignment))),
      ...Object.entries(plan.skills??{}).filter(([,settings])=>settings?.enabled).map(([name])=>name)]
  };
  state.toolpathApproved = false;
  Object.assign(state,{revision,pathHash,artifacts,history});
  state.setupBasis = plan.setup?.startupVerified
    ? 'Confirmed startup behavior'
    : machine.startup?.validation;

  Object.defineProperty(state,'geometryArtifact',{value:geometryArtifact,enumerable:false});

  return state;
}

async function restoreBundleProgram(input,program,allSources,previousProgram) {
  const state={...input},{dir,plan,machine,review,generationHash}=state;
  Object.defineProperty(state,'geometryArtifact',{value:input.geometryArtifact,enumerable:false});
  let cachedProgram=previousProgram;
  let observedExportHash=null;
  if (program && review.generation) {
    try {
      requireThat(review.generation.generationHash === generationHash, 'Generated program is stale; regenerate for the current plan.');
      requireThat(typeof review.generation.file==='string','Generated program has no saved artifact. Regenerate it.');
      const code = await readFile(resolve(dir,review.generation.file));
      const exportHash=hash(code),key=programKey(generationHash,exportHash);observedExportHash=exportHash;
      requireThat(exportHash === review.generation.exportHash,
        'Generated files changed; regenerate and review again.');
      const path=review.path?await readPathArtifact(dir,review.path):null;
      const authoredNozzleTemperatures=path?.completion?.authoredNozzleTemperatures;
      if(cachedProgram?.key!==key||(program!=='source'&&!cachedProgram.program)) {
        // Reopen the saved machine program. Interpretation checks the actual
        // commands; reopening never invokes a slicing skill or exporter. Source
        // requests can reuse their job's checked result after the current-byte
        // hash above matches. Full-motion and cold callers still interpret.
        const source=program==='source'?pendingCheckedPrograms.take(key):null;
        if(source)cachedProgram={key,...source,bytes:code,program:null};
        else cachedProgram=programCacheEntry(key,interpretProgram(code, plan, machine,{authoredNozzleTemperatures}),code);
      }
      state.program = structuredClone(program==='source'?cachedProgram.metadata:cachedProgram.program);
      state.authoredNozzleTemperatures=authoredNozzleTemperatures;
      state.limitations=[...new Set([...state.limitations,...(state.program.limitations??[])])];
      state.pathSummary = structuredClone(review.generation.summary??{});
      state.exportHash = exportHash;
      state.code = cachedProgram.code;
      Object.defineProperty(state,'checkedBytes',{value:Buffer.from(cachedProgram.bytes),enumerable:false});
      if(allSources)state.sources={...cachedProgram.sources};
      state.toolpathApproved = review.approvals.toolpath?.hash === state.exportHash
        && review.approvals.toolpath?.generationHash === generationHash
        && review.generation.mode === 'production';
    } catch (error) { state.programError = error.message; }
  }
  return {state,cachedProgram,observedExportHash};
}


async function loadBundle(directory, { program = true, allSources=false } = {}) {
  const input=await readBundleInput(directory);
  const validated=await validateBundleInput(input,inputCache);
  inputCache=validated.cache;
  if(validated.error)throw validated.error;
  const described=await describeBundle(validated,program);
  const restored=await restoreBundleProgram(described,program,allSources,verifiedProgram);
  verifiedProgram=restored.cachedProgram;
  const {review,machine,plan,geometry}=validated;
  const fingerprints={source:hash([hash(input.planText),validated.identity.geometryHash,
      originalSource(plan.geometry)?.sha256??null,program?restored.observedExportHash:null]),
    presentation:hash([['plan',hash(plan)],['machine',hash(machine)],['geometry',validated.identity.geometryHash],
      ['generation',review.generation?{generationHash:review.generation.generationHash,exportHash:review.generation.exportHash,
        summary:review.generation.summary,version:review.generation.version,file:review.generation.file,
        checks:review.generation.checks?Object.fromEntries(Object.entries(review.generation.checks).filter(([key])=>key!=='mode')):null}:null]])};
  Object.defineProperty(restored.state,'fingerprints',{value:fingerprints,enumerable:false});
  return restored.state;
}

async function loadBundleSnapshot(directory,options){
  const state=await loadBundle(directory,options);
  return {schema:'saam-bundle-snapshot/1',state,fingerprint:state.fingerprints.source,presentationFingerprint:state.fingerprints.presentation};
}

// A content fingerprint for automatic viewer updates. Changed geometry or plan
// inputs invalidate their checks; an approval-only change does not.
// One snapshot pass yields both change fingerprints: `source` covers the
// manifest and every referenced artifact; `presentation` uses the generation
// identity minus mode, so approval, delivery history and mode
// changes update controls without replacing mesh/motion.
async function bundleFingerprints(directory, {program=true}={}) {
  const snapshot=await loadBundleSnapshot(directory,{program});
  return {source:snapshot.fingerprint,presentation:snapshot.presentationFingerprint};
}
async function bundleFingerprint(directory, options) {
  return (await bundleFingerprints(directory, options)).source;
}

// Feasibility inspection through the same generator, without persisted output
// or approval. The approved generation/export step remains the delivery gate.
async function checkPathBundle(directory, {onProgress} = {}) {
  const candidate=await prepareGeneration(directory,{onProgress}),result=candidate.result;
  return {mode:'development-check-only',revision:candidate.revision,
    ...structuredClone(result.summary),exportSummary:structuredClone(result.program.summary)};
}

async function prepareGeneration(directory,{onProgress}={}){
  const state=await loadBundle(directory,{program:false});
  requireThat(state.machine,'Supply a machine, material and toolpath recipe before generation.');
  const key=hash([state.dir,state.generationHash]);
  if(preparation?.key!==key)preparation={key};
  const candidate=preparation;
  if(!candidate.result)candidate.result=Promise.resolve().then(async()=>{
    onProgress?.({stage:'Preparing geometry'});
    const {path,artifact}=await prepareToolpath(state,{onProgress});
    onProgress?.({stage:'Writing and checking machine commands'});
    try{return {pathArtifact:artifact,summary:path.summary,...exportAndInterpretProgram(path,state.plan,state.machine,{generatorVersion:VERSION,buildDate:BUILD_DATE})};}
    catch(error){error.stage='export';throw error;}
  }).catch(error=>{candidate.result=null;throw error;});
  const result=await candidate.result;
  return {directory:state.dir,revision:state.revision,generationHash:state.generationHash,result};
}

async function prepareToolpath(state,{onProgress}={}){
  const key=hash([state.dir,state.pathHash]);
  if(pathPreparation?.key===key){onProgress?.({stage:'Reusing neutral SAAMpath'});return pathPreparation.result;}
  const result=(async()=>{
    const saved=state.review.path;
    if(saved?.inputHash===state.pathHash){
      const path=await readPathArtifact(state.dir,saved);
      onProgress?.({stage:'Reusing saved SAAMpath'});
      requireThat(!adapter.completionContract||path.completion?.contract===adapter.completionContract&&path.completion.inputHash===state.pathHash,'Saved SAAMpath completion does not match its inputs.');
      return {path,artifact:saved};
    }
    const path=await generatePath(state.plan,state.machine,{onProgress});
    requireThat(!adapter.completionContract||path.completion?.contract===adapter.completionContract&&path.completion.inputHash===state.pathHash,'Generated SAAMpath completion does not match its inputs.');
    const bytes=JSON.stringify(path),contentHash=hash(bytes),file=`paths/${contentHash}.json`;
    await save(resolve(state.dir,file),bytes);
    return {path,artifact:{inputHash:state.pathHash,hash:contentHash,file}};
  })();
  pathPreparation={key,result};
  try{return await result;}catch(error){if(pathPreparation?.result===result)pathPreparation=null;throw error;}
}

async function readPathArtifact(dir,artifact){
  requireThat(/^[a-f0-9]{64}$/.test(artifact.hash)&&artifact.file===`paths/${artifact.hash}.json`,'Invalid SAAMpath reference.');
  const bytes=await readFile(resolve(dir,artifact.file));
  requireThat(hash(bytes)===artifact.hash,'Saved SAAMpath changed; regenerate it.');
  return JSON.parse(bytes);
}

// Authored SAAMpath can be saved before choosing a machine-program output.
async function generateToolpath(directory,{onProgress,beforeCommit}={}){
  const state=await loadBundle(directory,{program:false});
  const {artifact}=await prepareToolpath(state,{onProgress});
  await beforeCommit?.();
  await readPathArtifact(state.dir,artifact);
  await commitState(state,{review:{...state.review,path:artifact}});
  return loadBundle(directory,{program:false});
}

// Chat-driven adjustment: the agent applies a patch, the plan is revalidated,
// and the affected approvals fall away. An unknown key is refused here as well
// as in the plan check, so a misspelled setting never silently does nothing.
async function adjustBundle(directory, patch, { setupFile, expectedRevision } = {}) {
  const state = await loadBundle(directory, { program: false });
  if(expectedRevision!==undefined)requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing the print.');
  const plan = patchPlan?await patchPlan(state.plan,patch):applyPlanPatch(state.plan, patch, geometryTemplate);
  const updated=await updatePlan(directory, plan, state.revision);
  if (patch.setup&&updated.machine) await saveSetup(updated.machine,updated.plan.setup,{setupFile});
  return updated;
}


async function updatePlan(directory, plan, revision) {
  const state = await loadBundle(directory, { program: false });
  requireThat(revision === state.revision, 'This view is stale. Reload before changing the print.');
  const change = validatePlanUpdate(state, plan);
  if (!change.changed) return state;

  // Build before committing anything; plan.json remains the edit commit point.
  const geometry = change.geometryChanged&&change.plan.geometry ? await createGeometry(change.plan.geometry) : null;
  const review = editedPlanReview(state.review, state.generationHash, change.geometryChanged, planChanges(state.plan, change.plan));
  await persistPlanUpdate(state,change.plan,geometry,review);
  return loadBundle(directory);
}

function validatePlanUpdate(state, candidate) {
  const plan = structuredClone(candidate);
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  const changed = canonical(plan) !== canonical(state.plan);
  const geometryChanged = changed && canonical(plan.geometry) !== canonical(state.plan.geometry);
  return {plan, changed, geometryChanged};
}

async function persistPlanUpdate(state,plan,geometry,review) {
  const geometryArtifact=!plan.geometry?null:geometry?await saveGeometry(state.dir,geometry):state.geometryArtifact;
  await commitState(state,{plan,review,geometry:geometryArtifact},{edit:true});
}

// Generation performs the calculations the locked plan specifies. Both modes
// may be inspected freely; development output is recorded as a preview and can
// never satisfy the final reviewed-export delivery gate.
async function generateBundle(directory, { development = false, onProgress, beforeCommit, dispatchComputation } = {}) {
  const state = await loadBundle(directory, { program: false });
  const current=await currentGenerationCandidate(directory,state);
  if(current){
    if(development||current.checks.mode==='production')return current.checks;
    await beforeCommit?.();
    const confirmed=await currentGenerationCandidate(directory,state);
    requireThat(confirmed&&confirmed.checks.mode==='development'
      &&confirmed.current.generationHash===current.current.generationHash
      &&confirmed.current.exportHash===current.current.exportHash
      &&confirmed.current.revision===current.current.revision,
    'The reviewed export changed before promotion. Generate it again.');
    return promoteReviewedGeneration(state.dir,confirmed);
  }
  if(dispatchComputation){
    const computed=await dispatchComputation({directory:state.dir,generationHash:state.generationHash});
    if(computed!==null){
      const checks=computed?.checks,source=consumeCheckedProgram(computed?.checkedProgram,
        checks?.generationHash,checks?.exportHash);
      requireThat(checks&&source,'The generation worker returned unchecked machine source.');
      pendingCheckedPrograms.retain(programKey(checks.generationHash,checks.exportHash),source);
      return checks;
    }
  }
  const prepared=await prepareGeneration(directory,{onProgress});
  return commitGeneration(directory,prepared,{development,onProgress,beforeCommit});
}

async function commitGeneration(directory,prepared,{development=false,onProgress,beforeCommit}={}){
  const {result}=prepared;
  const state=await loadBundle(directory,{program:false});
  requireThat(state.dir===prepared.directory&&state.generationHash===prepared.generationHash&&state.revision===prepared.revision,
    'The print changed during generation. Review the updated print.');
  await beforeCommit?.();
  onProgress?.({stage:'Saving your toolpath'});
  const checks=generationChecks(state,result,development);
  const committed=await persistGeneratedProgram(state,result,checks);
  verifiedProgram=committed.cachedProgram;
  return committed.checks;
}

async function currentGenerationCandidate(directory,state){
  if(!state.review.generation)return null;
  const current=await loadBundle(directory,{program:'source'});
  if(!current.program||current.programError)return null;
  const checks=current.review.generation.checks;
  requireThat(checks?.schema==='saam-checks/1'&&checks.result==='pass'
    &&checks.generationHash===current.generationHash&&checks.exportHash===current.exportHash
    &&checks.mode===current.review.generation?.mode,'Saved checks do not match the reviewed export.');
  return {checks,current};
}

async function promoteReviewedGeneration(dir,{checks,current}){
  const promoted={...checks,mode:'production'};
  const review={...current.review,generation:{...current.review.generation,mode:'production',checks:promoted},
    history:[...current.review.history,{event:'generation-reused',mode:'production',time:new Date().toISOString(),exportHash:current.exportHash}]};
  await commitState(current,{review});
  return promoted;
}

function generationChecks(state,prepared,development){
  const {bytes:code,program,summary}=prepared;
  return {
    schema: 'saam-checks/1', result: 'pass', mode: development ? 'development' : 'production',
    generatorVersion: VERSION, generationHash: state.generationHash, exportHash: hash(code),
    moves: program.moves.length,
    volumeMm3: Number(program.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((program.seconds / 60).toFixed(1)),
    travel: summary.travel,
    shortTravel: program.summary.shortTravel,
    surfaceDomain: summary.surfaceDomain ?? null,
    checks: ['plan-inputs',...(state.geometryChecks??[]),'declared-output',...(program.checks??[])],
    clearance: 'operator responsibility; no collision model implemented',
    physicalValidation: 'not performed',
    firmwareEnvelope: program.envelope??null,
    limitations: [...limitationsFor(state.plan, state.machine),...(program.limitations??[])],
    ...(program.summary.materialModel==='relay-estimate'?{materialModel:'relay-estimate',commandedVolumeMm3:program.summary.commandedVolumeMm3,estimatedRelayVolumeMm3:program.summary.estimatedRelayVolumeMm3,relayEstimateDifferenceMm3:program.summary.relayEstimateDifferenceMm3}:{})
  };
}

async function persistGeneratedProgram(state,{bytes:code,program,summary,pathArtifact},checks){
  await readPathArtifact(state.dir,pathArtifact);
  const file=exportArtifactPath(state.plan,state.machine,checks.exportHash);
  await save(resolve(state.dir,file),code);
  const review={...state.review,approvals:{},path:pathArtifact,
    generation:{mode:checks.mode,generationHash:state.generationHash,exportHash:checks.exportHash,summary,version:VERSION,file,checks},
    history:[...state.review.history,{event:'generated',mode:checks.mode,time:new Date().toISOString(),exportHash:checks.exportHash}]};
  await commitState(state,{review});
  return {checks,cachedProgram:programCacheEntry(programKey(state.generationHash,checks.exportHash),program,code)};
}

// The one human approval: current settings and the exact checked export together.
async function approve(directory, { actor, revision, program = true }) {
  const state = await loadBundle(directory,{program});
  requireThat(revision === state.revision, 'This review is stale. Reload before approving.');
  requireThat(!state.programError,state.programError);
  requireThat(state.program && !state.programError
    && state.review.generation?.mode === 'production',
  'Generate and check the production plan before toolpath approval.');
  const record = {
    actor: typeof actor==='string'?actor.trim():'Local user', time: new Date().toISOString(),
    hash: state.exportHash, generationHash: state.generationHash, scope: ['settings','toolpath']
  };
  const review=approvedReview(state.review,record);
  const committed=await commitState(state,{review});
  return {
    ...state,
    review,
    toolpathApproved:true,
    revision:revisionOf(committed)
  };
}

// Export captures the displayed result; later edits do not change that snapshot.
async function exportReviewed(state){
  return writeDelivery(state,true);
}

// Non-Studio callers retain their explicit approval API.
async function deliver(directory,{artifact=false}={}) {
  const state = await loadBundle(directory,{program:'source'});
  requireThat(state.toolpathApproved, 'Delivery requires approval of the exact current export.');
  return writeDelivery(state,artifact);
}

async function writeDelivery(state,artifact){
  const bytes = state.checkedBytes;
  const destination = resolve(state.dir, `delivery/${state.exportName}`);
  await save(destination, bytes);
  const attribution=originalSource(state.plan.geometry)?.attribution;
  if(attribution)await save(resolve(state.dir,'delivery/source-attribution.json'),{
    ...attribution,
    changes:'SAAM imported and positioned/scaled the source for printing. The saved plan records the current geometry and printing settings; consult it and any repair reports for subsequent changes.',
    planRevision:state.revision
  });
  return artifact?{file:destination,bytes,exportHash:state.exportHash}:destination;
}

async function applySettingsSnapshot(directory,selection,expectedRevision) {
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing the printer.');
  const {machine,settings}=structuredClone(selection);
  requireThat((machine===null||machine&&typeof machine==='object'&&!Array.isArray(machine))
    &&settings&&typeof settings==='object'&&!Array.isArray(settings)
    &&Object.keys(settings).every(k=>['setup','process','output','placement','skills'].includes(k)),'Invalid selected settings snapshot.');
  const plan={...state.plan,...settings};
  if(canonical(machine)===canonical(state.machine)&&canonical(plan)===canonical(state.plan))return state;
  const review=canonical(machine)===canonical(state.machine)
    ?editedPlanReview(state.review,state.generationHash,false,planChanges(state.plan,plan))
    :machineChangedReview(state.review,state.machine?.id??null,machine?.id??null);
  await commitState(state,{plan,machine,review},{edit:true});
  return loadBundle(directory,{program:false});
}

return {root,EXPORT_NAME,atomicManifest:true,proposedPlan,initBundle,loadBundle,loadBundleSnapshot,bundleFingerprint,bundleFingerprints,
  migrateBundle,prepareGeneration,commitGeneration,generateToolpath,restoreRevision,checkPathBundle,adjustBundle,updatePlan,generateBundle,approve,deliver,exportReviewed,applySettingsSnapshot};
}
