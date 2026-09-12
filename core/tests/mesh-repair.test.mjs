import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boxMesh,ringMesh} from './fixtures/mesh.mjs';
import {makeMesh,parseSTL,sectionMesh} from '../geom/mesh.mjs';
import {reconstructMesh,encodeRepairSTL,validateRepair} from '../geom/mesh-repair.mjs';
import {simplifyRepair} from '../geom/mesh-simplify.mjs';
import {repairSTL,repairSTLFiles} from '../print/repair-stl.mjs';
import {triangleIndex,trianglesContact} from '../geom/mesh-spatial.mjs';
import {importSTLBundle} from '../print/import-stl.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {regionArea} from '../region/region2d.mjs';

const moved=(m,offset)=>({...m,vertices:m.vertices.map(p=>p.map((v,k)=>v+offset[k]))});
const combine=(a,b)=>({vertices:[...a.vertices,...b.vertices],triangles:[...a.triangles,...b.triangles.map(t=>t.map(i=>i+a.vertices.length))]});
const overlap=()=>combine(boxMesh(4,4,4),moved(boxMesh(4,4,4),[2,2,2]));
const volume=m=>Math.abs(m.triangles.reduce((sum,t)=>{const [a,b,c]=t.map(i=>m.vertices[i]);return sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;},0));

test('winding reconstruction resolves overlapping solids and converges toward their analytical union',()=>{
  const source=overlap();assert.throws(()=>makeMesh(source.vertices,source.triangles),/Intersecting/);
  const coarse=reconstructMesh(source,{resolutionMm:0.8}),fine=reconstructMesh(source,{resolutionMm:0.4});
  validateRepair(coarse);validateRepair(fine);
  assert.ok(Math.abs(volume(fine)-120)<Math.abs(volume(coarse)-120));
  assert.ok(Math.abs(volume(fine)-120)<3);
  const simplified=simplifyRepair(fine,{targetTriangles:500,maxPlaneErrorMm:0.05});validateRepair(simplified);
  assert.ok(simplified.triangles.length<=500);assert.ok(Math.abs(volume(simplified)-volume(fine))<1);
});

test('reconstructed material matches analytical box-union membership away from boundaries',()=>{
  const source=overlap(),result=reconstructMesh(source,{resolutionMm:0.4}),index=triangleIndex(result.vertices,result.triangles);
  const inside=(p,lo,hi)=>p.every((v,k)=>v>lo[k]&&v<hi[k]);
  for(const x of [0.7,1.7,2.7,3.3,4.7,5.3])for(const y of [0.7,2.7,4.7])for(const z of [0.7,2.7,4.7]){
    const winding=index.crossings(y,z).filter(hit=>hit.x<x).reduce((s,hit)=>s+hit.sign,0);
    assert.equal(winding!==0,inside([x,y,z],[0,0,0],[4,4,4])||inside([x,y,z],[2,2,2],[6,6,6]));
  }
});

test('general reconstruction retains cavities, through holes and disconnected solids',()=>{
  const inner=moved(boxMesh(4,4,4),[1,1,1]);inner.triangles=inner.triangles.map(t=>[...t].reverse());
  const cavity=reconstructMesh(combine(boxMesh(6,6,6),inner),{resolutionMm:0.4});validateRepair(cavity);
  const c=sectionMesh(makeMesh(cavity.vertices,cavity.triangles),3);assert.equal(c.loops.length,2);assert.ok(Math.abs(regionArea(c.loops)-20)<2);
  const ring=reconstructMesh(ringMesh(),{resolutionMm:0.5});validateRepair(ring);assert.equal(sectionMesh(makeMesh(ring.vertices,ring.triangles),1).loops.length,2);
  const islands=reconstructMesh(combine(boxMesh(3,3,3),moved(boxMesh(3,3,3),[6,0,0])),{resolutionMm:0.5});validateRepair(islands);assert.equal(sectionMesh(makeMesh(islands.vertices,islands.triangles),1.5).loops.length,2);
});

test('fill rules make the overlap interpretation explicit and handle inverted winding',()=>{
  const source=overlap(),nonzero=reconstructMesh(source,{resolutionMm:0.5}),parity=reconstructMesh(source,{resolutionMm:0.5,fillRule:'evenodd'});
  validateRepair(parity);assert.ok(volume(nonzero)-volume(parity)>5);
  source.triangles=source.triangles.map(t=>[...t].reverse());const reverse=reconstructMesh(source,{resolutionMm:0.5});
  assert.deepEqual(reverse.vertices,nonzero.vertices);assert.deepEqual(reverse.triangles,nonzero.triangles);
});

test('one connected folded surface is reconstructed independently of source face count and axis alignment',()=>{
  const source=boxMesh(4,4,4);source.vertices[6]=[-1,1,2];
  assert.throws(()=>makeMesh(source.vertices,source.triangles),/Intersecting/);
  const angle=0.37;source.vertices=source.vertices.map(([x,y,z])=>[x*Math.cos(angle)-y*Math.sin(angle)+0.173,x*Math.sin(angle)+y*Math.cos(angle)-0.29,z+0.117]);
  const repaired=reconstructMesh(source,{resolutionMm:0.25});validateRepair(repaired);assert.ok(volume(repaired)>1);
});

test('valid input keeps exact geometry and repair cleanup is explicit',()=>{
  const box=boxMesh(),bytes=encodeRepairSTL(box),result=repairSTL(bytes,{units:'mm',resolutionMm:0.5});
  assert.equal(result.report.method,'exact-cleanup/1');assert.equal(result.report.sampledDistanceMm.sourceVerticesToResult,0);assert.equal(result.report.outputTriangles,12);
  const dirty=Buffer.from(bytes.toString().replace('endsolid saam_repaired','facet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 0 0 0\nvertex 1 1 1\nendloop\nendfacet\nendsolid saam_repaired'));
  assert.equal(repairSTL(dirty,{units:'mm',resolutionMm:0.5}).report.removed.degenerate,1);
  assert.throws(()=>repairSTL(bytes,{resolutionMm:0.5}),/explicit/);
});

test('resolution, topology and allocation failures return no purported repaired file',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-repair-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=overlap();assert.throws(()=>reconstructMesh(source,{resolutionMm:0}),/positive/);
  assert.throws(()=>reconstructMesh(source,{resolutionMm:0.01,maxGridPoints:1000}),/allowance/);
  assert.throws(()=>reconstructMesh(source,{resolutionMm:0.5,maxOutputTriangles:100}),/output triangles/);
  assert.throws(()=>reconstructMesh({...source,triangles:source.triangles.slice(1)},{resolutionMm:0.5}),/closed/);
  const destination=join(root,'failed');await assert.rejects(repairSTLFiles(destination,encodeRepairSTL(source),{units:'mm',resolutionMm:0.01,maxGridPoints:1000}),/allowance/);await assert.rejects(access(destination));
});

test('ray ownership at shared projected edges is single-valued and nearest queries agree with a box',()=>{
  const b=boxMesh(4,4,4),index=triangleIndex(b.vertices,b.triangles);
  for(const [y,z]of [[1,1],[2,2],[3,3],[1.2,2.7]])assert.deepEqual(index.crossings(y,z),[{x:0,sign:-1},{x:4,sign:1}]);
  assert.equal(index.nearest([2,2,2]).distance,2);assert.equal(index.nearest([5,2,2]).distance,1);
});

test('collapse collision checks distinguish valid adjacency from folded overlapping faces',()=>{
  const a=[[0,0,0],[2,0,0],[0,2,0]];
  assert.equal(trianglesContact(a,[[0,0,0],[2,0,0],[1,-1,0]],a.slice(0,2)),false);
  assert.equal(trianglesContact(a,[[0,0,0],[2,0,0],[1,1,0]],a.slice(0,2)),true);
  assert.equal(trianglesContact(a,[[0,0,0],[1,0.5,1],[1,0.5,-1]],[a[0]]),true);
  assert.equal(trianglesContact(a,[[0,0,0],[-1,-1,1],[-1,-1,-1]],[a[0]]),false);
  // Opposite sides of x=0, almost coplanar, sharing just the origin. Incident
  // edge/plane solves must not invent a hit slightly past that shared endpoint.
  const left=[[-1,1,0],[0,-1,0.1],[0,0,0]],right=[[0.1,-0.3,0.02+1e-10],[0,0,0],[0.05,-0.2,0.015]];
  assert.equal(trianglesContact(left,right,[[0,0,0]]),false);
  const tetra={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],triangles:[[0,2,1],[0,1,3],[1,2,3],[2,0,3]]};
  const pair=combine(tetra,moved(tetra,[3,0,0])),small=simplifyRepair(pair,{targetTriangles:4,maxPlaneErrorMm:10});
  assert.equal(small.triangles.length,8);validateRepair(small);
});

test('resolved thin material survives and features below resolution are reported as uncertain',()=>{
  const source=boxMesh(3,3,0.6),result=reconstructMesh(source,{resolutionMm:0.15});validateRepair(result);
  assert.ok(volume(result)>4.5);assert.ok(result.report.limitations.some(s=>s.includes('smaller than')));
  const inch=repairSTL(encodeRepairSTL(boxMesh(1,1,1)),{units:'inch',resolutionMm:0.25});
  assert.deepEqual(inch.report.outputBoundsMm.max,[25.4,25.4,25.4]);assert.equal(inch.report.outputUnits,'mm');
});

test('repair files preserve original bytes and reenter the shared H2D/S5 unapproved import workflow',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-repair-workflow-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=encodeRepairSTL(overlap()),dir=join(root,'repair');const report=await repairSTLFiles(dir,source,{units:'mm',resolutionMm:0.5,targetTriangles:500});
  assert.deepEqual(await readFile(join(dir,'original.stl')),source);assert.equal(report.geometryApproved,false);
  const bytes=await readFile(join(dir,'repaired.stl'));parseSTL(bytes,{units:'mm'});
  for(const machineId of ['ultimaker-s5','bambu-h2d']){const print=join(root,machineId);await importSTLBundle(print,bytes,{units:'mm',machineId});const state=await loadBundle(print);assert.deepEqual(state.review.approvals,{});assert.equal(state.plan.geometry.source.sha256,report.repairedSha256);}
  await assert.rejects(repairSTLFiles(dir,source,{units:'mm',resolutionMm:0.5,targetTriangles:500}),/EEXIST/);
});
