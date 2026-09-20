import test from 'node:test';
import assert from 'node:assert/strict';
import {flattenBezier} from '../geom/text-outline.mjs';
import {textLayout} from '../geom/text-layout.mjs';

test('Bezier subdivision returns ordered owned sample records from frozen controls',()=>{
  const control=Object.freeze([[0,0],[1,2],[3,0]].map(Object.freeze));
  const sampled=flattenBezier(control,.5);
  assert.deepEqual(sampled,{points:[[1.25,1],[3,0]],parameters:[.5,1]});
  const again=flattenBezier(control,.5);
  sampled.points.pop();sampled.parameters.fill(0);
  assert.deepEqual(again,{points:[[1.25,1],[3,0]],parameters:[.5,1]});
  assert.deepEqual(control,[[0,0],[1,2],[3,0]]);
});

test('cubic subdivision preserves correspondence, excludes the start and refines by tolerance',()=>{
  const control=[[0,0],[2,3],[4,-2],[6,1]],coarse=flattenBezier(control,.1),fine=flattenBezier(control,.001);
  assert.ok(fine.points.length>coarse.points.length);
  assert.equal(fine.points.length,fine.parameters.length);
  assert.equal(fine.parameters.at(-1),1);
  assert.deepEqual(fine.points.at(-1),control.at(-1));
  for(let i=0;i<fine.parameters.length;i++){
    const t=fine.parameters[i],s=1-t;
    assert.ok(t>(fine.parameters[i-1]??0));
    const expected=[0,1].map(k=>s*s*s*control[0][k]+3*s*s*t*control[1][k]+3*s*t*t*control[2][k]+t*t*t*control[3][k]);
    assert.ok(expected.every((v,k)=>Math.abs(v-fine.points[i][k])<1e-12));
  }
});

test('flat and invalid curves retain diagnostics and baseline consumer uses returned parameters',()=>{
  assert.deepEqual(flattenBezier([[0,0],[2,0],[4,0]],.001),{points:[[4,0]],parameters:[1]});
  assert.throws(()=>flattenBezier([[0,0],[NaN,1],[2,0]],.1),/not finite/);
  const feature={baseline:{controlPoints:[[0,0],[2,0],[4,0]]},positionMm:[3,-2],rotationDeg:0,mirror:false};
  const map=textLayout(feature,.02);
  assert.deepEqual(map(1,.5),[4,-1.5]);
  assert.throws(()=>map(5,0),/baseline length/);
});
