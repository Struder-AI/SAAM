import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
const file='studio/decode.mjs';
const packet=async source=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::decode`);

test('unsupported-format exception is connected to the deciding input through its full else gate',async()=>{
  const p=await packet('export function decode(plan){if(plan.output==="a")return 1;else if(plan.output==="b")return 2;else throw new Error("Unsupported: "+plan.output);}');
  const out=p.outputs.find(o=>o.kind==='throw'),wire=p.wires.find(w=>w.to===out.port&&w.kind==='gate');
  assert.equal(wire.from,'in1');assert.equal(wire.label,'plan.output');assert.equal(wire.toPort,'condition');
  assert.match(p.gates[wire.gate].text,/!\(plan.output==="a"\)/);assert.match(p.gates[wire.gate].text,/!\(plan.output==="b"\)/);
  assert.ok(!p.wires.some(w=>w.to===out.port&&w.kind==='return'));
});

test('exit control uses the value at the condition, not a later reassignment',async()=>{
  const p=await packet('export function decode(flag,value){if(flag){flag=value;throw new Error("stop");}return 1;}');
  const out=p.outputs.find(o=>o.kind==='throw'),control=p.wires.filter(w=>w.to===out.port&&w.kind==='gate');
  assert.deepEqual(control.map(w=>w.from),['in1']);
});

test('record output exposes generated field names and its own source span without guessing dynamic keys',async()=>{
  const p=await packet('export function decode(input,key){return {response:input,preparation:input?{state:input}:null,...input,[key]:1};}');
  const out=p.outputs[0];
  assert.deepEqual(out.fields,['response','preparation']);assert.equal(out.spread,true);assert.equal(out.computedKeys,true);
  assert.deepEqual(out.source,{file,line:1,endLine:1});
  assert.ok(out.name.includes('preparation:input?'));
});

test('identical predicates at different sites retain separate clickable gate identities',async()=>{
  const p=await packet('export const first=x=>x;export function decode(flag){if(flag)first(1);if(flag)first(2);return 0;}');
  const gates=p.callBindings.filter(c=>c.callee.endsWith('::first')).map(c=>p.gates[c.gate]);
  assert.equal(gates.length,2);assert.equal(gates[0].text,gates[1].text);
  assert.notEqual(gates[0].source.start,gates[1].source.start);
});
