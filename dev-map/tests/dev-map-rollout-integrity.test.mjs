import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {presentationPage} from '../lib/presentation.mjs';
import {composePages} from '../lib/composition.mjs';
const file='core/rollout-probe.mjs';
const scan=async source=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`);
const endpointRows=page=>[...page.components.map(c=>({key:c.id??c.index,...c})),...page.inputs.map(p=>({key:p.port,...p})),...page.outputs.map(p=>({key:p.port,...p}))];

test('returning a locally known callable does not borrow an invocation result or become unknown',async()=>{
  const raw=await scan('export function main(input){const stage=x=>x;stage(input);stage(input);return stage;}');
  const p=presentationPage(raw),source=raw.components.find(c=>c.label==='main::stage');
  assert.ok(!p.uncertainty?.some(u=>u.kind==='invocation-origin'));
  const returned=p.wires.find(w=>w.kind==='return'&&w.to==='out1');assert.ok(returned);
  const producer=endpointRows(p).find(row=>row.key===returned.from);
  assert.equal(producer.index,source.index);assert.equal(producer.unknown,undefined);
  assert.equal(producer.invocation,undefined,'a callable value is not either call result');
});

test('passing a locally known callback after calling it twice keeps the callable source',async()=>{
  const raw=await scan('export const use=callback=>callback;export function main(input){const stage=x=>x;stage(input);stage(input);return use(stage);}');
  const p=presentationPage(raw),source=raw.components.find(c=>c.label==='main::stage'),consumer=p.components.find(c=>c.label==='use');
  assert.ok(!p.uncertainty?.some(u=>u.kind==='invocation-origin'));
  const wire=p.wires.find(w=>w.to===(consumer.id??consumer.index)&&w.label==='stage');assert.ok(wire);
  const producer=endpointRows(p).find(row=>row.key===wire.from);
  assert.equal(producer.index,source.index);assert.equal(producer.unknown,undefined);assert.equal(producer.invocation,undefined);
});

test('nested function groups retain every repeated invocation boundary edge',async()=>{
  const raw=await scan('export const a=x=>x;export const b=(x,y)=>x+y;export function main(x){const first=a(x),last=a(x);return b(first,last);}');
  const result=composePages(new Map([[raw.path,raw]]),{schema:1,flows:[{path:raw.path,groups:[{id:'stages',members:[`${file}::a`,`${file}::b`],groups:[{id:'repeated',members:[`${file}::a`]}]}]}]},{});
  const group=[...result.groupPages.values()].find(p=>p.path.endsWith('/repeated')),shown=presentationPage(group);
  const ids=new Set([...endpointRows(shown).map(row=>row.key),...(shown.operators??[]).map(op=>op.id)]);
  assert.equal(shown.components.filter(c=>c.invocation).length,2);
  assert.equal(shown.wires.length,raw.wires.filter(w=>w.from!==raw.components.find(c=>c.label==='b').index).length);
  assert.ok(shown.wires.every(w=>ids.has(w.from)&&ids.has(w.to)));
  assert.deepEqual(new Set(shown.wires.map(w=>w.edgeId)),new Set(group.boundary.map(b=>b.edgeId)));
});

test('repeated invocations separated by another stage cannot be contracted into false feedback',async()=>{
  const raw=await scan('export const a=x=>x;export const b=x=>x;export function main(x){const first=a(x),second=b(first),last=a(second);return last;}');
  assert.throws(()=>composePages(new Map([[raw.path,raw]]),{schema:1,flows:[{path:raw.path,groups:[
    {id:'repeated',members:[`${file}::a`]}]}]},{}),/Non-convex composition/);
});
