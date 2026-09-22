import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generationFixture} from './workflow-generation-fixture.mjs';

test('one manifest snapshot supplies state and matching fingerprints without read retries',async t=>{
  const f=await generationFixture();t.after(f.cleanup);
  const snapshot=await f.api.loadBundleSnapshot(f.directory,{program:false});
  assert.equal(snapshot.fingerprint,snapshot.state.fingerprints.source);
  assert.equal(snapshot.presentationFingerprint,snapshot.state.fingerprints.presentation);
  assert.equal(snapshot.state.plan.schema,'saam-shell-plan/1');
});

test('a saved manifest can initialize a new print without copying derived bundle state',async t=>{
  const f=await generationFixture();t.after(f.cleanup);
  const directory=await mkdtemp(join(tmpdir(),'saam-manifest-recipe-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const manifest=JSON.parse(await f.read('plan.json'));
  await f.api.initBundle(directory,manifest);
  const copy=await f.api.loadBundle(directory,{program:false});
  const {bundle:ignored,...recipe}=manifest;
  assert.deepEqual(copy.plan,recipe);
  assert.equal(copy.machine.id,manifest.bundle.machine.id);
  assert.deepEqual(copy.review.approvals,{});
});
