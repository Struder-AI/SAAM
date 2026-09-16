// One print lifecycle for every geometry/generator adapter.
import { readFile, mkdir, rename, access, rm,copyFile } from 'node:fs/promises';
import {hashFile} from '../geom/stl-file.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportAndInterpretProgram, interpretProgram } from '../export/registry.mjs';
import { loadMachine, validateDobotConfiguration } from '../machine/profile.mjs';
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
  let runtimeCache;
  // Retain only the latest verified program per adapter. Identity includes the
  // actual file bytes, not mtimes or editable review claims. Approval state is
  // always read afresh; callers receive copies so they cannot alter this cache.
  let verifiedProgram;
  let verifiedGeometryHash,validatedPlanHash,validatedPlanText;
  let inputIdentity;
  let preparedProgram;
  const fileSnapshot=createFileSnapshot();
  const programKey=(planHash,exportHash)=>hash([planHash,exportHash]);
  function rememberProgram(key,program,code) {
    // The interpreter result is owned here and has not escaped to a caller.
    // Copy only on return; a second full cache copy serves no purpose.
    const text=program.code??code.toString('utf8');delete program.code;
    const sources=program.sources??{program:text};delete program.sources;
    const {moves,events,...metadata}=program;
    const sourceInfo=Object.entries(sources).map(([name,source])=>({name,sha256:hash(source)}));
    verifiedProgram={key,program,code:text,sources,metadata:{...metadata,sources:sourceInfo}};
  }
  async function runtimeHash(){
    const reads=new Map();
    return runtimeCache??=hash(await Promise.all([
      new URL('./workflow.mjs',import.meta.url), new URL('../export/griffin.mjs',import.meta.url),
      new URL('../file-write.mjs',import.meta.url),
      new URL('./program-handoff.mjs',import.meta.url),
      new URL('../export/registry.mjs',import.meta.url),new URL('../machine/profile.mjs',import.meta.url),
      new URL('../export/travel-advisory.mjs',import.meta.url),
      new URL('../export/bambu.mjs',import.meta.url),new URL('../export/zip.mjs',import.meta.url),
      new URL('../export/gcode-lines.mjs',import.meta.url),
      new URL('../export/denso.mjs',import.meta.url),new URL('../export/denso-player.mjs',import.meta.url),new URL('../machine/denso.mjs',import.meta.url),new URL('../path/pose.mjs',import.meta.url),
      new URL('../machine/rules.mjs',import.meta.url),new URL('../export/bambu-player.mjs',import.meta.url),
      new URL('../path/process-controls.mjs',import.meta.url),
      new URL('../export/dobot-player.mjs',import.meta.url),
      new URL('../export/dobot.mjs',import.meta.url),new URL('../export/dobot-lua-subset.mjs',import.meta.url),
      new URL('../geom/tolerance.mjs',import.meta.url), new URL('../geom/polyline.mjs',import.meta.url), ...adapter.runtimeFiles
    ].map(async file=>{const path=fileURLToPath(file);if(!reads.has(path))reads.set(path,readFile(file));return [path.slice(root.length).replaceAll('\\','/'),hash(await reads.get(path))];})));
  }
async function proposedPlan(machineId, { setupFile } = {}) {
  const machine = machineId ? loadMachine(machineId) : await json(machineFile);
  const plan = defaults(machine);
  const remembered = await rememberedSetup(setupFile ?? setupFor(machine), machine);
  if (remembered) plan.setup = { ...plan.setup, ...remembered, materialGuid: remembered.materialGuid || plan.setup.materialGuid };
  return plan;
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
  await save(resolve(dir, nativeFile(geometry.descriptor)), geometry.bytes);
  await save(resolve(dir, 'geometry/model.json'), geometry.descriptor);
  await save(resolve(dir, 'machine.json'), machine);
  await save(resolve(dir, 'plan.json'), plan);
  await save(resolve(dir, 'review.json'), { schema: 'saam-review/1', approvals: {}, history: [], generation: null });
  return dir;
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

async function loadBundle(directory, { program = true, sourceFile, allSources=false } = {}) {
  const dir = resolve(directory);
  const [planText, machineText, geometryText, review, runtime] = await Promise.all([
    readFile(resolve(dir, 'plan.json'),'utf8'), readFile(resolve(dir, 'machine.json'),'utf8'), readFile(resolve(dir, 'geometry/model.json'),'utf8'),
    json(resolve(dir, 'review.json')), runtimeHash()]);
  const machine=JSON.parse(machineText),geometry=JSON.parse(geometryText);
  const bytes=await readFile(resolve(dir,nativeFile(geometry)));
  // Read current bytes at every boundary, but canonicalize large mesh/plan
  // trees only when those bytes change. Keep the established semantic hashes
  // so formatting alone does not invalidate a person's recorded approval.
  const fileHash=hash(bytes),identityKey=hash([hash(planText),hash(machineText),hash(geometryText),fileHash,runtime]);
  let identity=inputIdentity;
  let plan=JSON.parse(identity?.key===identityKey?identity.planText:planText);
  if(identity?.key!==identityKey){
    const geometryHash=hash({file:fileHash,descriptor:geometry});
    const inputsHash=hash({plan,machine});
    if(verifiedGeometryHash!==geometryHash){
      await verifyGeometry(bytes,geometry);
      verifiedGeometryHash=geometryHash;
    }
    if(validatedPlanHash!==inputsHash){
      validatePlan(plan,machine);
      validatedPlanHash=inputsHash;
      validatedPlanText=JSON.stringify(plan);
    }else plan=JSON.parse(validatedPlanText);
    requireThat(canonical(plan.geometry)===canonical(geometry.parameters),
      'Plan and geometry disagree. Ask the agent to recreate the geometry.');
    identity={key:identityKey,geometryHash,planHash:hash({plan,machine,geometryHash,runtime}),planText:validatedPlanText};
    inputIdentity=identity;
  }
  const {geometryHash,planHash}=identity;
  if(originalSource(plan.geometry))requireThat(await hashFile(resolve(dir,'geometry/source.stl'))===originalSource(plan.geometry).sha256,'Imported STL source changed; geometry approval is stale.');
  const state = {
    kind, dir, plan, machine, geometry, review, geometryHash, planHash, runtime, programChecked:Boolean(program),
    exportName: exportName(plan,machine), limitations: limitationsFor(plan, machine),
    outputAvailability:machine.outputs.find(o=>o.id===plan.output)?.implemented===false?`Machine-file export for ${machine.name} is not available yet; geometry and settings can be reviewed.`:null,
    skills: plan.composition?.regions?.length
      ? [...new Set([...plan.composition.regions.flatMap(region=>Object.keys(region.skills)),...['supports','rimming-planar','rimming-normal','wave-overhangs'].filter(name=>plan.skills?.[name]?.enabled)])]
      : plan.skills ? Object.entries(plan.skills).filter(([, settings]) => settings.enabled).map(([name]) => name) : ['wedge-demo'],
    geometryApproved: review.approvals.geometry?.hash === geometryHash,
    planApproved: review.approvals.plan?.hash === planHash
  };
  state.planApproved &&= state.geometryApproved;
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

  if (program && review.generation) {
    try {
      requireThat(review.generation.planHash === planHash, 'Generated program is stale; regenerate for the current plan.');
      const code = await readFile(resolve(dir, exportPath(plan,machine)));
      const exportHash=hash(code),key=programKey(planHash,exportHash);
      requireThat(exportHash === review.generation.exportHash,
        'Generated files changed; regenerate and review again.');
      if(verifiedProgram?.key!==key||(program!=='source'&&!verifiedProgram.program)) {
        // Reopen the saved machine program. Interpretation checks the actual
        // commands; reopening never invokes a slicing skill or exporter. Source
        // requests can reuse our worker's checked result after the current-byte
        // hash above matches. Full-motion and cold callers still interpret.
        const source=program==='source'?checkedSourceFor(planHash,exportHash):null;
        if(source)verifiedProgram={key,...source,program:null};
        else rememberProgram(key,interpretProgram(code, plan, machine),code);
      }
      state.program = structuredClone(program==='source'?verifiedProgram.metadata:verifiedProgram.program);
      state.limitations=[...new Set([...state.limitations,...(state.program.limitations??[])])];
      state.pathSummary = structuredClone(review.generation.summary??{});
      state.exportHash = exportHash;
      state.code = verifiedProgram.code;
      if(allSources)state.sources={...verifiedProgram.sources};
      if(sourceFile!==undefined){
        requireThat(Object.hasOwn(verifiedProgram.sources,sourceFile),'Unknown machine source file.');
        state.code=verifiedProgram.sources[sourceFile];
      }
      state.toolpathApproved = state.planApproved
        && review.approvals.toolpath?.hash === state.exportHash
        && review.approvals.toolpath?.planHash === planHash
        && review.generation.mode === 'production';
    } catch (error) { state.programError = error.message; }
  }
  return state;
}

// A content fingerprint for automatic viewer updates. Changed geometry or plan
// inputs invalidate their checks; an approval-only change does not.
async function bundleFingerprint(directory, {program=true,presentation=false}={}) {
  // Polling is a change notification, not a validity boundary. Reuse the file
  // digest while filesystem metadata is unchanged. loadBundle still reads
  // and hashes current bytes before review, approval, generation or delivery.
  const snapshot=(name,parse=false)=>fileSnapshot(resolve(directory,name),{parse});
  const [plan,geometry,machine]=await Promise.all([snapshot('plan.json',true),snapshot('geometry/model.json',true),snapshot('machine.json',true)]);
  const names = ['plan.json', 'machine.json', 'geometry/model.json', nativeFile(geometry), 'geometry/source.stl',...(!presentation?['review.json']:[]), ...(program?[exportPath(plan,machine)]:[])];
  const values = await Promise.all(names.map(async name => {
    return [name,await snapshot(name)];
  }));
  if(presentation){
    const review=await snapshot('review.json',true),generation=review?.generation;
    // Mode, confirmations and audit history update controls, not mesh/motion.
    // Every other generation claim remains part of source validity.
    const {mode,...identity}=generation??{};values.push(['generation',generation?identity:null]);
  }
  return hash(values);
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
  if(preparedProgram?.planHash===state.planHash)return preparedProgram;
  // One candidate per adapter. No approvals, files, or full producer path are
  // retained; the checked commands are committed only by generateBundle.
  preparedProgram=null;
  onProgress?.({stage:'Preparing geometry'});
  const path=await generatePath(state.plan,state.machine,{onProgress});
  onProgress?.({stage:'Writing and checking machine commands'});
  const {bytes,program}=exportAndInterpretProgram(path,state.plan,state.machine,{generatorVersion:VERSION,buildDate:BUILD_DATE});
  return preparedProgram={planHash:state.planHash,summary:path.summary,bytes,program};
}

// Chat-driven adjustment: the agent applies a patch, the plan is revalidated,
// and the affected approvals fall away. An unknown key is refused here as well
// as in the plan check, so a misspelled setting never silently does nothing.
async function adjustBundle(directory, patch, { setupFile, expectedRevision } = {}) {
  const state = await loadBundle(directory, { program: false });
  if(expectedRevision!==undefined)requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing the print.');
  const plan = structuredClone(state.plan);
  merge(plan, patch);
  if (patch.setup?.firmwareVersion !== undefined
    && patch.setup.firmwareVersion !== state.plan.setup.firmwareVersion
    && patch.setup.startupVerified === undefined) plan.setup.startupVerified = false;
  const updated=await updatePlan(directory, plan, state.revision);
  if (patch.setup) await rememberSetup(directory, { setupFile });
  return updated;
}

function merge(target, changes) {
  requireThat(changes && typeof changes === 'object' && !Array.isArray(changes), 'Adjustment must be an object.');
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
      merge(target.geometry, value);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) merge(target[key], value);
    else target[key] = value;
  }
}

async function updatePlan(directory, plan, revision) {
  const state = await loadBundle(directory, { program: false });
  requireThat(revision === state.revision, 'This view is stale. Reload before changing the print.');
  validatePlan(plan, state.machine);
  if (canonical(plan) === canonical(state.plan)) return state;

  const geometryChanged = canonical(plan.geometry) !== canonical(state.plan.geometry);
  if (geometryChanged) {
    const geometry = await createGeometry(plan.geometry);
    await save(resolve(state.dir, nativeFile(geometry.descriptor)), geometry.bytes);
    await save(resolve(state.dir, 'geometry/model.json'), geometry.descriptor);
  }
  const review = state.review;
  review.history.push({
    event: 'plan-edited', time: new Date().toISOString(), previousPlanHash: state.planHash,
    invalidated: geometryChanged ? ['geometry', 'plan', 'toolpath'] : ['plan', 'toolpath']
  });
  if (geometryChanged) delete review.approvals.geometry;
  delete review.approvals.plan;
  delete review.approvals.toolpath;
  review.generation = null;
  await save(resolve(state.dir, 'plan.json'), plan);
  await save(resolve(state.dir, 'review.json'), review);
  return loadBundle(directory);
}

// Generation performs the calculations the locked plan specifies. Production
// generation requires geometry confirmation; development generation
// is a preview and is recorded as one, so it can never satisfy delivery.
async function generateBundle(directory, { development = false, onProgress, beforeCommit } = {}) {
  const state = await loadBundle(directory, { program: false });
  requireThat(development || state.geometryApproved, 'Approve the geometry before production generation.');
  // Both modes use identical commands. Reuse a checked development export after
  // geometry confirmation, without slicing merely to change its mode. Current
  // input/runtime and byte identity still belong to loadBundle; no approval is added.
  if(!development&&state.review.generation?.mode==='development'){
    onProgress?.({stage:'Checking the reviewed file'});
    const current=await loadBundle(directory,{program:'source'});
    if(current.program&&!current.programError){
      requireThat(current.geometryApproved,'Approve the geometry before production generation.');
      const checks=await json(resolve(state.dir,'checks.json'));
      requireThat(checks.planHash===current.planHash&&checks.exportHash===current.exportHash&&checks.result==='pass','Saved checks do not match the reviewed export.');
      checks.mode='production';
      beforeCommit?.();
      await save(resolve(state.dir,'checks.json'),checks);
      current.review.generation.mode='production';
      current.review.history.push({event:'generation-reused',mode:'production',time:new Date().toISOString(),exportHash:current.exportHash});
      await save(resolve(state.dir,'review.json'),current.review);
      return checks;
    }
  }
  const prepared=await prepareProgram(state,onProgress);
  requireThat((await loadBundle(directory,{program:false})).planHash===state.planHash,'The print changed during generation. Review the updated print.');
  beforeCommit?.();
  onProgress?.({stage:'Saving your toolpath'});
  const {bytes:code,program,summary}=prepared;
  const checks = {
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
  await save(resolve(state.dir, exportPath(state.plan,state.machine)), code);
  await save(resolve(state.dir, 'checks.json'), checks);
  const review = state.review;
  delete review.approvals.toolpath;
  review.generation = { mode: checks.mode, planHash: state.planHash, exportHash: checks.exportHash, summary, version: VERSION };
  review.history.push({ event: 'generated', mode: checks.mode, time: new Date().toISOString(), exportHash: checks.exportHash });
  await save(resolve(state.dir, 'review.json'), review);
  // Remove an obsolete intermediate when regenerating an older bundle.
  await rm(resolve(state.dir,'path.saampath'),{force:true});
  rememberProgram(programKey(state.planHash,checks.exportHash),program,code);
  preparedProgram=null;
  return checks;
}

async function confirmGeometryFromChat(directory, {actor,expectedRevision,geometryHash,statement,chatReference}={}) {
  requireThat(typeof statement==='string'&&statement.trim().length>0&&statement.length<=8000,'Record the exact human geometry-confirmation statement.');
  requireThat(typeof chatReference==='string'&&chatReference.trim().length>0&&chatReference.length<=2000,'Identify the chat conversation and confirmation message.');
  requireThat(typeof geometryHash==='string'&&geometryHash.length>0,'Supply the geometry hash the person confirmed.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This review is stale. Reload before approving.');
  requireThat(geometryHash===state.geometryHash,'The confirmed geometry changed. Review the current shape before approving.');
  // This records a human decision already made in chat; it cannot determine
  // whether arbitrary words actually express approval. The caller owns that judgment.
  return approve(directory,{stage:'geometry',actor,revision:expectedRevision,program:false},
    {source:'chat',statement,chatReference,directory:state.dir,revision:expectedRevision,geometryHash});
}

async function approve(directory, { stage, actor, revision, program = true }, chatEvidence) {
  requireThat(['geometry', 'toolpath'].includes(stage), 'Confirm geometry first, then settings and toolpath together.');
  requireThat(typeof actor === 'string' && actor.trim().length >= 2 && actor.length <= 100, 'Enter the human reviewer’s name.');
  const state = await loadBundle(directory,{program});
  requireThat(revision === state.revision, 'This review is stale. Reload before approving.');
  if(chatEvidence)requireThat(stage==='geometry'&&chatEvidence.geometryHash===state.geometryHash&&chatEvidence.directory===state.dir,
    'Chat confirmation applies only to the exact selected geometry.');
  if (stage === 'toolpath') requireThat(state.geometryApproved && state.program && !state.programError
    && state.review.generation?.mode === 'production',
  'Generate and check the approved production plan before toolpath approval.');
  const record = {
    actor: actor.trim(), time: new Date().toISOString(),
    hash: stage === 'geometry' ? state.geometryHash : state.exportHash
  };
  if(chatEvidence)record.evidence=chatEvidence;
  if (stage === 'toolpath') {
    record.planHash = state.planHash;
    record.scope = ['settings','toolpath'];
    state.review.approvals.plan = {...record,hash:state.planHash};
  }
  state.review.approvals[stage] = record;
  state.review.history.push({ event: 'human-approval', stage, ...record });
  await save(resolve(state.dir, 'review.json'), state.review);
  state.geometryApproved=state.review.approvals.geometry?.hash===state.geometryHash;
  state.planApproved=state.geometryApproved&&state.review.approvals.plan?.hash===state.planHash;
  state.toolpathApproved=state.planApproved&&Boolean(state.program)&&!state.programError
    &&state.review.generation?.mode==='production'&&state.review.approvals.toolpath?.hash===state.exportHash
    &&state.review.approvals.toolpath?.planHash===state.planHash;
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
  return destination;
}

async function changeMachine(directory,machineId,{expectedRevision,setupFile}={}) {
  const state=await loadBundle(directory,{program:false});
  if(expectedRevision!==undefined)requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing the printer.');
  const machine=loadMachine(machineId),proposal=await proposedPlan(machineId,{setupFile});
  const process={...state.plan.process};
  for(const key of new Set([...Object.keys(state.machine.defaultProcess??{}),...Object.keys(machine.defaultProcess??{})]))process[key]=proposal.process[key];
  const plan={...state.plan,setup:proposal.setup,output:proposal.output,process};
  validatePlan(plan,machine);
  const review=state.review;
  delete review.approvals.plan;delete review.approvals.toolpath;review.generation=null;
  review.history.push({event:'machine-changed',from:state.machine.id,to:machineId,time:new Date().toISOString()});
  await save(resolve(state.dir,'machine.json'),machine);
  await save(resolve(state.dir,'plan.json'),plan);
  await save(resolve(state.dir,'review.json'),review);
  return loadBundle(directory,{program:false});
}

async function upgradeBundle(directory) {
  const plan=await json(resolve(directory,'plan.json'));
  const oldGeometry=canonical(plan.geometry);
  const geometry=await json(resolve(directory,'geometry/model.json'));
  await verifyGeometry(await readFile(resolve(directory,nativeFile(geometry))),geometry);
  requireThat(canonical(geometry.parameters)===oldGeometry,'Plan and geometry disagree; cannot upgrade.');
  const review=await json(resolve(directory,'review.json'));
  const previous=await json(resolve(directory,'machine.json'));
  const machine=loadMachine(previous.id);
  requireThat(previous.id===machine.id,'Cannot upgrade to a different machine.');
  if(adapter.upgradePlan) adapter.upgradePlan(plan,machine);
  validatePlan(plan,machine);
  if(canonical(plan.geometry)!==oldGeometry) {
    const next=await createGeometry(plan.geometry);
    await save(resolve(directory,nativeFile(next.descriptor)),next.bytes);
    await save(resolve(directory,'geometry/model.json'),next.descriptor);
    delete review.approvals.geometry;
  }
  delete review.approvals.plan; delete review.approvals.toolpath; review.generation=null;
  review.history.push({event:'generator-upgraded',version:VERSION,machineRevision:machine.revision,time:new Date().toISOString()});
  await save(resolve(directory,'plan.json'),plan);
  await save(resolve(directory,'machine.json'),machine);
  await save(resolve(directory,'review.json'),review);
}
return {root,defaultSetupFile,EXPORT_NAME,EXPORT_PATH,runtimeHash,proposedPlan,initBundle,loadBundle,bundleFingerprint,rememberSetup,checkPathBundle,adjustBundle,updatePlan,generateBundle,approve,confirmGeometryFromChat,deliver,changeMachine,upgradeBundle};
}
