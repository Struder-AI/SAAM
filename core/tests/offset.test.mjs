import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import { offsetRegion, OFFSET_PRECISION_MM } from '../region/offset.mjs';
import { canonicalLoops,clipperContext,clipPaths,offsetPaths } from '../region/clipper.mjs';
import { offsetRegion as compatibilityOffset, regionArea, pointInRegion } from '../region/region2d.mjs';
import { offsetFixtures } from '../../scripts/bench/offset-fixtures.mjs';

test('planar offset matches independent Clipper2 C# construction across 90 reference cases',()=>{
  const reference=JSON.parse(fs.readFileSync(new URL('./fixtures/clipper2-offset-reference.json',import.meta.url),'utf8'));
  assert.equal(reference.cases.length,90);
  assert.equal(reference.cases.length,offsetFixtures.length);
  assert.equal(reference.inputSha256,createHash('sha256').update(JSON.stringify(offsetFixtures)).digest('hex'),'reference input provenance');
  for(let i=0;i<offsetFixtures.length;i++) {
    const f=offsetFixtures[i];assert.equal(reference.cases[i].name,f.name);
    assert.deepEqual(offsetRegion(f.loops,f.delta,f),canonicalLoops(reference.cases[i].loops),f.name);
  }
});

test('offset preserves nesting independently of input loop order and starting vertices',()=>{
  const rect=(x,y,w)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w]];
  const source=[rect(0,0,20),rect(3,3,14).reverse(),rect(7,7,6),rect(9,9,2).reverse()];
  const expected=offsetRegion(source,-0.4);
  const shuffled=[...source].reverse().map(loop=>[...loop.slice(2),...loop.slice(0,2)]);
  assert.deepEqual(offsetRegion(shuffled,-0.4),expected);
  for(const [p,inside] of [[[1,1],true],[[5,5],false],[[8,8],true],[[10,10],false]])assert.equal(pointInRegion(p,expected),inside);
  assert.strictEqual(compatibilityOffset,offsetRegion);
});

test('touching offset lobes are separate components and tiny valid islands are retained',()=>{
  const f=offsetFixtures.find(f=>f.name==='nested/-1/round'),result=offsetRegion(f.loops,f.delta,f);
  assert.equal(result.length,6,'outer, hole, and four separate corner islands');
  for(const loop of result)assert.equal(new Set(loop.map(p=>p.join(','))).size,loop.length,'no repeated touch vertex inside a loop');
  const tiny=[[[0,0],[0.01,0],[0.01,0.01],[0,0.01]]];
  assert.ok(Math.abs(regionArea(offsetRegion(tiny,-0.001))-0.008**2)<1e-12);
});

test('offset numeric preconditions fail visibly; empty, repeated and degenerate input collapses',()=>{
  for(const loops of [[],[[]],[[[0,0],[1,0],[2,0]]]])assert.deepEqual(offsetRegion(loops,0.2),[]);
  assert.throws(()=>offsetRegion([[[0,0],[1,0],[1,Infinity]]],0.2),/finite/);
  assert.throws(()=>offsetRegion([],NaN),/finite/);
  assert.throws(()=>offsetRegion([],1,{arcToleranceMm:0}),/positive/);
  assert.throws(()=>offsetRegion([],1,{precisionMm:0}),/positive/);
  assert.throws(()=>offsetRegion([],1,{join:'bevel'}),/join/);
  assert.throws(()=>offsetRegion([[[0,0],[1e10,0],[0,1]]],0.2,{precisionMm:1e-9}),/coordinate range/);
});

test('native normalization and inflation preserve the former two-stage result exactly',()=>{
  const fixtures=[...offsetFixtures,
    {loops:[],delta:0}, {loops:[[]],delta:0},
    {loops:[[[0,0],[4,4],[0,4],[4,0]]],delta:0},
    {loops:[[[0,0],[4,4],[0,4],[4,0]]],delta:.2},
    {loops:[[[0,0],[1,0],[1,1],[0,1]]],delta:-2}];
  const former=(loops,delta,{precisionMm=OFFSET_PRECISION_MM,arcToleranceMm=.02,join='round',miterLimit=2})=>{
    const context=clipperContext([loops],precisionMm,Math.abs(delta)*(miterLimit+2));
    const normalized=clipPaths(context.encode(loops));
    return context.decode(!normalized.length||delta===0?normalized:offsetPaths(normalized,delta/precisionMm,
      {join,miterLimit,arcTolerance:arcToleranceMm/precisionMm}));
  };
  for(const fixture of fixtures)for(const shift of [0,123456.789]){
    const loops=fixture.loops.map(loop=>loop.map(([x,y])=>[x+shift,y-shift]));
    const before=structuredClone(loops);
    assert.deepEqual(offsetRegion(loops,fixture.delta,fixture),former(loops,fixture.delta,fixture),fixture.name);
    assert.deepEqual(loops,before);
  }
});

test('printing offset grid keeps rotated corners within quantization error',()=>{
  assert.equal(OFFSET_PRECISION_MM,1e-5);
  for(const angle of [.017,.8]){
    const loop=[[0,0],[10,0],[10,10],[0,10]].map(([x,y])=>[120+x*Math.cos(angle)-y*Math.sin(angle),90+x*Math.sin(angle)+y*Math.cos(angle)]);
    const actual=offsetRegion([loop],-.2),reference=offsetRegion([loop],-.2,{precisionMm:1e-9});
    assert.equal(actual.length,reference.length);
    assert.ok(Math.abs(regionArea(actual)-regionArea(reference))<40*OFFSET_PRECISION_MM*2);
    for(let i=0;i<actual[0].length;i++)assert.ok(Math.hypot(...actual[0][i].map((v,k)=>v-reference[0][i][k]))<OFFSET_PRECISION_MM*2);
  }
});
