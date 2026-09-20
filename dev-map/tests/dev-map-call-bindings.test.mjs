import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';

const file='core/bindings.mjs';
const packet=async(source,name='main')=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::${name}`);
const helper='export const prepare=x=>x; export const consume=x=>x;\n';
const calls=(p,name)=>p.callBindings.filter(c=>c.callee===`${file}::${name}`);

test('repeated calls retain exact argument producers and consumers independently',async()=>{
  const source=helper+'export function main(a,b){const first=prepare(a);const second=prepare(b);consume(first);return consume(second);}';
  const p=await packet(source),prep=calls(p,'prepare'),uses=calls(p,'consume');
  assert.equal(prep.length,2);assert.notEqual(prep[0].start,prep[1].start);
  assert.deepEqual(prep.map(c=>c.arguments[0].producers[0].endpoint),['in1','in2']);
  assert.deepEqual(prep.map(c=>c.result.expression),['first','second']);
  for(let i=0;i<2;i++) {
    assert.equal(uses[i].arguments[0].producers[0].site.start,prep[i].start);
    assert.equal(prep[i].resultUses.length,1);
    assert.equal(prep[i].resultUses[0].site.start,uses[i].start);
    assert.equal(source.slice(prep[i].start,prep[i].end),`prepare(${i?'b':'a'})`);
  }
  assert.equal(uses[0].result.kind,'unused');assert.equal(uses[1].result.kind,'return');
  assert.deepEqual(uses[1].resultUses,[{kind:'return',port:'out1',line:2}]);
});

test('source expressions, defaults, destructuring and spread uncertainty survive call boundaries',async()=>{
  const source='export function target(first,{order=[],batchLayers=1}={},...rest){return first;}\nexport function main(items,key){target?.(items,{[key]:"a  b"});return target(...items,key);}';
  const p=await packet(source),bound=calls(p,'target'),callee=await packet(source,'target');
  assert.equal(bound[0].optional,true);assert.equal(bound[0].arguments[1].expression,'{[key]:"a  b"}');
  assert.equal(bound[0].arguments[1].producers[0].endpoint,'in2');
  assert.equal(bound[1].arguments[0].spread,true);
  assert.ok(bound[1].arguments.every(a=>a.positionUnknown));
  assert.deepEqual(callee.inputs[1],{port:'in2',name:'{order,batchLayers}',position:2,pattern:'{order=[],batchLayers=1}',default:'{}'});
  assert.equal(callee.inputs[2].rest,true);
});

test('reassignments and unknown arguments do not inherit an earlier call result',async()=>{
  const p=await packet(helper+'export function main(x){let value=prepare(x);value=external();return consume({value,fixed:1});}');
  const prep=calls(p,'prepare')[0],consume=calls(p,'consume')[0];
  assert.equal(prep.resultUses.length,0);assert.equal(consume.arguments[0].unknown,true);
  assert.deepEqual(consume.arguments[0].producers,[]);
});

test('aliases retain the observed producer site and identity arguments retain input origin',async()=>{
  const p=await packet(helper+'export function main(x){const renamed=x;const value=prepare(renamed);const alias=value;return consume(alias);}');
  const prep=calls(p,'prepare')[0],consume=calls(p,'consume')[0];
  assert.equal(prep.arguments[0].producers[0].endpoint,'in1');
  assert.equal(prep.arguments[0].producers[0].label,'renamed');
  assert.equal(consume.arguments[0].producers[0].site.start,prep.start);
  assert.equal(consume.arguments[0].producers[0].endpoint,`${file}::prepare`);
});

test('receiver calls and direct assignment bindings have source evidence without fabricated heap provenance',async()=>{
  const source='class Tool{run(x){return x;}} export function main(x){const tool=new Tool();let result;result=tool.run(x);return result;}';
  const p=await packet(source),call=calls(p,'Tool::run')[0];
  assert.equal(call.result.kind,'binding');assert.equal(call.result.expression,'result');
  assert.equal(source.slice(call.result.site.start,call.result.site.end),'result=tool.run(x)');
  assert.equal(call.arguments[0].producers[0].endpoint,'in1');
  assert.ok(call.resultUses.some(use=>use.kind==='return'));
});

test('escaped literal records lose field certification while throws keep their exit role',async()=>{
  const escaped=await packet(helper+'export function main(x){const whole={left:prepare(x)};external(whole);return consume(whole.left);}');
  assert.equal(calls(escaped,'prepare')[0].resultUses.some(u=>u.callee===`${file}::consume`),false);
  assert.equal(calls(escaped,'consume')[0].arguments[0].unknown,true);
  assert.ok(escaped.uncertainty.some(u=>u.kind==='record-escape'));
  const thrown=await packet(helper+'export function main(x){throw prepare(x);}');
  assert.equal(calls(thrown,'prepare')[0].result.kind,'throw');
  assert.deepEqual(calls(thrown,'prepare')[0].resultUses,[{kind:'throw',port:'out1',line:2}]);
});
