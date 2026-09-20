import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {invocationInstances} from '../lib/instances.mjs';
import {compactPage} from '../lib/agent-view.mjs';
const file='core/closure-probe.mjs';
const helpers='export const build=value=>({value});';
async function packet(body,params='x,y') {
  const source=helpers+`export function main(${params}){${body}}`;
  return {source,p:flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`,{evidence:true})};
}
const child=(p,name)=>p.components.find(c=>c.label===`main::${name}`);

test('returned methods are callable values with capture references, never executions of their bodies',async()=>{
  const {p}=await packet('const value=build(x);return {read(){return build(value);},empty(){}};');
  const read=child(p,'read'),empty=child(p,'empty'),build=p.components.find(c=>c.label==='build');
  assert.equal(read.closure,true);assert.equal(read.calls,0);assert.equal(empty.calls,0);
  assert.equal(p.callBindings.filter(c=>c.callee.endsWith('::build')).length,1);
  assert.ok(p.wires.some(w=>w.from===build.index&&w.to===read.index&&w.kind==='capture'&&w.toPort==='capture:value'));
  for(const [component,name] of [[read,'read'],[empty,'empty']])assert.ok(p.wires.some(w=>w.from===component.index&&w.to==='out1'&&w.label===name&&w.fromPort==='callable'&&w.provenance==='ast-closure-value'));
  assert.ok(!p.uncertainty?.some(u=>u.kind==='callback-execution'));
  assert.equal(read.captures[0].reference,true);assert.equal(read.captures[0].valueUnknown,undefined);
});

test('named declarations, arrows and aliases preserve callable identity including declaration hoisting',async()=>{
  for(const body of ['function read(){return x;}const alias=read;return {alias};',
    'const read=()=>x;const alias=read;return {alias};','return {read};function read(){return x;}']) {
    const {p}=await packet(body),read=child(p,'read');assert.ok(read,body);
    assert.ok(p.wires.some(w=>w.from===read.index&&w.fromPort==='callable'&&w.to==='out1'),body);
    assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===read.index&&w.kind==='capture'),body);
  }
});

test('capture origins from repeated producer invocations stay distinct across sibling closures',async()=>{
  const {p}=await packet('const left=build(x),right=build(y);function a(){return left;}function b(){return right;}return {a,b};');
  const shown=invocationInstances(p),[left,right]=shown.components.filter(c=>c.label==='build'),a=child(shown,'a'),b=child(shown,'b');
  assert.notEqual(left.id,right.id);
  assert.ok(shown.wires.some(w=>w.from===left.id&&w.to===a.index&&w.kind==='capture'));
  assert.ok(shown.wires.some(w=>w.from===right.id&&w.to===b.index&&w.kind==='capture'));
  assert.ok(!shown.wires.some(w=>w.from===left.id&&w.to===b.index||w.from===right.id&&w.to===a.index));
  const uses=p.callBindings.filter(c=>c.callee.endsWith('::build')).map(c=>c.resultUses.filter(u=>u.kind==='capture').map(u=>u.callee));
  assert.deepEqual(uses,[[`${file}::main::a`],[`${file}::main::b`]]);
});

test('mutable captures retain binding identity and lifetime limits without false initial-value edges',async()=>{
  const {p}=await packet('let disposed=false;return {read(){return disposed;},dispose(){disposed=true;}};');
  const read=child(p,'read'),dispose=child(p,'dispose');
  assert.deepEqual(read.captures[0].source,dispose.captures[0].source);
  assert.equal(read.captures[0].access,'read');assert.equal(dispose.captures[0].access,'write');
  for(const component of [read,dispose]) {
    assert.equal(component.captures[0].valueUnknown,true);assert.equal(component.captures[0].lifetimeUnknown,true);
    assert.ok(!p.wires.some(w=>w.kind==='capture'&&w.to===component.index));
  }
  assert.ok(!p.wires.some(w=>w.from===read.index&&w.to===dispose.index||w.from===dispose.index&&w.to===read.index));
});

test('shadowed names and static record keys are not captures; stable primitives have no blanket uncertainty',async()=>{
  const {p}=await packet('const fixed=2;return {read(x){return {y:1,x,fixed};}};');
  const read=child(p,'read');assert.deepEqual(read.captures.map(c=>c.name),['fixed']);
  for(const flag of ['valueUnknown','lifetimeUnknown','mutationUnknown'])assert.equal(read.captures[0][flag],undefined);
  assert.ok(!p.wires.some(w=>w.kind==='capture'));
  const mutated=await packet('const state=build(x);return {read(){return state;},write(){state.value=y;}};');
  assert.equal(child(mutated.p,'read').captures.find(c=>c.name==='state').mutationUnknown,true);
  const reassigned=await packet('function read(){return x;}x=y;return read;');
  assert.equal(child(reassigned.p,'read').captures[0].valueUnknown,true);assert.ok(!reassigned.p.wires.some(w=>w.kind==='capture'));
});

test('a called and returned closure keeps canonical callable reference separate from invocation copies',async()=>{
  for(const calls of ['read(x);','read(x);read(y);']) {
    const {p}=await packet(`function read(value){return [x,value];}${calls}return {read};`),shown=invocationInstances(p);
    const reference=shown.components.find(c=>c.reference==='callable'),invoked=shown.components.filter(c=>c.label==='main::read'&&c.id);
    assert.ok(reference);assert.equal(invoked.length,calls==='read(x);'?1:2);
    assert.ok(shown.wires.some(w=>w.to===reference.index&&w.kind==='capture'));
    assert.ok(shown.wires.some(w=>w.from===reference.index&&w.fromPort==='callable'&&w.to==='out1'));
    assert.ok(invoked.every(c=>!shown.wires.some(w=>w.to===c.id&&w.kind==='capture')));
    assert.ok(!shown.inputs.some(i=>i.port.startsWith('untraced:')));
  }
});

test('actual machine presentation returns sample/dispose and connects stable captures while disposed remains unknown',async()=>{
  const model=await loadFlow({files:['core/machine/presentation.mjs']}),p=flowPacket(model,'core/machine/presentation.mjs::createMachinePresentation');
  const sample=p.components.find(c=>c.label.endsWith('::sample')),dispose=p.components.find(c=>c.label.endsWith('::dispose'));
  for(const name of ['program','descriptor','mechanism','layout'])assert.ok(p.wires.some(w=>w.to===sample.index&&w.kind==='capture'&&w.label===name));
  for(const component of [sample,dispose]) {
    assert.ok(p.wires.some(w=>w.from===component.index&&w.fromPort==='callable'&&w.to==='out2'));
    assert.equal(component.captures.find(c=>c.name==='disposed').valueUnknown,true);
  }
  assert.ok(!p.wires.some(w=>w.kind==='capture'&&w.label==='disposed'));
});

test('block-shadowed captures use their own binding, and declarations do not undo an earlier reassignment',async()=>{
  const {p}=await packet('const value=build(x);{const value=build(y);return {read(){return value;}};}');
  const shown=invocationInstances(p),[outer,inner]=shown.components.filter(c=>c.label==='build'),read=child(shown,'read');
  assert.ok(shown.wires.some(w=>w.from===inner.id&&w.to===read.index&&w.kind==='capture'));
  assert.ok(!shown.wires.some(w=>w.from===outer.id&&w.to===read.index));
  const overwritten=await packet('read=x;function read(){return y;}return read;');
  assert.ok(overwritten.p.wires.some(w=>w.from==='in1'&&w.to==='out1'));
  assert.ok(!overwritten.p.wires.some(w=>w.from===child(overwritten.p,'read').index&&w.to==='out1'));
});

test('default agent view keeps capture and callable roles without repeating bodies or binding source details',async()=>{
  const {p}=await packet('const value=build(x);return {read(){return [value,"secret closure body"];}};');
  const shown=compactPage(p),read=child(shown,'read');assert.equal(read.captures[0].reference,true);assert.equal(read.captures[0].source,undefined);
  assert.ok(shown.wires.some(w=>w.kind==='capture'&&w.to===read.index));
  assert.ok(shown.wires.some(w=>w.from===read.index&&w.fromPort==='callable'));
  assert.ok(!JSON.stringify(shown).includes('secret closure body'));
});
