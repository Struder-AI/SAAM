import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';

const file='core/callback.mjs';
const packet=async source=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`);
const invocations=p=>p.operators?.filter(o=>o.kind==='invocation')??[];

test('parameter invocations retain distinct source addresses, callable and payload without inventing targets',async()=>{
  const source='export function main(callback,value){callback({stage:"start",value});return callback(value);}';
  const p=await packet(source),ops=invocations(p);
  assert.equal(ops.length,2);assert.equal(p.unresolved.filter(u=>u.rule==='parameter-target').length,2);
  for(const op of ops) {
    assert.equal(op.file,file);assert.equal(source.slice(op.start,op.end).startsWith('callback('),true);
    assert.equal(op.column,op.start+1);assert.equal(op.targetUnknown,true);assert.equal(op.optional,false);
    assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===op.id&&w.toPort==='callable'));
    assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===op.id&&w.toPort==='arg1'));
  }
  assert.notEqual(ops[0].start,ops[1].start);
  assert.ok(p.wires.some(w=>w.from===ops[1].id&&w.fromPort==='result'&&w.to==='out1'));
  assert.deepEqual(ops[0].arguments[0].fields[0],{name:'stage',expression:'"start"',constant:true});
  assert.equal(ops[0].arguments[0].constant,undefined);
});

test('optional callback control uses nullish semantics and retains outer conditions and guarded argument calls',async()=>{
  const p=await packet('export const compute=value=>value; export function main(callback,value,enabled){if(enabled)callback?.(compute(value));}');
  const op=invocations(p)[0],gate=p.gates[op.gate],compute=p.components.find(c=>c.label==='compute');
  assert.equal(op.optional,true);assert.match(gate.text,/enabled/);
  assert.match(gate.text,/callback !== null && callback !== undefined/);
  assert.ok(gate.terms.some(t=>t.kind==='optional-call'));
  assert.equal(p.gates[compute.gate].text,gate.text);
  assert.ok(p.wires.some(w=>w.from===compute.index&&w.to===op.id&&w.toPort==='arg1'));
});

test('callback aliases, member calls, shadowed bindings and reassigned parameters are not inferred',async()=>{
  for(const source of [
    'export function main(callback,value){const alias=callback;alias(value);}',
    'export function main(callback,value){callback.run(value);}',
    'export function main(callback,value){callback=unknown();callback(value);}',
    'export function main(callback,value){{const callback=unknown();callback(value);}}',
    'export function main(callback,value){unknown(()=>callback(value));}',
  ])assert.equal(invocations(await packet(source)).length,0,source);
});

test('partial unknown payloads cannot become constants when mixed with fixed fields or nested arrays',async()=>{
  const p=await packet('export function main(callback,items){let changed=0;for(const item of items){changed=unknown(item);callback?.({fixed:1,nested:[{value:changed}]});}}');
  const arg=invocations(p)[0].arguments[0];
  assert.equal(arg.unknown,true);assert.equal(arg.constant,undefined);
  assert.equal(arg.fields.find(f=>f.name==='nested').unknown,true);
  assert.ok(p.uncertainty.some(u=>u.kind==='argument-origin'&&u.call==='callback'&&u.field==='nested[0].value'&&u.expression==='changed'));
});

test('computed payload keys are data dependencies, not constants',async()=>{
  const p=await packet('export function main(callback,key){callback({nested:[{[key]:1}]});}');
  const op=invocations(p)[0],arg=op.arguments[0];
  assert.equal(arg.constant,undefined);assert.equal(arg.unknown,undefined);
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===op.id&&w.toPort==='arg1'));
});

test('unknown argument and returned object field origins remain visible without invented wires',async()=>{
  const p=await packet('export const consume=value=>value; export function main(callback,x){const ledger=unknown(x);callback({fixed:1,value:ledger.get(x)});consume({nested:{value:ledger.size}});return {fixed:1,summary:{value:ledger.size}};}');
  const op=invocations(p)[0];assert.equal(op.arguments[0].unknown,true);
  assert.ok(p.uncertainty.some(u=>u.kind==='argument-origin'&&u.call==='consume'&&u.field==='nested.value'));
  assert.ok(p.uncertainty.some(u=>u.kind==='return-origin'&&u.field==='summary.value'));
  assert.ok(!p.wires.some(w=>w.from==='in2'&&w.to===op.id));
});
