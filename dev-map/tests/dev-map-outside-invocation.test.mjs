import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';

const file='core/outside-probe.mjs',skill='skills/example/stage.mjs';
async function packet(source,options={}) {
  const sources={[file]:source,[skill]:'export function stage(value, extra){return {value,extra};}',...options};
  return flowPacket(await loadFlow({repo:'',files:Object.keys(sources),readSource:name=>sources[name]}),`${file}::main`,{evidence:true});
}
const invocation=p=>p.operators?.filter(o=>o.kind==='invocation')??[];
const imported=`import {stage} from '../skills/example/stage.mjs';`;

test('known outside skill calls retain their exact source target and callback/result dataflow',async()=>{
  const source=imported+'export const consume=value=>value;export function main(callback,x){const result=stage(x);callback(result);return consume(result);}';
  const p=await packet(source),outside=invocation(p).find(o=>o.scope==='outside'),callback=invocation(p).find(o=>o.callee==='callback'),consume=p.components.find(c=>c.label==='consume');
  assert.ok(outside);assert.equal(outside.callee,'stage');assert.equal(outside.callKind,'call');assert.equal(outside.targetUnknown,undefined);assert.equal(outside.possibleTarget,undefined);
  assert.deepEqual(outside.targets,[{path:`${skill}::stage`,label:'stage',file:skill,line:1,endLine:1}]);
  assert.equal(outside.index,undefined);assert.equal(outside.targets[0].index,undefined);
  assert.equal(outside.file,file);assert.equal(source.slice(outside.start,outside.end),'stage(x)');
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===outside.id&&w.toPort==='arg1'));
  assert.ok(p.wires.some(w=>w.from===outside.id&&w.fromPort==='result'&&w.to===callback.id&&w.toPort==='arg1'));
  assert.ok(p.wires.some(w=>w.from===outside.id&&w.to===consume.index&&w.toPort==='arg1'));
  assert.equal(callback.targetUnknown,true);assert.equal(p.unresolved.length,1);assert.equal(p.unresolved[0].call,'callback');
  assert.equal(p.external,0);assert.ok(!p.components.some(c=>c.file===skill));
  assert.ok(p.callBindings.find(c=>c.callee.endsWith('::consume')).arguments[0].producers.some(pr=>pr.endpoint===outside.id&&pr.port==='result'));
});

test('outside invocations remain separate by source site and feed exactly their own consumers',async()=>{
  const p=await packet(imported+'export const consume=value=>value;export function main(x,y){const left=stage(x),right=stage(y);consume(left);return right;}');
  const [left,right]=invocation(p).filter(o=>o.scope==='outside');
  assert.notEqual(left.id,right.id);assert.notEqual(left.start,right.start);
  const consume=p.components.find(c=>c.label==='consume');
  assert.ok(p.wires.some(w=>w.from===left.id&&w.to===consume.index));
  assert.ok(!p.wires.some(w=>w.from===right.id&&w.to===consume.index));
  assert.ok(p.wires.some(w=>w.from===right.id&&w.to==='out1'));
  assert.ok(!p.wires.some(w=>w.from===left.id&&w.to==='out1'));
});

test('outside optional calls retain enclosing gates, spread slots and unknown arguments',async()=>{
  const p=await packet(imported+'export function main(enabled,items,x){if(enabled)return stage?.(...items,unknown(x));}'),op=invocation(p)[0];
  assert.equal(op.optional,true);assert.match(p.gates[op.gate].text,/enabled/);assert.match(p.gates[op.gate].text,/stage !== null/);
  assert.equal(op.arguments[0].position,1);assert.equal(op.arguments[0].spread,true);assert.equal(op.arguments[0].positionUnknown,true);
  assert.equal(op.arguments[1].position,2);assert.equal(op.arguments[1].positionUnknown,true);assert.equal(op.arguments[1].unknown,true);assert.equal(op.arguments[1].constant,undefined);
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===op.id&&w.spread&&w.positionUnknown&&w.gate===op.gate));
  assert.ok(p.uncertainty.some(u=>u.kind==='argument-origin'&&u.call==='stage'&&u.argument===2));
});

test('known outside stages do not absorb builtins or unresolved host methods into their classification',async()=>{
  const p=await packet(imported+'export function loadBundle(){}export function main(bundle,x){Math.abs(x);bundle.loadBundle(x);return stage(x);}');
  assert.deepEqual(invocation(p).filter(o=>o.scope==='outside').map(o=>o.callee),['stage']);
  assert.equal(invocation(p).find(o=>o.callee==='bundle.loadBundle').targetUnknown,true);
  assert.equal(p.external,1);assert.equal(p.externalSites[0].call,'Math.abs');
  assert.ok(p.unresolved.some(u=>u.call==='bundle.loadBundle'&&u.rule==='member-receiver-unresolved'));
});

test('outside possible targets retain alternatives without certifying one implementation',async()=>{
  const p=await packet(imported+"import {other} from '../skills/example/other.mjs';export function main(flag,x){const run=flag?stage:other;return run(x);}",{'skills/example/other.mjs':'export function other(x){return x;}'});
  const op=invocation(p)[0];assert.equal(op.possibleTarget,true);assert.equal(op.targets.length,2);
  assert.ok(op.targets.every(t=>t.possible===true));assert.equal(op.targetUnknown,undefined);
});

test('static returned fields name their data wires and keep expression evidence outside the label',async()=>{
  const p=await packet('export function main(flag){return {decision:flag?"secret-left":"secret-right"};}');
  const choice=p.operators.find(o=>o.kind==='choice'),wire=p.wires.find(w=>w.from===choice.id&&w.to==='out1');
  assert.equal(wire.label,'decision');assert.equal(wire.expression,'flag?"secret-left":"secret-right"');
  const overwritten=await packet('export const left=x=>x;export const right=x=>x;export function main(x){return {value:left(x),value:right(x)};}');
  const left=overwritten.components.find(c=>c.label==='left'),right=overwritten.components.find(c=>c.label==='right');
  assert.ok(!overwritten.wires.some(w=>w.from===left.index&&w.to==='out1'));
  assert.ok(overwritten.wires.some(w=>w.from===right.index&&w.to==='out1'&&w.label==='value'));
});

test('spreads and computed returned fields retain uncertainty instead of certifying overwritten field origins',async()=>{
  const p=await packet('export const left=x=>x;export function main(x,key){return {value:left(x),...x,[key]:x};}');
  const left=p.components.find(c=>c.label==='left');
  assert.ok(!p.wires.some(w=>w.from===left.index&&w.to==='out1'));
  assert.ok(p.uncertainty.some(u=>u.kind==='return-field-override'&&u.field==='value'));
  assert.ok(p.uncertainty.some(u=>u.kind==='return-field-origin'));
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to==='out1'));
});
