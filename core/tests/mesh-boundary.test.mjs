import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMesh,sectionMesh} from '../geom/mesh.mjs';
import {regionArea} from '../region/region2d.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';

test('mesh sections tolerate floating-point boundary roundoff symmetrically without accepting outside cuts',()=>{
  const geometry=boxMesh(8,8,6),mesh=makeMesh(geometry.vertices,geometry.triangles);
  for(const z of [0.2+29*0.2,-Number.EPSILON]){
    const section=sectionMesh(mesh,z);assert.ok(Math.abs(regionArea(section.loops)-64)<1e-6);assert.equal(section.requestedZ,z);
  }
  for(const z of [-1e-10,6+1e-10])assert.deepEqual(sectionMesh(mesh,z).loops,[]);
  const shifted=makeMesh(geometry.vertices.map(p=>[p[0],p[1],p[2]-3]),geometry.triangles);
  for(const z of [-3-Number.EPSILON*4,3+Number.EPSILON*4])assert.ok(sectionMesh(shifted,z).loops.length);
  for(const z of [-3-1e-10,3+1e-10])assert.deepEqual(sectionMesh(shifted,z).loops,[]);
});

test('a floating final layer is deposited identically by mesh and spline full-fill producers',async()=>{
  const machine=loadMachine(),native=await rhino(),lastLayers=[];
  for(const geometry of [boxMesh(8,8,6),{shape:'box',runMm:8,widthMm:8,heightMm:6}]){
    const plan=defaults(machine);plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
    const path=generatePath(plan,machine,native),deposition=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
    lastLayers.push(Math.max(...deposition.map(a=>a.to[2])));
    assert.equal(path.summary.fullFill.layers,30);assert.equal(path.summary.fullFill.skippedLayers,0);
  }
  assert.equal(lastLayers[0],lastLayers[1]);assert.ok(Math.abs(lastLayers[0]-6)<1e-12);
});
