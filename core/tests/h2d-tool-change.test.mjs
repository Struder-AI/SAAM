import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMachine} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {checkBlock, changeLines, parseBlock, renderBlock, TOOL_CHANGE_BEGIN, TOOL_CHANGE_END} from '../export/bambu-tool-change.mjs';
import {toolChangeDigest} from '../export/bambu.mjs';

const machine = loadMachine('bambu-h2d'), config = machine.outputs[0].program.toolChange;
const {switches} = JSON.parse(readFileSync(new URL('./fixtures/h2d-tool-change-switches.json', import.meta.url), 'utf8'));

test('the pinned template regenerates six real Bambu Studio nozzle switches byte for byte', () => {
  assert.equal(config.template.length, 44);
  for (const s of switches) {
    const slots = parseBlock(config, s.lines);
    assert.deepEqual(renderBlock(config, slots), s.lines, s.name);
    assert.equal(slots.sel, s.tool[1], `${s.name}: the change goes to the nozzle named by T`);
    assert.equal(Number(slots.old), 1 - Number(slots.sel), 'and leaves the other');
    const table = config.diameters[slots.dia];
    assert.deepEqual([slots.f20, slots.f25, slots.f983], [table.f20, table.f25, table.f983], `${s.name}: flow values follow the diameter`);
  }
});

test('any line that departs from the template is rejected, in a fixed line or a slot', () => {
  const real = switches[0].lines;
  assert.doesNotThrow(() => parseBlock(config, real));
  for (const i of [0, 5, 14, 30, 36]) assert.throws(() => parseBlock(config, real.map((l, k) => k === i ? l + ' ' : l)), /does not fit the pinned sequence/, `line ${i + 1}`);
  assert.throws(() => parseBlock(config, [...real, 'G1 X0']), /wrong number of lines/);
  assert.throws(() => parseBlock(config, real.map(l => l.replace('T240', 'T250'))), /pinned sequence/, 'a firmware parameter that is not a slot');
  const disagree = real.map((l, k) => k === 34 ? l.replace(/Z[\d.]+/, 'Z9') : l);
  assert.throws(() => parseBlock(config, disagree), /disagrees between lines/, 'a repeated slot must agree');
});

// A plan with a second nozzle on the right, and the interpreter's state at the moment of a change.
function situation(overrides = {}) {
  const plan = defaults(machine);
  Object.assign(plan.skills['line-network'], {enabled: true, networks: [{id: 'right', tool: {index: 1, core: 'Hardened steel 0.4', nozzleMm: 0.4}, strokes: [{closed: false, points: [[0, 0], [1, 0]]}]}]});
  const state = {plan, machine, tool: 0, fan: 0, maxZ: 0.4, changeIndex: 0, boundsOf: t => machine.tools[t].bounds ?? {min: [0, 0, 0], max: [325, 320, 320]},
    heat: {targetC: () => plan.setup.nozzleC, secondsHot: () => 150}, ...overrides};
  const {lines} = changeLines(config, {from: 0, to: 1, changeIndex: state.changeIndex, lift: 5, fan: state.fan, plan});
  return {plan, state, block: lines.slice(1, -1)};
}

test('a change the writer would emit passes the check, and reports where it leaves the head', () => {
  const {state, block} = situation();
  assert.deepEqual(changeLines(config, {from: 0, to: 1, changeIndex: 0, lift: 5, fan: 0, plan: state.plan}).lines.at(0), TOOL_CHANGE_BEGIN);
  assert.equal(changeLines(config, {from: 0, to: 1, changeIndex: 0, lift: 5, fan: 0, plan: state.plan}).lines.at(-1), TOOL_CHANGE_END);
  const effect = checkBlock(config, block, state);
  assert.deepEqual(effect, {to: 1, position: [180.861, 265, 5], fan: 0});
  const later = situation({changeIndex: 1});
  assert.equal(parseBlock(config, later.block).counter, '2', 'a later change carries the later counter');
});

test('the interpreter refuses a change that is unsafe or out of sequence', () => {
  const ok = situation(), bad = (over, note, re) => assert.throws(() => checkBlock(config, situation(over).block, situation(over).state), re, note);
  assert.doesNotThrow(() => checkBlock(config, ok.block, ok.state));
  bad({tool: 1}, 'not leaving the nozzle in use', /does not leave the nozzle in use/);
  bad({maxZ: 4}, 'a lift that does not clear what is printed', /does not clear/);
  bad({heat: {targetC: () => 0, secondsHot: () => 999}}, 'a nozzle that is not heated', /pre-heat/);
  bad({heat: {targetC: () => 220, secondsHot: () => 30}}, 'a pre-heat that has not had time', /pre-heat/);
  assert.throws(() => checkBlock(config, ok.block, {...ok.state, changeIndex: 1}), /counter/, 'a first-change block presented as a later change');
  assert.throws(() => checkBlock(config, ok.block, {...ok.state, fan: 128}), /fans/, 'fans that differ from the program');
  assert.throws(() => checkBlock(config, ok.block.map(l => l.replace('X180.861', 'X150')), ok.state), /pinned sequence|unexpected position/);
  const mixed = {...ok.state, plan: (() => { const p = structuredClone(ok.state.plan); p.skills['line-network'].networks[0].tool.nozzleMm = 0.6; return p; })()};
  assert.throws(() => checkBlock(config, ok.block, mixed), /diameters do not match/, 'nozzles of different diameters');
  assert.throws(() => changeLines(config, {from: 0, to: 1, changeIndex: 0, lift: 5, fan: 0, plan: mixed.plan}), /same nozzle diameter/);
});

test('a 0.6 mm pair uses the 0.6 mm values, and an unsupported diameter is refused', () => {
  const plan = defaults(machine);
  plan.setup.nozzleMm = 0.6; Object.assign(plan.skills['line-network'], {enabled: true, networks: [{id: 'r', tool: {index: 1, core: 'Hardened steel 0.6', nozzleMm: 0.6}, strokes: []}]});
  const slots = parseBlock(config, changeLines(config, {from: 0, to: 1, changeIndex: 0, lift: 5.1, fan: 0, plan}).lines.slice(1, -1));
  assert.deepEqual([slots.dia, slots.f20, slots.f25, slots.f983], ['0.6', '598.678', '748.347', '12.5']);
  plan.setup.nozzleMm = 0.8; plan.skills['line-network'].networks[0].tool.nozzleMm = 0.8;
  assert.throws(() => changeLines(config, {from: 0, to: 1, changeIndex: 0, lift: 5, fan: 0, plan}), /not supported for a 0.8 mm nozzle/);
});

test('the template is pinned: its digest is recorded so an edit is noticed', () => {
  assert.match(toolChangeDigest(config), /^[0-9a-f]{64}$/);
});
