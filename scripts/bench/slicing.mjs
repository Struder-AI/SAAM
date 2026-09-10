// Reproducible, opt-in development benchmark. Never creates approvals or delivers programs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import rhino3dm from 'rhino3dm';
import { fixtures, fixtureShell, disposeShell, meshAtTolerance, binarySTL, rhino6Bytes } from './fixtures.mjs';
import { makeMesh, parseSTL } from '../../core/geom/mesh.mjs';
import { sectionGeometry, topAt } from '../../core/geom/query.mjs';
import { signedArea } from '../../core/geom/shell.mjs';
import { translateShell } from '../../core/print/generate.mjs';
import { defaults, VERSION, BUILD_DATE } from '../../core/print/plan.mjs';
import { loadMachine, startupPosition, toolBounds, checkMachinePath } from '../../core/machine/profile.mjs';
import { fullFillResult, layerHeights } from '../../skills/full-fill/scripts/fill.mjs';
import { planarInfillResults } from '../../skills/planar-infill/scripts/infill.mjs';
import { surveySurface, drapedSkinResult } from '../../skills/draped-skin/scripts/drape.mjs';
import { PathBuilder } from '../../core/path/builder.mjs';
import { composeResults } from '../../core/path/compose.mjs';
import { planarSupportTopAt } from '../../core/print/regions.mjs';
import { exportProgram, interpretProgram } from '../../core/export/registry.mjs';

const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = path.resolve(arg('--out', '.local/slicing-bench'));
const trials = Number(arg('--trials', '3'));
if (!Number.isInteger(trials) || trials < 1 || trials > 20) throw new Error('--trials must be 1–20');
const machine = loadMachine('ultimaker-s5');
const measure = fn => { const t = performance.now(), value = fn(); return { ms: performance.now() - t, value }; };
const stats = values => { const a = [...values].sort((x, y) => x - y); return { medianMs: a[Math.floor(a.length / 2)], minMs: a[0], maxMs: a.at(-1), samplesMs: values }; };

function sectionBatch(shell, zs) {
  return zs.map(z => { const s = sectionGeometry(shell, z, { minFeatureMm: 0.4 });
    return { z, loops: s.loops, nudge: s.nudgedByMm, area: s.loops.reduce((a, l) => a + signedArea(l), 0) }; });
}
function roofPoints(name) {
  const f = fixtures[name], points = [];
  // Interior XY grid shared between representations, away from silhouette ambiguity.
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) points.push([f.width * (0.2 + 0.6 * (i + 0.37) / 16), f.depth * (0.2 + 0.6 * (j + 0.61) / 16)]);
  return points;
}
function compose(shell, plan, results) {
  const b = new PathBuilder({ start: startupPosition(machine, plan), process: plan.process, machine, generatorVersion: VERSION });
  b.motionBounds = toolBounds(machine, plan.setup.tool); b.planMaxZ = shell.bounds.max[2]; b.setContext('start', 0); b.fan(0);
  const summary = composeResults(b, results, plan.composition);
  b.setContext('finish', 0); b.retract(); b.move([b.position[0], b.position[1], shell.bounds.max[2] + plan.process.liftMm], plan.process.zSpeedMmS); b.fan(0);
  const result = b.toPath({ benchmark: true, composition: summary }); checkMachinePath(result, plan, machine); return result;
}
function skillTrial(shell, mode) {
  const plan = defaults(machine); plan.process.minimumLayerSeconds = 0;
  plan.skills['draped-skin'].enabled = mode === 'draped';
  plan.skills['planar-infill'].enabled = mode === 'planar';
  plan.skills['full-fill'].mode = mode === 'planar' ? 'solid-surfaces' : 'body';
  let survey = null, results;
  const time = {};
  const t = performance.now();
  if (mode === 'draped') { const m = measure(() => surveySurface(shell, plan.skills['draped-skin'], machine.nonplanar.maxAngleDeg)); survey = m.value; time.surveyMs = m.ms; }
  const p = measure(() => mode === 'planar' ? planarInfillResults({ shell, plan, solid: true }).filter(Boolean)
    : [fullFillResult({ shell, plan, reserve: survey })]);
  results = p.value; time.bodyMs = p.ms;
  if (mode === 'draped') { const m = measure(() => drapedSkinResult({ shell, plan, machine, survey,
    supportTopAt: planarSupportTopAt([{ shell }], plan.process, { allowBridge: true }),
    after: results.flatMap(r => r.operations.map(o => o.id)) })); results.push(m.value); time.skinMs = m.ms; }
  const c = measure(() => compose(shell, plan, results)); time.composeAndCheckMs = c.ms; time.sliceMs = performance.now() - t;
  const e = measure(() => exportProgram(c.value, plan, machine, { generatorVersion: VERSION, buildDate: BUILD_DATE })); time.exportMs = e.ms;
  const k = measure(() => interpretProgram(e.value, plan, machine)); time.interpretMs = k.ms;
  const actions = c.value.actions;
  return { time, actions: actions.length, depositedMm3: actions.reduce((v, a) => v + (a.volumeMm3 ?? 0), 0),
    operations: results.reduce((n, r) => n + r.operations.length, 0), exportBytes: Buffer.byteLength(e.value),
    pathHash: sha(c.value), exportHash: sha(e.value), reports: results.map(r => ({ id: r.id, report: r.report })) };
}

async function worker() {
  const config = json(arg('--worker')), result = { name: config.name, backend: config.backend, phases: {}, errors: [] };
  const t = performance.now(), r = await rhino3dm(); result.rhinoStartupMs = performance.now() - t;
  const build = () => config.backend === 'spline' ? fixtureShell(r, config.name)
    : makeMesh(config.mesh.vertices, config.mesh.triangles);
  const first = measure(build), shell = first.value; result.firstPrepareMs = first.ms;
  const prepare = [];
  for (let i = 0; i < trials; i++) { const m = measure(build); prepare.push(m.ms); disposeShell(m.value); }
  result.phases.prepare = stats(prepare);
  const zs = layerHeights(defaults(machine).process, 0, fixtures[config.name].height + fixtures[config.name].roofControlRise * 0.5625);
  const points = roofPoints(config.name);
  for (const [name, fn] of [['sections', () => sectionBatch(shell, zs)], ['roof256', () => points.map(p => topAt(shell, ...p))]]) {
    try { const cold = measure(fn), samples = []; let value = cold.value;
      for (let i = 0; i < trials; i++) { const m = measure(fn); samples.push(m.ms); value = m.value; }
      result.phases[name] = { firstMs: cold.ms, ...stats(samples) };
      if (name === 'sections') result.sectionSummary = { queries: zs.length, nonempty: value.filter(s => s.loops.length).length, vertices: value.reduce((n, s) => n + s.loops.flat().length, 0), nudges: value.filter(s => s.nudge).length };
      else if (value.some(v => !v)) throw new Error('Missing roof query');
    } catch (error) { result.errors.push({ phase: name, message: error.message, stack: error.stack }); }
  }
  const placed = translateShell(shell, 100, 100);
  for (const mode of config.modes) {
    process.stderr.write(`${config.name} ${config.backend} ${mode}\n`);
    const attemptStarted = performance.now();
    try { const first = skillTrial(placed, mode), samples = [];
      for (let i = 0; i < trials; i++) samples.push(skillTrial(placed, mode));
      if (samples.some(s => s.pathHash !== first.pathHash || s.exportHash !== first.exportHash)) throw new Error('Nondeterministic path/export');
      result.phases[mode] = Object.fromEntries(Object.keys(first.time).map(k => [k, { firstMs: first.time[k], ...stats(samples.map(s => s.time[k])) }]));
      result[mode] = { ...samples.at(-1), time: undefined };
    } catch (error) { result.errors.push({ phase: mode, message: error.message, stack: error.stack, failedAttemptMs: performance.now() - attemptStarted }); }
    save(config.result, result);
  }
  result.maxRssKiB = process.resourceUsage().maxRSS; disposeShell(shell);
  save(config.result, result);
}

function pointSegment(p, a, b) {
  const d = b.map((x, i) => x - a[i]), t = Math.max(0, Math.min(1, d.reduce((s, x, i) => s + (p[i] - a[i]) * x, 0) / (d.reduce((s, x) => s + x * x, 0) || 1)));
  return Math.hypot(...p.map((x, i) => x - a[i] - t * d[i]));
}
function directedDistance(a, b) {
  let max = 0;
  for (const l of a) for (let i = 0; i < l.length; i++) for (const t of [0, 0.25, 0.5, 0.75]) {
    const p = l[i].map((v, k) => v + (l[(i + 1) % l.length][k] - v) * t);
    let min = Infinity;
    for (const q of b) for (let j = 0; j < q.length; j++) min = Math.min(min, pointSegment(p, q[j], q[(j + 1) % q.length]));
    max = Math.max(max, min);
  }
  return max;
}
function fidelity(source, mesh, name) {
  const f = fixtures[name], zs = [0.001, ...Array.from({ length: 9 }, (_, i) => f.height * (i + 0.43) / 9), f.height - 0.001];
  if (f.roofControlRise) zs.push(f.height + f.roofControlRise * 0.13, f.height + f.roofControlRise * 0.41);
  let maxContourMm = 0, maxAreaRelative = 0;
  for (const z of zs) {
    const [a, b] = [source, mesh].map(s => sectionGeometry(s, z).loops);
    if (!a.length || a.length !== b.length) throw new Error('Section topology mismatch at ' + z);
    maxContourMm = Math.max(maxContourMm, directedDistance(a, b), directedDistance(b, a));
    const areas = [a, b].map(loops => loops.reduce((v, l) => v + signedArea(l), 0));
    maxAreaRelative = Math.max(maxAreaRelative, Math.abs(areas[0] - areas[1]) / areas[0]);
  }
  let maxRoofMm = 0, maxNormalDeg = 0;
  for (const p of roofPoints(name)) {
    const [a, b] = [source, mesh].map(s => topAt(s, ...p));
    if (!a || !b) throw new Error('Roof coverage mismatch');
    maxRoofMm = Math.max(maxRoofMm, Math.abs(a.zMm - b.zMm));
    maxNormalDeg = Math.max(maxNormalDeg, Math.acos(Math.max(-1, Math.min(1, a.normal.reduce((v, x, i) => v + x * b.normal[i], 0)))) * 180 / Math.PI);
  }
  return { sectionPlanes: zs.length, roofQueries: 256, maxContourMm, maxAreaRelative, maxRoofMm, maxNormalDeg,
    qualification: 'Sampled comparisons, not a certified Hausdorff bound; shallow roof cuts amplify vertical error.' };
}

async function runChild(config, id) {
  const configPath = path.join(out, id + '.job.json'); config.result = path.join(out, id + '.result.json'); save(configPath, config);
  const start = performance.now();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', configPath, '--trials', String(trials)], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', b => process.stderr.write(b));
    const timer = setTimeout(() => { child.kill(); reject(new Error('Benchmark worker timeout: ' + id)); }, Number(arg('--timeout', '600')) * 1000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Worker exit ' + code)); });
  });
  return { ...json(config.result), workerWallMs: performance.now() - start };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const names = arg('--fixtures', 'box,twisted-box').split(','), targetArg = arg('--targets', '0.1,0.025,0.005');
  const targets = targetArg === 'none' ? [] : targetArg.split(',').map(Number);
  if (names.some(n => !Object.hasOwn(fixtures, n))) throw new Error('Unknown fixture');
  if (targets.some(t => !Number.isFinite(t) || t <= 0)) throw new Error('Invalid mesh targets');
  const modes = arg('--modes', 'full,planar,draped').split(',');
  if (modes.some(m => !['full', 'planar', 'draped'].includes(m))) throw new Error('Invalid skill mode');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const runtimeFiles = [...git('ls-files', 'core', 'skills', 'machines', 'package-lock.json').split('\n').filter(p => /\.(mjs|json)$/.test(p)),
    'scripts/bench/slicing.mjs', 'scripts/bench/fixtures.mjs'];
  const sourceHashes = Object.fromEntries(runtimeFiles.map(p => [p, sha(fs.readFileSync(path.join(root, p)))]));
  const report = { date: new Date().toISOString(), node: process.version, platform: process.platform, cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length, totalMemoryGiB: os.totalmem() / 2 ** 30, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--short'),
    sourceHashes, runtimeHash: sha(sourceHashes), trials, modes, targets, results: [], fixtures: [], errors: [],
    process: { ...defaults(machine).process, minimumLayerSeconds: 0 }, skillSettings: defaults(machine).skills,
    timingBoundary: 'Prepared-geometry skills, shared composition + machine checks. Excludes production plan validation, bundle I/O, runtime hashing, native reopening, Studio, delivery and OS process launch. Export/interpretation reported separately. All workers serial; one first run plus warm repeats. No forced GC.' };
  const r = await rhino3dm();
  for (const name of names) {
    process.stderr.write(`Preparing ${name}\n`);
    const shell = fixtureShell(r, name), record = { name, parameters: fixtures[name], meshes: [] };
    fs.writeFileSync(path.join(out, name + '.3dm'), rhino6Bytes(r, shell));
    const jobs = [{ name, backend: 'spline', modes }];
    const seen = new Set();
    for (const target of targets) {
      try {
        const t = measure(() => meshAtTolerance(shell, target)), mesh = t.value;
        if (seen.has(mesh.n)) continue; seen.add(mesh.n);
        const bytes = binarySTL(mesh), file = `${name}-${target}mm.stl`; fs.writeFileSync(path.join(out, file), bytes);
        // Time and test the exact binary STL that will be used in external slicers.
        const imported = measure(() => parseSTL(bytes, { units: 'mm' }));
        const quality = fidelity(shell, makeMesh(imported.value.vertices, imported.value.triangles), name);
        record.meshes.push({ targetMm: target, grid: mesh.n, triangles: mesh.triangles.length, sampledMaxErrorMm: mesh.sampledMaxErrorMm,
          tessellateAndValidateMs: t.ms, stlImportAndValidateMs: imported.ms, stl: file, stlSHA256: sha(bytes), quality });
        jobs.push({ name, backend: `mesh-${target}`, mesh: imported.value, modes });
        if (args.includes('--native-mesh')) jobs.push({ name, backend: `native-mesh-${target}`, mesh: { vertices: mesh.vertices, triangles: mesh.triangles }, modes });
      } catch (error) { report.errors.push({ name, target, phase: 'prepare/fidelity', message: error.message }); }
    }
    const external = arg('--stl');
    if (external) {
      if (names.length !== 1) throw new Error('--stl requires exactly one --fixtures name');
      const bytes = fs.readFileSync(external), t = measure(() => parseSTL(bytes, { units: 'mm' }));
      fs.writeFileSync(path.join(out, 'rhino-standard.stl'), bytes);
      const quality = fidelity(shell, makeMesh(t.value.vertices, t.value.triangles), name);
      record.meshes.push({ stl: path.resolve(external), stlSHA256: sha(bytes), triangles: t.value.triangles.length, stlImportAndValidateMs: t.ms, quality });
      jobs.push({ name, backend: 'rhino-stl', mesh: t.value, modes });
    }
    report.fixtures.push(record); save(path.join(out, 'results.json'), report);
    disposeShell(shell);
    // Alternate placement of the spline candidate across fixtures to expose order bias.
    if (report.fixtures.length % 2 === 0) jobs.reverse();
    for (const job of jobs) {
      try { report.results.push(await runChild(job, name + '-' + job.backend)); }
      catch (error) { report.errors.push({ name, backend: job.backend, message: error.message }); }
      save(path.join(out, 'results.json'), report);
    }
  }
  report.runtimeUnchanged = runtimeFiles.every(p => sha(fs.readFileSync(path.join(root, p))) === sourceHashes[p]);
  report.errors.push(...report.results.flatMap(r => r.errors.map(e => ({ name: r.name, backend: r.backend, ...e }))));
  report.finished = new Date().toISOString(); save(path.join(out, 'results.json'), report);
  const lines = ['fixture,backend,triangles,prepare_ms,sections_ms,roof256_ms,full_slice_ms,planar_slice_ms,draped_slice_ms'];
  for (const result of report.results) lines.push([result.name, result.backend,
    report.fixtures.find(f => f.name === result.name).meshes.find(m => result.backend === `mesh-${m.targetMm}` || result.backend === `native-mesh-${m.targetMm}` || result.backend === 'rhino-stl' && !m.targetMm)?.triangles ?? '',
    ...['prepare', 'sections', 'roof256'].map(k => result.phases[k]?.medianMs ?? ''),
    ...['full', 'planar', 'draped'].map(k => result.phases[k]?.sliceMs?.medianMs ?? '')].join(','));
  fs.writeFileSync(path.join(out, 'summary.csv'), lines.join('\n') + '\n');
  console.log(JSON.stringify({ out, candidates: report.results.length, errors: report.errors, runtimeUnchanged: report.runtimeUnchanged }));
}

if (args.includes('--worker')) await worker(); else await main();
