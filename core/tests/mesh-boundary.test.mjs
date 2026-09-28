import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMesh,translateMesh} from '../geom/mesh.mjs';
import {section,prepareSection,horizontalSlice} from '../geom/slice.mjs';
import {regionArea} from '../region/region2d.mjs';
import {boxMesh,ringMesh} from './fixtures/mesh.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell} from '../print/generate.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

test('prepared sections exactly match direct cuts across heights, holes, islands and placement',async()=>{
  const boxes=Array.from({length:12},(_,i)=>boxMesh(8,6,2+i%3,.5));
  const vertices=[],triangles=[];
  for(const [i,box] of boxes.entries()) {
    const base=vertices.length;
    vertices.push(...box.vertices.map(p=>[p[0]+12*i,p[1],p[2]+i]));
    triangles.push(...box.triangles.map(t=>t.map(v=>v+base)));
  }
  const many=makeMesh(vertices,triangles),ring=ringMesh();
  const geometries=[many,translateMesh(many,-100,30,-4),makeMesh(ring.vertices,ring.triangles),
    buildShell(await rhino(),splineBox({runMm:8,widthMm:6,heightMm:2}))];
  for(const mesh of geometries) {
    const prepared=prepareSection(mesh,horizontalSlice(0)),[min,max]=[mesh.bounds.min[2],mesh.bounds.max[2]];
    const heights=[min-1e-8,max+1e-8,min-Number.EPSILON,max+Number.EPSILON,
      ...Array.from({length:65},(_,i)=>min+(max-min)*i/64),
      ...new Set(mesh.vertices?.map(p=>p[2])??[])];
    // Nonmonotonic/repeated cuts exercise adaptive subdivision and reuse.
    for(const z of [...heights,...heights.reverse()])assert.deepEqual(section(prepared,horizontalSlice(z)),section(mesh,horizontalSlice(z)));
    if(mesh.kind==='triangle-mesh')assert.throws(()=>section(prepared,horizontalSlice(NaN)),/finite/);
  }
});

test('mesh sections tolerate floating-point boundary roundoff symmetrically without accepting outside cuts',()=>{
  const geometry=boxMesh(8,8,6),mesh=makeMesh(geometry.vertices,geometry.triangles);
  for(const z of [0.2+29*0.2,-Number.EPSILON]){
    const cut=section(mesh,horizontalSlice(z));assert.ok(Math.abs(regionArea(cut.loops)-64)<1e-6);assert.equal(cut.slice.origin[2],z);
  }
  for(const z of [-1e-10,6+1e-10])assert.deepEqual(section(mesh,horizontalSlice(z)).loops,[]);
  const shifted=makeMesh(geometry.vertices.map(p=>[p[0],p[1],p[2]-3]),geometry.triangles);
  for(const z of [-3-Number.EPSILON*4,3+Number.EPSILON*4])assert.ok(section(shifted,horizontalSlice(z)).loops.length);
  for(const z of [-3-1e-10,3+1e-10])assert.deepEqual(section(shifted,horizontalSlice(z)).loops,[]);
});

test('a floating final layer is deposited identically by mesh and spline slices',async()=>{
  const machine=loadMachine(),native=await rhino(),lastLayers=[];
  for(const geometry of [boxMesh(8,8,6),splineBox({runMm:8,widthMm:8,heightMm:6})]){
    const plan=defaults(machine);plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
    const path=generatePath(plan,machine,native),deposition=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
    lastLayers.push(Math.max(...deposition.map(a=>a.to[2])));
    assert.equal(path.summary.slices.layers,30);assert.equal(path.summary.slices.instances[0].skippedLayers,0);
  }
  assert.equal(lastLayers[0],lastLayers[1]);assert.ok(Math.abs(lastLayers[0]-6)<1e-12);
});
