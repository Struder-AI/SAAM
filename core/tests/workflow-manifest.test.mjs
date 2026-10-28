import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generationFixture,fixtureGeometry} from './workflow-generation-fixture.mjs';

test("a saved manifest's recipe and machine label initialize a new print without copying derived bundle state",async t=>{
  const f=await generationFixture();t.after(f.cleanup);
  const directory=await mkdtemp(join(tmpdir(),'saam-manifest-recipe-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const manifest=JSON.parse(await f.read('plan.json'));
  const {bundle,...recipe}=manifest;
  assert.equal(bundle.machine,undefined,'Bundle stores the machine label, not a profile');
  await f.api.initBundle(directory,recipe,{machineId:bundle.machineId,geometry:fixtureGeometry(recipe.geometry)});
  const copy=await f.api.loadBundle(directory,{program:false});
  assert.deepEqual(copy.plan,recipe);
  assert.equal(copy.machineId,'ultimaker-s5');
  assert.equal(copy.review.approvals,undefined);
});
