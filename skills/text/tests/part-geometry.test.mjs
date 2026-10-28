// Sub-deliverable "Text part geometry" (map 4, Part edits -> Text): what Part edits
// relies on from text's part-geometry entry, independent of how text builds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {textPartGeometry as entry} from '../scripts/part-geometry.mjs';
import {geometryOperations} from '../../../core/geom/operations.mjs';

const bytes=await readFile(new URL('./fixtures/Abel-Regular.ttf',import.meta.url));
const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
const Geometry=geometryOperations(),textPartGeometry=entry();
const plane={kind:'plane',origin:[0,0,3],xAxis:[1,0,0],yAxis:[0,1,0]};
const box=(()=>{
  const [x,y,z]=[24,14,3],v=[[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
  const t=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return {shape:'mesh',source:null,vertices:v,triangles:t};
})();
const feature=(patch={})=>({id:'BO',text:'BO',font,reference:plane,positionMm:[3,3],sizeMm:7,...patch});
const edit=request=>textPartGeometry.edit({base:box,parameters:null,request},Geometry);

test('raised text builds base and named text material, labelled by its text, the same every time',async()=>{
  const {parameters}=await edit({feature:feature()});
  const first=await textPartGeometry.build({base:box,parameters},Geometry),again=await textPartGeometry.build({base:box,parameters},Geometry);
  assert.deepEqual(first.materialParts.map(part=>part.id).sort(),['base','text/BO']);
  assert.match(first.label,/BO/);
  assert.equal(JSON.stringify(first.solid),JSON.stringify(again.solid));
  assert.ok(!Geometry.buildGeometry(first.solid).empty);
});

test('recessed text leaves no text material',async()=>{
  const {parameters}=await edit({feature:feature({mode:'recessed'})});
  const built=await textPartGeometry.build({base:box,parameters},Geometry);
  assert.deepEqual(built.materialParts.map(part=>part.id),['base']);
});

test('updates merge by feature ID; removing the only feature removes the record; unknown fields fail',async()=>{
  const {parameters}=await edit({feature:feature()});
  const updated=await textPartGeometry.edit({base:box,parameters,request:{feature:{id:'BO',text:'OB'}}},Geometry);
  assert.equal(updated.parameters.features.length,1);
  assert.equal(updated.parameters.features[0].text,'OB');
  assert.equal(updated.parameters.features[0].sizeMm,7);
  assert.deepEqual(await textPartGeometry.edit({base:box,parameters,request:{remove:'BO'}},Geometry),{remove:true});
  await assert.rejects(edit({feature:feature(),part:'lid'}),/Unknown text request field/);
  await assert.rejects(textPartGeometry.edit({base:box,parameters,request:{remove:'missing'}},Geometry),/not found/);
});
