// Sub-deliverable "Gridfinity part geometry" (map 4, Part edits -> Gridfinity): what Part
// edits relies on from gridfinity's part-geometry entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {gridfinityPartGeometry} from '../scripts/part-geometry.mjs';
import {geometryOperations} from '../../../core/geom/operations.mjs';

const Geometry=geometryOperations(),gridfinity=gridfinityPartGeometry();
const create=request=>gridfinity.edit({base:null,parameters:null,request},Geometry);

test('a new print takes its kind\'s defaults and a placement; build is repeatable and not empty',async()=>{
  const created=await create({kind:'blank'});
  assert.deepEqual(created.placement,{xMm:20,yMm:20});
  assert.equal(created.parameters.kind,'blank');assert.equal(created.parameters.xUnits,1);assert.equal(created.parameters.heightUnits,1);
  const first=await gridfinity.build({base:null,parameters:created.parameters},Geometry),again=await gridfinity.build({base:null,parameters:created.parameters},Geometry);
  assert.equal(JSON.stringify(first.solid),JSON.stringify(again.solid));
  assert.deepEqual(first.materialParts??[],[]);
  assert.ok(!(await Geometry.buildGeometry(first.solid)).empty);
});

test('edits merge partial parameters; a new kind keeps footprint and tolerance',async()=>{
  const {parameters}=await create({kind:'bin',xUnits:2,compartmentsX:2});
  const wider=await gridfinity.edit({base:null,parameters,request:{yUnits:2}},Geometry);
  assert.equal(wider.parameters.xUnits,2);assert.equal(wider.parameters.compartmentsX,2);assert.equal(wider.parameters.yUnits,2);
  assert.equal(wider.placement,undefined);
  const blank=await gridfinity.edit({base:null,parameters:wider.parameters,request:{kind:'blank'}},Geometry);
  assert.equal(blank.parameters.xUnits,2);assert.equal(blank.parameters.yUnits,2);
  assert.equal(blank.parameters.toleranceMm,wider.parameters.toleranceMm);
  assert.equal(Object.hasOwn(blank.parameters,'compartmentsX'),false);
});

test('a part gridfinity did not create and unknown parameters fail',async()=>{
  const mesh={shape:'mesh',source:null,vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],triangles:[[0,2,1],[0,1,3],[1,2,3],[0,3,2]]};
  await assert.rejects(gridfinity.edit({base:mesh,parameters:null,request:{xUnits:2}},Geometry),/existing gridfinity/);
  await assert.rejects(create({kind:'bin',wheels:4}),/Unknown or inapplicable/);
  await assert.rejects(create({kind:'bin',xUnits:0}),/xUnits/);
});
