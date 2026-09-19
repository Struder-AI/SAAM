import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
import {presentationPage} from '../../scripts/dev-map/presentation.mjs';
import {compactPage} from '../../scripts/dev-map/agent-view.mjs';

const file='core/host-probe.mjs';
async function packet(body,params='host,x',extra='') {
  const source=`export function run(value){return value;}export function main(${params}){${body}}${extra}`;
  const model=await loadFlow({repo:'',files:[file],readSource:()=>source});
  return {p:flowPacket(model,`${file}::main`,{evidence:true}),source};
}
const hosts=p=>(p.operators??[]).filter(o=>o.scope==='parameter-member');

test('parameter host methods retain receiver, payload, result and unresolved target evidence',async()=>{
  const {p,source}=await packet('const result=host.run({input:x});return {checked:result};');
  const [op]=hosts(p);assert.ok(op);assert.equal(op.targetUnknown,true);assert.equal(op.receiver,'host');assert.equal(op.member,'run');
  assert.equal(op.targets,undefined);assert.equal(op.index,undefined);assert.equal(source.slice(op.start,op.end),'host.run({input:x})');
  assert.deepEqual(op.ports,{inputs:['receiver','arg1'],outputs:['result']});
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===op.id&&w.toPort==='receiver'));
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===op.id&&w.toPort==='arg1'));
  assert.ok(p.wires.some(w=>w.from===op.id&&w.fromPort==='result'&&w.to==='out1'&&w.label==='checked'));
  assert.ok(p.unresolved.some(u=>u.call==='host.run'&&u.rule==='member-receiver-unresolved'));
  assert.equal(op.arguments[0].fields[0].name,'input');
});

test('only proved const receiver aliases survive; escape does not certify method or state semantics',async()=>{
  const {p}=await packet('const alias=host;const second=alias;unknown(second);return second.run(x);');
  assert.equal(hosts(p).length,1);assert.equal(hosts(p)[0].targetUnknown,true);
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===hosts(p)[0].id&&w.toPort==='receiver'));
  assert.ok(!p.wires.some(w=>w.kind==='state'));
  for(const body of ['let alias=host;return alias.run(x);','const alias=host.child;return alias.run(x);',
    'host=unknown();return host.run(x);','host=x;return host.run(x);',
    'const alias=host;host.field=x;return alias.run(x);','const alias=host;unknown(()=>alias.run(x));return alias.run(x);',
    '{const host=unknown();return host.run(x);}','const alias=host;return alias.child.run(x);']) {
    assert.equal(hosts((await packet(body)).p).length,0,body);
  }
  const stable=await packet('const alias=host;host=unknown();return alias.run(x);');
  assert.equal(hosts(stable.p).length,1);
});

test('optional receiver and callable gates guard payload calls and argument state updates',async()=>{
  for(const [call,receiver,callable] of [['host?.run',true,false],['host.run?.',false,true],['host?.run?.',true,true]]) {
    const {p}=await packet(`let count=0;${call}(run(++count));return count;`),[op]=hosts(p);
    assert.ok(op,call);assert.equal(op.optional,true);assert.equal(!!op.optionalReceiver,receiver);assert.equal(!!op.optionalCall,callable);
    const gate=p.gates[op.gate];assert.ok(gate,call);
    assert.match(gate.text,receiver?/host !== null/:/host.run !== null/);
    const update=p.operators.find(o=>o.kind==='update'),choice=p.operators.find(o=>o.kind==='choice'&&o.binding==='count');
    assert.ok(update);assert.ok(choice);assert.ok(p.wires.some(w=>w.from===update.id&&w.to===choice.id&&w.toPort==='present'));
    assert.ok(choice.alternatives.some(a=>a.port==='nullish'&&a.constant));
    const helper=p.components.find(c=>c.label==='run');assert.ok(helper.gate!==undefined);
    assert.match(p.gates[helper.gate].text,/!== null/);
  }
});

test('known calls, builtins and local collection operators are not duplicated as host methods',async()=>{
  const {p}=await packet('Math.abs(x);const m=new Map();m.set(x,x);const values=[];values.push(x);run(x);return {host:host.run(x),value:m.get(x),count:values.length};');
  assert.equal(hosts(p).length,1);assert.equal(hosts(p)[0].callee,'host.run');
  assert.ok(p.operators.some(o=>o.kind==='collection'&&o.operation==='set'));
  assert.ok(p.operators.some(o=>o.kind==='collection'&&o.operation==='push'));
  assert.ok(p.externalSites.some(s=>s.call==='Math.abs'));assert.equal(p.components.filter(c=>c.label==='run').length,1);
  const known=await packet('const local=new Local();return local.run(x);','host,x','class Local {run(x){return x;}}');
  assert.equal(hosts(known.p).length,0);assert.ok(known.p.components.some(c=>c.label==='Local::run'));
});

test('host spread and unknown arguments retain position and origin uncertainty',async()=>{
  const {p}=await packet('return host["run"](...x,unknown());'),[op]=hosts(p);
  assert.ok(op);assert.equal(op.arguments[0].spread,true);assert.equal(op.arguments[1].positionUnknown,true);
  assert.equal(op.arguments[1].unknown,true);assert.equal(op.arguments[1].constant,undefined);
  assert.ok(p.uncertainty.some(u=>u.kind==='argument-origin'&&u.argument===2));
  assert.equal(hosts((await packet('return host[x](x);')).p).length,0);
});

test('nested logical expressions sharing a start have distinct operators and no self wires',async()=>{
  const {p}=await packet('return host && x && run(x);');
  const choices=p.operators.filter(o=>o.kind==='choice');assert.equal(choices.length,2);
  assert.equal(new Set(choices.map(o=>o.id)).size,2);assert.equal(choices[0].start,choices[1].start);assert.notEqual(choices[0].end,choices[1].end);
  assert.ok(!p.wires.some(w=>w.from===w.to));
  assert.ok(p.wires.some(w=>w.from===choices[0].id&&w.to===choices[1].id));
});

test('human and compact agent presentation preserve unknown receiver target and both optional guards',async()=>{
  const {p}=await packet('return host?.run?.(x);');
  for(const visible of [presentationPage(p),compactPage(p)]) {
    const [op]=hosts(visible);assert.equal(op.receiver,'host');assert.equal(op.member,'run');assert.equal(op.targetUnknown,true);
    assert.equal(op.optionalReceiver,true);assert.equal(op.optionalCall,true);assert.ok(visible.gates[op.gate]);
    assert.ok(visible.wires.some(w=>w.from==='in1'&&w.to===op.id&&w.toPort==='receiver'));
    assert.ok(visible.wires.some(w=>w.from===op.id&&w.to==='out1'));
    assert.ok(visible.unresolved.some(u=>u.call==='host?.run'&&u.rule==='member-receiver-unresolved'));
  }
});
