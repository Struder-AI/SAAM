// Sub-deliverable "Heat-set part geometry" (map 4, Part edits -> Heat-set inserts): what
// Part edits relies on from heat-set's part-geometry entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {heatSetPartGeometry} from '../scripts/part-geometry.mjs';
import {geometryOperations} from '../../../core/geom/operations.mjs';

const Geometry=geometryOperations(),heatSet=heatSetPartGeometry();
const box=(()=>{
  const [x,y,z]=[30,30,12],v=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
  const t=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return {shape:'mesh',source:null,vertices:v,triangles:t};
})();
const context=(operations=[],assignments=['body'])=>({part:null,slices:['body'],operations,assignments});
const insert=(patch={})=>({id:'a',insertId:'spirol-29-m3-long',positionMm:[15,15,12],axis:[0,0,-1],...patch});
const edit=(parameters,request,ctx=context())=>heatSet.edit({base:box,parameters,request,context:ctx},Geometry);

test('an insert reinforces its part\'s Slice owner; an update keeps its source',async()=>{
  const added=await edit(null,{feature:insert()});
  assert.equal(added.parameters.features.length,1);
  assert.equal(added.operations.length,1);
  assert.equal(added.operations[0].source.assignment,'body');
  assert.equal(added.operations[0].source.parameters.feature.id,'a');
  const moved=await edit(added.parameters,{feature:{id:'a',finLengthMm:5}},context(added.operations));
  assert.deepEqual(moved.operations.map(op=>op.source.assignment),['body']);
  assert.equal(moved.operations[0].id,added.operations[0].id);
  assert.equal(moved.parameters.features[0].finLengthMm,5);
});

test('a second insert inherits size and fins, not placement; removing the last removes the record',async()=>{
  const first=await edit(null,{feature:insert({finLengthMm:5})});
  const second=await edit(first.parameters,{feature:{id:'b',positionMm:[6,6,12]}},context(first.operations));
  const b=second.parameters.features.find(f=>f.id==='b');
  assert.equal(b.finLengthMm,5);assert.deepEqual(b.positionMm,[6,6,12]);
  assert.equal(second.operations.length,2);
  const removed=await edit(first.parameters,{remove:'a'},context(first.operations));
  assert.equal(removed.remove,true);assert.deepEqual(removed.operations,[]);
});

test('sources must be ordinary Slice owners of the part; pre-source assignment forms are deprecated',async()=>{
  await assert.rejects(edit(null,{feature:insert(),sourceAssignment:'other'}),/ordinary Slice owners/);
  await assert.rejects(heatSet.edit({base:box,parameters:null,request:{feature:insert()},context:{part:null,slices:[],operations:[],assignments:[]}},Geometry),/source Slice assignment/);
  await assert.rejects(edit(null,{feature:insert()},context([],['body','heat-set-a--fin-0'])),/Deprecated heat-set assignment form/);
});

test('build bores the inserts into the base, the same every time',async()=>{
  const {parameters}=await edit(null,{feature:insert()});
  const first=await heatSet.build({base:box,parameters},Geometry),again=await heatSet.build({base:box,parameters},Geometry);
  assert.equal(JSON.stringify(first.solid),JSON.stringify(again.solid));
  assert.ok(!(await Geometry.buildGeometry(first.solid)).empty);
});
