import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';

const file='core/callback-probe.mjs';
const packet=async source=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`);
const invocation=p=>p.operators.find(o=>o.kind==='invocation');

test('optional callback execution gates both its payload helper and its unknown-target invocation',async()=>{
  const p=await packet('export const prepare=x=>x;export function main(cb,flag,x){if(flag)cb?.(prepare(x));}');
  const op=invocation(p),helper=p.components.find(c=>c.label==='prepare');
  assert.equal(op.targetUnknown,true);assert.equal(op.optional,true);
  assert.equal(helper.gate,op.gate);
  assert.deepEqual(p.gates[op.gate].terms.map(g=>g.kind),['if','optional-call']);
  for(const [from,to,port] of [['in1',op.id,'callable'],['in3',helper.index,'arg1'],[helper.index,op.id,'arg1']])
    assert.ok(p.wires.some(w=>w.from===from&&w.to===to&&w.toPort===port&&w.gate===op.gate));
  assert.ok(p.unresolved.some(site=>site.call==='cb'&&site.rule==='parameter-target'));
});

test('partial unknown callback payloads cannot be certified as constants or complete values',async()=>{
  for(const payload of ['{fixed:1,value:changed}','[1,changed]','{inner:{fixed:1,value:changed}}']) {
    const p=await packet(`export function main(cb,items){let changed=0;for(const item of items){changed=unknown(item);cb(${payload});}}`);
    const arg=invocation(p).arguments[0];
    assert.equal(arg.unknown,true,payload);assert.notEqual(arg.constant,true,payload);
  }
});

test('computed payload keys retain their inputs and unknown key computation stays uncertain',async()=>{
  for(const payload of ['{[key]:1}','items[key]']) {
    const p=await packet(`export function main(cb,items,key){cb(${payload});}`),op=invocation(p);
    assert.notEqual(op.arguments[0].constant,true,payload);
    assert.ok(p.wires.some(w=>w.from==='in3'&&w.to===op.id&&w.toPort==='arg1'),payload);
  }
  for(const payload of ['{[unknown()]:1}','items[unknown()]']) {
    const p=await packet(`export function main(cb,items){cb(${payload});}`);
    assert.equal(invocation(p).arguments[0].unknown,true,payload);
    assert.notEqual(invocation(p).arguments[0].constant,true,payload);
  }
});

test('actual composition progress has callable and count sources without inventing its callback target',async()=>{
  const context=await loadFlow(),p=flowPacket(context,'core/path/compose.mjs::planComposition');
  const calls=p.operators.filter(o=>o.kind==='invocation'&&o.callee==='onProgress');
  assert.equal(calls.length,2);
  const schedule=p.components.find(c=>c.label==='scheduleOperations');
  for(const call of calls) {
    assert.equal(call.targetUnknown,true);assert.equal(call.optional,true);
    assert.ok(p.wires.some(w=>w.from==='in4'&&w.to===call.id&&w.toPort==='callable'));
    assert.ok(p.wires.some(w=>w.from===schedule.index&&w.to===call.id&&w.toPort==='arg1'&&w.label==='operations.length'));
    assert.ok(p.unresolved.some(site=>site.call==='onProgress'&&site.line===call.line&&site.rule==='parameter-target'));
  }
  assert.equal(p.gates[calls[0].gate].kind,'optional-call');
  assert.deepEqual(p.gates[calls[1].gate].terms.map(g=>g.kind),['loop','optional-call']);
  assert.equal(calls[0].arguments[0].fields.find(f=>f.name==='completed').constant,true);
  assert.ok(!calls[1].arguments[0].fields.find(f=>f.name==='completed').unknown);
  const increment=p.operators.find(o=>o.kind==='update'&&o.binding==='completed');
  assert.ok(increment);assert.equal(increment.prefix,true);
  assert.ok(p.wires.some(w=>w.from===increment.id&&w.fromPort==='result'&&w.to===calls[1].id&&w.toPort==='arg1'));
  for(const binding of ['state','remaining','elapsed','completed']) {
    const loops=p.operators.filter(o=>o.kind==='iteration'&&o.binding===binding);assert.ok(loops.length,binding);
    for(const loop of loops) {
      assert.equal(loop.minIterations,0,binding);
      assert.ok(p.wires.some(w=>w.to===loop.id&&w.toPort==='next'),`${binding} feedback`);
    }
  }
  assert.ok(p.uncertainty.some(u=>u.kind==='loop-data-flow'&&u.binding==='deposited'));
  assert.ok(!p.operators.some(o=>o.kind==='collection'&&o.binding==='deposited'&&o.operation==='push'));
  assert.ok(p.uncertainty.some(u=>u.kind==='argument-origin'&&u.field==='summary.operationOrder'));
  assert.ok(p.uncertainty.some(u=>u.kind==='receiver-state-order'&&u.receiver==='actions'));
});
