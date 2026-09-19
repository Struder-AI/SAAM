import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';

const file='core/local-state.mjs';
const packet=async source=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),`${file}::main`);
const collection=(p,operation)=>p.operators?.filter(o=>o.kind==='collection'&&o.operation===operation)??[];
const wire=(p,from,to,fromPort,toPort)=>p.wires.some(w=>w.from===from&&w.to===to&&(!fromPort||w.fromPort===fromPort)&&(!toPort||w.toPort===toPort));

test('local Map reads observe the state before and after each set',async()=>{
  const p=await packet('export function main(key,value){const map=new Map();const before=map.get(key);map.set(key,value);const after=map.get(key);return {before,after,size:map.size};}');
  const [create]=collection(p,'create'),[before,after]=collection(p,'get'),[set]=collection(p,'set'),[size]=collection(p,'size');
  assert.ok(wire(p,create.id,before.id,'state','state'));
  assert.ok(wire(p,create.id,set.id,'state','state'));
  assert.ok(wire(p,set.id,after.id,'state','state'));
  assert.ok(wire(p,set.id,size.id,'state','state'));
  assert.ok(!wire(p,set.id,before.id));
  assert.equal(set.arguments.find(a=>a.port==='value').expression,'value');
  const nested=await packet('export function main(a,b){const map=new Map();map.set(a,(map.set(b,1),2));return map.size;}');
  const [inside,outside]=collection(nested,'set');
  assert.ok(wire(nested,inside.id,outside.id,'state','state'),'argument mutation precedes outer set');
});

test('array push state, numeric return and simple map projection remain distinct',async()=>{
  const p=await packet('export function main(item){const items=[];const count=items.push(item);const names=items.map(x=>x.name);return {count,size:items.length,names};}');
  const [create]=collection(p,'create'),[push]=collection(p,'push'),[map]=collection(p,'map'),[length]=collection(p,'length');
  assert.ok(wire(p,create.id,push.id,'state','state'));
  assert.ok(wire(p,push.id,map.id,'state','state'));
  assert.ok(wire(p,push.id,length.id,'state','state'));
  assert.ok(wire(p,push.id,'out1','result'));
  assert.equal(map.projection,'x=>x.name');
  const assigned=await packet('export function main(item){let items=[];items=items.push(item);return items.length;}');
  assert.equal(collection(assigned,'length').length,0,'numeric push result is not an array');
});

test('collection and literal counter loops retain initial/current/next/final including zero iterations',async()=>{
  const p=await packet('export function main(items){const map=new Map();let count=0;for(const item of items){map.set(item,count);count++;}return {count,size:map.size};}');
  const iterations=p.operators.filter(o=>o.kind==='iteration'),mapLoop=iterations.find(o=>o.binding==='map'),countLoop=iterations.find(o=>o.binding==='count');
  const [created]=collection(p,'create'),[set]=collection(p,'set'),[size]=collection(p,'size'),update=p.operators.find(o=>o.kind==='update');
  assert.equal(mapLoop.minIterations,0);assert.equal(countLoop.minIterations,0);assert.deepEqual(countLoop.initialConstants,['0']);
  assert.ok(wire(p,created.id,mapLoop.id,'state','initial'));
  assert.ok(wire(p,mapLoop.id,set.id,'current','state'));
  assert.ok(wire(p,set.id,mapLoop.id,'state','next'));
  assert.ok(wire(p,mapLoop.id,size.id,'final','state'));
  assert.ok(wire(p,countLoop.id,update.id,'current','prior'));
  assert.ok(wire(p,update.id,countLoop.id,'next','next'));
  assert.ok(wire(p,countLoop.id,'out1','final'));
});

test('optional counter arguments select incremented or previous state and retain prefix/postfix semantics',async()=>{
  for(const expression of ['++count','count++']) {
    const p=await packet(`export function main(callback,items){let count=0;for(const item of items)callback?.(${expression});return count;}`);
    const loop=p.operators.find(o=>o.kind==='iteration'&&o.binding==='count'),update=p.operators.find(o=>o.kind==='update'),invoke=p.operators.find(o=>o.kind==='invocation');
    const selected=p.operators.find(o=>o.kind==='choice'&&o.binding==='count');
    assert.equal(update.prefix,expression==='++count');
    assert.ok(wire(p,update.id,invoke.id,'result','arg1'));
    assert.ok(wire(p,update.id,selected.id,'next','present'));
    assert.ok(wire(p,loop.id,selected.id,'current','nullish'));
    assert.ok(wire(p,selected.id,loop.id,'selected','next'));
    assert.match(p.gates[update.gate].text,/callback !== null/);
  }
});

test('aliases, escapes, captures and shadowed constructors do not receive certified collection operations',async()=>{
  for(const source of [
    'export function main(Map,key){const map=new Map();map.set(key,1);return map.size;}',
    'export function main(map,key){map.set(key,1);return map.size;}',
    'export function main(key){const map=new Map();const alias=map;alias.set(key,1);return map.size;}',
    'export function main(key){const map=new Map();unknown(map);map.set(key,1);return map.size;}',
    'export function main(key){const map=new Map();unknown(()=>map.set(key,1));return map.size;}',
  ]) {
    const p=await packet(source);assert.equal(collection(p,'set').length,0,source);assert.equal(collection(p,'size').length,0,source);
  }
});
