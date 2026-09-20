import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
async function scan(body,extra={}) {
  const sources={'core/api.mjs':'export function run(x){return x;}','core/use.mjs':`export async function main(x,flag,path){${body}}`,...extra};
  const context=await loadFlow({repo:'',files:Object.keys(sources),readSource:file=>sources[file]});
  return {context,sources,page:flowPacket(context,'core/use.mjs::main',{evidence:true})};
}
const targets=p=>p.callBindings?.map(c=>c.callee)??[];

test('literal awaited imports resolve selected exports with exact import provenance and data wires',async()=>{
  const {page,context,sources}=await scan("const {run}=await import('./api.mjs');return run(x);");
  assert.deepEqual(targets(page),['core/api.mjs::run']);assert.deepEqual(page.unresolved,[]);
  const component=page.components[0],call=page.callBindings[0];
  assert.ok(page.wires.some(w=>w.from==='in1'&&w.to===component.index&&w.toPort==='arg1'));
  assert.ok(page.wires.some(w=>w.from===component.index&&w.to==='out1'));
  assert.notEqual(call.callable?.constant,true,'the module specifier is not the callable value');
  const relation=context.graph.relations.find(r=>r.kind==='call'&&r.evidence[0].file==='core/use.mjs');
  const imported=relation.resolution.find(s=>s.text==="import('./api.mjs')");
  assert.equal(imported.start,sources['core/use.mjs'].indexOf("import('./api.mjs')"));
  assert.ok(relation.resolution.some(s=>s.exportName==='run'));
});

test('stable namespace, promise and callable aliases preserve explicit await and lexical identity',async()=>{
  for(const body of [
    "const api=await import('./api.mjs');const work=api;return work.run(x);",
    "const promise=import('./api.mjs');const api=await promise;return api.run(x);",
    "const api=await import('./api.mjs');const {run:work}=api;return work(x);",
    "const {run}=await import('./api.mjs');const work=run;return work(x);"
  ])assert.deepEqual(targets((await scan(body)).page),['core/api.mjs::run'],body);
  const shadowed=await scan("const api=await import('./api.mjs');{const api=x;return api.run(x);}");
  assert.deepEqual(targets(shadowed.page),[]);
});

test('unawaited imports and then callbacks do not expose namespace exports or simulate Promise behavior',async()=>{
  for(const body of [
    "const {run}=import('./api.mjs');return run(x);",
    "const api=import('./api.mjs');return api.run(x);",
    "return import('./api.mjs').then(api=>api.run(x));"
  ])assert.deepEqual(targets((await scan(body)).page),[],body);
});

test('dynamic specifiers, mutable or reassigned aliases and namespace property writes stay unresolved',async()=>{
  for(const body of [
    'const {run}=await import(path);return run(x);',
    "const file='./api.mjs';const {run}=await import(file);return run(x);",
    "let {run}=await import('./api.mjs');return run(x);",
    "let api=await import('./api.mjs');api=x;return api.run(x);",
    "const api=await import('./api.mjs');api.run=x;return api.run(x);",
    "let {run}=await import('./api.mjs');run=x;return run(x);",
    "const {run=()=>{}}=await import('./api.mjs');return run(x);"
  ])assert.deepEqual(targets((await scan(body)).page),[],body);
});

test('then-exporting and unscanned mapped modules cannot certify the namespace after await',async()=>{
  for(const api of [
    'export function run(x){return x;}export function then(resolve){resolve(unknown());}',
    'export function run(x){return x;}export const then=unknown();',
    "export * from 'unknown-package';export function run(x){return x;}"
  ])assert.deepEqual(targets((await scan("const {run}=await import('./api.mjs');return run(x);",{'core/api.mjs':api})).page),[]);
  const absent=await scan("const {run}=await import('./missing.mjs');return run(x);");
  assert.deepEqual(targets(absent.page),[]);assert.equal(absent.page.external,0);
  assert.ok(absent.page.unresolved.some(s=>s.call==='run'));
});

test('literal imports consume exported factory selections and re-exports through existing module rules',async()=>{
  const {page}=await scan("const {run}=await import('./api.mjs');return run(x);",{
    'core/api.mjs':"export * from './bundle.mjs';",
    'core/bundle.mjs':"import {factory} from './factory.mjs';export const {run}=factory();",
    'core/factory.mjs':'export function factory(){function run(x){return x;}return {run};}'
  });
  assert.deepEqual(targets(page),['core/factory.mjs::factory::run']);assert.deepEqual(page.unresolved,[]);
});

test('unscanned outside imports are boundaries without invented targets, including immutable aliases',async()=>{
  for(const body of [
    "const {run}=await import('../dev-map/lib/api.mjs');return run(x);",
    "const api=await import('../dev-map/lib/api.mjs');return api.run(x);",
    "const {run}=await import('node:fs');const work=run;return work(x);"
  ]) {
    const {page}=await scan(body);
    assert.deepEqual(targets(page),[]);assert.deepEqual(page.components,[]);
    assert.deepEqual(page.unresolved,[]);assert.equal(page.externalSites.length,1);
    assert.equal(page.externalSites[0].rule,'literal-import-outside-scan');
    assert.ok(!page.operators?.some(o=>o.targets?.length));
  }
  const mixed=await scan("const {run}=await import('./api.mjs');const {work}=await import('../dev-map/lib/api.mjs');const chosen=flag?run:work;return chosen(x);");
  assert.equal(mixed.page.callBindings[0].possibleTarget,true);
});

test('scanned outside imports retain their exact external source declaration rather than a mapped index',async()=>{
  const {page}=await scan("const {run}=await import('../skills/example/api.mjs');return run(x);",{'skills/example/api.mjs':'export function run(x){return x;}'});
  assert.deepEqual(page.components,[]);assert.deepEqual(page.unresolved,[]);
  const op=page.operators.find(o=>o.scope==='outside');
  assert.equal(op.targets[0].path,'skills/example/api.mjs::run');assert.ok(!op.targets[0].index);assert.ok(!op.targetUnknown);
});
