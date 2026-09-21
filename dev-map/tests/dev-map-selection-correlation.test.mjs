import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPage,flowPacket} from '../lib/flow.mjs';

const file='core/selection-correlation.mjs';
const source=`
const makeA=value=>value;
const readA=bytes=>bytes;
const makeB=value=>value;
const readB=bytes=>bytes;
const adapters={a:{make:makeA,read:readA},b:{make:makeB,read:readB}};
const choose=key=>adapters[key];
export function correlated(key,value){
  const adapter=choose(key);
  const bytes=adapter.make(value);
  return adapter.read(bytes);
}
export function independent(producerKey,consumerKey,value){
  const producer=choose(producerKey);
  const consumer=choose(consumerKey);
  const bytes=producer.make(value);
  return consumer.read(bytes);
}`;

const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
const named=path=>path.slice(path.lastIndexOf('::')+2);
const calls=(page,name)=>page.callBindings.filter(call=>named(call.callee)===name);
const bytesWires=page=>page.wires.filter(wire=>wire.label==='bytes'&&wire.provenance==='ast-def-use')
  .map(wire=>[named(wire.from),named(wire.to)]).sort();

test('one adapter selection correlates producer and consumer alternatives',()=>{
  const page=flowPage(context,`${file}::correlated`);
  assert.deepEqual(bytesWires(page),[['makeA','readA'],['makeB','readB']]);

  for(const suffix of ['A','B']) {
    const make=calls(page,`make${suffix}`)[0],read=calls(page,`read${suffix}`)[0];
    assert.deepEqual(make.selections,read.selections);
    assert.deepEqual(read.arguments[0].producers.map(p=>named(p.endpoint)),[`make${suffix}`]);
    assert.deepEqual(make.resultUses.filter(use=>use.kind==='argument').map(use=>named(use.callee)),[`read${suffix}`]);
  }

  const packet=flowPacket(context,`${file}::correlated`);
  assert.ok(packet.callBindings.filter(call=>call.possibleTarget).every(call=>Object.keys(call.selections).length===1));
});

test('independent adapter selections retain conservative alternatives',()=>{
  const page=flowPage(context,`${file}::independent`);
  assert.deepEqual(bytesWires(page),[
    ['makeA','readA'],['makeA','readB'],['makeB','readA'],['makeB','readB']
  ]);

  const make=calls(page,'makeA')[0],read=calls(page,'readA')[0];
  assert.equal(Object.keys(make.selections).some(key=>Object.hasOwn(read.selections,key)),false);
  assert.deepEqual(read.arguments[0].producers.map(p=>named(p.endpoint)).sort(),['makeA','makeB']);
});
