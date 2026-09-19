import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMotion} from '../export/griffin.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const machine=freeze(loadMachine('ultimaker-s5')),plan=freeze(defaults(machine));
const prelude=`G21\nG90\nM82\nT${plan.setup.tool}\nM190 S${plan.setup.bedC}\nM109 T${plan.setup.tool} S${plan.setup.nozzleC}\nG92 E0\n`;
// Establish a legal location, recover the documented startup withdrawal, then
// deposit slowly. State/thermal checks must still precede publication to a writer.
const start=`G0 X100 Y100 Z1 F600\nG1 E${plan.process.retractMm} F60\nG92 E0\n`;

test('command transitions preserve frozen inputs and emit immutable past moves to a push-only writer',()=>{
  const rows=[],writer={push(move){rows.push(freeze(move));},get length(){return rows.length;}};
  const program=interpretMotion(prelude+start+';SAAM_PHASE:deposit\n;LAYER:2\n;SAAM_OPERATION:line\nG1 X101 E0.01 F60\nM106 S128\nG1 Y101 E0.02\nG4 P100\n',plan,machine,{moves:writer});
  assert.equal(program.moves,writer);assert.equal(rows.length,3);
  assert.deepEqual(rows[1].from,[100,100,1]);assert.deepEqual(rows[1].to,[101,100,1]);
  assert.deepEqual(rows[2].from,[101,100,1]);assert.deepEqual(rows[2].to,[101,101,1]);
  assert.equal(rows[1].fan,0);assert.equal(rows[2].fan,128);
  assert.equal(rows[2].phase,'deposit');assert.equal(rows[2].layer,2);assert.equal(rows[2].operation,'line');
  assert.equal(program.events.at(-1).kind,'dwell');assert.equal(program.events.at(-1).seconds,0.1);
  assert.equal(program.summary.extrusionMoves,2);
});

test('an invalid later command preserves prior writer output and fails before publishing its move',()=>{
  const rows=[],writer={push:move=>rows.push(move),get length(){return rows.length;}};
  assert.throws(()=>interpretMotion(prelude+start+'G1 X101 E0.01 F60\nG1 X999 E0.02\n',plan,machine,{moves:writer}),/Out-of-bounds X move/);
  assert.equal(rows.length,2);assert.deepEqual(rows.at(-1).to,[101,100,1]);
});

test('long modal streams append incrementally without requiring an iterable or copyable history',()=>{
  let count=0,last;
  const writer={push(move){count++;last=move;},get length(){return count;},[Symbol.iterator](){throw Error('history must not be copied');}};
  function* chunks(){
    yield prelude+start;
    for(let i=0;i<2048;i++)yield `G1 X${101-(i%2)} E${((i+1)/1000).toFixed(3)} F60\n`;
  }
  const program=interpretMotion(chunks(),plan,machine,{moves:writer});
  assert.equal(program.moves,writer);assert.equal(count,2049);assert.equal(program.summary.moves,count);
  assert.deepEqual(last.to,[100,100,1]);assert.ok(program.volumeMm3>0);
});
