import test from 'node:test';
import assert from 'node:assert/strict';
import {pointTriangleDistanceSquared,createMeshDistanceQuery} from '../geom/mesh-distance.mjs';
import {makeMesh} from '../geom/mesh.mjs';
test('triangle distances cover face, edge, vertex and bounded BVH exclusion',()=>{
  const a=[0,0,0],b=[2,0,0],c=[0,2,0];
  assert.equal(pointTriangleDistanceSquared([.5,.5,3],a,b,c),9);
  assert.equal(pointTriangleDistanceSquared([1,-2,0],a,b,c),4);
  assert.equal(pointTriangleDistanceSquared([-1,-1,0],a,b,c),2);
  const mesh=makeMesh([a,b,c,[0,0,2]],[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]),query=createMeshDistanceQuery(mesh);
  assert.ok(Math.abs(query([.5,.5,-.1],.2)-.1)<1e-12);assert.equal(query([10,10,10],.2),Infinity);
});
