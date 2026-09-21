// Derive the H2D nozzle-change block from Bambu Studio dual-nozzle slices, and prove it: the template built
// from the first switch of each direction must regenerate every switch of every supplied slice exactly.
//   node scripts/h2d-derive-tool-change.mjs "a.gcode.3mf" ... [--json]
// The slices are not in Git (see maps/reference/bambu.md, nozzle changes); the resulting template is recorded in
// machines/bambu-h2d.json under outputs[].program.toolChange.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {unpackZip} from '../core/export/zip.mjs';
import {extractSwitches} from './h2d-switch-analysis.mjs';

// Values that follow the nozzle diameter: the two flow speeds and the M983.3 feed, per Bambu's own numbers.
export const DIAMETER_TOKENS = {0.4: {f20: '498.898', f25: '623.623', f983: '10.4167'}, 0.6: {f20: '598.678', f25: '748.347', f983: '12.5'}};

// The firmware part of a switch: no comments (the firmware ignores them), no progress lines, and it ends at the
// aux-fan restore, before the slicer's own retract and approach to its wipe tower.
export function firmwareLines(lines) {
  const kept = lines.filter(l => !l.startsWith(';') && !l.startsWith('M73') && l.trim());
  const end = kept.findLastIndex(l => l.startsWith('M106 P2 S')); // the restore at the end, not the earlier fans-off
  return kept.slice(0, end + 1);
}

// Turn one switch's lines into a template with named slots, and read its slot values.
const RULES = [
  [/^M620 S(\d)A$/, 'M620 S{sel}A', 'sel'],
  [/^G1 Z([\d.]+) F1200$/, 'G1 Z{lift} F1200', 'lift'],
  [/^G1 Z([\d.]+) F3000$/, 'G1 Z{lift} F3000', 'lift'],
  [/^M620\.10 A0 F([\d.]+) L0 H([\d.]+) T240 P220 S1$/, 'M620.10 A0 F{f20} L0 H{dia} T240 P220 S1', 'f20', 'dia'],
  [/^M620\.10 A1 F([\d.]+) L0 H([\d.]+) T240 P220 S1$/, 'M620.10 A1 F{f20} L0 H{dia} T240 P220 S1', 'f20', 'dia'],
  [/^M620\.11 P0 I(\d) E0$/, 'M620.11 P0 I{old} E0', 'old'],
  [/^M620\.11 K1 I(\d) R10 F([\d.]+)$/, 'M620.11 K1 I{old} R10 F{f25}', 'old', 'f25'],
  [/^M620\.11 S1 L0 I(\d) R10 D8 E-10 F([\d.]+)$/, 'M620.11 S1 L0 I{old} R10 D8 E-10 F{f25}', 'old', 'f25'],
  [/^T(\d)$/, 'T{sel}', 'sel'],
  [/^M621 S(\d)A$/, 'M621 S{sel}A', 'sel'],
  [/^M620\.6 I(\d) W1 ;enable ams air printing detect$/, 'M620.6 I{sel} W1 ;enable ams air printing detect', 'sel'],
  [/^M620\.10 R(\d)$/, 'M620.10 R{counter}', 'counter'],
  [/^M983\.3 F([\d.]+) A0\.4 R(\d)$/, 'M983.3 F{f983} A0.4 R{counter}', 'f983', 'counter'],
  [/^G1 X([\d.]+)$/, 'G1 X{purgeX}', 'purgeX'],
  [/^M1015\.4 S1 K1 H([\d.]+) ;enable E air printing detect$/, 'M1015.4 S1 K1 H{dia} ;enable E air printing detect', 'dia'],
  [/^M106 S([\d.]+)$/, 'M106 S{fanPart}', 'fanPart']
];
export function templateOf(lines) {
  const template = [], slots = {};
  lines.forEach((line, index) => {
    if (index === lines.length - 1 && /^M106 P2 S([\d.]+)$/.test(line)) { slots.fanAux = [/^M106 P2 S([\d.]+)$/.exec(line)[1]]; template.push('M106 P2 S{fanAux}'); return; }
    const rule = RULES.find(([re]) => re.test(line));
    if (!rule) { template.push(line); return; }
    const match = rule[0].exec(line);
    rule.slice(2).forEach((name, i) => { (slots[name] ??= []).push(match[i + 1]); });
    template.push(rule[1]);
  });
  return {template, slots};
}
export const render = (template, values) => template.map(l => l.replace(/\{(\w+)\}/g, (_, k) => { if (values[k] === undefined) throw new Error(`Missing slot ${k}`); return values[k]; }));

function load(path) {
  const files = unpackZip(readFileSync(path));
  return files.get('Metadata/plate_1.gcode').toString('utf8');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const paths = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!paths.length) { console.error('usage: h2d-derive-tool-change.mjs <file.gcode.3mf> ... [--json]'); process.exit(1); }
  const all = paths.flatMap(path => extractSwitches(load(path)).map((s, i) => ({path: path.split('/').pop(), index: i + 1, tool: s.tool, lines: firmwareLines(s.lines)})));
  const templates = {};
  for (const dir of ['T1', 'T0']) {
    const group = all.filter(s => s.tool === dir), base = templateOf(group[0].lines);
    templates[dir] = base.template;
    let ok = 0;
    for (const s of group) {
      const {template, slots} = templateOf(s.lines);
      const same = template.length === base.template.length && template.every((l, i) => l === base.template[i]);
      if (same) ok++; else console.log(`  ${dir}: ${s.path} switch ${s.index} has a different skeleton (${template.length} vs ${base.template.length} lines)`);
    }
    console.log(`${dir}: ${base.template.length} template lines; ${ok} of ${group.length} switches share it`);
  }
  // Each switch must equal the template rendered with its own slot values: slots that repeat must agree.
  const observed = {}; let consistent = 0;
  for (const s of all) {
    const {template, slots} = templateOf(s.lines), values = {};
    let agree = true;
    for (const [k, v] of Object.entries(slots)) { if (new Set(v).size !== 1) agree = false; values[k] = v[0]; (observed[k] ??= new Set()).add(v[0]); }
    const again = render(template, values);
    if (agree && again.length === s.lines.length && again.every((l, i) => l === s.lines[i])) consistent++;
    else console.log(`  ${s.path} switch ${s.index}: does not regenerate exactly`);
  }
  console.log(`${consistent} of ${all.length} switches regenerate byte for byte from the template and their own slot values`);
  console.log('observed slot values:', Object.fromEntries(Object.entries(observed).map(([k, v]) => [k, [...v]])));
  const same = templates.T1.length === templates.T0.length && templates.T1.every((l, i) => l === templates.T0[i]);
  console.log(same ? 'The T1 and T0 templates are identical: one template serves both directions.' : 'The T1 and T0 templates differ:');
  if (!same) templates.T1.forEach((l, i) => { if (l !== templates.T0[i]) console.log(`  line ${i + 1}: T1 ${l}  |  T0 ${templates.T0[i]}`); });
  if (process.argv.includes('--json')) console.log(JSON.stringify(templates, null, 2));
  else for (const dir of ['T1']) { console.log(`\n${dir} template:`); templates[dir].forEach((l, i) => console.log(String(i + 1).padStart(3), l)); }
}
