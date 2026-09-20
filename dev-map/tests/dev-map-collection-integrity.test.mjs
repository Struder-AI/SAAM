import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';

const file='core/collection-probe.mjs';
const packet=async body=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>
  `export const sink=x=>x;export function main(a,b,key,items,cb,flag,other){${body}}`}),`${file}::main`);
const operators=(p,operation)=>p.operators?.filter(o=>o.kind==='collection'&&o.operation===operation)??[];
const hasWire=(p,from,to,fromPort,toPort)=>p.wires.some(w=>w.from===from&&w.to===to&&w.fromPort===fromPort&&w.toPort===toPort);
const sinkArgs=p=>p.callBindings.filter(c=>c.callee===`${file}::sink`).map(c=>c.arguments[0]);

test('local collection reads use state at that source site rather than later mutations',async()=>{
  for(const [body,write,read] of [
    ['const values=new Map();values.set(key,a);sink(values.get(key));values.set(key,b);return sink(values.get(key));','set','get'],
    ['const values=[];values.push(a);sink(values.length);values.push(b);return sink(values.length);','push','length']]) {
    const p=await packet(body),writes=operators(p,write),reads=operators(p,read);
    assert.equal(writes.length,2);assert.equal(reads.length,2);
    assert.ok(hasWire(p,writes[0].id,reads[0].id,'state','state'));
    assert.ok(hasWire(p,writes[0].id,writes[1].id,'state','state'));
    assert.ok(hasWire(p,writes[1].id,reads[1].id,'state','state'));
    assert.deepEqual(sinkArgs(p).map(arg=>arg.producers[0].endpoint),reads.map(op=>op.id));
  }
});

test('map and literal counter loops preserve zero iterations through explicit initial and final ports',async()=>{
  const p=await packet('const values=new Map();let count=0;for(const item of items){values.set(key,item);count++;}sink(values.size);return sink(count);');
  const loops=p.operators.filter(o=>o.kind==='iteration'),map=loops.find(o=>o.binding==='values'),count=loops.find(o=>o.binding==='count');
  assert.equal(map.minIterations,0);assert.equal(count.minIterations,0);
  assert.deepEqual(count.initialConstants,['0']);
  assert.ok(hasWire(p,operators(p,'create')[0].id,map.id,'state','initial'));
  assert.ok(hasWire(p,operators(p,'set')[0].id,map.id,'state','next'));
  assert.ok(hasWire(p,map.id,operators(p,'size')[0].id,'final','state'));
  assert.equal(sinkArgs(p)[1].producers[0].endpoint,count.id);assert.equal(sinkArgs(p)[1].producers[0].port,'final');
});

test('prefix and postfix updates expose expression result separately from the next loop state',async()=>{
  for(const [expression,prefix] of [['++count',true],['count++',false]]) {
    const p=await packet(`let count=0;for(const item of items)cb(${expression});return sink(count);`);
    const update=p.operators.find(o=>o.kind==='update'),call=p.operators.find(o=>o.kind==='invocation'),loop=p.operators.find(o=>o.binding==='count'&&o.kind==='iteration');
    assert.equal(update.prefix,prefix);assert.equal(update.operation,'++');
    assert.ok(hasWire(p,update.id,call.id,'result','arg1'));
    assert.ok(hasWire(p,update.id,loop.id,'next','next'));
    assert.ok(!hasWire(p,update.id,call.id,'next','arg1'));
  }
  const p=await packet('let count=0;for(const item of items)cb?.(++count);return sink(count);');
  const loop=p.operators.find(o=>o.kind==='iteration'),choice=p.operators.find(o=>o.kind==='choice'&&o.binding==='count');
  assert.ok(hasWire(p,loop.id,choice.id,'current','nullish'));
  assert.ok(hasWire(p,choice.id,loop.id,'selected','next'));
});

test('aliases, escapes, captured closures and unsupported mutations revoke collection certainty',async()=>{
  for(const middle of [
    'const alias=values;',
    'unknown(values);',
    'unknown({values});',
    'values.clear();',
    'values.get=other;',
    'const change=()=>values.set(key,b);change();'
  ]) {
    const p=await packet(`const values=new Map();values.set(key,a);${middle}return sink(values.get(key));`);
    assert.equal(sinkArgs(p)[0].unknown,true,middle);
    assert.deepEqual(sinkArgs(p)[0].producers,[],middle);
  }
  const early=await packet('function change(){values.set(key,b);}const values=new Map();values.set(key,a);change();return sink(values.get(key));');
  assert.equal(sinkArgs(early)[0].unknown,true,'a hoisted closure can capture a later declared collection');
  const ordered=await packet('const values=new Map();values.set(key,a);sink(values.get(key));unknown(values);return sink(values.get(key));');
  assert.ok(!sinkArgs(ordered)[0].unknown,'later escape cannot erase an already observed read');
  assert.equal(sinkArgs(ordered)[1].unknown,true);
});

test('custom constructors and callbacks cannot gain builtin collection semantics from their spelling',async()=>{
  const shadowed=await packet('const Map=class{};const values=new Map();return sink(values.get(key));');
  assert.equal(operators(shadowed,'create').length,0);assert.equal(sinkArgs(shadowed)[0].unknown,true);
  const custom=await packet('return sink(items.map(x=>x.id));');
  assert.equal(operators(custom,'map').length,0);assert.equal(sinkArgs(custom)[0].unknown,true);
  const dynamic=await packet('const values=[];values.push(a);return sink(values.map(x=>x[key]));');
  assert.equal(operators(dynamic,'map').length,0);assert.equal(sinkArgs(dynamic)[0].unknown,true);
  const projected=await packet('const values=[];values.push(a);return sink(values.map(x=>x.id));');
  assert.equal(operators(projected,'map').length,1);assert.ok(!sinkArgs(projected)[0].unknown);
  const length=await packet('let values=[];values=values.push(a);values.push(b);return sink(values);');
  assert.equal(operators(length,'push').length,1,'push returns a scalar and cannot make its result another array');
});
