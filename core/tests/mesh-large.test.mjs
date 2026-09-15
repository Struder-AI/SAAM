import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {subdividedBox} from './fixtures/mesh.mjs';
import {encodeRepairSTLChunks} from '../geom/mesh-repair.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';
import {makeMesh,sectionMesh} from '../geom/mesh.mjs';
import {checkMeshBudget} from '../geom/mesh-budget.mjs';
import {regionArea} from '../region/region2d.mjs';

test('196608-face ASCII file streams, validates and sections without simplification',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-large-mesh-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let source=subdividedBox(7);const count=source.triangles.length,path=join(root,'dense.stl');
  await pipeline(encodeRepairSTLChunks(source),createWriteStream(path));source=null;
  let last=0,calls=0;const decoded=await decodeSTLFile(path,{units:'mm',progress:p=>{assert.ok(p.completed>=last);last=p.completed;calls++;}});
  assert.equal(decoded.triangles.length,count);assert.equal(count,196608);assert.equal(last,(await stat(path)).size);assert.ok(calls>10);
  const mesh=makeMesh(decoded.vertices,decoded.triangles);assert.equal(regionArea(sectionMesh(mesh,1.234).loops),16);assert.deepEqual(mesh.bounds,{min:[0,0,0],max:[4,4,4]});
});
test('memory guard fails explicitly without changing requested geometry',()=>{
  const previous=process.env.SAAM_MESH_MEMORY_MIB;try{process.env.SAAM_MESH_MEMORY_MIB='16';assert.throws(()=>checkMeshBudget(100000,100000),{code:'MESH_MEMORY_BUDGET'});}finally{if(previous===undefined)delete process.env.SAAM_MESH_MEMORY_MIB;else process.env.SAAM_MESH_MEMORY_MIB=previous;}
});
