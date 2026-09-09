// Command line for shell-based prints (full-fill and draped-skin).
//
// Two ways in, and the difference matters:
//
//   * `preview` writes a standalone development preview - plan, SAAMpath,
//     export and software checks in a plain directory. It records no approvals
//     and cannot be delivered.
//   * `init` creates a print bundle with native geometry and a review record.
//     A person then reviews it in SAAM Studio and gives the three approvals;
//     only after toolpath approval can `deliver` copy the reviewed bytes out.
//
// No command here approves anything on a person's behalf.

import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import rhino3dm from 'rhino3dm';
import { defaults, validatePlan, canonical, hash, VERSION, BUILD_DATE } from './plan.mjs';
import { generatePath } from './generate.mjs';
import { exportGriffin, interpretGriffin } from '../export/griffin.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import { initBundle, loadBundle, generateBundle, adjustBundle, rememberSetup, deliver } from './bundle.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const exists = async file => { try { await access(file); return true; } catch { return false; } };

async function save(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}

export async function makePreview(directory, { plan = defaults(), machineFile = resolve(root, 'machines/ultimaker-s5.json') } = {}) {
  const machine = await readJson(machineFile);
  validatePlan(plan, machine);
  const rhino = await rhino3dm();
  const path = generatePath(plan, machine, rhino);
  const code = exportGriffin(path, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE });
  const checks = runChecks(path, code, plan, machine);

  const directoryPath = resolve(directory);
  await save(resolve(directoryPath, 'plan.json'), plan);
  await save(resolve(directoryPath, 'machine.json'), machine);
  await save(resolve(directoryPath, 'path.saampath'), path);
  await save(resolve(directoryPath, 'exports/griffin-gcode/part.gcode'), code);
  await save(resolve(directoryPath, 'checks.json'), checks);
  return { directory: directoryPath, path, code, checks };
}

// Software checks only. None of these establish clearance or that the part
// prints; they establish that the program matches the plan and the machine's
// declared limits.
export function runChecks(path, code, plan, machine) {
  const program = interpretGriffin(code, plan, machine);
  const expected = path.actions.filter(action => action.kind === 'move');
  requireThat(program.moves.length === expected.length,
    `The exported program has ${program.moves.length} moves; SAAMpath has ${expected.length}.`);
  let worstPoint = 0, worstVolume = 0;
  for (let i = 0; i < expected.length; i++) {
    for (let k = 0; k < 3; k++) worstPoint = Math.max(worstPoint, Math.abs(expected[i].to[k] - program.moves[i].to[k]));
    worstVolume = Math.max(worstVolume, Math.abs(expected[i].volumeMm3 - program.moves[i].volumeMm3));
  }
  requireThat(worstPoint <= 6e-6, 'Export round trip moved a coordinate.');
  requireThat(worstVolume <= 1e-4, 'Export round trip changed a deposited volume.');
  return {
    schema: 'saam-checks/1',
    result: 'pass',
    mode: 'development',
    generatorVersion: VERSION,
    planHash: hash(canonical(plan)),
    pathHash: hash(path),
    exportHash: hash(code),
    moves: program.moves.length,
    volumeMm3: Number(program.volumeMm3.toFixed(3)),
    estimatedMinutes: Number((program.seconds / 60).toFixed(1)),
    travel: path.summary.travel,
    checks: ['plan-inputs', 'closed-shell', 'declared-output', 'strict-gcode-interpretation',
      'xyz-bounds', 'axis-feed', 'temperature-state', 'saampath-export-round-trip'],
    clearance: 'operator responsibility; no collision model implemented',
    approvals: 'none; this is a development preview and cannot be delivered',
    physicalValidation: 'not performed'
  };
}

export async function checkPreview(directory) {
  const directoryPath = resolve(directory);
  const [plan, machine, saved, code] = await Promise.all([
    readJson(resolve(directoryPath, 'plan.json')),
    readJson(resolve(directoryPath, 'machine.json')),
    readJson(resolve(directoryPath, 'path.saampath')),
    readFile(resolve(directoryPath, 'exports/griffin-gcode/part.gcode'), 'utf8')
  ]);
  const rhino = await rhino3dm();
  const regenerated = generatePath(plan, machine, rhino);
  requireThat(canonical(regenerated) === canonical(saved), 'Regenerating the locked plan produced a different SAAMpath.');
  const rebuilt = exportGriffin(regenerated, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE });
  requireThat(rebuilt === code, 'The stored export does not match the plan.');
  return runChecks(regenerated, code, plan, machine);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const [command, target, argument] = process.argv.slice(2);
  const bundleDirectory = () => resolve(target ?? 'Prints/shell-part');
  const report = state => JSON.stringify({
    print: state.dir, skills: state.skills, revision: state.revision,
    geometryApproved: state.geometryApproved, planApproved: state.planApproved, toolpathApproved: state.toolpathApproved,
    program: state.program?.summary ?? null, programError: state.programError ?? null,
    nonplanarLimit: state.pathSummary?.nonplanarLimit ?? null, limitations: state.limitations
  }, null, 2);

  const run = async () => {
    if (command === 'preview' || command === undefined) {
      const directory = target ?? 'Prints/shell-preview';
      const plan = argument ? await readJson(resolve(argument)) : defaults();
      const { checks } = await makePreview(directory, { plan });
      console.log(`Development preview written to ${directory}`);
      console.log(`  ${checks.moves} moves, ${checks.volumeMm3} mm3, about ${checks.estimatedMinutes} minutes of commanded motion`);
      console.log(`  travel: ${checks.travel.combed} direct, ${checks.travel.hopped} lifted, ${checks.travel.retractions} retractions`);
      console.log('  No approvals were created. This preview cannot be delivered to a machine.');
    } else if (command === 'init') {
      const plan = argument ? await readJson(resolve(argument)) : undefined;
      const directory = await initBundle(bundleDirectory(), plan);
      console.log(`Print created at ${directory}`);
      console.log(`Open it for review with: npm run studio -- ${directory}`);
      console.log('Nothing is approved yet; the three approvals are made by a person in Studio.');
    } else if (command === 'demo') {
      const directory = bundleDirectory();
      try { await access(resolve(directory, 'plan.json')); } catch { await initBundle(directory); }
      const checks = await generateBundle(directory, { development: true });
      console.log(`Development generation only; no human approvals created.`);
      console.log(`  ${checks.moves} moves, about ${checks.estimatedMinutes} minutes`);
      console.log(`Print: ${directory}`);
      console.log(`Open Studio with: npm run studio -- ${directory}`);
    } else if (command === 'generate') {
      console.log(JSON.stringify(await generateBundle(bundleDirectory()), null, 2));
    } else if (command === 'adjust') {
      if (!argument) throw new Error('Supply a JSON patch file after the print directory.');
      const state = await adjustBundle(bundleDirectory(), await readJson(resolve(argument)));
      console.log(JSON.stringify({ revision: state.revision, plan: state.plan }, null, 2));
    } else if (command === 'remember-setup') {
      console.log(await rememberSetup(bundleDirectory()));
    } else if (command === 'deliver') {
      console.log(await deliver(bundleDirectory()));
    } else if (command === 'check') {
      const directory = bundleDirectory();
      // A bundle checks its approvals as well as its files; a bare preview
      // directory only has files to check.
      if (await exists(resolve(directory, 'review.json'))) {
        const state = await loadBundle(directory);
        console.log(report(state));
        if (state.programError) process.exitCode = 1;
      } else {
        const checks = await checkPreview(directory);
        console.log(`Reopened ${directory}: regeneration and export match (${checks.moves} moves).`);
      }
    } else {
      console.error('Usage: cli.mjs preview [directory] [plan.json]');
      console.error('       cli.mjs init|demo|generate|check|deliver|remember-setup [print-directory] [plan.json]');
      console.error('       cli.mjs adjust <print-directory> <patch.json>');
      process.exitCode = 1;
    }
  };
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
