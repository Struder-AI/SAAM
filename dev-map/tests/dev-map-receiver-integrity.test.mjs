import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow} from '../lib/flow.mjs';
import {model} from '../lib/regions.mjs';
const file='core/receiver-probe.mjs';
const scan=source=>loadFlow({repo:'',files:[file],readSource:()=>source});
const callRows=context=>context.graph.relations.filter(r=>r.kind==='call').map(r=>({...r,
  call:r.evidence[0].text,target:context.graph.declarations.find(d=>d.id===r.to)?.anchor}));

test('Promise-chain methods do not acquire the inner factory call target',async()=>{
  const context=await scan(`export async function bundleFor(){return {};}
    export function main(){return bundleFor().then(x=>x).then(x=>x).catch(()=>{}).finally(()=>{});}`);
  const calls=callRows(context);
  assert.deepEqual(calls.map(c=>c.call),['bundleFor()']);
  assert.equal(calls[0].target,`${file}::bundleFor`);
});

test('synchronous factories and explicitly awaited async factories retain their actual methods',async()=>{
  const context=await scan(`export function run(){}
    export function sync(){return {run};}
    export async function asyncFactory(){return {run};}
    export function proxy(){return asyncFactory();}
    export async function main(){sync().run();asyncFactory().run();const promise=proxy();promise.run();
      (await asyncFactory()).run();(await promise).run();}`);
  const methods=callRows(context).filter(c=>c.target===`${file}::run`).map(c=>c.call);
  assert.deepEqual(methods,['sync().run()','(await asyncFactory()).run()','(await promise).run()']);
  assert.ok(context.graph.callSites.unresolved.some(u=>u.site.text==='asyncFactory().run()'));
  assert.ok(context.graph.callSites.unresolved.some(u=>u.site.text==='promise.run()'));
});

test('known synchronous then/catch/finally methods are not rejected by spelling',async()=>{
  const context=await scan(`export function then(){return {};}
    export function caught(){return {};}
    export function final(){return {};}
    export function factory(){return {then,catch:caught,finally:final};}
    export function main(){factory().then();factory().catch();factory().finally();}`);
  const methods=callRows(context).filter(c=>!c.target.endsWith('::factory'));
  assert.deepEqual(methods.map(c=>c.target),[`${file}::then`,`${file}::caught`,`${file}::final`]);
});

test('an array-valued mutable binding remains an external receiver across array resets',async()=>{
  const context=await scan(`export function push(){}export function join(){}
    export function lines(flag){let pending=[];pending.push('a');if(flag)pending=[];return pending.join('');}
    export function mixed(flag){let value=[];if(flag)value={};value.push('a');}
    export function replaced(opaque){let xs=[];xs=[];xs.push=opaque;xs.push('a');}
    export function exposed(mutate){let ys=[];mutate(ys);ys=[];ys.push('a');}`);
  const records=[...context.graph.callSites.externalSites,...context.graph.callSites.unresolved];
  const state=call=>records.filter(r=>r.site.text===call).map(r=>r.rule??r.reason);
  assert.deepEqual(state("pending.push('a')"),['receiver-array-valued-binding']);
  assert.deepEqual(state("pending.join('')"),['receiver-array-valued-binding']);
  assert.deepEqual(state("value.push('a')"),['member-receiver-unresolved']);
  assert.deepEqual(state("xs.push('a')"),['member-receiver-unresolved']);
  assert.deepEqual(state("ys.push('a')"),['member-receiver-unresolved']);
});

test('destructuring an awaited literal dynamic import resolves its exact named exports',async()=>{
  const entry='core/entry.mjs',adapter='core/adapter.mjs',sources={
    [entry]:`export async function read(){const {open}=await import('./adapter.mjs');return open();}`,
    [adapter]:`export function open(){return {};}`};
  const context=await loadFlow({repo:'',files:Object.keys(sources),readSource:file=>sources[file]});
  assert.deepEqual(callRows(context).filter(c=>c.call==='open()').map(c=>c.target),[`${adapter}::open`]);
});

test('same-named inline property callbacks keep distinct identities instead of borrowing their enclosing function',async()=>{
  const context=await scan(`function invoke({filter}){filter(1);}
    export function outer(){invoke({filter:value=>value>0});invoke({filter:value=>value<0});}`);
  const calls=callRows(context).filter(c=>c.call==='filter(1)');
  assert.equal(calls.length,2);
  assert.equal(new Set(calls.map(c=>c.target)).size,2);
  assert.ok(calls.every(c=>c.target.startsWith(`${file}::outer::filter@`)));
  assert.ok(!calls.some(c=>c.target===`${file}::outer`));
});

test('await does not certify thenable payloads or generator return holders',async()=>{
  const context=await scan(`export function run(){}
    export async function thenable(){return {run,then(resolve){resolve({});}};}
    export class Thenable{then(resolve){resolve({});}run(){}}
    export async function classThenable(){return new Thenable();}
    export function* iterator(){return {run};}
    export async function main(){(await thenable()).run();(await classThenable()).run();iterator().run();(await iterator()).run();}`);
  assert.ok(!callRows(context).some(c=>c.call.endsWith('.run()')));
});

test('a known holder among unknown Promise alternatives remains a possible target',async()=>{
  const context=await scan(`export function run(){}
    export function sync(){return {run};}
    export async function asyncFactory(){return {run};}
    export function main(flag){const candidate=flag?sync():asyncFactory();candidate.run();}`);
  const call=callRows(context).find(c=>c.call==='candidate.run()');
  assert.equal(call.target,`${file}::run`);assert.equal(call.possible,true);
  assert.ok(context.graph.unresolved.some(u=>u.site.text==='candidate.run()'&&u.reason==='partially-resolved-target'));
});

test('unlinked rules retain each full call span in a nested receiver chain',async()=>{
  const context=await scan(`export function hold(){}export function tail(){}
    export function main(){unknown().hold().tail();}`);
  const records=[...context.graph.callSites.externalSites,...context.graph.callSites.unresolved];
  assert.equal(records.length,3);
  assert.equal(new Set(records.map(r=>r.site.start)).size,1);
  assert.equal(Object.keys(context.graph.callSites.unlinked).length,3);
  for(const record of records)assert.equal(context.graph.callSites.unlinked[`${file}:${record.site.start}:${record.site.end}`],record.rule??record.reason);
});

test('module diagnostics distinguish external and unresolved calls from linked declarations',async()=>{
  const context=await scan(`import create from 'external-kernel';
    const kernel=await create();
    let receiver;receiver.run();
    export function run(){return Math.abs(-1);}
    run();`);
  const m=model(context.graph,context.projection),rows=m.moduleCallSites.get(file);
  assert.deepEqual(rows.map(r=>[r.state,r.call,r.rule]),[
    ['external','create()','callee-package-import'],['unresolved','receiver.run()','member-receiver-unresolved']]);
  assert.ok(rows.every(r=>Number.isInteger(r.start)&&r.end>r.start&&r.line>0&&r.column>0));
  assert.ok(context.graph.callSites.externalSites.some(r=>r.site.text==='Math.abs(-1)'&&!r.from.endsWith(':<module>')));
  assert.ok(!rows.some(r=>r.call==='run()'));
});
