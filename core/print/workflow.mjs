import {requireThat} from '../private/bundle/numeric.mjs';
import {authoredWorkIdentity,preparedWorkEvidence} from './work-evidence.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {retainCompletedOutput,readCompletedOutput} from './completed-output.mjs';
import {completedOutputState} from './review-state.mjs';
import {checkedPhaseColours} from './phase-colours.mjs';
// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, rename, access, rm,copyFile,readdir } from 'node:fs/promises';
import {createReadStream} from 'node:fs';
async function hashFile(path){const sha=createHash('sha256');for await(const chunk of createReadStream(path))sha.update(chunk);return sha.digest('hex');}
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportAndDecodeProgram, decodeProgram, readProgramSources, outputAdapter } from '../export/registry.mjs';
import { loadMachine } from '../machine/profile.mjs';
import {runComputationJob} from './computation-job.mjs';
import {heldBundleInstance} from './studio-ownership.mjs';
import {replaceFile} from '../file-write.mjs';
import {canonicalJson,canonicalHash} from '../canonical-json.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {selectSettings,saveSetup,withMachineSetupExport} from '../machine/settings.mjs';
import {assignmentFamily as ordinaryAssignmentFamily} from './slice-settings.mjs';
import {commitManifest,revisionOf,retainContent,restoreContent,recordDelivery} from './revisions.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_SCHEMA='saam-print-bundle/2';
const nativeSuffix=geometry=>{const name=geometry.nativeFile??'model.3dm';requireThat(['model.3dm','model.mesh.json'].includes(name),'Unsupported native geometry file.');return name==='model.3dm'?'.3dm':'.mesh.json';};
const json=async file=>JSON.parse(await readFile(file,'utf8'));
function migratedIdentity(record,newName,oldName,scope) {
  if(!record||typeof record!=='object')return record;
  const hasNew=Object.hasOwn(record,newName),hasOld=Object.hasOwn(record,oldName);
  if(hasNew&&hasOld&&record[newName]!==record[oldName])throw Error(`Conflicting generation identity in ${scope}.`);
  if(!hasOld)return record;
  const next={...record,[newName]:record[newName]??record[oldName]};delete next[oldName];return next;
}
// Saved reviews from earlier releases may carry approval records; SAAM keeps none.
function migrateReview(review) {
  const {approvals:_approvals,...kept}=review??{};
  return {...kept,
    generation:migratedIdentity(review?.generation,'generationHash','planHash','review generation'),
    history:(review?.history??[]).map((event,index)=>migratedIdentity(
      migratedIdentity(event,'generationHash','planHash',`review history ${index}`),
      'previousGenerationHash','previousPlanHash',`review history ${index}`))};
}
const migrateChecks=checks=>migratedIdentity(checks,'generationHash','planHash','saved checks');
const originalSource=geometry=>geometry?.source??(geometry?.solid?originalSource(geometry.solid):geometry?.base?originalSource(geometry.base):null);
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
  const sourceInfo=Object.entries(sources).map(([name,source])=>({name,sha256:canonicalHash(source)}));
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
    version:VERSION,buildDate:BUILD_DATE,exportName:EXPORT_NAME,limitations:limitationsFor}=adapter;
  const exportName=(plan,machine)=>{
    const extension=machine.outputs.find(o=>o.id===plan.output)?.extension??'.gcode';
    requireThat(/^\.[a-z0-9.]+$/.test(extension),'Invalid export extension.');
    return EXPORT_NAME.replace(/\.gcode$/,extension);
  };
  const legacyExportPath=(plan,machine)=>{requireThat(/^[a-z0-9-]+$/.test(plan.output),'Invalid output ID.');return `exports/${plan.output}/${exportName(plan,machine)}`;};
  const exportArtifactPath=(plan,machine,exportHash)=>{requireThat(/^[a-z0-9-]+$/.test(plan.output)&&/^[a-f0-9]{64}$/.test(exportHash),'Invalid generated program reference.');return `exports/${plan.output}/${exportHash}-${exportName(plan,machine)}`;};
  // Retain only the latest verified program per adapter. Identity includes the
  // actual file bytes, not mtimes or editable review claims. Review state is
  // always read afresh; callers receive copies so they cannot alter this cache.
  let verifiedProgram;
  let inputCache={};
  // One preparation serves checking and saving unchanged inputs.
  let preparation, pathPreparation;
  const programKey=(generationHash,exportHash)=>canonicalHash([generationHash,exportHash]);
async function proposedPlan(machineId, options={}) {
  const {machine,settings}=await selectSettings(machineId,options);
  return {...await defaults(machine),...settings};
}
async function initBundle(directory, plan = {schema:'saam-shell-plan/1'}, { machineId, sourceBytes,sourcePath,preparedGeometry,attachments=[] } = {}) {
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
  plan=adapter.normalizePlan?await adapter.normalizePlan(plan):plan;
  const machine = machineId?loadMachine(machineId):machineSnapshot??null;
  requireThat(plan&&typeof plan==='object'&&!Array.isArray(plan),'Bundle contents must be a record.');
  const geometry = preparedGeometry??(plan.geometry?await createGeometry(plan.geometry):null);
  if(preparedGeometry)requirePreparedGeometry(plan.geometry,preparedGeometry);
  for(const attachment of attachments){
    requireThat(['repair/original.stl','repair/repaired.stl','repair/repair.json'].includes(attachment.file),'Unsupported import attachment.');
    const target=resolve(dir,attachment.file);await mkdir(dirname(target),{recursive:true});await copyFile(attachment.sourcePath,target);
  }
  if(originalSource(plan.geometry)){
    if(sourcePath){
      const target=resolve(dir,'geometry/source.stl'),temporary=target+'.tmp';await mkdir(dirname(target),{recursive:true});
      try{await copyFile(sourcePath,temporary);requireThat(await hashFile(temporary)===originalSource(plan.geometry).sha256,'STL source changed during import.');await rename(temporary,target);}finally{await rm(temporary,{force:true});}
    }else{requireThat(sourceBytes&&canonicalHash(sourceBytes)===originalSource(plan.geometry).sha256,'STL source bytes are required; use import-stl.');await save(resolve(dir,'geometry/source.stl'),sourceBytes);}
  }
  const geometryArtifact=await saveGeometry(dir,geometry);
  const review={schema:'saam-review/1',history:[],generation:null};
  await saveManifest(dir,{plan,machine,review,geometry:geometryArtifact,deferRememberSetup,phaseColours},null);
  return dir;
}

function requirePreparedGeometry(parameters,geometry){
  requireThat(canonicalHash(geometry.descriptor.parameters)===canonicalHash(parameters)&&canonicalHash(geometry.bytes)===geometry.descriptor.fileHash,'Prepared geometry does not match the bundle recipe.');
}
async function saveGeometry(dir, geometry) {
  if(!geometry)return null;
  const geometryHash=canonicalHash({file:canonicalHash(geometry.bytes),descriptor:geometry.descriptor});
  const file=`geometry/${geometryHash}${nativeSuffix(geometry.descriptor)}`;
  try{await access(resolve(dir,file));}catch(error){if(error.code!=='ENOENT')throw error;await save(resolve(dir,file),geometry.bytes);}
  return {hash:geometryHash,file,descriptor:geometry.descriptor};
}

const manifestDocument=({plan,machine,review,geometry,deferRememberSetup,phaseColours})=>({...plan,bundle:{schema:BUNDLE_SCHEMA,machine,review,geometry,
  ...(deferRememberSetup?{deferRememberSetup:true}:{}),...(phaseColours?{phaseColours}:{})}});
const saveManifest=(dir,state,expected)=>commitManifest(dir,manifestDocument(state),expected);

async function commitState(state,next,{edit=false,history}={}){
  const previous={plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:state.deferRememberSetup,phaseColours:state.phaseColours};
  const navigation=state.review.navigation??{past:[],future:[]};
  const nextHistory=history??(edit?{past:[...navigation.past,await retainContent(state.dir,previous)],future:[]}:navigation);
  const generation=next.review?.generation===state.review.generation&&state.review.generation?.generationHash===state.generationHash
    ?await retainCompletedOutput(state,state.review.generation):next.review?.generation;
  const review={...next.review,generation,navigation:nextHistory};
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
  const review={...state.review,path:restored.path,
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
  const bytes=await readFile(resolve(dir,legacyFile)),geometryHash=canonicalHash({file:canonicalHash(bytes),descriptor});
  inputs.set(legacyFile,bytes);
  const geometry={hash:geometryHash,file:`geometry/${geometryHash}${nativeSuffix(descriptor)}`,descriptor};
  const artifacts=new Map([[geometry.file,bytes]]);let programBytes=null;
  if(review.generation){
    const oldProgram=resolve(dir,legacyExportPath(document,machine)),code=await readFile(oldProgram),exportHash=canonicalHash(code);
    inputs.set(legacyExportPath(document,machine),code);programBytes=code;
    requireThat(exportHash===review.generation.exportHash,'Legacy generated files changed; regenerate before migration.');
    const file=exportArtifactPath(document,machine,exportHash);artifacts.set(file,code);
    review.generation={...review.generation,file,checks:legacyChecks?migrateChecks(legacyChecks):null};
  }
  const state={plan:document,machine,review,geometry};
  const manifest=manifestDocument(state),preflight=await validateBundleInput({dir,planText:JSON.stringify(manifest),...state,bytes},{});
  if(preflight.error)throw preflight.error;
  const source=originalSource(document.geometry);
  if(source){const sourceBytes=await readFile(resolve(dir,'geometry/source.stl'));inputs.set('geometry/source.stl',sourceBytes);requireThat(canonicalHash(sourceBytes)===source.sha256,'Imported STL source changed; repair it before migration.');}
  const programStatus=!review.generation?'none':review.generation.generationHash===preflight.identity.generationHash?'current':'stale';
  if(programStatus==='current')decodeProgram(programBytes,document,machine);
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
    verification:{geometryHash:state.geometryHash,exportHash:state.exportHash??null,programError:state.programError??null}};
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
  if(source){const sourceBytes=await readFile(resolve(dir,'geometry/source.stl'));requireThat(canonicalHash(sourceBytes)===source.sha256,'Imported source changed; repair it before recipe migration.');inputs.set('geometry/source.stl',sourceBytes);}
  await beforeCommit?.();await requireLegacyCurrent(dir,inputs);
  await commitState({dir,plan:previous,machine,geometryArtifact:geometry,review:migrateReview(bundle.review),revision:revisionOf(document)},state,{edit:true});
  const reopened=await loadBundle(dir,{program:false});
  return {status:'migrated',directory:dir,changes,created:[],updated:['plan.json'],removed:[],retained:before.filter(name=>name!=='plan.json'),
      verification:{geometryHash:reopened.geometryHash,generation:reopened.review.generation,revision:reopened.revision}};
}

async function readBundleInput(directory) {
  const dir = resolve(directory);
  let planText=await readFile(resolve(dir,'plan.json'),'utf8'),document=JSON.parse(planText),state;
  if(document.bundle?.schema===BUNDLE_SCHEMA){
    const {bundle,...plan}=document,review=migrateReview(bundle.review);
    if(review.generation?.checks)review.generation={...review.generation,checks:migrateChecks(review.generation.checks)};
    requireThat(bundle.deferRememberSetup===undefined||typeof bundle.deferRememberSetup==='boolean','Invalid bundle setup remembering preference.');
    state={plan,machine:bundle.machine,review,geometry:bundle.geometry,revision:revisionOf(document),deferRememberSetup:bundle.deferRememberSetup===true,
      phaseColours:checkedPhaseColours(bundle.phaseColours,'Bundle phaseColours')};
  }else{
    throw Error(`Legacy split-file bundle requires explicit migration. Use saam call migrate_bundle with the bundleId, or offline source maintenance; see core/application/README.md#offline-maintenance.`);
  }
  requireThat(state.geometry===null&&!state.plan.geometry||state.geometry&&/^[a-f0-9]{64}$/.test(state.geometry.hash)
    &&new RegExp(`^geometry/${state.geometry.hash.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.(?:3dm|mesh\\.json)$`).test(state.geometry.file),
  'Invalid geometry artifact reference.');
  const bytes=state.geometry?await readFile(resolve(dir,state.geometry.file)):null;
  return {dir,planText,...state,bytes};
}

async function validateBundleInput(input,previousCache) {
  const {dir,planText,plan,review,machine,geometry,bytes,revision,deferRememberSetup,phaseColours}=input;
  const cache={...previousCache};
  try {
    // Read current bytes at every boundary, but canonicalize large mesh/plan
    // trees only when those bytes change. Keep the established semantic hashes
    // so formatting alone does not invalidate a person's recorded approval.
    const fileHash=canonicalHash(bytes),identityKey=canonicalHash([canonicalHash(planText),fileHash]);
    let identity=cache.identity;
    if(identity?.key!==identityKey){
      const geometryHash=geometry?canonicalHash({file:fileHash,descriptor:geometry.descriptor}):canonicalHash(null);
      requireThat(!geometry||geometryHash===geometry.hash,'Saved geometry artifact changed; rebuild the print geometry.');
      requireThat(!geometry||geometry.file===`geometry/${geometry.hash}${nativeSuffix(geometry.descriptor)}`,'Invalid geometry artifact reference.');
      if(review.generation)requireThat(/^[a-f0-9]{64}$/.test(review.generation.exportHash)&&new RegExp(`^exports/[a-z0-9-]+/${review.generation.exportHash}-[a-z0-9.-]+$`).test(review.generation.file),
        'Invalid generated program reference. Regenerate the print.');
      requireThat(canonicalJson(plan.geometry)===canonicalJson(geometry?.descriptor.parameters),'Plan and geometry disagree. Rebuild the print geometry.');
      identity={key:identityKey,...authoredWorkIdentity(plan,machine),geometryHash,geometryInputHash:adapter.geometryInput?canonicalHash(adapter.geometryInput(plan)):geometryHash,editRevision:canonicalHash({plan,machine,geometryHash}),pathHash:canonicalHash(adapter.pathDependencies?adapter.pathDependencies(plan,machine):{plan,machine}),generationHash:canonicalHash({plan,machine,geometryHash,...(adapter.generationContract?{generationContract:adapter.generationContract}:{})})};
      cache.identity=identity;
    }
    return {dir,plan,machine,geometry:geometry?.descriptor??null,geometryArtifact:geometry,geometryChecks:[],review,identity,cache,revision,deferRememberSetup,phaseColours};
  } catch(error) {return {cache,error};}
}

async function describeBundle({dir,plan,machine,geometry,geometryArtifact,geometryChecks,review,identity,revision,deferRememberSetup,phaseColours},program) {
  const {geometryHash,geometryInputHash,generationHash,pathHash,editRevision}=identity;
  geometry=adapter.presentGeometry?await adapter.presentGeometry(plan,geometry):geometry;
  const artifacts={geometry:geometry?'current':'absent',path:!review.path?'absent':review.path.inputHash===pathHash?'current':'stale',program:!review.generation?'absent':review.generation.generationHash===generationHash?'current':'stale'};
  const workEvidence=preparedWorkEvidence(identity,revision,review.generation);
  const history={canUndo:Boolean(review.navigation?.past.length),canRedo:Boolean(review.navigation?.future.length)};
  if(!machine){
    const state={kind,dir,plan,machine:null,geometry,geometryChecks,review,geometryHash,geometryInputHash,generationHash,programChecked:false,exportName:null,limitations:[],skills:[],setupBasis:null,outputAvailability:'Ask the agent to supply a printer, material and toolpath recipe.'};
    Object.assign(state,{revision,editRevision,pathHash,artifacts,history,workEvidence,deferRememberSetup,phaseColours});Object.defineProperty(state,'geometryArtifact',{value:geometryArtifact,enumerable:false});return state;
  }
  const state = {
    kind, dir, plan, machine, geometry, geometryChecks, review, geometryHash, geometryInputHash, generationHash, programChecked:Boolean(program&&review.generation),
    exportName: exportName(plan,machine), limitations: limitationsFor(plan, machine),
    outputAvailability:machine.outputs.find(o=>o.id===plan.output)?.implemented===false?`Machine-file export for ${machine.name} is not available yet; geometry and settings can be reviewed.`:null,
    skills: [...new Set((plan.slices?.assignments??[]).map(assignment=>assignment.construction==='sleeve'
      ?'trace':ordinaryAssignmentFamily(assignment))),
      ...Object.entries(plan.skills??{}).filter(([,settings])=>settings?.enabled).map(([name])=>name)]
  };
  Object.assign(state,{revision,editRevision,pathHash,artifacts,history,workEvidence,deferRememberSetup,phaseColours});
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
      const output=await readCompletedOutput(input,adapter.geometryInput,adapter.presentGeometry),code=output.bytes;
      const exportHash=output.generation.exportHash,key=programKey(output.generation.generationHash,exportHash);observedExportHash=exportHash;
      if(cachedProgram?.key!==key||(program!=='source'&&!cachedProgram.program)) {
        // Source viewing extracts checked artifact bytes without motion decoding.
        // Metadata is descriptive; only full-motion callers execute the player.
        if(program==='source'){
          const sources=readProgramSources(code,output.plan,output.machine);
          const metadata=output.generation.programMetadata??{summary:{shortTravel:output.generation.checks.shortTravel,
            volumeMm3:output.generation.checks.volumeMm3,estimatedMinutes:output.generation.checks.estimatedMinutes},
            limitations:output.generation.checks.limitations??[]};
          cachedProgram={key,bytes:Buffer.from(code),program:null,code:sources.program??Object.values(sources)[0],sources,
            metadata:{...metadata,sources:Object.entries(sources).map(([name,text])=>({name,sha256:canonicalHash(text)}))}};
        }else cachedProgram=programCacheEntry(key,decodeProgram(code,output.plan,output.machine),code);
      }
      state.programChecked=true;
      state.program = structuredClone(program==='source'?cachedProgram.metadata:cachedProgram.program);
      state.limitations=[...new Set([...state.limitations,...(state.program.limitations??[])])];
      state.pathSummary = structuredClone(review.generation.summary??{});
      state.exportHash = exportHash;
      state.completedOutput={id:output.id,current:review.generation.generationHash===generationHash&&canonicalJson(review.path)===canonicalJson(output.path),
        plan:output.plan,machine:output.machine,geometry:output.geometry,geometryHash:output.geometryHash,geometryInputHash:output.geometryInputHash,generationHash:output.generation.generationHash,
        exportHash,inputRevision:output.generation.inputRevision??null,exportName:exportName(output.plan,output.machine),review:{generation:output.generation},
        limitations:limitationsFor(output.plan,output.machine),pathHash:output.path?.inputHash??null};
      state.exportName=state.completedOutput.exportName;
      state.code = cachedProgram.code;
      Object.defineProperty(state,'checkedBytes',{value:Buffer.from(cachedProgram.bytes),enumerable:false});
      if(allSources)state.sources={...cachedProgram.sources};
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
  const fingerprints={source:canonicalHash([canonicalHash(input.planText),validated.identity.geometryHash,
      originalSource(plan.geometry)?.sha256??null,program?restored.observedExportHash:null]),
    presentation:canonicalHash([['plan',canonicalHash(plan)],['machine',canonicalHash(machine)],['geometry',validated.identity.geometryHash],
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

// Feasibility inspection through the same generator, without persisted output.
async function checkPathBundle(directory, {onProgress} = {}) {
  const candidate=await prepareGeneration(directory,{onProgress}),result=candidate.result;
  return {mode:'development-check-only',revision:candidate.revision,
    ...structuredClone(result.summary),exportSummary:structuredClone(result.program.summary)};
}

async function prepareGeneration(directory,{onProgress}={}){
  const state=await loadBundle(directory,{program:false}),source=await generationSource(state.plan);
  requireThat(state.machine,'Supply a machine, material and toolpath recipe before generation.');
  // A profile without an output contract refuses before geometry or motion is built.
  outputAdapter(state.plan,state.machine);
  const key=canonicalHash([state.dir,state.generationHash,source.release,source.hash??state.review.path?.source?.hash]);
  if(preparation?.key!==key)preparation={key};
  const candidate=preparation;
  if(!candidate.result)candidate.result=Promise.resolve().then(async()=>{
    onProgress?.({stage:'Preparing geometry'});
    const {path,artifact}=await prepareToolpath(state,{onProgress,source});
    onProgress?.({stage:'Writing machine commands'});
    try{return {pathArtifact:artifact,summary:path.summary,...exportAndDecodeProgram(path,state.plan,state.machine,{generatorVersion:VERSION,buildDate:BUILD_DATE})};}
    catch(error){error.stage='export';throw error;}
  }).catch(error=>{candidate.result=null;throw error;});
  const result=await candidate.result;
  return {directory:state.dir,revision:state.revision,generationHash:state.generationHash,source:{release:source.release,hash:source.hash},result};
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
  const key=canonicalHash([state.dir,state.pathHash,source.release,source.hash??state.review.path?.source?.hash]);
  if(pathPreparation?.key===key){onProgress?.({stage:'Reusing neutral SAAMpath'});return pathPreparation.result;}
  const result=(async()=>{
    const saved=state.review.path;
    if(saved?.inputHash===state.pathHash&&!staleGenerationSource(state,source)){
      const path=await readPathArtifact(state.dir,saved);
      onProgress?.({stage:'Reusing saved SAAMpath'});
      requireThat(!adapter.completionContract||path.completion?.contract===adapter.completionContract&&path.completion.inputHash===state.pathHash,'Saved SAAMpath completion does not match its inputs.');
      return {path,artifact:saved};
    }
    if(source.missing)throw source.missing;
    const path=await generatePath(state.plan,{onProgress}).catch(error=>requireMigrated(state,error));
    requireThat(!adapter.completionContract||path.completion?.contract===adapter.completionContract&&path.completion.inputHash===state.pathHash,'Generated SAAMpath completion does not match its inputs.');
    const bytes=JSON.stringify(path),contentHash=canonicalHash(bytes),file=`paths/${contentHash}.json`;
    await save(resolve(state.dir,file),bytes);
    return {path,artifact:{inputHash:state.pathHash,hash:contentHash,file,...(source.hash!==null?{source:{release:source.release,hash:source.hash}}:{})}};
  })();
  pathPreparation={key,result};
  try{return await result;}catch(error){if(pathPreparation?.result===result)pathPreparation=null;throw error;}
}

// Migration stays explicit: a generation failure on a recipe that migration
// would update names migrate_bundle; any other failure is reported unchanged.
async function requireMigrated(state,error){
  const migrates=await import('./recipe-migration.mjs')
    .then(({migrateRecipeFields})=>migrateRecipeFields(state.plan,state.machine).changes.length>0).catch(()=>false);
  if(migrates)throw Error(`${error.message} This recipe predates the current format: run saam call migrate_bundle with the bundleId, then generate again.`,{cause:error});
  throw error;
}

async function readPathBytes(dir,artifact){
  requireThat(/^[a-f0-9]{64}$/.test(artifact.hash)&&artifact.file===`paths/${artifact.hash}.json`,'Invalid SAAMpath reference.');
  const bytes=await readFile(resolve(dir,artifact.file));
  requireThat(canonicalHash(bytes)===artifact.hash,'Saved SAAMpath changed; regenerate it.');
  return bytes;
}
async function readPathArtifact(dir,artifact){return JSON.parse(await readPathBytes(dir,artifact));}
async function readToolpath(state){
  requireThat(state.artifacts.path==='current'&&state.review.path,'The saved SAAMpath changed. Reload before viewing.');
  return readPathBytes(state.dir,state.review.path);
}

// Authored SAAMpath can be saved before choosing a machine-program output.
async function generateToolpath(directory,{onProgress,beforeCommit}={}){
  const {state,source}=await activeGenerationState(directory);
  const {artifact}=await prepareToolpath(state,{onProgress,source});
  await beforeCommit?.();
  await readPathArtifact(state.dir,artifact);
  await requireGenerationSource(state,source);
  await commitState(state,{review:{...state.review,path:artifact}});
  return loadBundle(directory,{program:false});
}

// Chat-driven adjustment: the agent applies a patch, the plan is revalidated,
// and dependent output becomes stale. An unknown key is refused here as well
// as in the plan check, so a misspelled setting never silently does nothing.
async function adjustBundle(directory, patch, { expectedRevision, expectedEditRevision } = {}) {
  const state = await loadBundle(directory, { program: false });
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const plan = patchPlan?await patchPlan(state.plan,patch):applyPlanPatch(state.plan, patch, geometryTemplate);
  const updated=await updatePlan(directory, plan, state.revision,{expectedEditRevision});
  return updated;
}


async function updatePlan(directory, plan, revision, {preparedGeometry,expectedEditRevision} = {}) {
  const state = await loadBundle(directory, { program: false });
  requireEditRevision(state,{expectedRevision:revision,expectedEditRevision});
  plan=adapter.normalizePlan?await adapter.normalizePlan(plan):plan;
  if(!Object.hasOwn(plan,'workspace')&&Object.hasOwn(state.plan,'workspace'))plan={...plan,workspace:state.plan.workspace};
  const change = validatePlanUpdate(state, plan);
  const source=await generationSource(change.plan),sourceChanged=staleGenerationSource(state,source);
  if (!change.changed&&!sourceChanged) return state;

  // Build before committing anything; plan.json remains the edit commit point.
  if(preparedGeometry)requirePreparedGeometry(change.plan.geometry,preparedGeometry);
  const geometry = change.geometryChanged&&change.plan.geometry ? preparedGeometry??await createGeometry(change.plan.geometry) : null;
  const review = editedPlanReview(sourceChanged?sourceInvalidatedReview(state.review):state.review, state.generationHash, change.geometryChanged, planChanges(state.plan, change.plan));
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
      &&confirmed.current.generationHash===current.current.generationHash
      &&confirmed.current.exportHash===current.current.exportHash
      &&confirmed.current.revision===current.current.revision,
    'The reviewed export changed before promotion. Generate it again.');
    return promoteReviewedGeneration(state.dir,confirmed);
  }
  return runComputationJob(new URL('./generation-worker.mjs',import.meta.url),
    {directory:state.dir,generationHash:state.generationHash,development,instance:heldBundleInstance(state.dir)},
    {signal,progress:onProgress,beforeCommit:beforeCommit??(()=>{})});
}

async function commitGeneration(directory,prepared,{development=false,onProgress,beforeCommit}={}){
  const {result}=prepared;
  const state=await loadBundle(directory,{program:false});
  requireThat(state.dir===prepared.directory&&state.generationHash===prepared.generationHash&&state.revision===prepared.revision,
    'The print changed during generation. Review the updated print.');
  await beforeCommit?.();
  await requireGenerationSource(state,prepared.source);
  onProgress?.({stage:'Saving your toolpath'});
  const checks=generationChecks(state,result,development);
  const committed=await persistGeneratedProgram(state,result,checks);
  verifiedProgram=committed.cachedProgram;
  return committed.checks;
}

async function currentGenerationCandidate(directory,state){
  if(!state.review.generation)return null;
  const current=await loadBundle(directory,{program:'source'});
  if(!current.program||current.programError||!current.completedOutput?.current)return null;
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
    generatorVersion: VERSION, generationHash: state.generationHash, exportHash: canonicalHash(code),
    moves: program.moves.length,
    volumeMm3: Number(program.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((program.seconds / 60).toFixed(1)),
    travel: summary.travel,
    shortTravel: program.summary.shortTravel,
    surfaceDomain: summary.surfaceDomain ?? null,
    limitations: [...limitationsFor(state.plan, state.machine),...(program.limitations??[])],
    ...(program.summary.materialModel==='relay-estimate'?{materialModel:'relay-estimate',commandedVolumeMm3:program.summary.commandedVolumeMm3,estimatedRelayVolumeMm3:program.summary.estimatedRelayVolumeMm3,relayEstimateDifferenceMm3:program.summary.relayEstimateDifferenceMm3}:{})
  };
}

async function persistGeneratedProgram(state,{bytes:code,program,summary,pathArtifact},checks){
  await readPathArtifact(state.dir,pathArtifact);
  const file=exportArtifactPath(state.plan,state.machine,checks.exportHash);
  await save(resolve(state.dir,file),code);
  const cachedProgram=programCacheEntry(programKey(state.generationHash,checks.exportHash),program,code);
  const {sources,...programMetadata}=cachedProgram.metadata;
  const generation=await retainCompletedOutput(state,{mode:checks.mode,generationHash:state.generationHash,exportHash:checks.exportHash,summary,version:VERSION,file,checks,programMetadata},pathArtifact);
  const review={...state.review,path:pathArtifact,generation,
    history:[...state.review.history,{event:'generated',mode:checks.mode,time:new Date().toISOString(),exportHash:checks.exportHash}]};
  await commitState(state,{review});
  return {checks,cachedProgram};
}

// The person's Export in Studio is the one confirmation: it writes the displayed
// result, and later edits do not change that snapshot.
async function exportReviewed(state,{machineSetups}={}){
  const live=await loadBundle(state.dir,{program:'source'});
  requireThat(completedOutputState(live).exportable&&state.completedOutput?.id===live.completedOutput.id
    &&state.checkedBytes&&canonicalHash(state.checkedBytes)===live.exportHash,'The displayed program changed. Reload before exporting.');
  return writeDelivery({...state,checkedBytes:state.checkedBytes,plan:live.completedOutput.plan,machine:live.completedOutput.machine,
    exportName:live.completedOutput.exportName,exportHash:live.exportHash,deferRememberSetup:live.deferRememberSetup},true,machineSetups);
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
    artifactId:output.id,inputRevision:output.inputRevision??null,generationHash:output.generationHash,exportHash:state.exportHash});}
  catch(error){const failure=Error('The export was copied to '+destination+', but recording its delivery failed: '+error.message,{cause:error});
    failure.code='DELIVERY_RECORD_FAILED';failure.delivered={file:destination,exportHash:state.exportHash,artifactId:output.id};throw failure;}
  if(machineSetups)try{await saveSetup(output.machine,output.plan.setup,{machineSetups,exportReceipt:{
    directory:state.dir,artifactId:output.id,inputRevision:output.inputRevision??null,generationHash:output.generationHash,exportHash:state.exportHash}});}
  catch(error){const failure=Error('The export was copied to '+destination+', but remembering its machine setup failed: '+error.message,{cause:error});
    failure.code='EXPORTED_SETUP_SAVE_FAILED';failure.delivered={file:destination,exportHash:state.exportHash,artifactId:output.id};throw failure;}
  return artifact?{file:destination,bytes,exportHash:state.exportHash}:destination;
}

async function setDeferredSetupSave(directory,{defer,expectedRevision}){
  requireThat(typeof defer==='boolean','Supply whether this bundle defers remembering its exported machine setup.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This revision is stale. Reload before changing setup remembering.');
  if(state.deferRememberSetup===defer)return {directory:state.dir,revision:state.revision,deferRememberSetup:defer};
  const committed=await saveManifest(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:defer,phaseColours:state.phaseColours},state.revision);
  return {directory:state.dir,revision:revisionOf(committed),deferRememberSetup:defer};
}

// Display only: the choice replaces the print's previous one and changes no
// recipe, path or program identity.
async function setPhaseColours(directory,{phaseColours,expectedRevision}){
  const choice=checkedPhaseColours(phaseColours),state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This revision is stale. Reload before changing phase colours.');
  if(canonicalJson(choice)===canonicalJson(state.phaseColours))return {directory:state.dir,revision:state.revision,phaseColours:choice};
  const committed=await saveManifest(state.dir,{plan:state.plan,machine:state.machine,geometry:state.geometryArtifact,review:state.review,deferRememberSetup:state.deferRememberSetup,phaseColours:choice},state.revision);
  return {directory:state.dir,revision:revisionOf(committed),phaseColours:choice};
}

async function applySettingsSnapshot(directory,selection,expectedRevision,{expectedEditRevision}={}) {
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const {machine,settings}=structuredClone(selection);
  requireThat((machine===null||machine&&typeof machine==='object'&&!Array.isArray(machine))
    &&settings&&typeof settings==='object'&&!Array.isArray(settings)
    &&Object.keys(settings).every(k=>['setup','process','output','placement','skills'].includes(k)),'Invalid selected settings snapshot.');
  const plan={...state.plan,...settings};
  const source=await generationSource(plan),sourceChanged=staleGenerationSource(state,source);
  if(canonicalJson(machine)===canonicalJson(state.machine)&&canonicalJson(plan)===canonicalJson(state.plan)&&!sourceChanged)return state;
  const previousReview=sourceChanged?sourceInvalidatedReview(state.review):state.review;
  const review=canonicalJson(machine)===canonicalJson(state.machine)
    ?editedPlanReview(previousReview,state.generationHash,false,planChanges(state.plan,plan))
    :machineChangedReview(previousReview,state.machine?.id??null,machine?.id??null);
  await commitState(state,{plan,machine,review},{edit:true});
  return loadBundle(directory,{program:false});
}

return {root,EXPORT_NAME,atomicManifest:true,proposedPlan,initBundle,loadBundle,loadBundleSnapshot,bundleFingerprint,bundleFingerprints,
  migrateBundle,readToolpath,prepareGeneration,commitGeneration,generateToolpath,restoreRevision,checkPathBundle,adjustBundle,updatePlan,generateBundle,exportReviewed,setDeferredSetupSave,setPhaseColours,applySettingsSnapshot};
}
