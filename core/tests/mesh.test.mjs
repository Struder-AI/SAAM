import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMesh,sectionMesh,meshTopAt,parseSTL} from '../geom/mesh.mjs';
import {regionArea} from '../region/region2d.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino,createGeometry,verifyGeometry} from '../print/geometry.mjs';
import {exportProgram} from '../export/registry.mjs';
import {initBundle,loadBundle,generateBundle,approve,deliver} from '../print/bundle.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {boxMesh,ringMesh} from './fixtures/mesh.mjs';
import {execFileSync} from 'node:child_process';
function stl(g,binary=false) {
  if(binary){const bytes=Buffer.alloc(84+50*g.triangles.length);bytes.write('solid binary header');bytes.writeUInt32LE(g.triangles.length,80);g.triangles.forEach((t,i)=>t.forEach((v,j)=>g.vertices[v].forEach((n,k)=>bytes.writeFloatLE(n,84+50*i+12+12*j+4*k))));return bytes;}
  return Buffer.from('solid fixture\n'+g.triangles.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(v=>'vertex '+g.vertices[v].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid fixture');
}
test('mesh sections and normals follow the actual facets, including a top-boundary cut',()=>{
  const g=boxMesh(12,10,2,1),m=makeMesh(g.vertices,g.triangles);
  assert.ok(Math.abs(regionArea(sectionMesh(m,1).loops)-120)<1e-6);
  assert.ok(Math.abs(regionArea(sectionMesh(m,2.5).loops)-60)<1e-6);
  const top=meshTopAt(m,6,5);assert.equal(top.zMm,2.5);assert.ok(Math.abs(top.slopeDeg-Math.atan(1/12)*180/Math.PI)<1e-8);
  const flat=boxMesh();assert.ok(sectionMesh(makeMesh(flat.vertices,flat.triangles),2).nudgedByMm<0);
});
test('ASCII and binary STL require units and reject broken topology',()=>{
  for(const binary of [false,true]){
    const parsed=parseSTL(stl(boxMesh(),binary),{units:'mm'});
    assert.equal(regionArea(sectionMesh(makeMesh(parsed.vertices,parsed.triangles),1).loops),120);
    assert.throws(()=>parseSTL(stl(boxMesh(),binary)),/explicit/);
  }
  const g=boxMesh();assert.throws(()=>makeMesh(g.vertices,g.triangles.slice(1)),/closed/);
  assert.throws(()=>makeMesh(g.vertices,[...g.triangles,g.triangles[0]]),/Duplicate/);
  const shifted=boxMesh();shifted.vertices=shifted.vertices.map(p=>p.map(v=>v+0.5));
  assert.throws(()=>makeMesh([...g.vertices,...shifted.vertices],[...g.triangles,...shifted.triangles.map(t=>t.map(i=>i+8))]),/Intersecting/);
});
test('fill and drape generate on both geometry backends and both machine profiles',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const skill of ['full-fill','draped-skin']){
    const machine=loadMachine(id),paths=[];
    for(const geometry of [{shape:'box',runMm:12,widthMm:10,heightMm:2},boxMesh()]){
      const plan=defaults(machine);plan.geometry=geometry;plan.process.minimumLayerSeconds=0;
      plan.skills['full-fill'].enabled=skill==='full-fill';plan.skills['draped-skin'].enabled=skill==='draped-skin';
      const path=generatePath(plan,machine,r);paths.push(path);
      assert.equal(path.summary.machineChecks.machine,id);
      assert.ok(path.actions.some(a=>a.volumeMm3>0));
      if(id==='bambu-h2d')assert.throws(()=>exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'}),/H2D startup/);
    }
    const volume=p=>p.actions.reduce((s,a)=>s+(a.volumeMm3??0),0);
    assert.ok(Math.abs(volume(paths[0])-volume(paths[1]))/volume(paths[0])<0.01,`${id}/${skill}: backend volume parity`);
  }
});
test('native mesh uses the shared approvals and exact-byte delivery workflow',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-mesh-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const plan=defaults();plan.geometry=boxMesh();plan.skills['draped-skin'].enabled=false;
  await initBundle(dir,plan);let state=await loadBundle(dir);
  assert.equal(state.geometry.nativeFile,'model.mesh.json');
  const native=await createGeometry(plan.geometry),fake=structuredClone(native.descriptor);fake.vertices[0][0]+=1;
  await assert.rejects(verifyGeometry(native.bytes,fake),/display\/identity differs/);
  for(const stage of ['geometry','plan'])state=await approve(dir,{stage,actor:'SYNTHETIC MESH TEST',revision:state.revision});
  await generateBundle(dir);state=await loadBundle(dir);
  assert.equal(state.programError,undefined);
  state=await approve(dir,{stage:'toolpath',actor:'SYNTHETIC MESH TEST',revision:state.revision});
  assert.equal(await readFile(await deliver(dir),'utf8'),state.code);
  await writeFile(join(dir,'geometry/model.mesh.json'),'{}');
  await assert.rejects(loadBundle(dir),/Geometry file changed/);
});

test('holes, disconnected islands and mixed spline/mesh assemblies use the shared geometry boundary',async t=>{
  const g=ringMesh(),mesh=makeMesh(g.vertices,g.triangles),section=sectionMesh(mesh,1);
  assert.equal(section.loops.length,2);assert.equal(regionArea(section.loops),128);assert.equal(meshTopAt(mesh,6,6),null);
  const box=boxMesh();const islands=makeMesh([...box.vertices,...box.vertices.map(p=>[p[0]+20,p[1],p[2]])],[...box.triangles,...box.triangles.map(t=>t.map(v=>v+8))]);
  assert.equal(sectionMesh(islands,1).loops.length,2);
  const plan=defaults();plan.geometry={shape:'assembly',parts:[
    {id:'spline',geometry:{shape:'box',runMm:12,widthMm:10,heightMm:2},xMm:0,yMm:0,zMm:0},
    {id:'mesh',geometry:box,xMm:20,yMm:0,zMm:0}]};plan.skills['draped-skin'].enabled=false;
  const dir=await mkdtemp(join(tmpdir(),'saam-mixed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await initBundle(dir,plan);await generateBundle(dir,{development:true});
  const state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.equal(state.pathSummary.fullFill.instances.length,2);
});

test('public STL import locks units/source, uses the bundle and rejects a changed source',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-stl-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,'source.stl'),bundle=join(dir,'print');await writeFile(source,stl(boxMesh(),true));
  execFileSync(process.execPath,['core/print/cli.mjs','import-stl',bundle,source,'mm'],{stdio:'pipe'});
  const state=await loadBundle(bundle);assert.equal(state.plan.geometry.source.units,'mm');assert.deepEqual(state.review.approvals,{});
  execFileSync(process.execPath,['core/print/cli.mjs','check-path',bundle],{stdio:'pipe'});
  await writeFile(join(bundle,'geometry/source.stl'),'changed');
  await assert.rejects(loadBundle(bundle),/STL source changed/);
});
