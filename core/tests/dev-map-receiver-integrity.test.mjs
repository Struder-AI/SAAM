import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow} from '../../scripts/dev-map/flow.mjs';
import {model} from '../../scripts/dev-map/regions.mjs';
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
