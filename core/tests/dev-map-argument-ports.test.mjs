import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
import {presentationPage} from '../../scripts/dev-map/presentation.mjs';
const file='core/argument-slots.mjs';
const read=async body=>{
  const source=`export const accept=(a,b,c,d)=>[a,b,c,d];export const make=x=>x;export function main(x,y,z){${body}}`;
  return presentationPage(flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`));
};
const incoming=(page,call)=>page.wires.filter(w=>w.to===call.instance&&w.kind==='data');

test('argument wires distinguish source order and repeated use at each invocation',async()=>{
  const page=await read('accept(x,y);accept(y,x);return accept(x,x);');
  const calls=page.callBindings.filter(c=>c.callee.endsWith('::accept'));
  assert.deepEqual(calls.map(c=>incoming(page,c).map(w=>[w.from,w.toPort])),[
    [['in1','arg1'],['in2','arg2']],[['in2','arg1'],['in1','arg2']],[['in1','arg1'],['in1','arg2']]
  ]);
  assert.ok(page.wires.every(w=>!w.positionUnknown&&!w.spread));
});

test('spread wire slots retain source positions while expanded destinations remain unknown',async()=>{
  const page=await read('accept(x,...y,z);return accept(...x,y,...z);');
  const calls=page.callBindings.filter(c=>c.callee.endsWith('::accept'));
  const slots=call=>incoming(page,call).map(w=>[w.from,w.toPort,!!w.positionUnknown,!!w.spread]);
  assert.deepEqual(slots(calls[0]),[['in1','arg1',false,false],['in2','arg2',true,true],['in3','arg3',true,false]]);
  assert.deepEqual(slots(calls[1]),[['in1','arg1',true,true],['in2','arg2',true,false],['in3','arg3',true,true]]);
});

test('argument slots retain their exact producer instance and optional invocation gate',async()=>{
  const page=await read('const first=make(x),second=make(y);accept(first,second);return accept?.(second,first);');
  const made=page.callBindings.filter(c=>c.callee.endsWith('::make'));
  const calls=page.callBindings.filter(c=>c.callee.endsWith('::accept'));
  assert.deepEqual(incoming(page,calls[0]).map(w=>[w.from,w.toPort]),[[made[0].instance,'arg1'],[made[1].instance,'arg2']]);
  assert.deepEqual(incoming(page,calls[1]).map(w=>[w.from,w.toPort]),[[made[1].instance,'arg1'],[made[0].instance,'arg2']]);
  assert.ok(incoming(page,calls[1]).every(w=>page.gates[w.gate].kind==='optional-call'));
});

test('literal and unknown argument slots do not create fabricated producer wires',async()=>{
  const page=await read('return accept(0,unknown(),x);');
  const call=page.callBindings.find(c=>c.callee.endsWith('::accept'));
  const node=page.components.find(c=>c.label==='accept');
  assert.deepEqual(page.wires.filter(w=>w.to===node.index).map(w=>[w.from,w.toPort]),[['in1','arg3']]);
  assert.equal(call.arguments[0].constant,true);assert.equal(call.arguments[1].unknown,true);
});
