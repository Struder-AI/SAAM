import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSwitches, varyingSlots} from '../../scripts/h2d-switch-analysis.mjs';

// A synthetic stand-in for a Bambu dual-nozzle slice: filler, then two switches whose numbers differ.
const pad = Array.from({length: 120}, (_, i) => `; filler ${i}`);
const macro = (tool, lift, flow, diameter) => [
  '; filament end gcode', 'M620 S' + tool[1] + 'A', `G1 Z${lift} F1200`, 'M73 P50 R3',
  `M620.10 A0 F${flow} L0 H${diameter} T240 P220 S1`, tool, 'M621 S' + tool[1] + 'A', 'G1 X180.8 Y295 F60000', '; tower'
];
const gcode = [...pad, ...macro('T1', 5, 498.898, 0.4), ...pad.slice(0, 3), ...macro('T1', 5.4, 598.678, 0.6)].join('\n');

test('a switch is the firmware part, from the filament-end marker to the first approach move', () => {
  const switches = extractSwitches(gcode);
  assert.equal(switches.length, 2);
  assert.deepEqual(switches[0].lines, ['; filament end gcode', 'M620 S1A', 'G1 Z5 F1200', 'M620.10 A0 F498.898 L0 H0.4 T240 P220 S1', 'T1', 'M621 S1A'],
    'progress lines are dropped and the approach move and tower are excluded');
  assert.equal(switches[0].tool, 'T1');
});

test('lines whose numbers vary are reported with their values; constant lines are not', () => {
  const {switches, skeletons, rows} = varyingSlots(extractSwitches(gcode));
  assert.equal(switches, 2);
  assert.equal(skeletons, 1, 'both share one skeleton once numbers are masked');
  assert.deepEqual(rows.map(r => r.line), [3, 4]);
  assert.deepEqual(rows[1].values, ['620.10 0 498.898 0 0.4 240 220 1', '620.10 0 598.678 0 0.6 240 220 1'], 'every number on the line, command code first');
});
