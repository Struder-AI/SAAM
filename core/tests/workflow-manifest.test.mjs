import test from 'node:test';
import assert from 'node:assert/strict';
import {access,copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generationFixture} from './workflow-generation-fixture.mjs';

test('legacy parallel bundle files migrate once to an atomic manifest and immutable artifacts',async t=>{
  const f=await generationFixture();t.after(f.cleanup);
  await f.api.generateBundle(f.directory,{development:true});
  const manifest=JSON.parse(await f.read('plan.json')),{bundle,...plan}=manifest;
  const native=bundle.geometry.descriptor.nativeFile??'model.3dm';
  await Promise.all([
    writeFile(join(f.directory,'plan.json'),JSON.stringify(plan)),
    writeFile(join(f.directory,'machine.json'),JSON.stringify(bundle.machine)),
    writeFile(join(f.directory,'review.json'),JSON.stringify({...bundle.review,generation:{...bundle.review.generation,file:undefined,checks:undefined}})),
    writeFile(join(f.directory,'checks.json'),JSON.stringify(bundle.review.generation.checks)),
    writeFile(join(f.directory,'geometry/model.json'),JSON.stringify(bundle.geometry.descriptor)),
    copyFile(join(f.directory,bundle.geometry.file),join(f.directory,'geometry',native)),
    mkdir(join(f.directory,'exports/griffin-gcode'),{recursive:true}).then(()=>copyFile(join(f.directory,bundle.review.generation.file),join(f.directory,'exports/griffin-gcode/part.gcode')))
  ]);
  const state=await f.api.loadBundle(f.directory,{program:'source'}),saved=JSON.parse(await f.read('plan.json'));
  assert.equal(state.programError,undefined);assert.equal(saved.bundle.schema,'saam-print-bundle/2');
  assert.match(saved.bundle.geometry.file,/^geometry\/[a-f0-9]{64}\.mesh\.json$/);
  assert.match(saved.bundle.review.generation.file,/^exports\/griffin-gcode\/[a-f0-9]{64}-part\.gcode$/);
  for(const name of ['machine.json','review.json','checks.json','geometry/model.json',`geometry/${native}`,'exports/griffin-gcode/part.gcode'])
    await assert.rejects(access(join(f.directory,name)),{code:'ENOENT'});
});

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
