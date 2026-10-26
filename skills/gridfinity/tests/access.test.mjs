import '../../../core/tests/temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadBundle} from '../../../core/print/bundle.mjs';
import {applyExtensionEdit,createExtensionBundle} from '../../../core/print/extension-edits.mjs';

async function fixture(t){const dir=await mkdtemp(resolve(tmpdir(),'saam-synthetic-gridfinity-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('creates and edits a shared print from parameters; stale changes fail without altering it',async t=>{
  const dir=resolve(await fixture(t),'print');
  const state=await createExtensionBundle(dir,'gridfinity',{kind:'blank'},{machineId:'ultimaker-s5'});
  const next=await applyExtensionEdit(dir,'gridfinity',{xUnits:2},{expectedRevision:state.revision});assert.notEqual(next.revision,state.revision);
  await assert.rejects(applyExtensionEdit(dir,'gridfinity',{xUnits:2},{expectedRevision:state.revision}),/stale/);
  assert.equal((await loadBundle(dir)).plan.geometry.parameters.xUnits,2);
});

test('baseplate padding widens the solid border and leaves the socket grid at the origin',async()=>{
  const {compileGridfinity,gridfinityParameters}=await import('../scripts/gridfinity.mjs');
  const {geometryOperations}=await import('../../../core/geom/operations.mjs');
  const Geometry=await geometryOperations();
  const {geometry}=await compileGridfinity({kind:'baseplate',xUnits:2,yUnits:1,paddingLeftMm:3,paddingRightMm:3,paddingBackMm:7.5},Geometry);
  const {min,max}=Geometry.buildGeometry(geometry).bounds;
  for(const [actual,expected] of [[min[0],-3],[max[0],87],[min[1],0],[max[1],49.5],[max[2],5.95]])assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
  assert.throws(()=>gridfinityParameters({kind:'bin',paddingLeftMm:1},0.01),/inapplicable/);
  assert.throws(()=>gridfinityParameters({kind:'baseplate',paddingFrontMm:-1},0.01),/paddingFrontMm/);
});
