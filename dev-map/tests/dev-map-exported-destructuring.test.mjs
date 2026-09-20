import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
const factory='export function factory(seed){function load(x){return [seed,x];}return {load};}';
async function scan(bundle='export const {load}=factory(1);',definition=factory,body='return load(x);',imports='load') {
  const sources={'core/factory.mjs':definition,'core/bundle.mjs':`import {factory} from './factory.mjs';${bundle}`,
    'core/use.mjs':`import {${imports}} from './bundle.mjs';export function main(x){${body}}`};
  const context=await loadFlow({repo:'',files:Object.keys(sources),readSource:file=>sources[file]});
  return {context,sources,page:flowPacket(context,'core/use.mjs::main',{evidence:true})};
}

test('exported const destructuring resolves the exact returned function and preserves input/output wires',async()=>{
  const {page,context}=await scan();
  assert.deepEqual(page.callBindings.map(c=>c.callee),['core/factory.mjs::factory::load']);
  assert.deepEqual(page.unresolved,[]);
  const target=page.components[0].index;
  assert.ok(page.wires.some(w=>w.from==='in1'&&w.to===target&&w.toPort==='arg1'));
  assert.ok(page.wires.some(w=>w.from===target&&w.to==='out1'));
  const call=context.graph.relations.find(r=>r.kind==='call'&&r.evidence[0].file==='core/use.mjs');
  assert.ok(call.resolution.some(s=>s.file==='core/bundle.mjs'&&s.text==='factory(1)'));
  assert.ok(call.resolution.some(s=>s.file==='core/factory.mjs'&&s.text==='load'));
  assert.ok(!call.possible);
});

test('renamed and nested static fields keep their binding path through a later export',async()=>{
  const definition='export function factory(){function load(x){return x;}return {tools:{load}};}';
  const {page}=await scan('const {tools:{load:read}}=factory();export {read as load};',definition);
  assert.deepEqual(page.callBindings.map(c=>c.callee),['core/factory.mjs::factory::load']);
  assert.deepEqual(page.unresolved,[]);
});

test('two exported factory results retain separate construction evidence for the shared implementation',async()=>{
  const {page,context,sources}=await scan('export const {load:first}=factory(1),{load:second}=factory(2);',factory,
    'return first(x)+second(x);','first,second');
  assert.equal(page.callBindings.length,2);
  assert.ok(page.callBindings.every(c=>c.callee==='core/factory.mjs::factory::load'));
  for(const [callee,construction] of [['first(x)','factory(1)'],['second(x)','factory(2)']]) {
    const call=context.graph.relations.find(r=>r.kind==='call'&&r.evidence[0].file==='core/use.mjs'&&r.evidence[0].text===callee);
    const evidence=call.resolution.filter(s=>s.file==='core/bundle.mjs'&&s.text.startsWith('factory('));
    assert.deepEqual(evidence.map(s=>s.text),[construction]);
    assert.equal(evidence[0].start,sources['core/bundle.mjs'].indexOf(construction));
  }
});

test('ambiguous and partial factory results do not certify one selected function',async()=>{
  for(const definition of [
    'export function factory(flag){function a(){}function b(){}return flag?{load:a}:{load:b};}',
    'export function factory(flag){function load(){}if(flag)return {load};return unknown();}',
    'export function factory(flag){function load(){}if(flag)return {load};}',
    'export function factory(){function a(){}function b(){}return {load:unknown()?a:b};}',
    'export function factory(){return {load:unknown()};}'
  ]) {
    const {page}=await scan(undefined,definition);
    assert.ok(!page.callBindings?.length,definition);assert.equal(page.unresolved[0].rule,'unresolved-import');
  }
});

test('default, rest, computed, duplicate, accessor and spread field selections stay conservative',async()=>{
  const cases=[
    ['export const {load=()=>{}}=factory();',factory],
    ['export const {...load}=factory();',factory],
    ["export const {['load']:load}=factory();",factory],
    ['export const {load}=factory();','export function factory(){function load(){}return {...unknown(),load};}'],
    ['export const {load}=factory();','export function factory(){function a(){}function b(){}return {load:a,load:b};}'],
    ['export const {load}=factory();','export function factory(){function load(){}return {get load(){return load;}};}'],
    ['export const {load}=factory();',"export function factory(){function load(){}return {[unknown()]:1,load};}"]
  ];
  for(const [bundle,definition] of cases) {
    const {page}=await scan(bundle,definition);
    assert.ok(!page.callBindings?.length,bundle+definition);assert.equal(page.unresolved[0].rule,'unresolved-import');
  }
});

test('mutable exports, selected binding reassignment and holder aliases or escapes cannot certify a target',async()=>{
  for(const [bundle,definition] of [
    ['export let {load}=factory();',factory],
    ['let {load}=factory();load=unknown();export {load};',factory],
    ['const holder=factory();unknown(holder);export const {load}=holder;',factory],
    ['export const {load}=factory();','export function factory(){const holder={load(){}};unknown(holder);return holder;}'],
    ['export const {load}=factory();','export function factory(){let load=()=>{};load=unknown();return {load};}'],
    ['export const {load}=factory();','export function factory(){const holder={load(){}};holder.load=unknown();return holder;}'],
    ['export const {load}=factory();','export function factory(){const holder={load(){}};unknown(holder);return {load:holder.load};}'],
    ['export const {load}=factory();','export function factory(){const holder={load(){}};unknown(holder);const load=holder.load;return {load};}'],
    ['export const {load}=factory();','export function factory(){const holder={load(){}};unknown(holder);return {tools:holder};}']
  ]) {
    const {page}=await scan(bundle,definition);
    assert.ok(!page.callBindings?.length,bundle+definition);assert.equal(page.unresolved[0].rule,'unresolved-import');
  }
});

test('only explicitly awaited non-thenable async factory results can expose selected callables',async()=>{
  const definition=factory.replace('export function','export async function');
  const promise=await scan('export const {load}=factory(1);',definition);
  assert.ok(!promise.page.callBindings?.length);assert.equal(promise.page.unresolved[0].rule,'unresolved-import');
  const awaited=await scan('export const {load}=await factory(1);',definition);
  assert.deepEqual(awaited.page.callBindings.map(c=>c.callee),['core/factory.mjs::factory::load']);
  const thenable=await scan('export const {load}=await factory();','export async function factory(){function load(){}return {load,then(){}};}');
  assert.ok(!thenable.page.callBindings?.length);assert.equal(thenable.page.unresolved[0].rule,'unresolved-import');
});

test('star conflicts retain exported binding identity even when two factories use the same implementation',async()=>{
  const sources={'core/factory.mjs':factory,'core/first.mjs':"import {factory} from './factory.mjs';export const {load}=factory(1);",
    'core/second.mjs':"import {factory} from './factory.mjs';export const {load}=factory(2);",
    'core/barrel.mjs':"export * from './first.mjs';export * from './second.mjs';",
    'core/use.mjs':"import {load} from './barrel.mjs';export function main(x){return load(x);}"};
  const context=await loadFlow({repo:'',files:Object.keys(sources),readSource:file=>sources[file]});
  const page=flowPacket(context,'core/use.mjs::main');
  assert.ok(!page.callBindings?.length);assert.equal(page.unresolved[0].rule,'unresolved-import');
});
