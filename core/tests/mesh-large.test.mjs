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
import {checkMeshCapacity,meshAllocation,meshAllocationError} from '../geom/mesh-capacity.mjs';
import {repairMemoryError} from '../print/mesh-repair-job.mjs';
import {regionArea} from '../region/region2d.mjs';

test('196608-face ASCII file streams, validates and sections without simplification',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-large-mesh-'));t.after(()=>rm(root,{recursive:true,force:true}));
  // The retired working-set estimate for this mesh was about 120 MiB, so the
  // retired 16 MiB floor refused it outright. The setting is inert; nothing
  // predicts a mesh's size any more.
  const previous=process.env.SAAM_MESH_MEMORY_MIB;process.env.SAAM_MESH_MEMORY_MIB='16';
  t.after(()=>{if(previous===undefined)delete process.env.SAAM_MESH_MEMORY_MIB;else process.env.SAAM_MESH_MEMORY_MIB=previous;});
  let source=subdividedBox(7);const count=source.triangles.length,path=join(root,'dense.stl');
  await pipeline(encodeRepairSTLChunks(source),createWriteStream(path));source=null;
  let last=0,calls=0;const decoded=await decodeSTLFile(path,{units:'mm',progress:p=>{assert.ok(p.completed>=last);last=p.completed;calls++;}});
  assert.equal(decoded.triangles.length,count);assert.equal(count,196608);assert.equal(last,(await stat(path)).size);assert.ok(calls>10);
  const mesh=makeMesh(decoded.vertices,decoded.triangles);assert.equal(regionArea(sectionMesh(mesh,1.234).loops),16);assert.deepEqual(mesh.bounds,{min:[0,0,0],max:[4,4,4]});
});
test('index capacity is the only size limit; a real allocation failure names its stage and mesh',()=>{
  checkMeshCapacity(0x7ffffffe,0x3ffffffe);
  assert.throws(()=>checkMeshCapacity(0x7fffffff,4),/index capacity/);
  assert.throws(()=>checkMeshCapacity(4,0x3fffffff),/index capacity/);
  assert.throws(()=>checkMeshCapacity(4.5,4),/index capacity/);
  // An injected allocator failure, not an exhausted machine: the estimate that
  // used to refuse this work in advance is gone.
  assert.throws(()=>meshAllocation('Mesh face normals',998786,1997568,()=>{throw new RangeError('Array buffer allocation failed');}),
    error=>error.code==='MESH_MEMORY_EXHAUSTED'&&error.vertices===998786&&error.triangles===1997568
      &&/Mesh face normals could not allocate memory for 1997568 triangles and 998786 vertices/.test(error.message)
      &&/Array buffer allocation failed/.test(error.message));
  assert.equal(meshAllocation('Mesh edge topology',4,4,()=>'kept'),'kept');
  const defect=Error('Degenerate mesh triangle.');
  assert.equal(meshAllocationError(defect,'Mesh edge topology',4,4),defect);
  // A worker whose heap is exhausted reports that, with the size it was given.
  const exhausted=Object.assign(Error('Worker terminated due to reaching memory limit: JS heap out of memory'),{code:'ERR_WORKER_OUT_OF_MEMORY'});
  const mapped=repairMemoryError(exhausted,Buffer.alloc(3*1048576));
  assert.equal(mapped.code,'MESH_MEMORY_EXHAUSTED');assert.match(mapped.message,/ran out of memory on a 3 MiB STL source/);
  assert.match(repairMemoryError(exhausted,'C:/prints/huge.stl').message,/reading C:\/prints\/huge\.stl/);
  assert.equal(repairMemoryError(defect,Buffer.alloc(4)),defect);
});
