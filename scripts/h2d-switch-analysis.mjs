// Study the nozzle-change (T0/T1) blocks of Bambu Studio dual-nozzle H2D slices: which lines of the firmware
// macro are fixed and which numbers vary, within one file and across files. This is how the facts in
// maps/reference/bambu.md (nozzle changes) were derived. The reference slices themselves are not in Git;
// run it on your own `.gcode.3mf` (or an extracted `plate_1.gcode`):
//   node scripts/h2d-switch-analysis.mjs "a.gcode.3mf" "b.gcode.3mf" ...
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {unpackZip} from '../core/export/zip.mjs';

const mask = line => line.replace(/-?\d+\.?\d*/g, '#');
const numbers = line => line.match(/-?\d+\.?\d*/g) ?? [];

// The firmware part of each switch: from the slicer's "filament end gcode" marker to the first approach move
// after the closing M621. What follows (the approach and the wipe tower) is slicer geometry, not firmware.
export function extractSwitches(gcode) {
  const lines = gcode.split('\n'), out = [];
  lines.forEach((line, t) => {
    if (!/^T[01]$/.test(line.trim()) || t < 100) return; // start-up T commands come earlier
    let start = t; while (start > 0 && !lines[start].startsWith('; filament end gcode')) start--;
    let close = t; while (close < lines.length && !lines[close].startsWith('M621 ')) close++;
    let end = close; while (end < lines.length && !(lines[end].startsWith('G1 X') && lines[end].includes('F60000'))) end++;
    if (start === 0 && !lines[0].startsWith('; filament end gcode') || end >= lines.length) return;
    out.push({tool: line.trim(), lines: lines.slice(start, end).map(l => l.trimEnd()).filter(l => l.trim() && !l.startsWith('M73'))}); // M73 is slicer progress
  });
  return out;
}

// Group switches of one direction by skeleton (every number masked) and list the lines whose numbers vary.
export function varyingSlots(switches) {
  const skeletons = new Map();
  for (const s of switches) { const key = s.lines.map(mask).join('\n'); skeletons.set(key, (skeletons.get(key) ?? 0) + 1); }
  const rows = [], n = Math.min(...switches.map(s => s.lines.length));
  for (let i = 0; i < n; i++) {
    const values = switches.map(s => s.lines[i]);
    if (new Set(values).size > 1) rows.push({line: i + 1, skeleton: mask(values[0]), values: [...new Set(values.map(v => numbers(v).join(' ')))]});
  }
  return {switches: switches.length, skeletons: skeletons.size, rows};
}

function load(path) {
  const bytes = readFileSync(path);
  if (!path.endsWith('.3mf')) return {gcode: bytes.toString('utf8'), info: null};
  const files = unpackZip(bytes), text = name => files.get(name)?.toString('utf8') ?? '';
  const info = text('Metadata/slice_info.config');
  return {gcode: text('Metadata/plate_1.gcode'), info: {
    slicer: /X-BBL-Client-Version" value="([^"]+)/.exec(info)?.[1], nozzles: /nozzle_diameters" value="([^"]+)/.exec(info)?.[1],
    filaments: [...info.matchAll(/<filament id="(\d+)"[^>]*tray_info_idx="([^"]+)"[^>]*color="([^"]+)"/g)].map(m => `${m[1]}:${m[2]}:${m[3]}`),
    sequence: text('Metadata/filament_sequence.json').trim()
  }};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const paths = process.argv.slice(2);
  if (!paths.length) { console.error('usage: h2d-switch-analysis.mjs <plate.gcode | file.gcode.3mf> ...'); process.exit(1); }
  const all = [];
  for (const path of paths) {
    const {gcode, info} = load(path), switches = extractSwitches(gcode);
    console.log(`\n${path}\n  ${info ? `slicer ${info.slicer}, nozzles ${info.nozzles}, filaments ${info.filaments.join(' ')}, ${info.sequence}\n  ` : ''}${switches.length} switches: ${switches.map(s => s.tool).join(' ')}`);
    for (const s of switches) all.push({path, ...s});
  }
  for (const tool of ['T1', 'T0']) {
    const group = all.filter(s => s.tool === tool);
    if (!group.length) continue;
    const {switches, skeletons, rows} = varyingSlots(group);
    console.log(`\n${tool} (change to nozzle ${tool[1]}): ${switches} switches, ${skeletons} distinct skeleton(s); lines that vary:`);
    for (const r of rows) console.log(`  [${String(r.line).padStart(2)}] ${r.skeleton.slice(0, 60).padEnd(60)} ${r.values.slice(0, 6).map(v => `(${v})`).join(' ')}`);
  }
}
