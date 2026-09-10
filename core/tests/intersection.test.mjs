import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { intersect, union, difference } from '../region/intersection.mjs';
import * as compatibility from '../region/boolean.mjs';
import { intersectionFixtures } from '../../scripts/bench/intersection-fixtures.mjs';
import { createBundleWorkflow } from '../print/workflow.mjs';
import { offsetRegion } from '../region/offset.mjs';
import { pointInRegion } from '../region/region2d.mjs';

const rect = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const shift = (region, dx, dy) => region.map(loop => loop.map(([x,y]) => [x+dx,y+dy]));
// Translate before the shoelace sum so the test's area oracle does not itself
// lose small areas to cancellation at large world coordinates.
const area = region => region.reduce((sum, loop) => {
  const [ox,oy] = loop[0];
  return sum + loop.reduce((a,[x,y],i) => {
    const [u,v] = loop[(i+1)%loop.length];
    return a + (x-ox)*(v-oy) - (u-ox)*(y-oy);
  },0)/2;
},0);
const near = (a,b,tolerance=1e-7) => assert.ok(Math.abs(a-b)<=tolerance, `${a} != ${b} (tolerance ${tolerance})`);
const operations = { intersect, union, difference };

test('existing skill imports are aliases to the shared Clipper2 functions',()=>{
  for(const [name,operation] of Object.entries(operations))assert.strictEqual(compatibility[name],operation);
});

test('WASM results match 138 saved unmodified upstream C# results, with exact coordinates and topology',()=>{
  const reference=JSON.parse(fs.readFileSync(new URL('./fixtures/intersection-reference.json',import.meta.url)));
  assert.equal(createHash('sha256').update(JSON.stringify(intersectionFixtures)).digest('hex'),reference.inputSha256);
  assert.equal(reference.expected.length,intersectionFixtures.length);
  for(const [i,f] of intersectionFixtures.entries())assert.deepEqual(
    {name:f.name,loops:operations[f.operation](f.a,f.b,{precisionMm:f.precisionMm})},reference.expected[i],f.name);
});

test('runtime identity hashes binary bytes without lossy UTF-8 decoding',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'saam-binary-identity-'));
  try {
    const file=path.join(directory,'kernel.wasm'),runtimeFiles=[pathToFileURL(file)];
    const adapter={runtimeFiles,machineFile:'machines/ultimaker-s5.json'};
    fs.writeFileSync(file,Buffer.from([0x80]));
    const before=await createBundleWorkflow(adapter).runtimeHash();
    fs.writeFileSync(file,Buffer.from([0x81]));
    assert.notEqual(await createBundleWorkflow(adapter).runtimeHash(),before);
  } finally { fs.rmSync(path.join(directory,'kernel.wasm'),{force:true});fs.rmdirSync(directory); }
});

test('closed material operations retain nested holes, islands, overlaps and empty semantics', () => {
  const a = [rect(0,0,20,20), rect(3,3,14,14).reverse(), rect(7,7,6,6)];
  const b = [rect(0,0,10,20)];
  near(area(a),240);
  near(area(intersect(a,b)),120);
  near(area(difference(a,b)),120);
  near(area(union(a,b)),320);
  assert.equal(intersect(a,a).length,3);
  assert.deepEqual(difference(a,a),[]);
  assert.deepEqual(intersect(a,[]),[]);
  assert.deepEqual(difference([],a),[]);
  near(area(union([],a)),240);
  near(area(difference(a,[])),240);
  assert.equal(pointInRegion([4,4],intersect(a,a)),false);
  assert.equal(pointInRegion([8,8],intersect(a,a)),true);
  // Overlapping positive loops are material once, as in the offset interface.
  near(area(union([rect(0,0,10,10),rect(5,0,10,10)],[])),150);
});

test('edge and point contacts produce no material area; point-touching islands remain separate', () => {
  const a = [rect(0,0,10,10)];
  assert.deepEqual(intersect(a,[rect(10,0,10,10)]),[]);
  assert.deepEqual(intersect(a,[rect(10,10,10,10)]),[]);
  const touching = union(a,[rect(10,10,10,10)]);
  assert.equal(touching.length,2);
  near(area(touching),200);
  for (const loop of touching) assert.equal(new Set(loop.map(p=>p.join(','))).size,loop.length);
  for (const width of [1e-3,1e-6,1e-8]) {
    const sliver=intersect(a,[rect(10-width,0,10,10)]);
    assert.equal(sliver.length,1);
    near(area(sliver),width*10,2e-8);
  }
});

test('near-parallel crossings approach exact coincidence without spikes or lost components', () => {
  const a=[rect(0,0,10,2)], options={precisionMm:2**-40};
  for (const delta of [1,2**-10,2**-20,2**-30,0,-(2**-30),-(2**-20),-1]) {
    const b=[[[-1,-delta],[11,delta],[11,3],[-1,3]]];
    const result=intersect(a,b,options);
    assert.equal(result.length,1);
    near(area(result),20-25*Math.abs(delta)/12,1e-9);
    for(const [x,y] of result.flat()) assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=10&&y>=0&&y<=2);
    assert.deepEqual(result,intersect(b,a,options));
  }
});

test('loop order, seams, winding reversal and redundant vertices do not change the filled answer', () => {
  const a=[rect(0,0,20,20),rect(3,3,14,14).reverse(),rect(7,7,6,6)], b=[rect(2,-1,12,25)];
  const reencode=region=>region.slice().reverse().map(loop=>{
    const points=loop.flatMap((p,i)=>[p,[(p[0]+loop[(i+1)%loop.length][0])/2,(p[1]+loop[(i+1)%loop.length][1])/2]]);
    return [...points.slice(3),...points.slice(0,3)].reverse();
  });
  for(const operation of Object.values(operations)) {
    const expected=operation(a,b);
    near(area(operation(reencode(a),reencode(b))),area(expected));
    assert.equal(operation(reencode(a),reencode(b)).length,expected.length);
  }
  const snapshot=JSON.stringify([a,b]);intersect(a,b);assert.equal(JSON.stringify([a,b]),snapshot);
});

test('dyadic scaling, distant origins and repeated operations retain geometry at declared precision', () => {
  for(const scale of [2**-10,1,2**10])for(const origin of [0,2**20,2**30]) {
    const a=shift([rect(0,0,8*scale,6*scale)],origin,-origin);
    const b=shift([rect(4*scale,2*scale,8*scale,6*scale)],origin,-origin);
    const options={precisionMm:scale*2**-30};
    const result=intersect(a,b,options);
    near(area(result),16*scale*scale,scale*scale*1e-6);
    let repeated=result;
    for(let i=0;i<20;i++)repeated=intersect(repeated,b,options);
    assert.deepEqual(repeated,result);
    near(area(union(a,b,options))+area(result),area(a)+area(b),scale*scale*1e-6);
  }
});

test('seeded rectangle sets match an independent cell-classification oracle', () => {
  let state=173;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let trial=0;trial<200;trial++) {
    const make=()=>Array.from({length:3},()=>rect(random()%16,random()%16,1+random()%8,1+random()%8));
    const a=make(), b=make();
    const xs=[...new Set([...a,...b].flat().map(p=>p[0]))].sort((x,y)=>x-y);
    const ys=[...new Set([...a,...b].flat().map(p=>p[1]))].sort((x,y)=>x-y);
    const inside=(x,y,region)=>region.some(r=>x>r[0][0]&&x<r[2][0]&&y>r[0][1]&&y<r[2][1]);
    const answers=Object.fromEntries(Object.entries(operations).map(([key,op])=>[key,op(a,b)]));
    const expected={intersect:0,union:0,difference:0};
    for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++) {
      const x=(xs[i-1]+xs[i])/2,y=(ys[j-1]+ys[j])/2,l=inside(x,y,a),r=inside(x,y,b);
      const membership={intersect:l&&r,union:l||r,difference:l&&!r};
      for(const key of Object.keys(expected)) {
        if(membership[key])expected[key]+=(xs[i]-xs[i-1])*(ys[j]-ys[j-1]);
        assert.equal(pointInRegion([x,y],answers[key]),membership[key],`${trial}: ${key} at ${x},${y}`);
      }
    }
    for(const key of Object.keys(expected))near(area(answers[key]),expected[key]);
  }
});

test('recorded Rhino STL failure closes and remains inside both input regions', () => {
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/intersection-stl.json',import.meta.url)));
  const result=intersect(fixture.a,fixture.b);
  assert.equal(result.length,1);
  assert.ok(area(result)>570&&area(result)<571);
  assert.ok(area(result)<=Math.min(area(fixture.a),area(fixture.b)));
  near(area(union(fixture.a,fixture.b))+area(result),area(fixture.a)+area(fixture.b),1e-6);
  near(area(difference(result,fixture.a)),0);
  near(area(difference(result,fixture.b)),0);
  assert.deepEqual(result,intersect(fixture.b,fixture.a));
});

test('offset and boolean composition preserve a ring and complementary fill without changing the offset kernel', () => {
  const a=[rect(0,0,20,10)], inner=offsetRegion(a,-1,{join:'miter'});
  const ring=difference(a,inner);
  near(area(ring),56);
  assert.equal(ring.length,2);
  near(area(union(ring,inner)),200);
  assert.deepEqual(intersect(ring,inner),[]);
});

test('invalid coordinates and unrepresentable spans fail explicitly; grid collapse is empty', () => {
  assert.throws(()=>intersect(null,[]),/arrays/);
  assert.throws(()=>intersect([[[0,0],[1,0],[1,Infinity]]],[]),/finite/);
  assert.throws(()=>intersect([[[0,0,1],[1,0],[0,1]]],[]),/2D/);
  assert.throws(()=>intersect([],[],{precisionMm:0}),/positive/);
  assert.throws(()=>intersect([rect(0,0,1e10,1)],[]),/coordinate range/);
  assert.deepEqual(union([rect(0,0,1e-12,1e-12)],[]),[]);
  const a=[rect(0,0,10,10)];
  // Recover normally after rejected input; no partial geometry is returned.
  near(area(intersect(a,a)),100);
});
