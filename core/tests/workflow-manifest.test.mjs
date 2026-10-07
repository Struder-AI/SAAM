import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generationFixture} from './workflow-generation-fixture.mjs';

test('a saved manifest can initialize a new print without copying derived bundle state',async t=>{
  const f=await generationFixture();t.after(f.cleanup);
  const directory=await mkdtemp(join(tmpdir(),'saam-manifest-recipe-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const manifest=JSON.parse(await f.read('plan.json'));
  await f.api.initBundle(directory,manifest);
  const copy=await f.api.loadBundle(directory,{program:false});
  const {bundle:ignored,...recipe}=manifest;
  assert.deepEqual(copy.plan,recipe);
  assert.equal(copy.machine.id,manifest.bundle.machine.id);
  assert.equal(copy.review.approvals,undefined);
});
