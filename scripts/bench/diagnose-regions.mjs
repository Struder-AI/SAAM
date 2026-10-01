// Bounded developer diagnosis; intercept excessive spatial-grid allocation in
// this process only. Preserves the original STL and saves failing query inputs.
import fs from 'node:fs';
import path from 'node:path';
import { parseSTL, makeMesh } from '../../core/geom/mesh.mjs';
import {horizontalSlice, sliceFamily } from '../../core/geom/slice.mjs';
import {section} from '../../core/region/section.mjs';
import {translateShell} from '../../core/geom/build.mjs';
import { defaults } from '../../core/print/plan.mjs';
import { sliceAssignment } from '../../core/print/slices.mjs';
import { layerStrokes } from '../../core/region/layer-strokes.mjs';
import { SegmentIndex } from '../../core/region/region2d.mjs';
import { intersect, difference, union } from '../../core/region/boolean.mjs';

const [input, destination = '.local/slicing-diagnostics'] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/bench/diagnose-regions.mjs file.stl [output-directory]');
fs.mkdirSync(destination, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(destination, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const parsed = parseSTL(fs.readFileSync(input), { units: 'mm' }), shell = translateShell(makeMesh(parsed.vertices, parsed.triangles), 100, 100);
const plan = defaults(), settings = sliceAssignment({ id: 'diagnosis' });
const heights = sliceFamily({ base: horizontalSlice(0), pitchMm: plan.process.layerMm, firstLayerMm: plan.process.firstLayerMm },
  { min: [0, 0, 0], max: [0, 0, shell.bounds.max[2]] }).layers.map(layer => layer.slice.origin[2]);
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
    try { layerStrokes(section(shell, horizontalSlice(z)).loops, { ...settings, widthMm: plan.process.lineWidthMm, fillAngleDeg: 45, patternAngleDeg: 45, fillDensity: 1 }); }
    catch (error) {
      const finding = { phase: 'slice layer', z, error: error.message, dangerous, section: section(shell,horizontalSlice(z)).loops };
      save('offset-failure', finding); report.findings.push({ phase: finding.phase, z, error: finding.error, cells: dangerous?.cellsForOneSegment }); break;
    }
  }
} finally { SegmentIndex.prototype.add = original; }

const regions = heights.map(z => section(shell,horizontalSlice(z)).loops);
let current;
const op = (name, a, b, info) => { current = { operation: name, a, b, ...info }; return ({ intersect, difference, union })[name](a, b); };
try {
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]; if (!region.length) continue;
    let supported = region, covered = region;
    for (let n = 1; n <= settings.solidBottom; n++) supported = op('intersect', supported, regions[i - n] ?? [], { z: heights[i], neighbor: heights[i - n], side: 'bottom' });
    for (let n = 1; n <= settings.solidTop; n++) covered = op('intersect', covered, regions[i + n] ?? [], { z: heights[i], neighbor: heights[i + n], side: 'top' });
    const bottom = op('difference', region, supported, { z: heights[i] }), top = op('difference', region, covered, { z: heights[i] });
    op('union', bottom, top, { z: heights[i] });
  }
} catch (error) {
  save('boolean-failure', { ...current, error: error.message });
  report.findings.push({ phase: 'slice solid mask', z: current.z, neighbor: current.neighbor, operation: current.operation, error: error.message });
}
save('diagnosis', report); console.log(JSON.stringify(report, null, 2));
