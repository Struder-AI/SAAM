import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
const packet=async(sources,body='return operation(x);',specifier='operation')=>{
  const file='core/use.mjs';sources={...sources,[file]:`import {${specifier}} from './barrel.mjs';export function main(x){${body}}`};
  return flowPacket(await loadFlow({repo:'',files:Object.keys(sources),readSource:file=>sources[file]}),`${file}::main`,{evidence:true});
};
const targets=p=>p.callBindings?.map(c=>c.callee)??[];
const base={
  'core/a.mjs':'export function operation(x){return x;}',
  'core/b.mjs':'export function operation(x){return x+1;}'
};

test('star re-exports resolve the originating declaration and keep argument/result wiring',async()=>{
  const p=await packet({...base,'core/barrel.mjs':"export * from './a.mjs';"});
  assert.deepEqual(targets(p),['core/a.mjs::operation']);assert.deepEqual(p.unresolved,[]);
  const component=p.components.find(c=>c.label==='operation');
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===component.index&&w.toPort==='arg1'));
  assert.ok(p.wires.some(w=>w.from===component.index&&w.to==='out1'));
});

test('explicit local and named exports take precedence over conflicting or unknown stars',async()=>{
  for(const own of ["export {operation} from './a.mjs';",'export function operation(x){return x;}']) {
    const p=await packet({...base,'core/barrel.mjs':`${own}export * from './b.mjs';export * from 'some-package';`});
    assert.deepEqual(targets(p),[own.startsWith('export {')?'core/a.mjs::operation':'core/barrel.mjs::operation']);
    assert.deepEqual(p.unresolved,[]);
  }
});

test('distinct star bindings remain ambiguous even when both contain the same callable value',async()=>{
  for(const sources of [base,{
    'core/shared.mjs':'export function fn(x){return x;}',
    'core/a.mjs':"import {fn} from './shared.mjs';export const operation=fn;",
    'core/b.mjs':"import {fn} from './shared.mjs';export const operation=fn;"
  }]) {
    const p=await packet({...sources,'core/barrel.mjs':"export * from './a.mjs';export * from './b.mjs';"});
    assert.deepEqual(targets(p),[]);assert.equal(p.unresolved[0].rule,'unresolved-import');
  }
});

test('same-binding diamonds and cycles resolve once without manufacturing a second target',async()=>{
  const p=await packet({
    'core/origin.mjs':'export function operation(x){return x;}',
    'core/a.mjs':"export * from './origin.mjs';export * from './b.mjs';",
    'core/b.mjs':"export {operation} from './origin.mjs';export * from './a.mjs';",
    'core/barrel.mjs':"export * from './a.mjs';export * from './b.mjs';"
  });
  assert.deepEqual(targets(p),['core/origin.mjs::operation']);assert.deepEqual(p.unresolved,[]);
  const empty=await packet({'core/a.mjs':"export * from './barrel.mjs';",'core/barrel.mjs':"export * from './a.mjs';"});
  assert.deepEqual(targets(empty),[]);assert.equal(empty.unresolved[0].rule,'unresolved-import');
  const imported=await packet({
    'core/origin.mjs':'export default function operation(x){return x;}export {operation};',
    'core/a.mjs':"import {operation} from './origin.mjs';export {operation};",
    'core/b.mjs':"import operation from './origin.mjs';export {operation};",
    'core/barrel.mjs':"export * from './a.mjs';export * from './b.mjs';"
  });
  assert.deepEqual(targets(imported),['core/origin.mjs::operation']);assert.deepEqual(imported.unresolved,[]);
});

test('default does not cross a star boundary; explicit default renaming and namespace exports do',async()=>{
  const sources={'core/a.mjs':'export default function operation(x){return x;}'};
  const absent=await packet({...sources,'core/barrel.mjs':"export * from './a.mjs';"},'return operation(x);','default as operation');
  assert.deepEqual(targets(absent),[]);assert.equal(absent.unresolved[0].rule,'unresolved-import');
  const named=await packet({...sources,'core/barrel.mjs':"export {default as operation} from './a.mjs';"});
  assert.deepEqual(targets(named),['core/a.mjs::operation']);
  const namespace=await packet({...base,'core/barrel.mjs':"export * as tools from './a.mjs';"},'return tools.operation(x);','tools');
  assert.deepEqual(targets(namespace),['core/a.mjs::operation']);
});

test('unscanned stars cannot certify a target or silently lose ambiguity',async()=>{
  for(const external of ["'node:fs'","'./missing.mjs'"]) {
    const p=await packet({...base,'core/barrel.mjs':`export * from './a.mjs';export * from ${external};`});
    assert.deepEqual(targets(p),[]);assert.equal(p.unresolved[0].rule,'unresolved-import');
  }
  const missing=await packet({...base,'core/barrel.mjs':"export {absent as operation} from './a.mjs';export * from './b.mjs';"});
  assert.deepEqual(targets(missing),[]);assert.equal(missing.unresolved[0].rule,'unresolved-import');
});

test('a resolved star from scanned outside source retains an outside invocation instead of a map target',async()=>{
  const p=await packet({'skills/example/work.mjs':'export function operation(x){return x;}','core/barrel.mjs':"export * from '../skills/example/work.mjs';"});
  assert.deepEqual(p.unresolved,[]);assert.deepEqual(p.components,[]);
  const op=p.operators.find(o=>o.kind==='invocation');
  assert.equal(op.scope,'outside');assert.ok(!op.targetUnknown);
  assert.equal(op.targets[0].path,'skills/example/work.mjs::operation');
  assert.ok(!op.targets[0].index);
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===op.id&&w.toPort==='arg1'));
});

test('actual profile star exposes machine checks and startup implementations without changing their identities',async()=>{
  const context=await loadFlow({files:['core/export/bambu.mjs','core/machine/profile.mjs','core/machine/rules.mjs','core/geom/tolerance.mjs']});
  const p=flowPacket(context,'core/export/bambu.mjs::configuration');
  for(const name of ['validateSetup','startupPosition']) {
    assert.ok(targets(p).includes(`core/machine/rules.mjs::${name}`),name);
    assert.ok(!p.unresolved.some(u=>u.call===name),name);
  }
});
