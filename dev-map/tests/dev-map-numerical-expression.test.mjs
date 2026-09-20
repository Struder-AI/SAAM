import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {numericalExpressionShape} from '../lib/shapes.mjs';
import {generate,readGenerated,destinationFor} from '../lib/store.mjs';
import {viewModel} from '../lib/generated-view.mjs';

const shape=source=>numericalExpressionShape(parse(`const f=${source}`,{ecmaVersion:'latest'}).body[0].declarations[0].init);
test('numerical expression source boundary covers vector arithmetic without claiming receiver purity',()=>{
  for(const source of [
    '(a,b,s=1)=>a.map((x,k)=>x+b[k]*s)',
    '(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]))',
    '(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]',
    'x=>{return Math.sqrt(x*x);}'
  ])assert.equal(shape(source),true,source);
  for(const source of [
    'xs=>xs.map(stage)',
    'xs=>xs.map(x=>stage(x)+1)',
    'xs=>xs.map(x=>{save(x);return x+1})',
    'xs=>xs.map(x=>x>0?x:-x)',
    'x=>x.value++',
    'x=>Math.random()*x',
    '(Math,x)=>Math.sqrt(x)',
    'async x=>Math.sqrt(x)',
    'x=>{const y=x*x;return Math.sqrt(y);}'
  ])assert.equal(shape(source),false,source);
  assert.equal(destinationFor({kind:'function',shape:'numerical-expression',components:[{},{}],wires:[{}]}),'graph','real called stages keep their graph');
});

test('numerical code destinations retain parent identity, callers and receiver/callback limits',async t=>{
  const repo=await mkdtemp(resolve(tmpdir(),'saam-numerical-expression-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  await mkdir(resolve(repo,'core'));
  await writeFile(resolve(repo,'core/math.mjs'),`const plus=(a,b,s=1)=>a.map((x,k)=>x+b[k]*s);
export function consumer(a,b){return plus(a,b);}`);
  await generate({repo});
  const page=await readGenerated('core/math.mjs::plus',{repo});
  const caller=await readGenerated('core/math.mjs::consumer',{repo});
  const file=await readGenerated('core/math.mjs',{repo});
  assert.equal(page.shape,'numerical-expression');
  assert.equal(page.destination,'code');
  assert.equal(page.code,true);
  assert.match(page.source,/a\.map/);
  assert.equal(page.external,1);
  assert.ok(page.uncertainty.some(u=>u.kind==='callback-execution'));
  assert.ok(page.uncertainty.some(u=>u.kind==='return-origin'));
  assert.ok(page.calledFrom.some(c=>c.index===caller.index));
  assert.equal(file.components.find(c=>c.index===page.index).destination,'code');
  assert.equal((await viewModel({repo})).pages.find(p=>p.index===page.index).destination,'code');
});
