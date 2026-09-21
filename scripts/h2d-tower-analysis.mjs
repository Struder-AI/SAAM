#!/usr/bin/env node
// What a Bambu Studio dual-nozzle slice prints besides the model: the prime tower. Compare a slice's
// extrusion against the model's footprint (from a STEP file's points, when given): everything deposited
// outside that footprint is the tower, and the slicer labels it `; FEATURE: Prime tower` as well.
//   node scripts/h2d-tower-analysis.mjs <plate_1.gcode | file.gcode.3mf> [model.step] [--json]
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const FILAMENT_AREA = Math.PI * (1.75 / 2) ** 2;

export function stepFootprint(text) {
  const points = [...text.matchAll(/CARTESIAN_POINT\('[^']*',\(([^)]*)\)\)/g)].map(m => m[1].split(',').map(Number));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  return {min, max};
}

// Every deposit in the G-code: endpoints (arcs are sampled), volume from E, layer, feature, tool.
export function extrusions(gcode) {
  const moves = [];
  let x = 0, y = 0, z = 0, e = 0, relative = true, feature = '', layer = -1, filament = 0;
  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('; FEATURE:')) feature = line.slice(10).trim();
    const layerMatch = line.match(/^; layer num\/total_layer_count: (\d+)/);
    if (layerMatch) layer = Number(layerMatch[1]);
    const change = line.match(/^T(\d)$/); if (change) filament = Number(change[1]);
    if (line === 'M82') relative = false; if (line === 'M83') relative = true;
    const m = line.match(/^G([0-3])\s/); if (!m) continue;
    const arg = key => { const v = line.match(new RegExp(`${key}(-?[\\d.]+)`)); return v ? Number(v[1]) : undefined; };
    const nx = arg('X') ?? x, ny = arg('Y') ?? y, nz = arg('Z') ?? z, ev = arg('E');
    let de = 0; if (ev !== undefined) { de = relative ? ev : ev - e; if (!relative) e = ev; }
    if (de > 1e-9 && (nx !== x || ny !== y)) {
      const points = [[x, y]];
      if (m[1] === '2' || m[1] === '3') {
        const cx = x + (arg('I') ?? 0), cy = y + (arg('J') ?? 0), r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
        if (m[1] === '3') { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
        for (let k = 1; k < 16; k++) { const a = a0 + (a1 - a0) * k / 16; points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      }
      points.push([nx, ny]);
      moves.push({points, z: nz, volume: de * FILAMENT_AREA, feature, layer, filament, arc: m[1] > 1});
    }
    x = nx; y = ny; z = nz;
  }
  return moves;
}

const bbox = moves => {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of moves) for (const [px, py] of m.points) { box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py); box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py); }
  return box.map(v => Math.round(v * 100) / 100);
};

export function analyse(gcode, model = null) {
  const moves = extrusions(gcode);
  // `Custom` is the machine's own start-of-print purge line, printed before layer 1: neither model nor tower.
  const start = moves.filter(m => m.feature === 'Custom');
  const tower = moves.filter(m => m.feature === 'Prime tower'), rest = moves.filter(m => m.feature !== 'Prime tower' && m.feature !== 'Custom');
  const result = {
    extrusionMoves: moves.length, volumeMm3: sum(moves), startPurge: {moves: start.length, volumeMm3: sum(start), bbox: bbox(start)}, tower: {moves: tower.length, volumeMm3: sum(tower), bbox: bbox(tower)},
    model: {moves: rest.length, volumeMm3: sum(rest), bbox: bbox(rest)}
  };
  const [x0, y0, x1, y1] = result.model.bbox;
  // The check that matters: nothing labelled tower lies inside the model's footprint, nothing else lies outside it.
  const inside = m => m.points.every(([px, py]) => px >= x0 - 0.01 && px <= x1 + 0.01 && py >= y0 - 0.01 && py <= y1 + 0.01);
  result.towerInsideModelFootprint = tower.filter(m => m.points.some(([px, py]) => px >= x0 && px <= x1 && py >= y0 && py <= y1)).length;
  result.nonTowerOutsideModelFootprint = rest.filter(m => !inside(m)).length;
  const layers = [...new Set(moves.map(m => m.layer))].sort((a, b) => a - b);
  result.layers = layers.map(layer => {
    const t = tower.filter(m => m.layer === layer), r = rest.filter(m => m.layer === layer);
    const flush = t.filter(m => !m.arc && m.points.length === 2 && Math.abs(m.points[0][1] - m.points[1][1]) < 1e-6 && Math.abs(m.points[1][0] - m.points[0][0]) > 15 && m.volume > 1.6 && m.volume < 1.8);
    return {layer, z: t[0]?.z ?? r[0]?.z, towerMm3: round(sum(t)), modelMm3: round(sum(r)), flushRows: flush.length};
  });
  if (model) {
    const [mx0, my0] = model.min, [mx1, my1] = model.max;
    result.stepFootprintMm = [mx1 - mx0, my1 - my0, mx1 !== undefined ? model.max[2] - model.min[2] : 0];
    result.modelFootprintFromGcode = [x1 - x0, y1 - y0];
    result.modelOffsetInGcode = [round(x0 - mx0), round(y0 - my0)];
  }
  return result;
}
const sum = moves => round(moves.reduce((s, m) => s + m.volume, 0)), round = v => Math.round(v * 100) / 100;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2).filter(a => a !== '--json'), [source, step] = args;
  let gcode;
  if (source.endsWith('.3mf')) gcode = execFileSync('unzip', ['-p', source, 'Metadata/plate_1.gcode'], {maxBuffer: 1 << 30}).toString();
  else gcode = readFileSync(source, 'utf8');
  const out = analyse(gcode, step ? stepFootprint(readFileSync(step, 'utf8')) : null);
  console.log(JSON.stringify(out, null, process.argv.includes('--json') ? 0 : 2));
}
