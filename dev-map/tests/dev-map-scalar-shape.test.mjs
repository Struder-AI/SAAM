import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {scalarReductionShape} from '../lib/shapes.mjs';
import {generate,readGenerated} from '../lib/store.mjs';
import {viewModel} from '../lib/generated-view.mjs';

const greville='(knots,index,order)=>{let sum=0;for(let k=1;k<order;k++)sum+=knots[index+k];return sum/(order-1);}';
const area='loop=>{let sum=0;for(let i=0,j=loop.length-1;i<loop.length;j=i++)sum+=loop[j][0]*loop[i][1]-loop[i][0]*loop[j][1];return sum/2;}';
const shape=source=>scalarReductionShape(parse(`const f=${source}`,{ecmaVersion:'latest'}).body[0].declarations[0].init);

test('scalar reduction presentation shape recognizes arithmetic and polygon accumulations without names',()=>{
  assert.equal(shape(greville),true);
  assert.equal(shape(area),true);
  assert.equal(shape('xs=>{let total=0;for(let at=xs.length-1;at>=0;at--){total-=xs[at];}return -total;}'),true);
});

test('scalar reduction shape excludes searches, stages, nesting and nonlocal effects',()=>{
  const rejected=[
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++){if(xs[i])sum+=xs[i];}return sum;}',
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++)sum+=transform(xs[i]);return sum;}',
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++){for(let j=0;j<xs.length;j++)sum+=xs[j];}return sum;}',
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++)xs[i]+=sum;return sum;}',
    'xs=>{let sum=0;for(let i=0;i<sum;i++)sum+=xs[i];return sum;}',
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++)sum+=captured;return sum;}',
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++)sum+=xs[i]?1:0;return sum;}',
    'xs=>{let sum=0;for(let i=0;i<xs.length;i++)sum+=xs[i];return xs.length;}',
    'xs=>{let low=0;while(low<xs.length){if(xs[low]>0)return low;low++;}return -1;}',
    'async xs=>{let sum=0;for(let i=0;i<xs.length;i++)sum+=xs[i];return sum;}'
  ];
  for(const source of rejected)assert.equal(shape(source),false,source);
});

test('generated scalar reductions open matching source for CLI and viewer without losing analysis or parent boxes',async t=>{
  const repo=await mkdtemp(resolve(tmpdir(),'saam-scalar-shape-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  await mkdir(resolve(repo,'core'),{recursive:true});
  const source=`export const measure=${area};
export const sample=${greville};
export function search(xs,x){let low=0;let high=xs.length;while(low<high){const mid=(low+high)>>1;if(xs[mid]<x)low=mid+1;else high=mid;}return low;}
export function consume(xs){return measure(xs);}`;
  await writeFile(resolve(repo,'core/math.mjs'),source);
  await generate({repo});
  const shown=await viewModel({repo}),file=await readGenerated('core/math.mjs',{repo});
  for(const name of ['measure','sample']) {
    const page=await readGenerated(`core/math.mjs::${name}`,{repo});
    assert.equal(page.shape,'scalar-reduction');
    assert.equal(page.destination,'code');
    assert.equal(page.code,true);
    assert.equal(page.leaf,true);
    assert.match(page.source,/let sum=0/);
    assert.ok(page.operators.length>0,'analysis operators survive source destination');
    assert.ok(page.wires.length>0,'analysis wires survive source destination');
    const view=shown.pages.find(p=>p.index===page.index);
    assert.equal(view.destination,'code');
    const box=file.components.find(c=>c.index===page.index);
    assert.equal(box.destination,'code');
    assert.equal(box.sourceSpan.line,page.sourceSpan.line);
  }
  const measure=await readGenerated('core/math.mjs::measure',{repo});
  const consume=await readGenerated('core/math.mjs::consume',{repo});
  assert.ok(measure.calledFrom.some(c=>c.index===consume.index));
  const search=await readGenerated('core/math.mjs::search',{repo});
  assert.equal(search.shape,undefined);
  assert.equal(search.destination,'graph');
});
