import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {presentationPage} from '../lib/presentation.mjs';
const file='core/callable-probe.mjs';
const scan=source=>loadFlow({repo:'',files:[file],readSource:()=>source});
const at=(source,call)=>source.slice(call.start,call.end);

test('factory results feed solver callable inputs through immutable aliases',async()=>{
  const source='export function leastSquares(rows){return values=>rows.length+values.length;}export function main(rows,values){const solve=leastSquares(rows);const work=solve;return work(values);}',context=await scan(source);
  const p=presentationPage(flowPacket(context,`${file}::main`));
  const made=p.callBindings.find(c=>at(source,c)==='leastSquares(rows)'),used=p.callBindings.find(c=>at(source,c)==='work(values)');
  assert.equal(used.callable.expression,'work');assert.equal(used.callable.unknown,undefined);
  assert.deepEqual(used.callable.producers.map(p=>[p.endpoint,p.site.start]),[[made.callee,made.start]]);
  assert.ok(made.resultUses.some(u=>u.kind==='callable'&&u.callee===used.callee&&u.site.start===used.start));
  const component=call=>p.components.find(c=>`${c.file}::${c.label}`===call.callee).index;
  assert.ok(p.wires.some(w=>w.from===component(made)&&w.to===component(used)&&w.toPort==='callable'&&w.label==='work'));
});

test('two constructions of the same solver implementation retain exact callable instance wires',async()=>{
  const source='export function factory(rows){return values=>rows+values;}export function main(a,b,x,y){const first=factory(a),second=factory(b);return first(x)+second(y);}',context=await scan(source);
  const p=presentationPage(flowPacket(context,`${file}::main`));
  for(const [madeText,usedText] of [['factory(a)','first(x)'],['factory(b)','second(y)']]) {
    const made=p.callBindings.find(c=>at(source,c)===madeText),used=p.callBindings.find(c=>at(source,c)===usedText);
    assert.ok(made.instance&&used.instance);
    assert.deepEqual(p.wires.filter(w=>w.to===used.instance&&w.toPort==='callable').map(w=>w.from),[made.instance]);
    assert.deepEqual(made.resultUses.filter(u=>u.kind==='callable').map(u=>u.site.start),[used.start]);
  }
});

test('mutable or reassigned solver bindings do not invent a factory result origin',async()=>{
  for(const body of [
    'let work=factory();work=unknown();return work(x);',
    'let work=factory();return x.map(value=>work(value));',
    'let work=factory();const result=x.map(value=>work(value));work=unknown();return result;',
    'let work=factory();return x.map(value=>{work=unknown();return work(value);});'
  ]) {
    const source='export function factory(){return value=>value;}export function main(x){'+body+'}',context=await scan(source);
    const p=flowPacket(context,`${file}::main`),made=p.callBindings.find(c=>at(source,c)==='factory()');
    assert.ok(!made.resultUses.some(u=>u.kind==='callable'));
    for(const called of p.callBindings.filter(c=>at(source,c).startsWith('work('))) {
      assert.equal(called.callable.unknown,true);assert.deepEqual(called.callable.producers,[]);
    }
    assert.ok(!p.wires.some(w=>w.toPort==='callable'));
  }
});

test('a stable captured solver keeps its exact factory origin without claiming callback execution or element origin',async()=>{
  const source='export function factory(){return value=>value;}export function main(x){const work=factory();return x.map(value=>work(value));}',context=await scan(source);
  const p=flowPacket(context,`${file}::main`,{evidence:true});
  const made=p.callBindings.find(c=>at(source,c)==='factory()'),called=p.callBindings.find(c=>at(source,c)==='work(value)');
  assert.equal(called.callable.unknown,undefined);
  assert.deepEqual(called.callable.producers.map(p=>[p.endpoint,p.site.start,p.site.end]),[[made.callee,made.start,made.end]]);
  assert.deepEqual(made.resultUses.filter(u=>u.kind==='callable').map(u=>[u.callee,u.site.start]),[[called.callee,called.start]]);
  const handle=path=>p.components.find(c=>`${c.file}::${c.label}`===path).index;
  assert.ok(p.wires.some(w=>w.from===handle(made.callee)&&w.to===handle(called.callee)&&w.toPort==='callable'));
  assert.equal(called.executionUnknown,true);
  assert.equal(called.arguments[0].unknown,true);assert.deepEqual(called.arguments[0].producers,[]);
  assert.ok(p.externalSites.some(s=>s.call==='x.map'&&s.rule==='member-name-not-in-mapped-code'));
  assert.ok(p.uncertainty.some(u=>u.kind==='callback-execution'));
  assert.ok(p.uncertainty.some(u=>u.kind==='return-origin'&&u.port==='out1'));
  assert.ok(!p.wires.some(w=>w.to==='out1'));
});

test('optional solver invocation keeps its callable wire behind the nullish gate',async()=>{
  const source='export function factory(){return value=>value;}export function main(x){const work=factory();return work?.(x);}',context=await scan(source);
  const p=flowPacket(context,`${file}::main`),wire=p.wires.find(w=>w.toPort==='callable');
  assert.ok(wire);assert.match(p.gates[wire.gate].text,/work !== null/);
});

for(const [label,factory] of [
  ['returned function','export function factory(){return function(value){return value+1;};}'],
  ['concise arrow','export const factory=()=>value=>value+1;'],
  ['awaited returned arrow','export const factory=async()=>value=>value+1;']
])test(`${label} retains a source identity distinct from its factory`,async()=>{
  const source=factory+'export async function main(x){const work=await factory();return work(x);}',context=await scan(source);
  const p=presentationPage(flowPacket(context,`${file}::main`)),bindings=p.callBindings;
  const made=bindings.find(b=>source.slice(b.start,b.end)==='factory()'),called=bindings.find(b=>source.slice(b.start,b.end)==='work(x)');
  assert.equal(made.callee,`${file}::factory`);assert.notEqual(called.callee,made.callee);
  assert.match(called.callee,/::<return@\d+:\d+>$/);
  const node=context.projection.nodes.get(called.callee);assert.ok(node);
  const declaration=context.graph.declarations.find(d=>d.anchor===called.callee);
  assert.equal(context.projection.owner.get(declaration.id),node);
  assert.match(source.slice(declaration.start,declaration.end),/value/);
  assert.deepEqual(flowPacket(context,called.callee).inputs.map(p=>p.name),['value']);
  assert.equal(p.components.filter(c=>c.label==='factory').length,1);
  assert.ok(!p.components.some(c=>c.id),'these are two implementations, not repeated factory instances');
});

test('alternative returned callables have separate source identities and possible targets',async()=>{
  const context=await scan('export function factory(flag){return flag?(x=>x+1):(x=>x-1);}export function main(x,flag){const work=factory(flag);return work(x);}');
  const page=flowPacket(context,`${file}::main`),calls=page.callBindings.filter(c=>c.callee!==`${file}::factory`);
  assert.equal(calls.length,2);assert.equal(new Set(calls.map(c=>c.callee)).size,2);
  assert.ok(calls.every(c=>c.possibleTarget));
});

test('named helpers under a returned callable preserve their own identities',async()=>{
  const context=await scan('export const factory=()=>value=>{const tools={step:x=>x+1};return tools.step(value);};export function main(x){const work=factory();return work(x);}');
  const returned=[...context.projection.nodes.values()].find(n=>/::<return@/.test(n.path)&&!n.path.endsWith('::step'));
  const helper=[...context.projection.nodes.values()].find(n=>n.path.endsWith('::tools::step'));
  assert.ok(returned);assert.ok(helper);assert.equal(helper.parent,returned);
  const calls=flowPacket(context,returned.path).callBindings;
  assert.ok(calls.some(c=>c.callee===helper.path));
  assert.ok(!calls.some(c=>c.callee===returned.path));
});

test('a directly invoked anonymous callable is not its enclosing owner',async()=>{
  const context=await scan('export function main(x){return (value=>value+1)(x);}');
  const page=flowPacket(context,`${file}::main`);
  assert.equal(page.callBindings.length,1);assert.match(page.callBindings[0].callee,/::<callable@\d+:\d+>$/);
  assert.deepEqual(flowPacket(context,page.callBindings[0].callee).inputs.map(p=>p.name),['value']);
});
