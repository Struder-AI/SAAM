// Print bundle and review workflow for shell prints (full-fill, draped-skin).
//
// The wedge demo owns its own bundle for its own bounded geometry. This is the
// same workflow for the shared core: one directory per print, a locked plan
// bound to the native 3DM and the generating source, three human approvals -
// geometry, locked plan, toolpath - and delivery of the exact reviewed bytes.
//
// Nothing here creates an approval on a person's behalf. `approve` records the
// name it is given, and every hash it records is checked again before delivery.

import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hash, defaults, geometryTemplate, validatePlan, VERSION, BUILD_DATE } from './plan.mjs';
import { createGeometry, verifyGeometry, rhino } from './geometry.mjs';
import { generatePath } from './generate.mjs';
import { exportGriffin, interpretGriffin } from '../export/griffin.mjs';
import { requireThat } from '../geom/tolerance.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const machineFile = resolve(root, 'machines/ultimaker-s5.json');
// Shared with the wedge demo: one remembered S5 setup per machine, not per skill.
export const defaultSetupFile = resolve(root, '.local/machine-setups/ultimaker-s5.json');
export const EXPORT_NAME = 'part.gcode';
export const EXPORT_PATH = `exports/griffin-gcode/${EXPORT_NAME}`;

const json = async file => JSON.parse(await readFile(file, 'utf8'));

async function save(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await writeFile(temporary, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}

// The plan lock covers the source that generates from it, so a runtime change
// invalidates a plan approval instead of silently regenerating something else.
const RUNTIME_FILES = [
  '../geom/nurbs.mjs', '../geom/section.mjs', '../geom/shell.mjs', '../geom/shapes.mjs', '../geom/field.mjs',
  '../geom/tolerance.mjs', '../region/region2d.mjs', '../region/boolean.mjs', '../path/builder.mjs',
  '../export/griffin.mjs', './plan.mjs', './generate.mjs', './geometry.mjs', './bundle.mjs',
  '../../skills/full-fill/scripts/fill.mjs', '../../skills/draped-skin/scripts/drape.mjs'
];
let runtimeCache;
export async function runtimeHash() {
  return runtimeCache ??= hash(await Promise.all(RUNTIME_FILES.map(async name =>
    [name, await readFile(new URL(name, import.meta.url), 'utf8')])));
}

export const LIMITATIONS = [
  'Physical clearance is the operator’s responsibility; no collision model is implemented.',
  'Bead shape, perimeter overlap and skin stacking are approximations; no part from these skills has been printed.',
  'Contour sampling is bounded by minFeatureMm; a closed feature smaller than that can be missed.',
  'The machine’s non-planar angle limit is a declared software limit, not a measured clearance rating.',
  'Griffin firmware startup is external; its internal motions are not simulated.'
];

const limitationsFor = (plan, machine) => {
  const override = plan.skills['draped-skin'].maxAngleDegOverride;
  return override === null ? LIMITATIONS : [...LIMITATIONS,
    `EXPERIMENTAL: this print overrides the machine profile’s declared ${machine.nonplanar.maxAngleDeg}° non-planar limit with ${override}°. Physical clearance and deposition behavior are unvalidated.`];
};

export async function initBundle(directory, plan, { setupFile = defaultSetupFile } = {}) {
  const dir = resolve(directory);
  try {
    await access(resolve(dir, 'plan.json'));
    throw new Error('Print already exists. Open it or choose another directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const machine = await json(machineFile);
  if (!plan) {
    plan = defaults();
    const remembered = await rememberedSetup(setupFile, machine);
    if (remembered) plan.setup = { ...plan.setup, ...remembered, materialGuid: remembered.materialGuid || plan.setup.materialGuid };
  }
  validatePlan(plan, machine);
  const geometry = await createGeometry(plan.geometry);
  await save(resolve(dir, 'geometry/model.3dm'), geometry.bytes);
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

export async function loadBundle(directory, { program = true } = {}) {
  const dir = resolve(directory);
  const [plan, machine, geometry, review, bytes, runtime] = await Promise.all([
    json(resolve(dir, 'plan.json')), json(resolve(dir, 'machine.json')), json(resolve(dir, 'geometry/model.json')),
    json(resolve(dir, 'review.json')), readFile(resolve(dir, 'geometry/model.3dm')), runtimeHash()]);
  validatePlan(plan, machine);
  await verifyGeometry(bytes, geometry);
  requireThat(canonical(plan.geometry) === canonical(geometry.parameters),
    'Plan and geometry disagree. Ask the agent to recreate the geometry.');

  const geometryHash = hash({ file: hash(bytes), descriptor: geometry });
  const planHash = hash({ plan, machine, geometryHash, runtime });
  const state = {
    kind: 'shell', dir, plan, machine, geometry, review, geometryHash, planHash, runtime,
    exportName: EXPORT_NAME, limitations: limitationsFor(plan, machine),
    skills: Object.entries(plan.skills).filter(([, settings]) => settings.enabled).map(([name]) => name),
    geometryApproved: review.approvals.geometry?.hash === geometryHash,
    planApproved: review.approvals.plan?.hash === planHash
  };
  state.planApproved &&= state.geometryApproved;
  state.toolpathApproved = false;
  state.revision = hash({ geometryHash, planHash, review });
  state.setupBasis = plan.setup.startupVerified
    ? 'Confirmed startup behavior'
    : 'Standard S5 Griffin startup without routine bed leveling assumed';

  if (program && review.generation) {
    try {
      requireThat(review.generation.planHash === planHash, 'Generated program is stale; regenerate for the current plan.');
      const [code, path] = await Promise.all([readFile(resolve(dir, EXPORT_PATH), 'utf8'), json(resolve(dir, 'path.saampath'))]);
      requireThat(hash(code) === review.generation.exportHash && hash(path) === review.generation.pathHash,
        'Generated files changed; regenerate and review again.');
      const regenerated = generatePath(plan, machine, await rhino());
      requireThat(canonical(path) === canonical(regenerated), 'SAAMpath does not match the locked recipe.');
      requireThat(code === exportGriffin(regenerated, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE }),
        'Export does not match SAAMpath.');
      state.program = interpretGriffin(code, plan, machine);
      state.pathSummary = path.summary;
      state.exportHash = hash(code);
      state.code = code;
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
export async function bundleFingerprint(directory) {
  const names = ['plan.json', 'machine.json', 'geometry/model.json', 'geometry/model.3dm', 'review.json', 'path.saampath', EXPORT_PATH];
  const values = await Promise.all(names.map(async name => {
    try { return [name, hash(await readFile(resolve(directory, name)))]; }
    catch (error) { if (error.code === 'ENOENT') return [name, null]; throw error; }
  }));
  return hash(values);
}

export async function rememberSetup(directory, { setupFile = defaultSetupFile, source = 'User setup supplied through chat' } = {}) {
  const state = await loadBundle(directory, { program: false });
  await save(setupFile, {
    schema: 'saam-machine-setup/1', machineId: state.machine.id, setup: state.plan.setup,
    source, updatedAt: new Date().toISOString()
  });
  return setupFile;
}

// Chat-driven adjustment: the agent applies a patch, the plan is revalidated,
// and the affected approvals fall away. An unknown key is refused here as well
// as in the plan check, so a misspelled setting never silently does nothing.
export async function adjustBundle(directory, patch, { setupFile = defaultSetupFile } = {}) {
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
    if (key === 'geometry' && value && typeof value === 'object' && !Array.isArray(value)
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

export async function updatePlan(directory, plan, revision) {
  const state = await loadBundle(directory, { program: false });
  requireThat(revision === state.revision, 'This view is stale. Reload before changing the print.');
  validatePlan(plan, state.machine);
  if (canonical(plan) === canonical(state.plan)) return state;

  const geometryChanged = canonical(plan.geometry) !== canonical(state.plan.geometry);
  if (geometryChanged) {
    const geometry = await createGeometry(plan.geometry);
    await save(resolve(state.dir, 'geometry/model.3dm'), geometry.bytes);
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
export async function generateBundle(directory, { development = false } = {}) {
  const state = await loadBundle(directory, { program: false });
  requireThat(development || state.planApproved, 'Approve the geometry and locked plan before production generation.');
  const path = generatePath(state.plan, state.machine, await rhino());
  const code = exportGriffin(path, state.plan, state.machine, { generatorVersion: VERSION, buildDate: BUILD_DATE });
  const program = interpretGriffin(code, state.plan, state.machine);
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
    checks: ['plan-inputs', 'closed-shell', '3dm-round-trip', 'declared-output', 'strict-gcode-interpretation',
      'xyz-bounds', 'axis-feed', 'temperature-state', 'saampath-export-round-trip'],
    clearance: 'operator responsibility; no collision model implemented',
    physicalValidation: 'not performed',
    limitations: limitationsFor(state.plan, state.machine)
  };
  await save(resolve(state.dir, 'path.saampath'), path);
  await save(resolve(state.dir, EXPORT_PATH), code);
  await save(resolve(state.dir, 'checks.json'), checks);
  const review = state.review;
  delete review.approvals.toolpath;
  review.generation = { mode: checks.mode, planHash: state.planHash, exportHash: checks.exportHash, pathHash: checks.pathHash, version: VERSION };
  review.history.push({ event: 'generated', mode: checks.mode, time: new Date().toISOString(), exportHash: checks.exportHash });
  await save(resolve(state.dir, 'review.json'), review);
  return checks;
}

export async function approve(directory, { stage, actor, revision }) {
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
export async function deliver(directory) {
  const state = await loadBundle(directory);
  requireThat(state.toolpathApproved, 'Delivery requires approval of the exact current export.');
  const bytes = await readFile(resolve(state.dir, EXPORT_PATH));
  requireThat(hash(bytes) === state.exportHash, 'Export changed during delivery.');
  const destination = resolve(state.dir, `delivery/${EXPORT_NAME}`);
  await save(destination, bytes);
  requireThat(hash(await readFile(destination)) === state.exportHash, 'Delivery bytes differ from reviewed export.');
  return destination;
}
