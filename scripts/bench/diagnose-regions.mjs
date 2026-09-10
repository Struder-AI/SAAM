// Bounded developer diagnosis; intercept excessive spatial-grid allocation in
// this process only. Preserves the original STL and saves failing query inputs.
import fs from 'node:fs';
import path from 'node:path';
import { parseSTL, makeMesh } from '../../core/geom/mesh.mjs';
import { sectionGeometry } from '../../core/geom/query.mjs';
import { translateShell } from '../../core/print/generate.mjs';
import { defaults } from '../../core/print/plan.mjs';
import { fullFillResult, layerHeights } from '../../skills/full-fill/scripts/fill.mjs';
import { SegmentIndex } from '../../core/region/region2d.mjs';
import { intersect, difference, union } from '../../core/region/boolean.mjs';

const [input, destination = '.local/slicing-diagnostics'] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/bench/diagnose-regions.mjs file.stl [output-directory]');
fs.mkdirSync(destination, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(destination, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const parsed = parseSTL(fs.readFileSync(input), { units: 'mm' }), shell = translateShell(makeMesh(parsed.vertices, parsed.triangles), 100, 100);
const plan = defaults(), heights = layerHeights(plan.process, 0, shell.bounds.max[2]);
const report = { source: path.resolve(input), triangles: parsed.triangles.length, findings: [] };
const original = SegmentIndex.prototype.add;
let dangerous;
SegmentIndex.prototype.add = function(segment) {
  const counts = [0, 1].map(k => Math.floor(Math.max(segment[0][k], segment[1][k]) / this.cell) - Math.floor(Math.min(segment[0][k], segment[1][k]) / this.cell) + 1);
  if (counts[0] * counts[1] > 100000) {
    dangerous = { segment, gridCellMm: this.cell, cellsForOneSegment: counts[0] * counts[1], precedingSegments: this.segments };
    throw new Error('Diagnostic intercepted a segment requiring over 100000 grid cells');
  }
  return original.call(this, segment);
};
try {
  for (const z of heights) {
    try { fullFillResult({ shell, plan, zStartMm: z - plan.process.layerMm / 2, zEndMm: z }); }
    catch (error) {
      const finding = { phase: 'full-fill', z, error: error.message, dangerous, section: sectionGeometry(shell, z).loops };
      save('offset-failure', finding); report.findings.push({ phase: finding.phase, z, error: finding.error, cells: dangerous?.cellsForOneSegment }); break;
    }
  }
} finally { SegmentIndex.prototype.add = original; }

const regions = heights.map(z => sectionGeometry(shell, z).loops);
let current;
const op = (name, a, b, info) => { current = { operation: name, a, b, ...info }; return ({ intersect, difference, union })[name](a, b); };
try {
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]; if (!region.length) continue;
    let supported = region, covered = region;
    for (let n = 1; n <= plan.skills['full-fill'].bottomLayers; n++) supported = op('intersect', supported, regions[i - n] ?? [], { z: heights[i], neighbor: heights[i - n], side: 'bottom' });
    for (let n = 1; n <= plan.skills['full-fill'].topLayers; n++) covered = op('intersect', covered, regions[i + n] ?? [], { z: heights[i], neighbor: heights[i + n], side: 'top' });
    const bottom = op('difference', region, supported, { z: heights[i] }), top = op('difference', region, covered, { z: heights[i] });
    op('union', bottom, top, { z: heights[i] });
  }
} catch (error) {
  save('boolean-failure', { ...current, error: error.message });
  report.findings.push({ phase: 'planar-infill solid mask', z: current.z, neighbor: current.neighbor, operation: current.operation, error: error.message });
}
save('diagnosis', report); console.log(JSON.stringify(report, null, 2));
