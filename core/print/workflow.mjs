// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, rename, access, rm,copyFile } from 'node:fs/promises';
import {hashFile} from '../geom/stl-file.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportAndInterpretProgram, interpretProgram, outputAdapter } from '../export/registry.mjs';
import { loadMachine, validateDobotConfiguration, lineWidthLimits } from '../machine/profile.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {validateDensoConfiguration} from '../machine/denso.mjs';
import {checkedSourceFor} from './program-handoff.mjs';
import {createFileSnapshot} from './file-snapshot.mjs';
import {replaceFile} from '../file-write.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultSetupFile=resolve(root,'.local/machine-setups/ultimaker-s5.json');
const setupFor=machine=>resolve(root,`.local/machine-setups/${machine.id}.json`);
const nativeFile=geometry=>{const name=geometry.nativeFile??'model.3dm';requireThat(['model.3dm','model.mesh.json'].includes(name),'Unsupported native geometry file.');return 'geometry/'+name;};
const canonical=value=>JSON.stringify(value,function(_key,item){return item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item;});
const hash=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:canonical(value)).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
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
  const plan = mergePlanPatch(previous, patch, geometryTemplate);
  if (patch.setup?.firmwareVersion !== undefined
    && patch.setup.firmwareVersion !== previous.setup.firmwareVersion
    && patch.setup.startupVerified === undefined)
    return {...plan, setup:{...plan.setup, startupVerified:false}};
  return plan;
}

export function editedPlanReview(review, previousPlanHash, geometryChanged, time = new Date().toISOString()) {
  const event = {event:'plan-edited', time, previousPlanHash, geometryChanged, invalidated:['toolpath']};
  return {...review, history:[...review.history, event], approvals:{}, generation:null};
}

function mergePlanPatch(previous, changes, geometryTemplate) {
  requireThat(changes && typeof changes === 'object' && !Array.isArray(changes), 'Adjustment must be an object.');
  const target={...previous};
  for (const [key, value] of Object.entries(changes)) {
    requireThat(Object.hasOwn(target, key), `Unknown setting: ${key}`);
    // Optional records begin at null. Installing a complete record is a
    // replacement; validatePlan owns its fields. Subsequent patches merge.
    if(target[key]===null&&value&&typeof value==='object'&&!Array.isArray(value)){
      target[key]=structuredClone(value);continue;
    }
    // Surface selectors are discriminated records, including a legacy null.
    // Replace the complete selection and let validatePlan check its schema.
    if(key==='surface'&&value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'kind')){
      target[key]=structuredClone(value);continue;
    }
    // Optional locked records (for example primeLine) are replaced as a whole;
    // their alternate single-pass and multi-pass schemas cannot be deep-merged.
    if((key==='primeLine'||target[key]===null||target[key]===undefined)&&value&&typeof value==='object'&&!Array.isArray(value)){
      target[key]=structuredClone(value);continue;
    }
    // Vase pattern forms have distinct strict fields. A complete form switch
    // replaces the record; ordinary motif/layout patches still merge in place.
    if(key==='pattern'&&value&&typeof value==='object'&&target[key]&&typeof target[key]==='object'
      &&(Object.hasOwn(value,'motif')&&!Object.hasOwn(target[key],'motif')
         ||Object.hasOwn(value,'paths')&&Object.hasOwn(target[key],'motif'))){
      target[key]=structuredClone(value);continue;
    }
    // Shapes deliberately have different strict field sets. Retain only the
    // fields the new shape shares, start the new shape's fields from its own
    // template, then apply the chat-requested geometry change.
    if (geometryTemplate && key === 'geometry' && value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.shape === 'string' && value.shape !== target.geometry.shape) {
      const template = geometryTemplate(value.shape);
      const shared = Object.fromEntries(Object.entries(target.geometry).filter(([field]) => Object.hasOwn(template, field)));
      target.geometry = { ...template, ...shared };
      target.geometry = mergePlanPatch(target.geometry, value, geometryTemplate);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) target[key] = mergePlanPatch(target[key], value, geometryTemplate);
    else target[key] = structuredClone(value);
  }
  return target;
}

export function createBundleWorkflow(adapter) {
  const {kind,defaults,validatePlan,createGeometry,verifyGeometry,generatePath,geometryTemplate,
    version:VERSION,buildDate:BUILD_DATE,exportName:EXPORT_NAME,limitations:limitationsFor}=adapter;
  const machineFile=resolve(root,adapter.machineFile);
  const EXPORT_PATH='exports/griffin-gcode/'+EXPORT_NAME;
  const exportName=(plan,machine)=>{
    const extension=machine.outputs.find(o=>o.id===plan.output)?.extension??'.gcode';
    requireThat(/^\.[a-z0-9.]+$/.test(extension),'Invalid export extension.');
    return EXPORT_NAME.replace(/\.gcode$/,extension);
  };
  const exportPath=(plan,machine)=>{requireThat(/^[a-z0-9-]+$/.test(plan.output),'Invalid output ID.');return `exports/${plan.output}/${exportName(plan,machine)}`;};
  // Retain only the latest verified program per adapter. Identity includes the
  // actual file bytes, not mtimes or editable review claims. Approval state is
  // always read afresh; callers receive copies so they cannot alter this cache.
  let verifiedProgram;
  let inputCache={};
  let preparedProgram;
  const fileSnapshot=createFileSnapshot();
  const programKey=(planHash,exportHash)=>hash([planHash,exportHash]);
async function proposedPlan(machineId, { setupFile } = {}) {
  const machine = machineId ? loadMachine(machineId) : await json(machineFile);
  const plan = defaults(machine);
  const remembered = await rememberedSetup(setupFile ?? setupFor(machine), machine);
  if (remembered) plan.setup = { ...plan.setup, ...remembered, materialGuid: remembered.materialGuid || plan.setup.materialGuid };
  fitLineWidthToSetup(plan,machine);
  return plan;
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
  await saveGeometry(dir, geometry);
  await save(resolve(dir, 'machine.json'), machine);
  await save(resolve(dir, 'review.json'), { schema: 'saam-review/1', approvals: {}, history: [], generation: null });
  await save(resolve(dir, 'plan.json'), plan);
  return dir;
}

// Geometry files are derived from plan.geometry. plan.json is the commit point
// of an edit: it is written first, and a reader that finds older geometry beside
// it rebuilds these files instead of refusing the print.
async function saveGeometry(dir, geometry) {
  await save(resolve(dir, nativeFile(geometry.descriptor)), geometry.bytes);
  await save(resolve(dir, 'geometry/model.json'), geometry.descriptor);
}

// Remembered setup is an editable starting point. Only fields this pipeline
// already has are taken, so a setup saved by another skill cannot introduce one.
async function rememberedSetup(setupFile, machine) {
  let saved;
  try { saved = await json(setupFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  requireThat(saved.schema === 'saam-machine-setup/1' && saved.machineId === machine.id, 'Saved machine setup is incompatible.');
  const known = defaults(machine).setup;
  return Object.fromEntries(Object.entries(saved.setup ?? {}).filter(([key]) => Object.hasOwn(known, key)));
}

async function readBundleInput(directory) {
  const dir = resolve(directory);
  const [planText, machineText, geometryText, review] = await Promise.all([
    readFile(resolve(dir, 'plan.json'),'utf8'), readFile(resolve(dir, 'machine.json'),'utf8'), readFile(resolve(dir, 'geometry/model.json'),'utf8'),
    json(resolve(dir, 'review.json'))]);
  const machine=JSON.parse(machineText),geometry=JSON.parse(geometryText);
  const bytes=await readFile(resolve(dir,nativeFile(geometry)));
  return {dir,planText,machineText,geometryText,review,machine,geometry,bytes};
}

async function validateBundleInput(input,previousCache) {
  const {dir,planText,machineText,geometryText,review,machine,geometry,bytes}=input;
  const cache={...previousCache};
  try {
    // Read current bytes at every boundary, but canonicalize large mesh/plan
    // trees only when those bytes change. Keep the established semantic hashes
    // so formatting alone does not invalidate a person's recorded approval.
    const fileHash=hash(bytes),identityKey=hash([hash(planText),hash(machineText),hash(geometryText),fileHash]);
    let identity=cache.identity;
    let plan=JSON.parse(identity?.key===identityKey?identity.planText:planText);
    if(identity?.key!==identityKey){
      const geometryHash=hash({file:fileHash,descriptor:geometry});
      const inputsHash=hash({plan,machine});
      if(cache.verifiedGeometryHash!==geometryHash){
        await verifyGeometry(bytes,geometry);
        cache.verifiedGeometryHash=geometryHash;
      }
      if(cache.validatedPlanHash!==inputsHash){
        validatePlan(plan,machine);
        cache.validatedPlanHash=inputsHash;
        cache.validatedPlanText=JSON.stringify(plan);
      }else plan=JSON.parse(cache.validatedPlanText);
      if(canonical(plan.geometry)!==canonical(geometry.parameters)){
        return {dir,plan,machine,geometry,review,cache,rebuild:true};
      }
      identity={key:identityKey,geometryHash,planHash:hash({plan,machine,geometryHash}),planText:cache.validatedPlanText};
      cache.identity=identity;
    }
    return {dir,plan,machine,geometry,review,identity,cache,rebuild:false};
  } catch(error) {return {cache,error};}
}

async function describeBundle({dir,plan,machine,geometry,review,identity},program) {
  const {geometryHash,planHash}=identity;
  if(originalSource(plan.geometry))requireThat(await hashFile(resolve(dir,'geometry/source.stl'))===originalSource(plan.geometry).sha256,'Imported STL source changed; reload the current geometry.');
  const state = {
    kind, dir, plan, machine, geometry, review, geometryHash, planHash, programChecked:Boolean(program),
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
  state.revision = hash({ geometryHash, planHash, review });
  state.setupBasis = plan.setup.startupVerified
    ? 'Confirmed startup behavior'
    : machine.startup.validation;

  return state;
}

async function restoreBundleProgram(input,program,allSources,previousProgram) {
  const state={...input},{dir,plan,machine,review,planHash}=state;
  let cachedProgram=previousProgram;
  if (program && review.generation) {
    try {
      requireThat(review.generation.planHash === planHash, 'Generated program is stale; regenerate for the current plan.');
      const code = await readFile(resolve(dir, exportPath(plan,machine)));
      const exportHash=hash(code),key=programKey(planHash,exportHash);
      requireThat(exportHash === review.generation.exportHash,
        'Generated files changed; regenerate and review again.');
      if(cachedProgram?.key!==key||(program!=='source'&&!cachedProgram.program)) {
        // Reopen the saved machine program. Interpretation checks the actual
        // commands; reopening never invokes a slicing skill or exporter. Source
        // requests can reuse our worker's checked result after the current-byte
        // hash above matches. Full-motion and cold callers still interpret.
        const source=program==='source'?checkedSourceFor(planHash,exportHash):null;
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
        && review.approvals.toolpath?.planHash === planHash
        && review.generation.mode === 'production';
    } catch (error) { state.programError = error.message; }
  }
  return {state,cachedProgram};
}


async function loadBundle(directory, { program = true, allSources=false } = {}, geometryRebuilt=false) {
  const input=await readBundleInput(directory);
  const validated=await validateBundleInput(input,inputCache);
  inputCache=validated.cache;
  if(validated.error)throw validated.error;
  if(validated.rebuild) {
    // An edit was interrupted after its plan was committed. Finish it once.
    requireThat(!geometryRebuilt,'Plan and geometry disagree. Ask the agent to recreate the geometry.');
    await saveGeometry(validated.dir,await createGeometry(validated.plan.geometry));
    return loadBundle(directory,{program,allSources},true);
  }
  const described=await describeBundle(validated,program);
  const restored=await restoreBundleProgram(described,program,allSources,verifiedProgram);
  verifiedProgram=restored.cachedProgram;
  return restored.state;
}

// A content fingerprint for automatic viewer updates. Changed geometry or plan
// inputs invalidate their checks; an approval-only change does not.
// One snapshot pass yields both change fingerprints: `source` covers every
// input and review file; `presentation` replaces review.json with its
// generation identity minus mode, so approval, delivery history and mode
// changes update controls without replacing mesh/motion.
async function bundleFingerprints(directory, {program=true}={}) {
  // Polling is a change notification, not a validity boundary. Reuse the file
  // digest while filesystem metadata is unchanged. loadBundle still reads
  // and hashes current bytes before review, approval, generation or delivery.
  const snapshot=(name,parse=false)=>fileSnapshot(resolve(directory,name),{parse});
  const [plan,geometry,machine]=await Promise.all([snapshot('plan.json',true),snapshot('geometry/model.json',true),snapshot('machine.json',true)]);
  const names = ['plan.json', 'machine.json', 'geometry/model.json', nativeFile(geometry), 'geometry/source.stl', ...(program?[exportPath(plan,machine)]:[])];
  const [values,review,reviewDigest] = await Promise.all([Promise.all(names.map(async name => [name,await snapshot(name)])),snapshot('review.json',true),snapshot('review.json')]);
  const {mode,...identity}=review?.generation??{};
  return {source:hash([...values,['review.json',reviewDigest]]),presentation:hash([...values,['generation',review?.generation?identity:null]])};
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
  const state = await loadBundle(directory, { program: false });
  const prepared=await prepareProgram(state,onProgress);
  return { mode: 'development-check-only', revision: state.revision, ...structuredClone(prepared.summary), exportSummary:structuredClone(prepared.program.summary) };
}

async function prepareProgram(state,onProgress){
  const cached=selectPreparedProgram(state,preparedProgram);
  if(cached)return cached;
  // This owner clears the previous candidate before asynchronous calculation,
  // and installs a new one only after export and interpretation succeed.
  preparedProgram=null;
  const generated=await generatePreparedProgram(state,onProgress);
  preparedProgram=generated;
  return generated;
}

function selectPreparedProgram(state,previous){
  // Profiles can support geometry/setup review before an output contract exists.
  // Report that contract's reason before constructing geometry or motion.
  outputAdapter(state.plan,state.machine);
  return previous?.planHash===state.planHash?previous:null;
}

async function generatePreparedProgram(state,onProgress){
  // One candidate per adapter. No approvals, files, or full producer path are
  // retained; the checked commands are committed only by generateBundle.
  onProgress?.({stage:'Preparing geometry'});
  const path=await generatePath(state.plan,state.machine,{onProgress});
  onProgress?.({stage:'Writing and checking machine commands'});
  const {bytes,program}=exportAndInterpretProgram(path,state.plan,state.machine,{generatorVersion:VERSION,buildDate:BUILD_DATE});
  return {planHash:state.planHash,summary:path.summary,bytes,program};
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
  const review = editedPlanReview(state.review, state.planHash, change.geometryChanged);
  await persistPlanUpdate(state.dir, change.plan, geometry, review);
  return loadBundle(directory);
}

function validatePlanUpdate(state, candidate) {
  const plan = structuredClone(candidate);
  validatePlan(plan, state.machine);
  const changed = canonical(plan) !== canonical(state.plan);
  const geometryChanged = changed && canonical(plan.geometry) !== canonical(state.plan.geometry);
  return {plan, changed, geometryChanged};
}

async function persistPlanUpdate(dir, plan, geometry, review) {
  await save(resolve(dir, 'plan.json'), plan);
  if (geometry) await saveGeometry(dir, geometry);
  await save(resolve(dir, 'review.json'), review);
}

// Generation performs the calculations the locked plan specifies. Both modes
// may be inspected freely; development output is recorded as a preview and can
// never satisfy the final reviewed-export delivery gate.
async function generateBundle(directory, { development = false, onProgress, beforeCommit } = {}) {
  const state = await loadBundle(directory, { program: false });
  const reusable=await reviewedGenerationCandidate(directory,state,development,onProgress);
  if(reusable){
    beforeCommit?.();
    return persistReviewedGeneration(state.dir,reusable);
  }
  const prepared=await prepareProgram(state,onProgress);
  requireThat((await loadBundle(directory,{program:false})).planHash===state.planHash,'The print changed during generation. Review the updated print.');
  beforeCommit?.();
  onProgress?.({stage:'Saving your toolpath'});
  const checks=generationChecks(state,prepared,development);
  const committed=await persistGeneratedProgram(state,prepared,checks);
  verifiedProgram=committed.cachedProgram;
  preparedProgram=null;
  return committed.checks;
}

async function reviewedGenerationCandidate(directory,state,development,onProgress){
  // Both modes use identical commands. Reuse a checked development export after
  // review, without slicing merely to change its mode. Current
  // input and byte identity still belong to loadBundle; no approval is added.
  if(!development&&state.review.generation?.mode==='development'){
    onProgress?.({stage:'Checking the reviewed file'});
    const current=await loadBundle(directory,{program:'source'});
    if(current.program&&!current.programError){
      const checks=await json(resolve(state.dir,'checks.json'));
      requireThat(checks.planHash===current.planHash&&checks.exportHash===current.exportHash&&checks.result==='pass','Saved checks do not match the reviewed export.');
      return {checks:{...checks,mode:'production'},current};
    }
  }
  return null;
}

async function persistReviewedGeneration(dir,{checks,current}){
  await save(resolve(dir,'checks.json'),checks);
  const review={...current.review,generation:{...current.review.generation,mode:'production'},
    history:[...current.review.history,{event:'generation-reused',mode:'production',time:new Date().toISOString(),exportHash:current.exportHash}]};
  await save(resolve(dir,'review.json'),review);
  return checks;
}

function generationChecks(state,prepared,development){
  const {bytes:code,program,summary}=prepared;
  return {
    schema: 'saam-checks/1', result: 'pass', mode: development ? 'development' : 'production',
    generatorVersion: VERSION, planHash: state.planHash, exportHash: hash(code),
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
  await save(resolve(state.dir, exportPath(state.plan,state.machine)), code);
  await save(resolve(state.dir, 'checks.json'), checks);
  const review={...state.review,approvals:{},
    generation:{mode:checks.mode,planHash:state.planHash,exportHash:checks.exportHash,summary,version:VERSION},
    history:[...state.review.history,{event:'generated',mode:checks.mode,time:new Date().toISOString(),exportHash:checks.exportHash}]};
  await save(resolve(state.dir, 'review.json'), review);
  return {checks,cachedProgram:programCacheEntry(programKey(state.planHash,checks.exportHash),program,code)};
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
    hash: state.exportHash, planHash: state.planHash, scope: ['settings','toolpath']
  };
  state.review.approvals = { toolpath: record };
  state.review.history.push({ event: 'human-approval', ...record });
  await save(resolve(state.dir, 'review.json'), state.review);
  state.toolpathApproved = true;
  state.revision=hash({geometryHash:state.geometryHash,planHash:state.planHash,review:state.review});
  return state;
}

// Delivery copies the bytes that were reviewed. It re-reads and re-hashes them
// rather than regenerating, so nothing new can appear between review and file.
async function deliver(directory) {
  const state = await loadBundle(directory,{program:'source'});
  requireThat(state.toolpathApproved, 'Delivery requires approval of the exact current export.');
  const bytes = await readFile(resolve(state.dir, exportPath(state.plan,state.machine)));
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
  const machine=loadMachine(machineId),proposal=await proposedPlan(machineId,{setupFile});
  const process={...state.plan.process};
  for(const key of new Set([...Object.keys(state.machine.defaultProcess??{}),...Object.keys(machine.defaultProcess??{})]))process[key]=proposal.process[key];
  const plan={...state.plan,setup:proposal.setup,output:proposal.output,process};
  fitLineWidthToSetup(plan,machine);
  validatePlan(plan,machine);
  const review=state.review;
  review.approvals={};review.generation=null;
  review.history.push({event:'machine-changed',from:state.machine.id,to:machineId,time:new Date().toISOString()});
  await save(resolve(state.dir,'machine.json'),machine);
  await save(resolve(state.dir,'plan.json'),plan);
  await save(resolve(state.dir,'review.json'),review);
  return loadBundle(directory,{program:false});
}

return {root,defaultSetupFile,EXPORT_NAME,EXPORT_PATH,proposedPlan,initBundle,loadBundle,bundleFingerprint,bundleFingerprints,rememberSetup,checkPathBundle,adjustBundle,updatePlan,generateBundle,approve,deliver,changeMachine};
}
