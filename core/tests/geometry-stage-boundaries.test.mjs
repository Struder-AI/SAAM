import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMesh} from '../geom/mesh.mjs';
import {levelSetRegion} from '../region/boolean.mjs';
import {boxMesh} from './fixtures/mesh.mjs';

function freeze(value){
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
}

test('mesh validation stages accept frozen source arrays and keep cached geometry private',()=>{
  const source=freeze(boxMesh(7,9,3));
  const original=structuredClone(source);
  const first=makeMesh(source.vertices,source.triangles);
  const expected={bounds:structuredClone(first.bounds),normals:structuredClone(first.normals),edges:first.edges.size};
  first.bounds.max.fill(999);first.normals[0].fill(999);first.edges.clear();
  const second=makeMesh(source.vertices,source.triangles);
  assert.deepEqual(source,original);
  assert.deepEqual(second.bounds,expected.bounds);
  assert.deepEqual(second.normals,expected.normals);
  assert.equal(second.edges.size,expected.edges);
});

test('level-set stages preserve sentinel refinement order and close the sampled domain',()=>{
  const field=freeze({xs:[0,1,2],ys:[0,1,2],values:[[1,1,1],[1,1,1],[-1e6,-1e6,-1e6]]});
  const calls=[];
  const loops=levelSetRegion(field,0,{refine:(above,below)=>{calls.push([above,below]);return [1.5,above[1]];}});
  assert.deepEqual(loops,[[[0,1],[0,0],[1,0],[1.5,0],[1.5,1],[1.5,2],[1,2],[0,2]]]);
  assert.deepEqual(calls,[
    [[1,0],[2,0]],[[1,1],[2,1]],[[1,1],[2,1]],[[1,2],[2,2]],
    [[1,0],[2,0]],[[1,2],[2,2]]
  ]);
  assert.deepEqual(levelSetRegion(field,0,{refine:()=>null}),levelSetRegion(field,0));
});
