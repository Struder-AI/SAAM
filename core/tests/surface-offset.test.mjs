import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetSurfaceRegion } from '../region/surface-offset.mjs';
import { offsetRegion } from '../region/offset.mjs';
import { regionArea, pointInRegion, pointSegmentDistance } from '../region/region2d.mjs';
import { evaluate } from '../geom/nurbs.mjs';
import { surfaceDerivatives } from '../geom/surface-derivatives.mjs';

const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
function plane(slope=0,scaleU=1,scaleV=1) {
  return {nu:2,nv:2,orderU:2,orderV:2,knotsU:[0,0,20*scaleU,20*scaleU],knotsV:[0,0,20*scaleV,20*scaleV],
    domainU:[0,20*scaleU],domainV:[0,20*scaleV],cp:Float64Array.from([0,0,0,1,0,20,0,1,20,0,20*slope,1,20,20,20*slope,1])};
}
function cylinder() {
  const cp=[];
  for(const [x,y,w] of [[10,0,1],[10,10,Math.SQRT1_2],[0,10,1]])for(const z of [0,20])cp.push(x*w,y*w,z*w,w);
  return {nu:3,nv:2,orderU:3,orderV:2,knotsU:[0,0,0,1,1,1],knotsV:[0,0,20,20],domainU:[0,1],domainV:[0,20],cp:Float64Array.from(cp)};
}
const deviation=(a,b)=>Math.max(...a.flat().map(p=>Math.min(...b.flatMap(loop=>loop.map((q,i)=>pointSegmentDistance(p,q,loop[(i+1)%loop.length]))))));

test('surface derivatives match native evaluation and finite differences on a rational cylinder',()=>{
  const patch=cylinder(),uv=[0.37,9],f=surfaceDerivatives(patch,...uv),base=evaluate(patch,...uv),h=1e-5;
  for(const name of ['point','du','dv'])f[name].forEach((x,k)=>assert.ok(Math.abs(x-base[name][k])<1e-10));
  const lo=evaluate(patch,uv[0]-h,uv[1]),hi=evaluate(patch,uv[0]+h,uv[1]);
  f.duu.forEach((x,k)=>assert.ok(Math.abs(x-(hi.du[k]-lo.du[k])/(2*h))<1e-6));
});

test('surface offsets inherit Clipper nesting, split and collapse on a flat patch',()=>{
  const patch=plane(),loops=[rectangle(2,2,16,16),rectangle(6,6,8,8).reverse(),rectangle(9,9,2,2)];
  for(const delta of [-0.4,0.4,-1.1]) {
    const result=offsetSurfaceRegion(patch,loops,delta,{maxStepMm:2,toleranceMm:0.01});
    const expected=offsetRegion(loops,delta,{arcToleranceMm:0.002});
    assert.equal(result.loops.length,expected.length);
    assert.ok(Math.abs(regionArea(result.loopsUv)-regionArea(expected))<0.08);
    assert.ok(deviation(result.loopsUv,expected)<0.015);
    assert.equal(pointInRegion([10,10],result.loopsUv),delta>-1);
    assert.equal(result.report.inverseMappings,0);
  }
  assert.deepEqual(offsetSurfaceRegion(patch,[rectangle(3,3,0.5,2)],-0.3).loops,[]);
});

test('inclined surface offset preserves physical spacing under UV rescaling',()=>{
  for(const scale of [[1,1],[7,0.3]]) {
    const p=plane(1,...scale),source=[rectangle(4*scale[0],4*scale[1],8*scale[0],8*scale[1])];
    const result=offsetSurfaceRegion(p,source,-0.4,{maxStepMm:2});
    const developed=result.loops.map(loop=>loop.map(([x,y])=>[x*Math.SQRT2,y]));
    // Compare intrinsic geometry at the same fine reference scale; the
    // printing grid's 1e-5 mm quantization exceeds this 1e-7 mm assertion.
    const expected=offsetRegion([rectangle(4*Math.SQRT2,4,8*Math.SQRT2,8)],-0.4,{precisionMm:1e-9});
    assert.ok(deviation(developed,expected)<1e-7);
    assert.ok(deviation(expected,developed)<1e-7);
  }
});

test('surface geodesics match independently unrolled cylinder distances and round joins',()=>{
  const patch=cylinder(),source=[rectangle(0.25,6,0.5,8)];
  const develop=p=>[10*Math.atan2(p[1],p[0]),p[2]];
  const flatSource=source.map(loop=>loop.map(uv=>develop(evaluate(patch,...uv).point)));
  for(const delta of [-0.4,0.4]) {
    const result=offsetSurfaceRegion(patch,source,delta,{toleranceMm:0.005,maxStepMm:1});
    const developed=result.loops.map(loop=>loop.map(develop)),expected=offsetRegion(flatSource,delta,{arcToleranceMm:0.001});
    assert.ok(deviation(developed,expected)<0.008);
    assert.ok(deviation(expected,developed)<0.008);
    for(const loop of result.loops)for(const p of loop)assert.ok(Math.abs(Math.hypot(p[0],p[1])-10)<1e-10);
  }
});

test('surface offset handles a patch-boundary inset, reports its actual work and rejects domain escape',()=>{
  const patch=plane();
  const result=offsetSurfaceRegion(patch,[rectangle(0,0,20,20)],-0.4,{maxStepMm:2});
  assert.ok(Math.abs(regionArea(result.loopsUv)-19.2**2)<1e-6);
  // No evaluation budget: a finer step simply integrates and reports more work.
  assert.equal('maxEvaluations' in result.report,false);
  const fine=offsetSurfaceRegion(patch,[rectangle(4,4,8,8)],-0.4,{maxStepMm:0.25});
  assert.ok(fine.report.evaluations>result.report.evaluations&&fine.report.integrationSteps>result.report.integrationSteps);
  assert.throws(()=>offsetSurfaceRegion(patch,[rectangle(0,0,20,20)],0.4),/patch boundary/);
  assert.throws(()=>offsetSurfaceRegion(patch,[],NaN),/finite/);
  const zero=offsetSurfaceRegion(patch,[rectangle(4,4,8,8)],0);
  assert.equal(zero.report.integrationSteps,0);
  assert.equal(zero.report.evaluations,4);
});

test('nested offsets on a doubly curved patch converge without losing the material island',()=>{
  const patch={nu:3,nv:3,orderU:3,orderV:3,knotsU:[-10,-10,-10,10,10,10],knotsV:[-10,-10,-10,10,10,10],domainU:[-10,10],domainV:[-10,10],cp:[]};
  // Exact graph z=0.02*x*x+0.01*y*y in a quadratic Bernstein basis.
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)patch.cp.push([-10,0,10][i],[-10,0,10][j],[2,-2,2][i]+[1,-1,1][j],1);
  const loops=[rectangle(-6,-6,12,12),rectangle(-3,-3,6,6).reverse(),rectangle(-1,-1,2,2)];
  const rough=offsetSurfaceRegion(patch,loops,-0.3,{toleranceMm:0.01,maxStepMm:1});
  const fine=offsetSurfaceRegion(patch,loops,-0.3,{toleranceMm:0.0025,maxStepMm:0.5});
  assert.equal(rough.loops.length,3);assert.equal(fine.loops.length,3);
  assert.ok(deviation(rough.loopsUv,fine.loopsUv)<0.015);
  assert.ok(deviation(fine.loopsUv,rough.loopsUv)<0.015);
  for(const result of [rough,fine]) {
    assert.equal(pointInRegion([0,0],result.loopsUv),true);
    assert.equal(pointInRegion([2,0],result.loopsUv),false);
    assert.equal(pointInRegion([4,0],result.loopsUv),true);
    for(const loop of result.loops)for(const [x,y,z] of loop)assert.ok(Math.abs(z-0.02*x*x-0.01*y*y)<1e-10);
  }
});
