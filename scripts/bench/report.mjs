// Summarize existing runs without rerunning any benchmark.
import fs from 'node:fs';
import path from 'node:path';
const [destination, ...sources] = process.argv.slice(2);
if (!destination || !sources.length) throw new Error('Usage: node scripts/bench/report.mjs report.md results.json [...]');
const reports = sources.map(p => ({ file: path.resolve(p), ...JSON.parse(fs.readFileSync(p, 'utf8')) }));
const fixed = (v, digits = 3) => Number.isFinite(v) ? v.toFixed(digits) : '—';
const seconds = v => fixed(v / 1000);
const range = p => p ? `${seconds(p.medianMs)} (${seconds(p.minMs)}–${seconds(p.maxMs)})` : 'FAILED / not run';
const lines = [
  '# SAAM spline/mesh slicing measurements', '',
  'Local developer measurements on one laptop; no physical validation or job approvals.', '',
  'These measure prepared-geometry skill production, shared composition and machine checks. Export and interpretation are separate. Public plan validation, native reopening, bundle I/O, runtime hashing, Studio loading and delivery are excluded. Do not equate the totals with application-to-application stopwatch results.', '',
  `Environment: ${reports[0].cpu}, ${reports[0].logicalCpus} logical CPUs, ${fixed(reports[0].totalMemoryGiB, 1)} GiB RAM, ${reports[0].platform}, Node ${reports[0].node}.`, '',
  'Each candidate has a separate process, a first invocation, then warm repeats. Tables show median (minimum–maximum), in seconds. Read the raw JSON for first-run times, samples, source hashes, output hashes and complete error stacks. Repeated runs on a busy interactive laptop are evidence of local trends, not formal statistical significance.', '',
  'Fixture: 24 × 24 mm base, 24 mm rim, 45° top rotation, a bicubic domed roof reaching 24.9 mm, and four ruled sides forming a waist. The large fixture doubles every dimension. Control: 24 mm cube. All use 0.2 mm layers, 0.4 mm lines and two walls. Full fill is 100%; planar infill is 20% with three solid top/bottom layers; drape has two 0.2 mm skins, 0.5 mm sample/survey steps and a 15° limit.', '',
  '## Timing results', '',
  '| Run | Geometry | Full fill | Planar infill + solids | Body + drape |',
  '|---|---|---:|---:|---:|'
];
for (const report of reports) for (const r of report.results) {
  lines.push(`| ${path.basename(path.dirname(report.file))} | ${r.name}: ${r.backend} | ${range(r.phases.full?.sliceMs)} | ${range(r.phases.planar?.sliceMs)} | ${range(r.phases.draped?.sliceMs)} |`);
}
lines.push('', '## Geometry microbenchmarks', '', '| Run / geometry | Prepare, ms | All sections, ms | Section vertices | 256 roof queries, ms |', '|---|---:|---:|---:|---:|');
for (const report of reports) for (const r of report.results) lines.push(`| ${path.basename(path.dirname(report.file))} / ${r.name}: ${r.backend} | ${fixed(r.phases.prepare?.medianMs, 1)} | ${fixed(r.phases.sections?.medianMs, 1)} | ${r.sectionSummary?.vertices ?? '—'} | ${fixed(r.phases.roof256?.medianMs, 1)} |`);
lines.push('', '## Mesh fidelity', '', 'Targets describe sampled surface-to-triangle correspondence, not certified bounds or Cura input requirements. Contour distances are sampled in both directions. Shallow roof sections amplify XYZ error in XY; maximum contour errors need not equal maximum surface error.', '',
  '| Run / fixture | Mesh | Triangles | Surface sample, mm | Contour sample, mm | Area error, % | Roof height, mm | Normal angle, ° |', '|---|---|---:|---:|---:|---:|---:|---:|');
for (const report of reports) for (const f of report.fixtures) for (const m of f.meshes) lines.push(`| ${path.basename(path.dirname(report.file))} / ${f.name} | ${m.targetMm ? m.targetMm + ' mm target' : 'User Rhino STL'} | ${m.triangles} | ${fixed(m.sampledMaxErrorMm, 6)} | ${fixed(m.quality.maxContourMm, 6)} | ${fixed(100 * m.quality.maxAreaRelative, 3)} | ${fixed(m.quality.maxRoofMm, 6)} | ${fixed(m.quality.maxNormalDeg, 3)} |`);
lines.push('', '## Successful drape stage breakdown', '', '| Run / geometry | Survey, s | Body, s | Skin incl. support queries, s | Compose/check, s | Skin area, mm² |', '|---|---:|---:|---:|---:|---:|');
for (const report of reports) for (const r of report.results) if (r.phases.draped) {
  const p = r.phases.draped, skin = r.draped.reports.find(r => r.id === 'draped-skin').report;
  lines.push(`| ${path.basename(path.dirname(report.file))} / ${r.backend} | ${seconds(p.surveyMs?.medianMs)} | ${seconds(p.bodyMs?.medianMs)} | ${seconds(p.skinMs?.medianMs)} | ${seconds(p.composeAndCheckMs?.medianMs)} | ${fixed(skin.skinAreaMm2, 2)} |`);
}
lines.push('', '## Failures', '', 'Failed attempts are excluded from successful timings. No skipped check, mesh repair or changed production tolerance was used to obtain a successful result.', '');
for (const report of reports) {
  for (const r of report.results) for (const e of r.errors) lines.push(`- ${path.basename(path.dirname(report.file))} / ${r.name}: ${r.backend}, ${e.phase}: ${e.message}`);
  for (const e of report.errors.filter(e => !e.backend || !report.results.some(r => r.backend === e.backend && r.name === e.name))) lines.push(`- ${JSON.stringify(e)}`);
}
lines.push('', '## Raw evidence', '');
for (const r of reports) lines.push(`- [${path.basename(path.dirname(r.file))}](${r.file.replaceAll('\\', '/')}) — ${r.finished}; runtime unchanged during run: ${r.runtimeUnchanged}; source hash: ${r.runtimeHash}.`);
fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, lines.join('\n') + '\n');
console.log(path.resolve(destination));
