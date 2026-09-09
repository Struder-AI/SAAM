// One print lifecycle for every geometry/generator adapter.
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportProgram, interpretProgram } from '../export/registry.mjs';
import { loadMachine } from '../machine/profile.mjs';
import { requireThat } from '../geom/tolerance.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultSetupFile=resolve(root,'.local/machine-setups/ultimaker-s5.json');
const setupFor=machine=>resolve(root,`.local/machine-setups/${machine.id}.json`);
const nativeFile=geometry=>{const name=geometry.nativeFile??'model.3dm';requireThat(['model.3dm','model.mesh.json'].includes(name),'Unsupported native geometry file.');return 'geometry/'+name;};
const canonical=value=>JSON.stringify(value,function(_key,item){return item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item;});
const hash=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:canonical(value)).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function save(file,value){
  await mkdir(dirname(file),{recursive:true});
  const temporary=file+'.tmp';
  await writeFile(temporary,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');
  await rename(temporary,file);
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
  async function runtimeHash(){
    return runtimeCache??=hash(await Promise.all([
      new URL('./workflow.mjs',import.meta.url), new URL('../export/griffin.mjs',import.meta.url),
      new URL('../export/registry.mjs',import.meta.url),new URL('../machine/profile.mjs',import.meta.url),
      new URL('../export/bambu.mjs',import.meta.url),new URL('../export/zip.mjs',import.meta.url),
      new URL('../geom/tolerance.mjs',import.meta.url), ...adapter.runtimeFiles
    ].map(async file=>[fileURLToPath(file).slice(root.length).replaceAll('\\','/'),await readFile(file,'utf8')])));
  }
async function initBundle(directory, plan, { setupFile, machineId, sourceBytes } = {}) {
  const dir = resolve(directory);
  try {
    await access(resolve(dir, 'plan.json'));
    throw new Error('Print already exists. Open it or choose another directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const machine = machineId?loadMachine(machineId):await json(machineFile);
  setupFile??=setupFor(machine);
  if (!plan) {
    plan = defaults(machine);
    const remembered = await rememberedSetup(setupFile, machine);
    if (remembered) plan.setup = { ...plan.setup, ...remembered, materialGuid: remembered.materialGuid || plan.setup.materialGuid };
  }
  validatePlan(plan, machine);
  const geometry = await createGeometry(plan.geometry);
  if(plan.geometry.source){
    requireThat(sourceBytes&&hash(sourceBytes)===plan.geometry.source.sha256,'STL source bytes are required; use import-stl.');
    await save(resolve(dir,'geometry/source.stl'),sourceBytes);
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
  const known = defaults().setup;
  return Object.fromEntries(Object.entries(saved.setup ?? {}).filter(([key]) => Object.hasOwn(known, key)));
}

async function loadBundle(directory, { program = true } = {}) {
  const dir = resolve(directory);
  const [plan, machine, geometry, review, runtime] = await Promise.all([
    json(resolve(dir, 'plan.json')), json(resolve(dir, 'machine.json')), json(resolve(dir, 'geometry/model.json')),
    json(resolve(dir, 'review.json')), runtimeHash()]);
  const bytes=await readFile(resolve(dir,nativeFile(geometry)));
  if(plan.geometry.source)requireThat(hash(await readFile(resolve(dir,'geometry/source.stl')))===plan.geometry.source.sha256,'Imported STL source changed; geometry approval is stale.');
  validatePlan(plan, machine);
  await verifyGeometry(bytes, geometry);
  requireThat(canonical(plan.geometry) === canonical(geometry.parameters),
    'Plan and geometry disagree. Ask the agent to recreate the geometry.');

  const geometryHash = hash({ file: hash(bytes), descriptor: geometry });
  const planHash = hash({ plan, machine, geometryHash, runtime });
  const state = {
    kind, dir, plan, machine, geometry, review, geometryHash, planHash, runtime,
    exportName: exportName(plan,machine), limitations: limitationsFor(plan, machine),
    outputAvailability:machine.outputs.find(o=>o.id===plan.output)?.implemented===false?`Machine-file export for ${machine.name} is not available yet; geometry and settings can be reviewed.`:null,
    skills: plan.skills ? Object.entries(plan.skills).filter(([, settings]) => settings.enabled).map(([name]) => name) : ['wedge-demo'],
    geometryApproved: review.approvals.geometry?.hash === geometryHash,
    planApproved: review.approvals.plan?.hash === planHash
  };
  state.planApproved &&= state.geometryApproved;
  state.toolpathApproved = false;
  state.revision = hash({ geometryHash, planHash, review });
  state.setupBasis = plan.setup.startupVerified
    ? 'Confirmed startup behavior'
    : machine.startup.validation;

  if (program && review.generation) {
    try {
      requireThat(review.generation.planHash === planHash, 'Generated program is stale; regenerate for the current plan.');
      const [code, path] = await Promise.all([readFile(resolve(dir, exportPath(plan,machine))), json(resolve(dir, 'path.saampath'))]);
      requireThat(hash(code) === review.generation.exportHash && hash(path) === review.generation.pathHash,
        'Generated files changed; regenerate and review again.');
      const regenerated = await generatePath(plan, machine);
      requireThat(canonical(path) === canonical(regenerated), 'SAAMpath does not match the locked recipe.');
      requireThat(code.equals(Buffer.from(exportProgram(regenerated, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE }))),
        'Export does not match SAAMpath.');
      state.program = interpretProgram(code, plan, machine);
      state.pathSummary = path.summary;
      state.exportHash = hash(code);
      state.code = state.program.code??code.toString('utf8');
      delete state.program.code;
      state.toolpathApproved = state.planApproved
        && review.approvals.toolpath?.hash === state.exportHash
        && review.approvals.toolpath?.planHash === planHash
        && review.generation.mode === 'production';
    } catch (error) { state.programError = error.message; }
  }
  return state;
}

// A cheap liveness fingerprint for automatic viewer updates. Full validation
// still runs on every changed snapshot and immediately before approval.
async function bundleFingerprint(directory) {
  const [plan,geometry,machine]=await Promise.all([json(resolve(directory,'plan.json')),json(resolve(directory,'geometry/model.json')),json(resolve(directory,'machine.json'))]);
  const names = ['plan.json', 'machine.json', 'geometry/model.json', nativeFile(geometry), 'geometry/source.stl','review.json', 'path.saampath', exportPath(plan,machine)];
  const values = await Promise.all(names.map(async name => {
    try { return [name, hash(await readFile(resolve(directory, name)))]; }
    catch (error) { if (error.code === 'ENOENT') return [name, null]; throw error; }
  }));
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

// Chat-driven adjustment: the agent applies a patch, the plan is revalidated,
// and the affected approvals fall away. An unknown key is refused here as well
// as in the plan check, so a misspelled setting never silently does nothing.
async function adjustBundle(directory, patch, { setupFile } = {}) {
  const state = await loadBundle(directory, { program: false });
  const plan = structuredClone(state.plan);
  merge(plan, patch);
  if (patch.setup?.firmwareVersion !== undefined
    && patch.setup.firmwareVersion !== state.plan.setup.firmwareVersion
    && patch.setup.startupVerified === undefined) plan.setup.startupVerified = false;
  await updatePlan(directory, plan, state.revision);
  if (patch.setup) await rememberSetup(directory, { setupFile });
  return loadBundle(directory, { program: false });
}

function merge(target, changes) {
  requireThat(changes && typeof changes === 'object' && !Array.isArray(changes), 'Adjustment must be an object.');
  for (const [key, value] of Object.entries(changes)) {
    requireThat(Object.hasOwn(target, key), `Unknown setting: ${key}`);
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
// generation requires the geometry and plan approvals; development generation
// is a preview and is recorded as one, so it can never satisfy delivery.
async function generateBundle(directory, { development = false } = {}) {
  const state = await loadBundle(directory, { program: false });
  requireThat(development || state.planApproved, 'Approve the geometry and locked plan before production generation.');
  const path = await generatePath(state.plan, state.machine);
  const code = exportProgram(path, state.plan, state.machine, { generatorVersion: VERSION, buildDate: BUILD_DATE });
  const program = interpretProgram(code, state.plan, state.machine);
  const expected = path.actions.filter(action => action.kind === 'move');
  requireThat(program.moves.length === expected.length,
    `The exported program has ${program.moves.length} moves; SAAMpath has ${expected.length}.`);
  for (let i = 0; i < expected.length; i++) {
    requireThat(expected[i].to.every((value, k) => Math.abs(value - program.moves[i].to[k]) <= 6e-6)
      && Math.abs(expected[i].volumeMm3 - program.moves[i].volumeMm3) <= 1e-4, 'Export round trip changed the path.');
  }
  const checks = {
    schema: 'saam-checks/1', result: 'pass', mode: development ? 'development' : 'production',
    generatorVersion: VERSION, planHash: state.planHash, pathHash: hash(path), exportHash: hash(code),
    moves: program.moves.length,
    volumeMm3: Number(program.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((program.seconds / 60).toFixed(1)),
    travel: path.summary.travel,
    nonplanarLimit: path.summary.nonplanarLimit ?? null,
    checks: ['plan-inputs', 'closed-geometry', 'native-geometry-round-trip', 'declared-output', ...(program.envelope?['fixed-firmware-envelope','archive-integrity','strict-print-body-interpretation']:['strict-gcode-interpretation']),
      'xyz-bounds', 'axis-feed', 'extrusion-flow', 'temperature-state', 'saampath-export-round-trip'],
    clearance: 'operator responsibility; no collision model implemented',
    physicalValidation: 'not performed',
    firmwareEnvelope: program.envelope??null,
    limitations: limitationsFor(state.plan, state.machine)
  };
  await save(resolve(state.dir, 'path.saampath'), path);
  await save(resolve(state.dir, exportPath(state.plan,state.machine)), code);
  await save(resolve(state.dir, 'checks.json'), checks);
  const review = state.review;
  delete review.approvals.toolpath;
  review.generation = { mode: checks.mode, planHash: state.planHash, exportHash: checks.exportHash, pathHash: checks.pathHash, version: VERSION };
  review.history.push({ event: 'generated', mode: checks.mode, time: new Date().toISOString(), exportHash: checks.exportHash });
  await save(resolve(state.dir, 'review.json'), review);
  return checks;
}

async function approve(directory, { stage, actor, revision }) {
  requireThat(['geometry', 'plan', 'toolpath'].includes(stage), 'Unknown approval stage.');
  requireThat(typeof actor === 'string' && actor.trim().length >= 2 && actor.length <= 100, 'Enter the human reviewer’s name.');
  const state = await loadBundle(directory);
  requireThat(revision === state.revision, 'This review is stale. Reload before approving.');
  if (stage === 'plan') requireThat(state.geometryApproved, 'Approve geometry first.');
  if (stage === 'toolpath') requireThat(state.planApproved && state.program && !state.programError
    && state.review.generation?.mode === 'production',
  'Generate and check the approved production plan before toolpath approval.');
  const record = {
    actor: actor.trim(), time: new Date().toISOString(),
    hash: stage === 'geometry' ? state.geometryHash : stage === 'plan' ? state.planHash : state.exportHash
  };
  if (stage === 'toolpath') record.planHash = state.planHash;
  state.review.approvals[stage] = record;
  state.review.history.push({ event: 'human-approval', stage, ...record });
  await save(resolve(state.dir, 'review.json'), state.review);
  return loadBundle(directory);
}

// Delivery copies the bytes that were reviewed. It re-reads and re-hashes them
// rather than regenerating, so nothing new can appear between review and file.
async function deliver(directory) {
  const state = await loadBundle(directory);
  requireThat(state.toolpathApproved, 'Delivery requires approval of the exact current export.');
  const bytes = await readFile(resolve(state.dir, exportPath(state.plan,state.machine)));
  requireThat(hash(bytes) === state.exportHash, 'Export changed during delivery.');
  const destination = resolve(state.dir, `delivery/${state.exportName}`);
  await save(destination, bytes);
  requireThat(hash(await readFile(destination)) === state.exportHash, 'Delivery bytes differ from reviewed export.');
  return destination;
}

async function upgradeBundle(directory) {
  const plan=await json(resolve(directory,'plan.json'));
  const review=await json(resolve(directory,'review.json'));
  const previous=await json(resolve(directory,'machine.json'));
  const machine=loadMachine(previous.id);
  requireThat(previous.id===machine.id,'Cannot upgrade to a different machine.');
  if(adapter.upgradePlan) adapter.upgradePlan(plan);
  validatePlan(plan,machine);
  delete review.approvals.plan; delete review.approvals.toolpath; review.generation=null;
  review.history.push({event:'generator-upgraded',version:VERSION,machineRevision:machine.revision,time:new Date().toISOString()});
  await save(resolve(directory,'plan.json'),plan);
  await save(resolve(directory,'machine.json'),machine);
  await save(resolve(directory,'review.json'),review);
}
return {root,defaultSetupFile,EXPORT_NAME,EXPORT_PATH,runtimeHash,initBundle,loadBundle,bundleFingerprint,rememberSetup,adjustBundle,updatePlan,generateBundle,approve,deliver,upgradeBundle};
}
