import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {regionArea} from '../region/region2d.mjs';

test('numerical triangle seams are removed before offsetting, independent of short edge length',()=>{
  const loop=[[0,0],[1e-5,2e-9],[5,0],[5.000001,-2e-9],[10,0],[10,10],[0,10]];
  const expected=[[0,0],[10,0],[10,10],[0,10]];
  assert.deepEqual(cleanPlanarLoop(loop),expected);
  assert.deepEqual(offsetRegion([cleanPlanarLoop(loop)],-.2),offsetRegion([expected],-.2));
  assert.equal(regionArea([cleanPlanarLoop([...loop].reverse())]),-100);
});

test('contour cleanup retains corners, narrow features, reversals and accumulated curvature',()=>{
  const reversal=[[0,0],[2,0],[1,0],[4,0],[4,4],[0,4]];
  assert.deepEqual(cleanPlanarLoop(reversal),reversal);
  const narrow=[[0,0],[4,0],[4,4],[2,4],[2,3],[1.99999,3],[1.99999,4],[0,4]];
  assert.deepEqual(cleanPlanarLoop(narrow),narrow);
  const circle=Array.from({length:2000},(_,i)=>[10*Math.cos(i*Math.PI/1000),10*Math.sin(i*Math.PI/1000)]);
  assert.equal(cleanPlanarLoop(circle).length,circle.length);
  const curved=Array.from({length:101},(_,i)=>[i*.1,1e-7*i*i]);
  const loop=[...curved,[10,10],[0,10]];
  assert.ok(cleanPlanarLoop(loop).length>50,'whole-run distance prevents incremental curve flattening');
});
