import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMesh,translateMesh,sectionMesh,meshTopAt,parseSTL} from '../geom/mesh.mjs';
import {regionArea} from '../region/region2d.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino,createGeometry,verifyGeometry} from '../print/geometry.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {initBundle,loadBundle,generateBundle,approve,deliver} from '../print/bundle.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {boxMesh,ringMesh} from './fixtures/mesh.mjs';
import {execFileSync} from 'node:child_process';
test('mesh reuse detects edited inputs and isolates cached derived data',()=>{
  const g=boxMesh(),first=makeMesh(g.vertices,g.triangles);
  const bounds=structuredClone(first.bounds),normals=structuredClone(first.normals);
  first.bounds.max[0]=999;first.normals[0][0]=999;first.edges.clear();
  const second=makeMesh(structuredClone(g.vertices),structuredClone(g.triangles));
  assert.deepEqual(second.bounds,bounds);assert.deepEqual(second.normals,normals);assert.ok(second.edges.size);
  g.triangles[0]=[0,0,0];
  assert.throws(()=>makeMesh(g.vertices,g.triangles),/Invalid mesh triangle/);
});
test('planar mesh translation defers derived copies and retains defensive ownership',()=>{
  const g=boxMesh(),mesh=makeMesh(g.vertices,g.triangles);let normalReads=0,edgeReads=0;
  for(const key of ['normals','edges']){
    const descriptor=Object.getOwnPropertyDescriptor(mesh,key);
    Object.defineProperty(mesh,key,{...descriptor,get(){if(key==='normals')normalReads++;else edgeReads++;return descriptor.get.call(this);}});
  }
  mesh.sourceTag={source:'fixture'};
  const translated=translateMesh(mesh,3,4,5);
  assert.equal(translated.sourceTag,mesh.sourceTag);
  assert.equal(normalReads,0);assert.equal(edgeReads,0);
  assert.equal(regionArea(sectionMesh(translated,6).loops),120);
  assert.equal(normalReads,0);assert.equal(edgeReads,0);
  assert.equal(meshTopAt(translated,9,9).zMm,7);
  assert.ok(normalReads>0);assert.equal(edgeReads,0);
  assert.equal(translated.normals,mesh.normals,'translation retains shallow sharing of owned derived arrays');
  translated.normals[0][0]=999;translated.edges.clear();
  const clean=makeMesh(g.vertices,g.triangles);
  assert.notEqual(clean.normals[0][0],999);assert.ok(clean.edges.size);
  translated.normals=[];assert.notEqual(translated.normals,mesh.normals,'reassignment belongs to its receiver');
  const frozen=Object.freeze(makeMesh(g.vertices,g.triangles));
  assert.ok(frozen.normals.length);assert.ok(frozen.edges.size);
  const translatedFrozen=translateMesh(frozen,1,2,3);
  assert.equal(meshTopAt(translatedFrozen,7,7).zMm,5);
  translatedFrozen.edges=new Map();assert.equal(translatedFrozen.edges.size,0);assert.ok(frozen.edges.size);
});
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
test('rejected mesh inputs retain their diagnostic and point once to the mesh tools manual',()=>{
  const g=boxMesh(),open={...g,triangles:g.triangles.slice(1)};
  const rejected=[
    [()=>makeMesh([],[]),/^Mesh needs at least 4 vertices\./],
    [()=>makeMesh(g.vertices.map((p,i)=>i===0?[NaN,0,0]:p),g.triangles),/^Mesh vertices must be finite XYZ millimeters\./],
    [()=>makeMesh(g.vertices,[...g.triangles,[0,0,0]]),/^Invalid mesh triangle indices\./],
    [()=>makeMesh(open.vertices,open.triangles),/^Mesh must be closed, manifold and consistently wound/],
    [()=>parseSTL(stl(open),{units:'mm'}),/^Mesh must be closed, manifold and consistently wound/],
    [()=>parseSTL(stl(open,true),{units:'mm'}),/^Mesh must be closed, manifold and consistently wound/],
    [()=>parseSTL(Buffer.from('solid truncated'),{units:'mm'}),/^Invalid or truncated STL\./],
    [()=>parseSTL(Buffer.from('solid bad\nfacet unexpected\nendsolid bad'),{units:'mm'}),/^Malformed ASCII STL\./]
  ];
  for(const [run,diagnostic] of rejected)assert.throws(run,error=>{
    assert.equal(error.constructor,Error);assert.match(error.message,diagnostic);
    assert.equal(error.message.split('Read skills/mesh-tools/SKILL.md').length-1,1);
    assert.match(error.message,/read_skill with skillId "mesh-tools"/);return true;
  });
  // Missing units is an import argument problem; section parameters are query
  // problems. Neither asks an agent to diagnose an otherwise valid mesh.
  assert.throws(()=>parseSTL(stl(g)),{message:'STL import needs explicit mm/inch units and positive scale.'});
  assert.throws(()=>sectionMesh(makeMesh(g.vertices,g.triangles),NaN),{message:'Section height must be finite.'});
  for(const binary of [false,true]){
    const bytes=stl(g,binary),before=Buffer.from(bytes),parsed=parseSTL(bytes,{units:'mm'});
    assert.deepEqual(Object.keys(parsed),['vertices','triangles']);
    assert.deepEqual(bytes,before);assert.equal(regionArea(sectionMesh(makeMesh(parsed.vertices,parsed.triangles),1).loops),120);
  }
});
test('fill and drape generate on both geometry backends and both machine profiles',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const skill of ['full-fill','draped-skin']){
    const machine=loadMachine(id),paths=[];
    for(const geometry of [{shape:'box',runMm:12,widthMm:10,heightMm:2},boxMesh()]){
      const plan=defaults(machine);plan.geometry=geometry;plan.process.minimumLayerSeconds=0;
      plan.skills['full-fill'].enabled=skill==='full-fill';plan.skills['draped-skin'].enabled=skill==='draped-skin';
      const path=generatePath(plan,machine,r);paths.push(path);
      assert.ok(path.actions.some(a=>a.volumeMm3>0));
      const output=exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'});
      assert.equal(interpretProgram(output,plan,machine).moves.length,path.actions.filter(a=>a.kind==='move').length);
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

test('public STL import exposes mesh recovery guidance only for rejected mesh content',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-stl-rejected-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,'open.stl'),bundle=join(dir,'print'),g=boxMesh();
  await writeFile(source,stl({...g,triangles:g.triangles.slice(1)}));
  assert.throws(()=>execFileSync(process.execPath,['core/print/cli.mjs','import-stl',bundle,source,'mm'],{stdio:'pipe'}),error=>{
    assert.equal(error.status,1);const diagnostic=error.stderr.toString();
    assert.match(diagnostic,/Mesh must be closed, manifold and consistently wound/);
    assert.equal(diagnostic.split('Read skills/mesh-tools/SKILL.md').length-1,1);return true;
  });
  assert.throws(()=>execFileSync(process.execPath,['core/print/cli.mjs','import-stl',bundle,join(dir,'missing.stl'),'mm'],{stdio:'pipe'}),error=>{
    assert.equal(error.status,1);assert.match(error.stderr.toString(),/ENOENT/);
    assert.doesNotMatch(error.stderr.toString(),/mesh-tools/);return true;
  });
});
