import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createBlobFieldEvaluator,validateBlobField} from '../geom/blob-field.mjs';
import {compileBlobField} from '../geom/blob-field-compile.mjs';
import {solidKernel,preciseSolidMesh} from '../geom/solid.mjs';
import {validateBlobFieldRecord} from '../geom/blob-field-record.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {topAt} from '../geom/query.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import {section} from '../region/section.mjs';
import {regionArea} from '../region/region2d.mjs';
import {createBlobFieldBundle,updateBlobFieldBundle,compileRequest} from '../print/blob-field.mjs';
import {loadBundle,generateBundle,approve,deliver} from '../print/bundle.mjs';
import {createGeometry,verifyGeometry} from '../print/geometry.mjs';

const field=(points,threshold=0.25)=>({schema:'saam-blob-field/1',threshold,points});
const blob=(positionMm,reachMm,strength=1)=>({positionMm,reachMm,strength});
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('solid export retains coordinates below a Float32 ULP and honors property seams',async()=>{
  const kernel=await solidKernel(),cube=kernel.Manifold.cube([1,2,3]),moved=cube.translate([1.00000003,0,0]);
  const seams=moved.calculateNormals(0,0);
  try{
    const {vertices,triangles}=preciseSolidMesh(seams),mesh=makeMesh(vertices,triangles);
    close(mesh.bounds.min[0],1.00000003,1e-14);close(mesh.bounds.max[0],2.00000003,1e-14);
    assert.equal(vertices.length,8);
  }finally{seams.delete();moved.delete();cube.delete();}
});

test('falloff sums: a lone point reaches the threshold at half its reach, gradients match differences, invalid points fail',()=>{
  const f=field([blob([1,2,5],8),blob([4,2,5],6,-0.5)]),evaluate=createBlobFieldEvaluator(f);
  close(createBlobFieldEvaluator(field([blob([0,0,5],10)]))([5,0,5]).value,0.25);
  close(evaluate([20,20,20]).value,0);
  const point=[2.3,3.1,4.2],at=evaluate(point,{derivatives:true});
  for(let a=0;a<3;a++){const lo=[...point],hi=[...point];lo[a]-=1e-6;hi[a]+=1e-6;close(at.gradient[a],(evaluate(hi).value-evaluate(lo).value)/2e-6,1e-6);}
  for(const bad of [field([]),field([blob([0,0,0],0)]),field([blob([0,0,0],4,0)]),field([blob([0,0,0],4,-1)]),field([blob([0,0,0],4)],0),{...field([blob([0,0,0],4)]),extra:1}])
    assert.throws(()=>validateBlobField(bad),/blob|Blob/);
});

test('a lone ball extracts to its radius with a flat bed cut',async()=>{
  const f=field([blob([0,0,3],10)]),g=await compileBlobField(f,{edgeMm:0.25}),mesh=makeMesh(g.vertices,g.triangles);
  close(mesh.bounds.min[2],0,1e-9);close(mesh.bounds.max[2],8,0.05);
  close(regionArea(section(mesh,horizontalSlice(3)).loops),Math.PI*25,0.2);
  await assert.rejects(compileBlobField(field([blob([0,0,3],10,0.01)]),{edgeMm:0.5}),/empty/);
  const changed=structuredClone(g);changed.field.threshold=0.3;assert.throws(()=>validateBlobFieldRecord(changed),/Rebuild/);
});

test('neighbouring points blend, distant ones stay separate, and negative points carve holes and voids',async()=>{
  const at=async points=>{const g=await compileBlobField(field(points),{edgeMm:0.3});return makeMesh(g.vertices,g.triangles);};
  assert.equal(section(await at([blob([0,0,2],8),blob([9,0,2],8)]),horizontalSlice(2)).loops.length,1);
  assert.equal(section(await at([blob([0,0,2],8),blob([11,0,2],8)]),horizontalSlice(2)).loops.length,2);
  const ring=await at(Array.from({length:12},(_,i)=>blob([12*Math.cos(i*Math.PI/6),12*Math.sin(i*Math.PI/6),3],8)));
  assert.equal(section(ring,horizontalSlice(3)).loops.length,2);assert.equal(topAt(ring,0,0),null);
  const hollow=await at([blob([0,0,4],20,2),blob([0,0,4],8,-3)]);
  assert.equal(section(hollow,horizontalSlice(4)).loops.length,2);assert.ok(topAt(hollow,0,0).zMm>12);
});

test('requests default the threshold and sampling and store them explicitly',async()=>{
  const g=await compileRequest({points:[blob([0,0,2],4)]});
  assert.equal(g.field.threshold,0.25);assert.equal(g.extraction.edgeMm,0.5);
  assert.throws(()=>compileRequest({points:[],isoValue:0}),/request/);
});

test('CLI creates and rebuilds a blob field from a request file without approving it',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-blob-field-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const bundle=join(dir,'print'),file=join(dir,'request.json'),request={points:[blob([0,0,2],8)],edgeMm:0.5};
  await writeFile(file,JSON.stringify(request));
  execFileSync(process.execPath,['core/print/cli.mjs','blob-field-create',bundle,file,'ultimaker-s5'],{stdio:'pipe'});
  const state=await loadBundle(bundle);request.threshold=0.3;await writeFile(file,JSON.stringify(request));
  execFileSync(process.execPath,['core/print/cli.mjs','blob-field-update',bundle,file,'--revision',state.revision],{stdio:'pipe'});
  const next=await loadBundle(bundle);assert.equal(next.plan.geometry.field.threshold,0.3);assert.deepEqual(next.review.approvals,{});
});

test('blob field lifecycle slices, reopens, delivers exact bytes and invalidates changed points',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-blob-field-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const request={points:[blob([0,0,1],8),blob([5,0,1],6)],edgeMm:0.5};
  let state=await createBlobFieldBundle(dir,request);
  assert.deepEqual(state.plan.geometry.field.points,request.points);assert.equal(state.geometry.nativeFile,'model.mesh.json');
  const native=await createGeometry(state.plan.geometry),fake=structuredClone(native.descriptor);fake.vertices[0][0]+=1;
  await assert.rejects(verifyGeometry(native.bytes,fake),/display\/identity/);
  await generateBundle(dir);state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.ok(state.program.moves.length>0);
  const bytes=await readFile(join(dir,state.review.generation.file));
  await approve(dir,{actor:'SYNTHETIC BLOB FIELD TEST',revision:state.revision});
  assert.deepEqual(await readFile(await deliver(dir)),bytes);
  state=await loadBundle(dir);request.points[1].strength=1.5;
  state=await updateBlobFieldBundle(dir,request,{expectedRevision:state.revision});
  assert.equal(state.toolpathApproved,false);
  await assert.rejects(updateBlobFieldBundle(dir,request,{expectedRevision:'stale'}),/stale/);
});
