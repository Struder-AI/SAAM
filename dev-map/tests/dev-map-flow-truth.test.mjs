import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';

const file='core/truth.mjs';
const helpers=`
export function first(x){const y=x;return y;}
export function second(x){const y=x;return y;}
export function before(x){const y=x;return y;}
export function after(x){const y=x;return y;}
`;
const context=source=>loadFlow({repo:'',files:[file],readSource:()=>helpers+source});
const packet=async source=>flowPacket(await context(source),`${file}::main`);
const at=(p,label)=>p.components.find(c=>c.label===label)?.index;
const into=(p,label)=>p.wires.filter(w=>w.to===at(p,label)&&w.kind==='data');

test('nested conditions survive on call wires, components and exits',async()=>{
  const p=await packet('export function main(x,y){if(x){if(y)return first(x);}return null;}');
  const component=p.components.find(c=>c.label==='first'),gate=p.gates[component.gate];
  assert.deepEqual(gate.terms.map(({text,kind})=>({text,kind})),[{text:'x',kind:'if'},{text:'y',kind:'if'}]);
  assert.ok(gate.terms.every(term=>term.source.file===file&&term.source.line>0));
  assert.equal(p.wires.find(w=>w.to===component.index).gate,component.gate);
  assert.equal(p.outputs.find(o=>o.name==='first(x)').gate,component.gate);
});

test('opposite guards are not lost when equal endpoints and payloads are deduplicated',async()=>{
  const p=await packet('export function main(x,flag){if(flag)first(x);else first(x);}');
  assert.deepEqual(into(p,'first').map(w=>p.gates[w.gate].text),['flag','!(flag)']);
});

test('each use gets its reaching assignment, and literal reassignment kills old origins',async()=>{
  const p=await packet(`export function main(x){
    let value=first(x); before(value); value=second(x); after(value); value=0; return value;
  }`);
  assert.deepEqual(into(p,'before').map(w=>w.from),[at(p,'first')]);
  assert.deepEqual(into(p,'after').map(w=>w.from),[at(p,'second')]);
  assert.deepEqual(p.wires.filter(w=>w.to.startsWith('out')),[]);
  const parameter=await packet('export function main(x){x=second(x);return after(x);}');
  assert.deepEqual(into(parameter,'after').map(w=>w.from),[at(parameter,'second')]);
});

test('proved branch definitions meet at an explicit selected value, not a last-written guess',async()=>{
  const p=await packet(`export function main(x,flag){
    let value=first(x);if(flag){value=second(x);before(value);}return after(value);
  }`);
  assert.deepEqual(into(p,'before').map(w=>w.from),[at(p,'second')]);
  const join=p.operators.find(o=>o.kind==='choice'&&o.binding==='value');
  assert.ok(join);
  assert.deepEqual(into(p,'after').map(w=>[w.from,w.fromPort]),[[join.id,'selected']]);
  assert.ok(p.wires.some(w=>w.from===at(p,'second')&&w.to===join.id&&w.toPort==='true'));
  assert.ok(p.wires.some(w=>w.from===at(p,'first')&&w.to===join.id&&w.toPort==='false'));
});

test('proved loop assignments retain initial, next and final boundaries',async()=>{
  const p=await packet('export function main(x,list){let value=first(x);for(const item of list)value=second(item);return after(value);}');
  const loop=p.operators.find(o=>o.kind==='iteration'&&o.binding==='value');
  assert.equal(loop.minIterations,0);
  assert.deepEqual(into(p,'after').map(w=>[w.from,w.fromPort]),[[loop.id,'final']]);
  assert.ok(p.wires.some(w=>w.from===at(p,'first')&&w.to===loop.id&&w.toPort==='initial'));
  assert.ok(p.wires.some(w=>w.from===at(p,'second')&&w.to===loop.id&&w.toPort==='next'));
});

test('mutually exclusive receiver calls have no invented state sequence or last-step return',async()=>{
  const p=await packet(`export class C{a(){this.x=1;}b(){this.x=2;}}
    export function main(flag){const c=new C();if(flag)c.a();else c.b();return c;}`);
  assert.deepEqual(p.wires.filter(w=>w.provenance==='state-thread'),[]);
  assert.ok(p.uncertainty.some(u=>u.kind==='receiver-state-order'&&u.receiver==='c'));
  assert.deepEqual(p.wires.filter(w=>w.to.startsWith('out')).map(w=>w.from),[at(p,'C')]);
});

test('straight-line receiver source order does not invent returned state for a scalar exit',async()=>{
  const p=await packet(`export class C{a(){this.x=1;}b(){this.x=2;}}
    export function main(){const c=new C();c.a();c.b();return 7;}`);
  assert.ok(p.wires.some(w=>w.from===at(p,'C::a')&&w.to===at(p,'C::b')&&w.kind==='state'));
  assert.ok(p.wires.filter(w=>w.kind==='state').every(w=>w.order==='source'));
  assert.deepEqual(p.wires.filter(w=>w.to.startsWith('out')),[]);
});

test('multiple input values in a computed argument all retain their producers',async()=>{
  const p=await packet('export function main(x,y){const a=first(x),b=second(y);return after([a,b]);}');
  assert.deepEqual(new Set(into(p,'after').map(w=>w.from)),new Set([at(p,'first'),at(p,'second')]));
});

test('external operations and linked arithmetic helpers both remain visible',async()=>{
  const ctx=await context(`import {writeFile} from 'node:fs/promises';
    export const write=x=>writeFile('target',x);
    export const push=(list,x)=>list.push(x);
    export const clock=()=>Date.now();
    export const wrapper=x=>write(x);
    export const scale=x=>x*2;
    export const twice=x=>scale(x)+1;
    export function main(x){const y=twice(x);return after(y);}`);
  for(const label of ['write','push','clock','wrapper'])assert.ok(!ctx.shapes.formulas.has(`${file}::${label}`),label);
  for(const label of ['scale','twice'])assert.ok(ctx.shapes.formulas.has(`${file}::${label}`),label);
  const p=flowPacket(ctx,`${file}::main`);
  assert.deepEqual(into(p,'after').map(w=>[w.from,w.label]),[[at(p,'twice'),'y']]);
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===at(p,'twice')));
  const twice=flowPacket(ctx,`${file}::twice`);
  assert.ok(twice.components.some(c=>c.label==='scale'&&c.shape==='formula'));
  assert.ok(twice.wires.some(w=>w.from===at(twice,'scale')&&w.to==='out1'));
});

test('switch fallthrough does not falsely gate a body only by its own case',async()=>{
  const p=await packet('export function main(x){switch(x){case 1:first(x);case 2:second(x);}}');
  assert.ok(p.uncertainty.some(u=>u.kind==='switch-control-flow'));
  assert.ok(!p.gates.some(g=>g.kind==='case'));
});

test('member mutation invalidates object and known alias value origins',async()=>{
  const p=await packet('export function main(x){const value=first(x);const alias=value;value.x=0;return after(alias.x);}');
  assert.deepEqual(into(p,'after'),[]);
  assert.ok(p.uncertainty.some(u=>u.kind==='member-mutation'&&u.binding==='value.x'));
});
