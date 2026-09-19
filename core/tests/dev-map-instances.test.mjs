import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
import {presentationPage} from '../../scripts/dev-map/presentation.mjs';
import {composePages} from '../../scripts/dev-map/composition.mjs';
import {destinationFor} from '../../scripts/dev-map/store.mjs';
const file='core/stages.mjs';
const packet=async body=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>`export const move=x=>x;export function main(input,flag){${body}}`}),`${file}::main`);

test('reusing an implementation preserves sequential stage instances and their actual data chain',async()=>{
  const rich=await packet('const up=move(input),across=move(up),down=move(across);return down;');
  const before=structuredClone(rich),p=presentationPage(rich),[up,across,down]=p.components;
  assert.equal(destinationFor(rich),'graph');assert.deepEqual(rich,before);
  assert.equal(p.components.length,3);assert.equal(new Set(p.components.map(c=>c.id)).size,3);
  assert.equal(new Set(p.components.map(c=>c.index)).size,1);
  assert.deepEqual(p.components.map(c=>c.binding),['up','across','down']);
  for(const [from,to]of [['in1',up.id],[up.id,across.id],[across.id,down.id],[down.id,'out1']])assert.ok(p.wires.some(w=>w.from===from&&w.to===to),`${from} → ${to}`);
  assert.ok(!p.uncertainty?.some(u=>u.kind==='invocation-origin'));
  const ids=new Set([...p.components.map(c=>c.id),...p.inputs.map(x=>x.port),...p.outputs.map(x=>x.port)]);
  assert.ok(p.wires.every(w=>ids.has(w.from)&&ids.has(w.to)));
});

test('alternative invocations retain distinct gates without implying a sequential chain',async()=>{
  const p=presentationPage(await packet('const value=flag?move(input):move(0);return value;'));
  assert.equal(p.components.length,2);
  assert.notEqual(p.components[0].gate,p.components[1].gate);
  assert.ok(!p.wires.some(w=>p.components.some(c=>c.id===w.from)&&p.components.some(c=>c.id===w.to)));
  assert.ok(!p.uncertainty?.some(u=>u.kind==='invocation-origin'));
});

test('one call inside a loop stays one stage with loop-carried connections',async()=>{
  const p=presentationPage(await packet('let state=input;for(let i=0;i<3;i++)state=move(state);return state;'));
  assert.equal(p.components.length,1);assert.equal(p.components[0].id,undefined);
  assert.ok(p.operators.some(op=>op.kind==='iteration'&&op.binding==='state'));
});

test('nested calls and same-line same-argument invocations retain separate source identity',async()=>{
  const p=presentationPage(await packet('const a=move(input),b=move(input);return move(move(a));'));
  assert.equal(p.components.length,4);
  assert.equal(p.wires.filter(w=>w.from==='in1').length,2);
  assert.ok(!p.uncertainty?.some(u=>u.kind==='invocation-origin'));
});

test('authored containment keeps every instance of a member and preserves boundary evidence',async()=>{
  const rich=await packet('const up=move(input),across=move(up),down=move(across);return down;');
  const config={schema:1,flows:[{path:rich.path,groups:[{id:'travel',members:[`${file}::move`]}]}]};
  const result=composePages(new Map([[rich.path,rich]]),config,{});
  const p=presentationPage([...result.groupPages.values()][0]);
  assert.equal(p.components.length,3);
  assert.ok(p.wires.some(w=>w.from===p.components[0].id&&w.to===p.components[1].id));
  assert.ok(!p.uncertainty?.some(u=>u.kind==='invocation-origin'));
});

test('member chains sharing a source start do not become repeated calls to their producer',async()=>{
  const source='export async function bundleFor(x){return x;} export function main(x){return bundleFor(x).then(y=>y).catch(e=>e).finally(()=>{});}';
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const p=flowPacket(context,`${file}::main`),calls=p.callBindings.filter(c=>c.callee===`${file}::bundleFor`);
  assert.equal(calls.length,1);assert.equal(source.slice(calls[0].start,calls[0].end),'bundleFor(x)');
  assert.equal(p.components.find(c=>c.label==='bundleFor').calls,undefined);
});
