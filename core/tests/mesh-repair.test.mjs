import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boxMesh,ringMesh,subdividedBox} from './fixtures/mesh.mjs';
import {existsSync} from 'node:fs';
import {nativeMeshExecutable} from '../geom/mesh-native.mjs';
import {makeMesh,parseSTL,sectionMesh} from '../geom/mesh.mjs';
import {cleanTriangleSoup,encodeRepairSTL,validateRepair} from '../geom/mesh-repair.mjs';
import {repairSTL,repairSTLFiles} from '../print/repair-stl.mjs';
import {triangleIndex,trianglesContact} from '../geom/mesh-spatial.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';
import {importSTLBundle} from '../print/import-stl.mjs';
import {loadBundle} from '../print/bundle.mjs';
const volume=m=>Math.abs(m.triangles.reduce((sum,t)=>{const [a,b,c]=t.map(i=>m.vertices[i]);return sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;},0));
test('valid input keeps exact geometry and repair cleanup is explicit',async()=>{
  const box=boxMesh(),bytes=encodeRepairSTL(box),result=await repairSTL(bytes,{units:'mm'});
  assert.equal(result.report.method,'exact-cleanup/1');assert.equal(result.report.sampledDistanceMm.sourceToResult,0);assert.equal(result.report.outputTriangles,12);
  const dirty=Buffer.from(bytes.toString().replace('endsolid saam_repaired','facet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 0 0 0\nvertex 1 1 1\nendloop\nendfacet\nendsolid saam_repaired'));
  assert.equal((await repairSTL(dirty,{units:'mm'})).report.removed.degenerate,1);
  await assert.rejects(repairSTL(bytes,{}),/explicit/);
});

test('collapsed-face cleanup stitches a long edge to its subdivided opposite without changing the solid',async()=>{
  const source={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,1],[0,0.25,0],[0,0.75,0]],
    triangles:[[0,4,1],[4,5,1],[5,2,1],[0,1,3],[1,2,3],[2,0,3],[0,2,5],[0,5,4]]};
  for(const transformed of [false,true]){
    const mesh=structuredClone(source);
    if(transformed)mesh.vertices=mesh.vertices.map(([x,y,z])=>[x*.8-y*.6+11,x*.6+y*.8-7,z+3]);
    const original=structuredClone(mesh),clean=cleanTriangleSoup(mesh);
    assert.deepEqual(mesh,original,'cleanup must preserve source coordinates and topology');
    assert.equal(clean.removed.degenerate,2);assert.equal(clean.stitching.edges,1);assert.equal(clean.stitching.addedTriangles,2);
    validateRepair(clean);assert.ok(Math.abs(volume(clean)-1/6)<1e-12);
    assert.equal(clean.vertices.length,6);assert.equal(clean.triangles.length,8);
    assert.deepEqual(new Set(clean.vertices.map(p=>p.join(','))),new Set(mesh.vertices.map(p=>p.join(','))));
    const again=cleanTriangleSoup(clean);assert.deepEqual(again.vertices,clean.vertices);assert.deepEqual(again.triangles,clean.triangles);assert.equal(again.stitching.edges,0);
  }
  const bytes=Buffer.from('solid collapsed\n'+source.triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(i=>'vertex '+source.vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid collapsed');
  const result=await repairSTL(bytes,{units:'mm'});
  assert.equal(result.report.method,'edge-stitch-cleanup/1');assert.equal(result.report.stitching.edges,1);
  assert.ok(Math.abs(volume(parseSTL(result.repairedBytes,{units:'mm'}))-1/6)<1e-12);
  assert.equal(result.report.sampledDistanceMm.sourceToResult,0);
  // An actual missing surface is not a collinear seam to stitch closed.
  const open={...source,triangles:source.triangles.filter((_,i)=>i!==2)};
  const cleanedOpen=cleanTriangleSoup(open);assert.equal(cleanedOpen.stitching.edges,0);
  assert.throws(()=>validateRepair(cleanedOpen),/closed/);
});

test('nearest surface queries agree with an analytical box',()=>{
  const b=boxMesh(4,4,4),index=triangleIndex(b.vertices,b.triangles);
  assert.equal(index.nearest([2,2,2]).distance,2);assert.equal(index.nearest([5,2,2]).distance,1);
});

test('contact checks distinguish valid adjacency from folded overlapping faces',()=>{
  const a=[[0,0,0],[2,0,0],[0,2,0]];
  assert.equal(trianglesContact(a,[[0,0,0],[2,0,0],[1,-1,0]],a.slice(0,2)),false);
  assert.equal(trianglesContact(a,[[0,0,0],[2,0,0],[1,1,0]],a.slice(0,2)),true);
  assert.equal(trianglesContact(a,[[0,0,0],[1,0.5,1],[1,0.5,-1]],[a[0]]),true);
  assert.equal(trianglesContact(a,[[0,0,0],[-1,-1,1],[-1,-1,-1]],[a[0]]),false);
  // Opposite sides of x=0, almost coplanar, sharing just the origin. Incident
  // edge/plane solves must not invent a hit slightly past that shared endpoint.
  const left=[[-1,1,0],[0,-1,0.1],[0,0,0]],right=[[0.1,-0.3,0.02+1e-10],[0,0,0],[0.05,-0.2,0.015]];
  assert.equal(trianglesContact(left,right,[[0,0,0]]),false);
});

const native={skip:existsSync(nativeMeshExecutable)?false:'Build the CGAL helper with npm run setup:mesh to run native repair tests.'};
test('native repair closes only holes within both explicit bounds',native,async()=>{
  const source=boxMesh(2,2,2);source.triangles=source.triangles.slice(1);const bytes=encodeRepairSTL(source);
  await assert.rejects(repairSTL(bytes,{units:'mm'}),/Open boundaries/);
  await assert.rejects(repairSTL(bytes,{units:'mm',maxHoleEdges:3,maxHoleDiameterMm:1}),/Open boundaries/);
  const {repairedBytes,report}=await repairSTL(bytes,{units:'mm',maxHoleEdges:3,maxHoleDiameterMm:3});
  assert.equal(report.method,'cgal-patch-repair/1');assert.equal(report.holesFilled,1);assert.equal(report.holeTrianglesAdded,1);
  assert.equal(report.unchangedSourceFaces,11);assert.ok(Math.abs(volume(parseSTL(repairedBytes,{units:'mm'}))-8)<1e-12);
});
test('native patch repair resolves a penetrating fold and retains remote facets',native,async()=>{
  const source=subdividedBox();source.vertices.find(p=>p[0]===2&&p[1]===2&&p[2]===4)[2]=-1;
  assert.throws(()=>makeMesh(source.vertices,source.triangles),/Intersecting/);
  const {repairedBytes,report}=await repairSTL(encodeRepairSTL(source),{units:'mm'}),fixed=parseSTL(repairedBytes,{units:'mm'});
  validateRepair(fixed);assert.equal(report.selfIntersectionsRepaired,true);assert.ok(report.unchangedSourceFaces>700);assert.ok(report.outputTriangles<1000);
  const faceKey=points=>points.map(p=>p.join(',')).sort().join(';'),resultFaces=new Set(fixed.triangles.map(t=>faceKey(t.map(v=>fixed.vertices[v]))));
  for(const t of source.triangles){const points=t.map(v=>source.vertices[v]);if(points.every(p=>p[0]===0))assert.ok(resultFaces.has(faceKey(points)),'unaffected side faces must retain exact geometry');}
});
test('native repair fixes orientation without changing the face geometry',native,async()=>{
  const source=boxMesh();source.triangles[0].reverse();const result=await repairSTL(encodeRepairSTL(source),{units:'mm'});
  assert.equal(result.report.unchangedSourceFaces,12);assert.equal(result.report.changedSourceFaces,0);validateRepair(parseSTL(result.repairedBytes,{units:'mm'}));
});
test('repair aborts, times out and rejects obsolete options without publishing output',native,async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-repair-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=boxMesh();source.triangles[0].reverse();const bytes=encodeRepairSTL(source);
  await assert.rejects(repairSTL(bytes,{units:'mm',resolutionMm:1}),/Unsupported repair option/);
  await assert.rejects(repairSTL(bytes,{units:'mm',signal:AbortSignal.abort()}),{name:'AbortError'});
  await assert.rejects(repairSTLFiles(join(root,'failed'),bytes,{units:'mm',timeoutMs:1}),/exceeded/);await assert.rejects(access(join(root,'failed')));
});
test('repair shape threshold rejects a changed patch even when output vertices lie on the source',native,async()=>{
  const source=boxMesh(2,2,2);source.triangles=source.triangles.slice(1);
  await assert.rejects(repairSTL(encodeRepairSTL(source),{units:'mm',maxHoleEdges:3,maxHoleDiameterMm:3,maxSampledDistanceMm:0.01}),{code:'MESH_SHAPE_CHANGE'});
});
test('streamed files preserve source bytes and accepted geometry chunks reassemble exactly',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-repair-files-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source.stl'),bytes=encodeRepairSTL(ringMesh());await writeFile(source,bytes);const chunks=[];
  const report=await repairSTLFiles(join(root,'repair'),source,{units:'mm',onGeometry:async event=>{chunks.push(event);await new Promise(resolve=>setImmediate(resolve));}});
  assert.deepEqual(await readFile(source),bytes);assert.deepEqual(await readFile(join(root,'repair/original.stl')),bytes);
  assert.equal(chunks.at(-1).percent,100);assert.equal(chunks.reduce((n,c)=>n+c.faces.length,0),report.outputTriangles);
  for(const c of chunks)assert.ok(c.faces.length<=4096);
  const mesh=await decodeSTLFile(join(root,'repair/repaired.stl'),{units:'mm'});validateRepair(mesh);
  const actual=chunks.flatMap(c=>c.faces.map(t=>t.map(i=>c.vertices[i]))),expected=mesh.triangles.map(t=>t.map(i=>mesh.vertices[i]));assert.deepEqual(actual,expected);
  for(const machineId of ['ultimaker-s5','bambu-h2d']){const directory=join(root,machineId);await importSTLBundle(directory,join(root,'repair/repaired.stl'),{units:'mm',machineId});const state=await loadBundle(directory,{program:false});assert.deepEqual(state.review.approvals,{});assert.equal(state.plan.geometry.source.sha256,report.repairedSha256);}
  await assert.rejects(repairSTLFiles(join(root,'repair'),source,{units:'mm'}),/EEXIST/);
});
test('streamed ASCII and binary parsing match byte ingestion across chunk boundaries',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-stl-stream-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const mesh=boxMesh(),binary=Buffer.alloc(84+50*mesh.triangles.length);binary.write('solid binary');binary.writeUInt32LE(mesh.triangles.length,80);mesh.triangles.forEach((face,i)=>face.forEach((v,j)=>mesh.vertices[v].forEach((n,k)=>binary.writeFloatLE(n,84+50*i+12+j*12+k*4))));
  for(const [i,bytes] of [encodeRepairSTL(mesh),binary].entries()){const path=join(root,i+'.stl');await writeFile(path,bytes);const read=await decodeSTLFile(path,{units:'inch'}),direct=parseSTL(bytes,{units:'inch'});assert.deepEqual(read.vertices,direct.vertices);assert.deepEqual(read.triangles,direct.triangles);}
  const bad=join(root,'bad.stl');await writeFile(bad,'solid x\nfacet normal 0 0 0\n');await assert.rejects(decodeSTLFile(bad,{units:'mm'}),/truncated/);
});
test('large repair keeps the caller responsive and emits ordered full-quality chunks',async()=>{
  const source=subdividedBox(5),bytes=encodeRepairSTL(source);let ticks=0,completed=0,chunks=0;
  const timer=setInterval(()=>ticks++,5);
  try{const result=await repairSTL(bytes,{units:'mm',onGeometry:async chunk=>{
    assert.equal(chunk.firstTriangle,completed);completed+=chunk.faces.length;assert.equal(chunk.completed,completed);assert.ok(chunk.faces.length<=4096);chunks++;
    await new Promise(resolve=>setTimeout(resolve,5));
  }});assert.equal(completed,source.triangles.length);assert.ok(chunks>1);assert.ok(ticks>5,'caller event loop must keep running during mesh processing');assert.equal(result.report.unchangedSourceFaces,source.triangles.length);}finally{clearInterval(timer);}
});
test('cancellation during a held geometry chunk releases staging without publication',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-repair-abort-'));t.after(()=>rm(root,{recursive:true,force:true}));const controller=new AbortController();
  await assert.rejects(repairSTLFiles(join(root,'result'),encodeRepairSTL(boxMesh()),{units:'mm',signal:controller.signal,onGeometry:async()=>{controller.abort();}}),{name:'AbortError'});
  await assert.rejects(access(join(root,'result')));
});
