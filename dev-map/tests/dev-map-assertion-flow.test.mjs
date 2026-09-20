import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {invocationInstances} from '../lib/instances.mjs';
import {compactPage} from '../lib/agent-view.mjs';
const file='core/assertion-probe.mjs';
const helpers='export function demand(condition,message){if(!condition)throw new Error(message);}export const consume=x=>x;';
async function packet(body,params='x,y,message') {
  const source=helpers+`export function main(${params}){${body}}`;
  return {source,p:flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`,{evidence:true})};
}

test('assertion retains ordinary data inputs and detailed evidence without a fabricated success edge',async()=>{
  const {p,source}=await packet('demand(x>y,message);return consume(x);');
  const gate=p.components.find(c=>c.label==='demand'),consumer=p.components.find(c=>c.label==='consume');
  assert.equal(gate.shape,'assertion');assert.equal(gate.assertion.condition.name,'x');assert.equal(gate.assertion.condition.position,1);assert.equal(gate.assertion.messagePosition,2);
  const span=gate.assertion.condition.source;assert.equal(source.slice(span.start,span.end),'x>y');assert.equal(span.endColumn-span.column,3);
  for(const [from,toPort] of [['in1','arg1'],['in2','arg1'],['in3','arg2']])assert.ok(p.wires.some(w=>w.from===from&&w.to===gate.index&&w.toPort===toPort));
  assert.ok(!p.wires.some(w=>w.from===gate.index&&w.to===consumer.index));
  const call=p.callBindings.find(c=>c.callee.endsWith('::demand'));assert.equal(call.result.kind,'unused');assert.deepEqual(call.assertion,gate.assertion);
  assert.equal(p.requires[0].text,'x>y');assert.equal(p.requires[0].message,undefined);
});

test('repeated assertions have distinct condition sources, literal messages and input wires',async()=>{
  const {p,source}=await packet('demand(x>0,"first secret");demand(y<10,"second secret");return x;');
  const shown=invocationInstances(p),gates=shown.components.filter(c=>c.shape==='assertion');assert.equal(gates.length,2);
  assert.notEqual(gates[0].id,gates[1].id);
  for(const [i,predicate] of ['x>0','y<10'].entries()) {
    const span=gates[i].assertion.condition.source;assert.equal(source.slice(span.start,span.end),predicate);
    assert.ok(shown.wires.some(w=>w.from===`in${i+1}`&&w.to===gates[i].id&&w.toPort==='arg1'));
    assert.ok(!shown.wires.some(w=>w.from===`in${2-i}`&&w.to===gates[i].id));
  }
  const calls=shown.callBindings.filter(c=>c.callee.endsWith('::demand'));assert.deepEqual(calls.map(c=>c.arguments[1].expression),['"first secret"','"second secret"']);
  assert.deepEqual(p.requires.map(r=>r.message),['first secret','second secret']);
  assert.ok(!shown.wires.some(w=>w.from===gates[0].id&&w.to===gates[1].id));
});

test('spread and omitted assertion conditions do not get false caller predicate spans',async()=>{
  for(const [body,flag] of [['demand(...x);','positionUnknown'],['demand();','omitted']]) {
    const {p}=await packet(body),gate=p.components.find(c=>c.shape==='assertion');
    assert.equal(gate.assertion.condition[flag],true);assert.equal(gate.assertion.condition.source,undefined);
  }
});

test('local assertion declarations remain visible and carry actual call evidence',async()=>{
  const {p}=await packet('function local(condition){if(!condition)throw new Error("failed");}local(x);return x;');
  const gate=p.components.find(c=>c.label.endsWith('::local'));assert.equal(gate.shape,'assertion');
  assert.ok(p.callBindings.some(c=>c.callee.endsWith('::local')&&c.assertion.condition.name==='x'));
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===gate.index));
});

test('compact assertion metadata keeps exact source columns without copying predicate or message bodies',async()=>{
  const {p}=await packet('demand(x>0,"secret diagnostic");return x;'),rich=p.components.find(c=>c.shape==='assertion');
  const compact=compactPage(p),gate=compact.components.find(c=>c.shape==='assertion'),span=gate.assertion.condition.source;
  assert.deepEqual(span.range,[rich.assertion.condition.source.line,rich.assertion.condition.source.endLine]);
  assert.equal(span.column,rich.assertion.condition.source.column);assert.equal(span.endColumn,rich.assertion.condition.source.endColumn);
  assert.ok(!JSON.stringify(gate).includes('secret diagnostic'));assert.ok(!JSON.stringify(gate).includes('x>0'));
});

test('actual tessellation prior-error feedback remains connected through its assertion consumer',async()=>{
  const model=await loadFlow({files:['core/geom/tessellate.mjs','core/geom/tolerance.mjs','core/geom/mesh.mjs']});
  const p=invocationInstances(flowPacket(model,'core/geom/tessellate.mjs::tessellateShell'));
  const previous=p.operators.find(o=>o.kind==='iteration'&&o.binding==='previousError');assert.ok(previous);assert.deepEqual(previous.initialConstants,['Infinity']);
  const guard=p.components.find(c=>c.shape==='assertion'&&c.assertion?.condition.name==='candidate.sampledErrorMm');assert.ok(guard);
  assert.ok(p.wires.some(w=>w.from===previous.id&&w.fromPort==='current'&&w.to===(guard.id??guard.index)&&w.toPort==='arg1'));
  assert.ok(p.wires.some(w=>w.to===previous.id&&w.toPort==='next'&&w.provenance==='ast-normal-backedge'));
});
