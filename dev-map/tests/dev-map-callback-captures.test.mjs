import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {generate,readGenerated} from '../lib/store.mjs';
import {compactPage} from '../lib/agent-view.mjs';

const file='core/callback-captures.mjs';
const packet=async body=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>
  `export function consume(...args){return args;}export function make(x){return {x};}${body}`}),`${file}::main`);
const consume=p=>p.callBindings.filter(c=>c.callee===`${file}::consume`);

test('deferred callbacks retain stable captured origins while their element and timing remain unknown',async()=>{
  const p=await packet('export function main(items,spacing,angle,options){return items.flatMap(item=>consume(item,spacing,angle,options));}');
  const call=consume(p)[0];
  assert.equal(call.executionUnknown,true);
  assert.equal(call.arguments[0].unknown,true);
  assert.deepEqual(call.arguments[0].producers,[]);
  for(let i=1;i<4;i++) {
    assert.deepEqual(call.arguments[i].producers.map(p=>p.endpoint),[`in${i+1}`]);
    assert.ok(!call.arguments[i].unknown);
    assert.ok(p.wires.some(w=>w.from===`in${i+1}`&&w.toPort===`arg${i+1}`));
  }
  assert.ok(p.uncertainty.some(u=>u.kind==='callback-execution'));
  assert.ok(!p.operators?.some(o=>o.kind==='iteration'));
  assert.ok(!p.wires.some(w=>w.to==='out1'),'unknown receiver result is not a proved flattening result');
});

test('captured reference identity does not certify deferred member or destructured contents',async()=>{
  for(const change of ['options.value=7;','unknown(options);','']) {
    const p=await packet(`export function main(items,options){${change}return items.map(item=>{const {value}=options;const [entry]=options;return consume(options,options.value,value,entry);});}`);
    const call=consume(p)[0];
    assert.deepEqual(call.arguments[0].producers.map(p=>p.endpoint),['in2']);
    for(const arg of call.arguments.slice(1)) {
      assert.equal(arg.unknown,true,change);assert.deepEqual(arg.producers,[],change);
    }
  }
  const p=await packet('export function main(items,x){const value=make(x);return items.map(item=>consume(value,value.x));}');
  assert.deepEqual(consume(p)[0].arguments[0].producers.map(p=>p.endpoint),[`${file}::make`]);
  assert.equal(consume(p)[0].arguments[1].unknown,true);
});

test('record snapshots, mutable bindings and reassignments never become stable captured origins',async()=>{
  for(const body of [
    'const value={left:x};return items.map(item=>consume(value.left));',
    'const value={left:x};unknown(value);return items.map(item=>consume(value.left));',
    'const value={left:x};const result=items.map(item=>consume(value.left));value.left=7;return result;',
    'let value=x;return items.map(item=>consume(value));',
    'const result=items.map(item=>consume(x));x=7;return result;',
    'x=7;return items.map(item=>consume(x));'
  ]) {
    const p=await packet(`export function main(items,x){${body}}`),arg=consume(p)[0].arguments[0];
    assert.equal(arg.unknown,true,body);assert.deepEqual(arg.producers,[],body);
  }
});

test('callback parameters and block locals shadow outer captures without aliasing them',async()=>{
  const p=await packet('export function main(items,x){const count=42;return items.map(x=>{consume(x,count);{const x=7;consume(x,count);}});}');
  const calls=consume(p);
  assert.equal(calls[0].arguments[0].unknown,true);
  assert.deepEqual(calls[0].arguments[0].producers,[]);
  assert.equal(calls[1].arguments[0].constant,true);
  assert.ok(calls.every(c=>c.executionUnknown&&c.arguments[1].constant));
  assert.ok(!p.wires.some(w=>w.from==='in2'));
});

test('actual scanline callback gains only its three forwarded outer parameter origins',async()=>{
  const context=await loadFlow({files:['core/region/region2d.mjs','core/geom/tolerance.mjs']});
  const p=flowPacket(context,'core/region/region2d.mjs::scanlineFill',{evidence:true});
  const call=p.callBindings.find(c=>c.callee==='core/region/region2d.mjs::scanlineFillComponent');
  assert.equal(call.executionUnknown,true);assert.equal(call.arguments[0].unknown,true);
  assert.deepEqual(call.arguments.slice(1).map(a=>a.producers.map(p=>p.endpoint)),[['in2'],['in3'],['in4']]);
  assert.equal(p.external,3);
  assert.ok(p.externalSites.every(s=>s.rule==='member-name-not-in-mapped-code'));
  assert.ok(!p.wires.some(w=>w.to==='out1'));
});

test('same-line unresolved call sites retain distinct columns through stored details and default reads',async t=>{
  const repo=await mkdtemp(resolve(tmpdir(),'saam-callback-sites-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  await mkdir(resolve(repo,'core'));
  const source='export function main(cb,x){cb(x);return cb(x);}';
  await writeFile(resolve(repo,file),source);
  await generate({repo});
  const rich=await readGenerated(`${file}::main`,{repo}),compact=compactPage(rich);
  const expected=[source.indexOf('cb(x)')+1,source.lastIndexOf('cb(x)')+1];
  for(const page of [rich,compact]) {
    assert.equal(page.unresolved.length,2);
    assert.deepEqual(page.unresolved.map(s=>s.column),expected);
    assert.ok(page.unresolved.every(s=>s.call==='cb'&&s.line===1));
  }
});
