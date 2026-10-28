// Sub-deliverable "Proposed part geometry" (map 0 capability-commands, from Part edits):
// extension records stack on a part, and editing one rebuilds those above it from their
// own parameters. Saved extension-specific forms read as part geometry records.
import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadBundle} from '../print/bundle.mjs';
import {applyExtensionEdit,createExtensionBundle} from '../print/extension-edits.mjs';
import {readRecipe} from '../print/plan.mjs';
import {geometryOperations} from '../geom/operations.mjs';

const bytes=await readFile(new URL('../../skills/text/tests/fixtures/Abel-Regular.ttf',import.meta.url));
const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(t){const dir=await mkdtemp(resolve(tmpdir(),'saam-part-geometry-'));t.after(()=>rm(dir,{recursive:true,force:true}));return resolve(dir,'print');}

test('text on a gridfinity bin is rebuilt on the edited bin with its own features',async t=>{
  const dir=await fixture(t);
  const bin=await createExtensionBundle(dir,'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const {bounds}=await geometryOperations().buildGeometry(bin.plan.geometry);
  const reference={kind:'plane',origin:[bounds.min[0]+4,bounds.min[1]+4,bounds.max[2]],xAxis:[1,0,0],yAxis:[0,1,0]};
  const lettered=await applyExtensionEdit(dir,'text',{feature:{id:'BO',text:'BO',font,reference,sizeMm:6}},{expectedRevision:bin.revision});
  const top=lettered.plan.geometry;
  assert.equal(top.shape,'extension');assert.equal(top.extension,'text');
  assert.equal(top.base.parameters.xUnits,bin.plan.geometry.parameters.xUnits);
  const wider=await applyExtensionEdit(dir,'gridfinity',{xUnits:2},{expectedRevision:lettered.revision});
  const saved=(await loadBundle(dir)).plan.geometry;
  assert.equal(saved.shape,'extension');assert.equal(saved.extension,'text');
  assert.deepEqual(saved.parameters,top.parameters);
  assert.equal(saved.label,top.label);
  assert.equal(saved.base.extension,'gridfinity');assert.equal(saved.base.parameters.xUnits,2);
  assert.ok(saved.materialParts.some(part=>part.id==='text/BO'));
  assert.notEqual(JSON.stringify(saved.solid),JSON.stringify(top.solid));
  assert.notEqual(wider.revision,lettered.revision);
});

test('saved legacy text and gridfinity records read as part geometry records',async t=>{
  const dir=await fixture(t);
  const bin=await createExtensionBundle(dir,'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const legacy={shape:'text',base:bin.plan.geometry,features:[{id:'BO',text:'BO'}],toleranceMm:0.01,maxEdgeMm:1,
    solid:bin.plan.geometry.solid,materialParts:[{id:'base',geometry:null}]};
  const {plan}=readRecipe({...bin.plan,geometry:legacy});
  assert.equal(plan.geometry.shape,'extension');
  assert.equal(plan.geometry.extension,'text');
  assert.deepEqual(plan.geometry.parameters,{features:[{id:'BO',text:'BO'}],toleranceMm:0.01,maxEdgeMm:1});
  assert.deepEqual(plan.geometry.base,bin.plan.geometry);
  assert.deepEqual(plan.geometry.materialParts,[{id:'base',geometry:null}]);
  const bin2={shape:'gridfinity',parameters:bin.plan.geometry.parameters,solid:bin.plan.geometry.solid};
  const read=readRecipe({...bin.plan,geometry:bin2}).plan.geometry;
  assert.equal(read.extension,'gridfinity');assert.deepEqual(read.parameters,bin2.parameters);assert.equal(read.base,null);
});

test('heat-set reinforcement follows its insert; removing the insert removes it and keeps the body',async t=>{
  const dir=await fixture(t);
  const bin=await createExtensionBundle(dir,'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const bored=await applyExtensionEdit(dir,'heat-set-inserts',{feature:{id:'a',insertId:'spirol-29-m3-long',positionMm:[21,21,7],axis:[0,0,-1]}},{expectedRevision:bin.revision});
  const ids=assignments=>assignments.map(a=>a.id);
  const reinforcement=bored.plan.slices.assignments.filter(a=>a.source?.extension==='heat-set-inserts');
  assert.equal(reinforcement.length,1);assert.equal(reinforcement[0].source.assignment,'body');
  assert.equal(bored.plan.geometry.extension,'heat-set-inserts');assert.equal(bored.plan.geometry.base.extension,'gridfinity');
  assert.deepEqual(ids(bored.plan.slices.assignments),[...ids(bin.plan.slices.assignments),reinforcement[0].id]);
  const plain=await applyExtensionEdit(dir,'heat-set-inserts',{remove:'a'},{expectedRevision:bored.revision});
  assert.deepEqual(ids(plain.plan.slices.assignments),ids(bin.plan.slices.assignments));
  assert.equal(plain.plan.geometry.extension,'gridfinity');
});
