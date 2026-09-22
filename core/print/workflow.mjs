// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, rename, access, rm,copyFile,readdir } from 'node:fs/promises';
import {hashFile} from '../geom/stl-file.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportAndInterpretProgram, interpretProgram, outputAdapter } from '../export/registry.mjs';
import { loadMachine, validateDobotConfiguration, lineWidthLimits } from '../machine/profile.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {validateDensoConfiguration} from '../machine/denso.mjs';
import {consumeCheckedProgram,createPendingCheckedProgramStore} from './program-handoff.mjs';
import {replaceFile} from '../file-write.mjs';
import {resolveInitialPlan,resolveMachinePlan,resolvePlanPatch} from './resolve-plan.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const setupFor=machine=>resolve(root,`.local/machine-setups/${machine.id}.json`);
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
const originalSource=geometry=>geometry?.source??(['text','heat-set'].includes(geometry?.shape)?originalSource(geometry.base):null);
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
  return {key,program:motion,code:text,sources,metadata:{...metadata,sources:sourceInfo}};
}

export function applyPlanPatch(previous, patch, geometryTemplate) {
  return resolvePlanPatch(previous,patch,{geometryTemplate});
}

export function editedPlanReview(review, previousGenerationHash, geometryChanged, time = new Date().toISOString()) {
  const event = {event:'plan-edited', time, previousGenerationHash, geometryChanged, invalidated:['toolpath']};
  return invalidateReview(review,event);
}

function invalidateReview(review,event) {
  return {...review, history:[...review.history,event], approvals:{}, generation:null};
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
  const {kind,defaults,validatePlan,createGeometry,verifyGeometry,generatePath,geometryTemplate,
    version:VERSION,buildDate:BUILD_DATE,exportName:EXPORT_NAME,limitations:limitationsFor}=adapter;
  const machineFile=resolve(root,adapter.machineFile);
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
  const programKey=(generationHash,exportHash)=>hash([generationHash,exportHash]);
async function proposedPlan(machineId, { setupFile } = {}) {
  const machine = machineId ? loadMachine(machineId) : await json(machineFile);
  const remembered = await rememberedSetup(setupFile ?? setupFor(machine), machine);
  return resolveInitialPlan(machine,{defaults,rememberedSetup:remembered,fit:fitLineWidthToSetup});
}
function fitLineWidthToSetup(plan,machine) {
  if(!machine.tools.some(candidate=>candidate.index===plan.setup.tool))return;
  const limits=lineWidthLimits(plan,machine);
  if(limits&&(plan.process.lineWidthMm<limits[0]||plan.process.lineWidthMm>limits[1]))
    plan.process.lineWidthMm=Math.min(limits[1],Math.max(limits[0],plan.setup.nozzleMm));
}
async function initBundle(directory, plan, { setupFile, machineId, sourceBytes,sourcePath } = {}) {
  const dir = resolve(directory);
  try {
    await access(resolve(dir, 'plan.json'));
    throw new Error('Print already exists. Open it or choose another directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  if(plan?.bundle){
    const {bundle,...recipe}=plan;
    plan=recipe;
    machineId??=bundle.machine?.id;
  }
  const machine = machineId?loadMachine(machineId):await json(machineFile);
  setupFile??=setupFor(machine);
  if (!plan) plan = await proposedPlan(machine.id, { setupFile });
  validatePlan(plan, machine);
  const geometry = await createGeometry(plan.geometry);
  if(originalSource(plan.geometry)){
    if(sourcePath){
      const target=resolve(dir,'geometry/source.stl'),temporary=target+'.tmp';await mkdir(dirname(target),{recursive:true});
      try{await copyFile(sourcePath,temporary);requireThat(await hashFile(temporary)===originalSource(plan.geometry).sha256,'STL source changed during import.');await rename(temporary,target);}finally{await rm(temporary,{force:true});}
    }else{requireThat(sourceBytes&&hash(sourceBytes)===originalSource(plan.geometry).sha256,'STL source bytes are required; use import-stl.');await save(resolve(dir,'geometry/source.stl'),sourceBytes);}
  }
  const geometryArtifact=await saveGeometry(dir,geometry);
  const review={schema:'saam-review/1',approvals:{},history:[],generation:null};
  await saveManifest(dir,{plan,machine,review,geometry:geometryArtifact});
  return dir;
}

async function saveGeometry(dir, geometry) {
  const geometryHash=hash({file:hash(geometry.bytes),descriptor:geometry.descriptor});
  const file=`geometry/${geometryHash}${nativeSuffix(geometry.descriptor)}`;
  try{await access(resolve(dir,file));}catch(error){if(error.code!=='ENOENT')throw error;await save(resolve(dir,file),geometry.bytes);}
  return {hash:geometryHash,file,descriptor:geometry.descriptor};
}

const manifestDocument=({plan,machine,review,geometry})=>({...plan,bundle:{schema:BUNDLE_SCHEMA,machine,review,geometry}});
const saveManifest=(dir,state)=>save(resolve(dir,'plan.json'),manifestDocument(state));

// Remembered setup is an editable starting point. Only fields this pipeline
// already has are taken, so a setup saved by another skill cannot introduce one.
async function rememberedSetup(setupFile, machine) {
  let saved;
  try { saved = await json(setupFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  requireThat(saved.schema === 'saam-machine-setup/1' && saved.machineId === machine.id, 'Saved machine setup is incompatible.');
  const known = defaults(machine).setup;
  return Object.fromEntries(Object.entries(saved.setup ?? {}).filter(([key]) => Object.hasOwn(known, key)));
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
  if(programStatus==='current')interpretProgram(programBytes,document,machine);
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
  if(document.bundle?.schema===BUNDLE_SCHEMA)return {status:'current',directory:dir,created:[],updated:[],removed:[],retained:before};
  const prepared=await prepareLegacyMigration(dir,document,planText),created=[],retained=new Set(before);
  await requireLegacyCurrent(dir,prepared.inputs);
  for(const [name,bytes] of prepared.artifacts){
    try{
      const existing=await readFile(resolve(dir,name));
      requireThat(existing.equals(bytes),`Migration target already exists with different bytes: ${name}.`);
    }catch(error){if(error.code!=='ENOENT')throw error;created.push(name);}
  }
  let manifestCommitted=false;
  const manifestBytes=Buffer.from(`${JSON.stringify(prepared.manifest,null,2)}\n`);
  try{
    for(const name of created)await save(resolve(dir,name),prepared.artifacts.get(name));
    await beforeCommit?.();
    await requireLegacyCurrent(dir,prepared.inputs);
    await save(planFile,prepared.manifest);manifestCommitted=true;
    const state=await loadBundle(dir,{program:'source'});
    return {status:'migrated',directory:dir,created,updated:['plan.json'],removed:[],retained:[...retained].filter(name=>name!=='plan.json'),
      legacyProgram:prepared.programStatus,
      verification:{geometryHash:state.geometryHash,exportHash:state.exportHash??null,toolpathApproved:state.toolpathApproved,programError:state.programError??null}};
  }catch(error){
    if(manifestCommitted){
      const current=await readFile(planFile).catch(()=>null);
      if(current?.equals(manifestBytes))await save(planFile,planText).catch(()=>{});
    }
    const planUnchanged=await readFile(planFile).then(actual=>actual.equals(Buffer.from(planText)),()=>false);
    if(planUnchanged)await Promise.all(created.map(name=>rm(resolve(dir,name),{force:true})));
    throw error;
  }
}

async function readBundleInput(directory) {
  const dir = resolve(directory);
  let planText=await readFile(resolve(dir,'plan.json'),'utf8'),document=JSON.parse(planText),state;
  if(document.bundle?.schema===BUNDLE_SCHEMA){
    const {bundle,...plan}=document,review=migrateReview(bundle.review);
    if(review.generation?.checks)review.generation={...review.generation,checks:migrateChecks(review.generation.checks)};
    state={plan,machine:bundle.machine,review,geometry:bundle.geometry};
  }else{
    throw Error(`Legacy split-file bundle requires explicit migration. Run: node core/print/cli.mjs migrate ${JSON.stringify(dir)}`);
  }
  requireThat(state.geometry&&/^[a-f0-9]{64}$/.test(state.geometry.hash)
    &&new RegExp(`^geometry/${state.geometry.hash.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.(?:3dm|mesh\\.json)$`).test(state.geometry.file),
  'Invalid geometry artifact reference.');
  const bytes=await readFile(resolve(dir,state.geometry.file));
  return {dir,planText,...state,bytes};
}

async function validateBundleInput(input,previousCache) {
  const {dir,planText,plan,review,machine,geometry,bytes}=input;
  const cache={...previousCache};
  try {
    // Read current bytes at every boundary, but canonicalize large mesh/plan
    // trees only when those bytes change. Keep the established semantic hashes
    // so formatting alone does not invalidate a person's recorded approval.
    const fileHash=hash(bytes),identityKey=hash([hash(planText),fileHash]);
    let identity=cache.identity;
    if(identity?.key!==identityKey){
      const geometryHash=hash({file:fileHash,descriptor:geometry.descriptor});
      requireThat(geometryHash===geometry.hash,'Saved geometry artifact changed; rebuild the print geometry.');
      requireThat(geometry.file===`geometry/${geometry.hash}${nativeSuffix(geometry.descriptor)}`,'Invalid geometry artifact reference.');
      if(review.generation)requireThat(review.generation.file===exportArtifactPath(plan,machine,review.generation.exportHash),
        'Invalid generated program reference. Regenerate the print.');
      const inputsHash=hash({plan,machine});
      if(cache.verifiedGeometryHash!==geometryHash){
        await verifyGeometry(bytes,geometry.descriptor);
        cache.verifiedGeometryHash=geometryHash;
      }
      if(cache.validatedInputsHash!==inputsHash){
        validatePlan(plan,machine);
        cache.validatedInputsHash=inputsHash;
        cache.validatedPlanText=JSON.stringify(plan);
      }
      requireThat(canonical(plan.geometry)===canonical(geometry.descriptor.parameters),'Plan and geometry disagree. Rebuild the print geometry.');
      identity={key:identityKey,geometryHash,generationHash:hash({plan,machine,geometryHash})};
      cache.identity=identity;
    }
    return {dir,plan,machine,geometry:geometry.descriptor,geometryArtifact:geometry,review,identity,cache};
  } catch(error) {return {cache,error};}
}

async function describeBundle({dir,plan,machine,geometry,geometryArtifact,review,identity},program) {
  const {geometryHash,generationHash}=identity;
  if(originalSource(plan.geometry))requireThat(await hashFile(resolve(dir,'geometry/source.stl'))===originalSource(plan.geometry).sha256,'Imported STL source changed; reload the current geometry.');
  const state = {
    kind, dir, plan, machine, geometry, review, geometryHash, generationHash, programChecked:Boolean(program),
    exportName: exportName(plan,machine), limitations: limitationsFor(plan, machine),
    outputAvailability:machine.outputs.find(o=>o.id===plan.output)?.implemented===false?`Machine-file export for ${machine.name} is not available yet; geometry and settings can be reviewed.`:null,
    skills: plan.composition?.regions?.length
      ? [...new Set([...plan.composition.regions.flatMap(region=>Object.keys(region.skills)),...['supports','rimming-planar','rimming-normal','wave-overhangs'].filter(name=>plan.skills?.[name]?.enabled)])]
      : plan.skills ? Object.entries(plan.skills).filter(([, settings]) => settings.enabled).map(([name]) => name) : []
  };
  if(machine.id==='denso-vp6242-rc8'){
    state.machineConfiguration=validateDensoConfiguration(plan);
    if(!state.machineConfiguration.configured)state.outputAvailability='DENSO installation is unconfigured. Supply tool/work frames, figure, arm group, relay and the rotary control interface before generation.';
  }
  if(machine.id==='dobot-mg400'){
    state.machineConfiguration=validateDobotConfiguration(plan,machine);
    if(!state.machineConfiguration.configured)state.outputAvailability='Dobot installation is unconfigured; geometry can be reviewed. Supply frame, calibration, workspace, initial pose, controller limits and relay/thermal setup before generation.';
  }
  state.toolpathApproved = false;
  state.revision = hash({ geometryHash, generationHash, review });
  state.setupBasis = plan.setup.startupVerified
    ? 'Confirmed startup behavior'
    : machine.startup.validation;

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
      if(cachedProgram?.key!==key||(program!=='source'&&!cachedProgram.program)) {
        // Reopen the saved machine program. Interpretation checks the actual
        // commands; reopening never invokes a slicing skill or exporter. Source
        // requests can reuse their job's checked result after the current-byte
        // hash above matches. Full-motion and cold callers still interpret.
        const source=program==='source'?pendingCheckedPrograms.take(key):null;
        if(source)cachedProgram={key,...source,program:null};
        else cachedProgram=programCacheEntry(key,interpretProgram(code, plan, machine),code);
      }
      state.program = structuredClone(program==='source'?cachedProgram.metadata:cachedProgram.program);
      state.limitations=[...new Set([...state.limitations,...(state.program.limitations??[])])];
      state.pathSummary = structuredClone(review.generation.summary??{});
      state.exportHash = exportHash;
      state.code = cachedProgram.code;
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
  return {state,fingerprint:state.fingerprints.source,presentationFingerprint:state.fingerprints.presentation};
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

async function rememberSetup(directory, { setupFile, source = 'User setup supplied through chat' } = {}) {
  const state = await loadBundle(directory, { program: false });
  setupFile??=setupFor(state.machine);
  await save(setupFile, {
    schema: 'saam-machine-setup/1', machineId: state.machine.id, setup: state.plan.setup,
    source, updatedAt: new Date().toISOString()
  });
  return setupFile;
}

// Feasibility inspection through the same generator, without persisted output
// or approval. The approved generation/export step remains the delivery gate.
async function checkPathBundle(directory, {onProgress} = {}) {
  const candidate=await prepareGeneration(directory,{onProgress});
  return {mode:'development-check-only',revision:candidate.revision,
    ...structuredClone(candidate.summary),exportSummary:structuredClone(candidate.program.summary)};
}

function requireOutput(state){
  // Profiles can support geometry/setup review before an output contract exists.
  // Report that contract's reason before constructing geometry or motion.
  outputAdapter(state.plan,state.machine);
}

async function prepareGeneration(directory,{onProgress}={}){
  const state=await loadBundle(directory,{program:false});
  requireOutput(state);
  onProgress?.({stage:'Preparing geometry'});
  const path=await generatePath(state.plan,state.machine,{onProgress});
  onProgress?.({stage:'Writing and checking machine commands'});
  const {bytes,program}=exportAndInterpretProgram(path,state.plan,state.machine,{generatorVersion:VERSION,buildDate:BUILD_DATE});
  return {directory:state.dir,revision:state.revision,generationHash:state.generationHash,
    summary:path.summary,bytes,program};
}

// Chat-driven adjustment: the agent applies a patch, the plan is revalidated,
// and the affected approvals fall away. An unknown key is refused here as well
// as in the plan check, so a misspelled setting never silently does nothing.
async function adjustBundle(directory, patch, { setupFile, expectedRevision } = {}) {
  const state = await loadBundle(directory, { program: false });
  if(expectedRevision!==undefined)requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing the print.');
  const plan = applyPlanPatch(state.plan, patch, geometryTemplate);
  const updated=await updatePlan(directory, plan, state.revision);
  if (patch.setup) await rememberSetup(directory, { setupFile });
  return updated;
}


async function updatePlan(directory, plan, revision) {
  const state = await loadBundle(directory, { program: false });
  requireThat(revision === state.revision, 'This view is stale. Reload before changing the print.');
  const change = validatePlanUpdate(state, plan);
  if (!change.changed) return state;

  // Build before committing anything; plan.json remains the edit commit point.
  const geometry = change.geometryChanged ? await createGeometry(change.plan.geometry) : null;
  const review = editedPlanReview(state.review, state.generationHash, change.geometryChanged);
  await persistPlanUpdate(state,change.plan,geometry,review);
  return loadBundle(directory);
}

function validatePlanUpdate(state, candidate) {
  const plan = structuredClone(candidate);
  validatePlan(plan, state.machine);
  const changed = canonical(plan) !== canonical(state.plan);
  const geometryChanged = changed && canonical(plan.geometry) !== canonical(state.plan.geometry);
  return {plan, changed, geometryChanged};
}

async function persistPlanUpdate(state,plan,geometry,review) {
  const geometryArtifact=geometry?await saveGeometry(state.dir,geometry):state.geometryArtifact;
  await saveManifest(state.dir,{plan,machine:state.machine,review,geometry:geometryArtifact});
}

// Generation performs the calculations the locked plan specifies. Both modes
// may be inspected freely; development output is recorded as a preview and can
// never satisfy the final reviewed-export delivery gate.
async function generateBundle(directory, { development = false, onProgress, beforeCommit, dispatchComputation } = {}) {
  const state = await loadBundle(directory, { program: false });
  const current=await currentGenerationCandidate(directory,state);
  if(current){
    if(development||current.checks.mode==='production')return current.checks;
    beforeCommit?.();
    const confirmed=await currentGenerationCandidate(directory,state);
    requireThat(confirmed&&confirmed.checks.mode==='development'
      &&confirmed.current.generationHash===current.current.generationHash
      &&confirmed.current.exportHash===current.current.exportHash
      &&confirmed.current.revision===current.current.revision,
    'The reviewed export changed before promotion. Generate it again.');
    return promoteReviewedGeneration(state.dir,confirmed);
  }
  if(dispatchComputation){
    let localChecks;
    const runLocally=async()=>localChecks=await generateBundle(directory,{development,onProgress,beforeCommit});
    const computed=await dispatchComputation({directory,state,development,onProgress,beforeCommit,runLocally});
    if(computed===localChecks&&localChecks)return localChecks;
    const checks=computed?.checks,source=consumeCheckedProgram(computed?.checkedProgram,
      checks?.generationHash,checks?.exportHash);
    requireThat(checks&&source,'The generation worker returned unchecked machine source.');
    pendingCheckedPrograms.retain(programKey(checks.generationHash,checks.exportHash),source);
    return checks;
  }
  const prepared=await prepareGeneration(directory,{onProgress});
  return commitGeneration(directory,prepared,{development,onProgress,beforeCommit});
}

async function commitGeneration(directory,prepared,{development=false,onProgress,beforeCommit}={}){
  const state=await loadBundle(directory,{program:false});
  requireThat(state.generationHash===prepared.generationHash&&state.revision===prepared.revision,
    'The print changed during generation. Review the updated print.');
  beforeCommit?.();
  onProgress?.({stage:'Saving your toolpath'});
  const checks=generationChecks(state,prepared,development);
  const committed=await persistGeneratedProgram(state,prepared,checks);
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
  await saveManifest(dir,{plan:current.plan,machine:current.machine,review,geometry:current.geometryArtifact});
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
    nonplanarLimit: summary.nonplanarLimit ?? null,
    checks: ['plan-inputs', 'closed-geometry', 'native-geometry-round-trip', 'declared-output', ...(program.checks??(program.envelope?['fixed-firmware-envelope','archive-integrity','strict-print-body-interpretation']:['strict-gcode-interpretation'])),
      ...(state.machine.motionChecks==='deferred'?[]:['xyz-bounds','axis-feed']), ...(program.summary.materialModel==='relay-estimate'?['commanded-flow-intent']:['extrusion-flow','temperature-state'])],
    clearance: 'operator responsibility; no collision model implemented',
    physicalValidation: 'not performed',
    firmwareEnvelope: program.envelope??null,
    limitations: [...limitationsFor(state.plan, state.machine),...(program.limitations??[])],
    ...(program.summary.materialModel==='relay-estimate'?{materialModel:'relay-estimate',commandedVolumeMm3:program.summary.commandedVolumeMm3,estimatedRelayVolumeMm3:program.summary.estimatedRelayVolumeMm3,relayEstimateDifferenceMm3:program.summary.relayEstimateDifferenceMm3}:{})
  };
}

async function persistGeneratedProgram(state,{bytes:code,program,summary},checks){
  const file=exportArtifactPath(state.plan,state.machine,checks.exportHash);
  await save(resolve(state.dir,file),code);
  const review={...state.review,approvals:{},
    generation:{mode:checks.mode,generationHash:state.generationHash,exportHash:checks.exportHash,summary,version:VERSION,file,checks},
    history:[...state.review.history,{event:'generated',mode:checks.mode,time:new Date().toISOString(),exportHash:checks.exportHash}]};
  await saveManifest(state.dir,{plan:state.plan,machine:state.machine,review,geometry:state.geometryArtifact});
  return {checks,cachedProgram:programCacheEntry(programKey(state.generationHash,checks.exportHash),program,code)};
}

// The one human approval: current settings and the exact checked export together.
async function approve(directory, { actor, revision, program = true }) {
  requireThat(typeof actor === 'string' && actor.trim().length >= 2 && actor.length <= 100, 'Enter the human reviewer’s name.');
  const state = await loadBundle(directory,{program});
  requireThat(revision === state.revision, 'This review is stale. Reload before approving.');
  requireThat(!state.programError,state.programError);
  requireThat(state.program && !state.programError
    && state.review.generation?.mode === 'production',
  'Generate and check the production plan before toolpath approval.');
  const record = {
    actor: actor.trim(), time: new Date().toISOString(),
    hash: state.exportHash, generationHash: state.generationHash, scope: ['settings','toolpath']
  };
  const review=approvedReview(state.review,record);
  await saveManifest(state.dir,{plan:state.plan,machine:state.machine,review,geometry:state.geometryArtifact});
  return {
    ...state,
    review,
    toolpathApproved:true,
    revision:hash({geometryHash:state.geometryHash,generationHash:state.generationHash,review})
  };
}

// Delivery copies the bytes that were reviewed. It re-reads and re-hashes them
// rather than regenerating, so nothing new can appear between review and file.
async function deliver(directory) {
  const state = await loadBundle(directory,{program:'source'});
  requireThat(state.toolpathApproved, 'Delivery requires approval of the exact current export.');
  const bytes = await readFile(resolve(state.dir,state.review.generation.file));
  requireThat(hash(bytes) === state.exportHash, 'Export changed during delivery.');
  const destination = resolve(state.dir, `delivery/${state.exportName}`);
  await save(destination, bytes);
  requireThat(hash(await readFile(destination)) === state.exportHash, 'Delivery bytes differ from reviewed export.');
  const attribution=originalSource(state.plan.geometry)?.attribution;
  if(attribution)await save(resolve(state.dir,'delivery/source-attribution.json'),{
    ...attribution,
    changes:'SAAM imported and positioned/scaled the source for printing. The saved plan records the current geometry and printing settings; consult it and any repair reports for subsequent changes.',
    planRevision:state.revision
  });
  return destination;
}

async function changeMachine(directory,machineId,{expectedRevision,setupFile}={}) {
  const state=await loadBundle(directory,{program:false});
  if(expectedRevision!==undefined)requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing the printer.');
  const machine=loadMachine(machineId),remembered=await rememberedSetup(setupFile??setupFor(machine),machine);
  const plan=resolveMachinePlan(state.plan,state.machine,machine,{defaults,rememberedSetup:remembered,fit:fitLineWidthToSetup});
  validatePlan(plan,machine);
  const review=machineChangedReview(state.review,state.machine.id,machineId);
  await saveManifest(state.dir,{plan,machine,review,geometry:state.geometryArtifact});
  return loadBundle(directory,{program:false});
}

return {root,EXPORT_NAME,atomicManifest:true,proposedPlan,initBundle,loadBundle,loadBundleSnapshot,bundleFingerprint,bundleFingerprints,rememberSetup,
  migrateBundle,prepareGeneration,commitGeneration,checkPathBundle,adjustBundle,updatePlan,generateBundle,approve,deliver,changeMachine};
}
