import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {generationFixture} from './workflow-generation-fixture.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

async function fixture(t){const value=await generationFixture();t.after(value.cleanup);return value;}
const manifest=async f=>JSON.parse(await f.read('plan.json'));
const generationFile=async f=>join(f.directory,(await manifest(f)).bundle.review.generation.file);

test('one prepared candidate commits once and promotes without regeneration',async t=>{
  const f=await fixture(t),candidate=await f.api.prepareGeneration(f.directory,f.options);
  assert.equal(f.generateCount,1);assert.deepEqual(f.events,['Preparing geometry','generate','Writing and checking machine commands']);
  const checks=await f.api.commitGeneration(f.directory,candidate,{...f.options,development:true});
  assert.equal(f.generateCount,1);assert.deepEqual(f.events.slice(3),['commit','Saving your toolpath']);
  const file=await generationFile(f),source=await readFile(file,'utf8');f.events.length=0;
  const production=await f.api.generateBundle(f.directory,f.options);
  assert.deepEqual(production,{...checks,mode:'production'});assert.deepEqual(f.events,['commit']);assert.equal(f.generateCount,1);
  assert.equal(await readFile(file,'utf8'),source);
  const saved=await manifest(f);assert.deepEqual(saved.bundle.review.history.map(event=>event.event),['generated','generation-reused']);
  assert.equal(saved.bundle.review.generation.checks.mode,'production');
});

test('cancelled commit writes nothing and the explicit candidate remains reusable',async t=>{
  const f=await fixture(t),before=await f.read('plan.json'),candidate=await f.api.prepareGeneration(f.directory,f.options);
  await assert.rejects(f.api.commitGeneration(f.directory,candidate,{development:true,beforeCommit(){throw Error('stop commit');}}),/stop commit/);
  assert.equal(await f.read('plan.json'),before);assert.equal(f.generateCount,1);
  await f.api.commitGeneration(f.directory,candidate,{development:true});assert.equal(f.generateCount,1);
});

test('corrupt saved evidence fails while corrupt program bytes regenerate',async t=>{
  const f=await fixture(t);await f.api.generateBundle(f.directory,{development:true});
  let saved=await manifest(f);saved.bundle.review.generation.checks.generationHash='wrong';await writeFile(join(f.directory,'plan.json'),JSON.stringify(saved));
  await assert.rejects(f.api.generateBundle(f.directory),/Saved checks do not match/);assert.equal(f.generateCount,1);
  saved.bundle.review.generation.checks.generationHash=saved.bundle.review.generation.generationHash;await writeFile(join(f.directory,'plan.json'),JSON.stringify(saved));
  await writeFile(join(f.directory,saved.bundle.review.generation.file),'changed');
  const regenerated=await f.api.generateBundle(f.directory);assert.equal(regenerated.mode,'production');assert.equal(f.generateCount,2);
});

test('changed manifest during calculation is rejected before commit',async t=>{
  const f=await fixture(t),before=await f.read('plan.json');
  f.generateHook=async()=>{const saved=JSON.parse(await f.read('plan.json'));saved.placement.xMm++;await writeFile(join(f.directory,'plan.json'),JSON.stringify(saved));};
  await assert.rejects(f.api.generateBundle(f.directory,f.options),/print changed during generation/);
  assert.ok(!f.events.includes('commit'));const after=await manifest(f);assert.equal(after.bundle.review.generation,null);
  assert.notEqual(await f.read('plan.json'),before);
});

test('promotion rejects manifest or artifact changes at its commit boundary',async t=>{
  await t.test('manifest revision',async()=>{
    const f=await generationFixture();t.after(f.cleanup);await f.api.generateBundle(f.directory,{development:true});
    const saved=await manifest(f);
    await assert.rejects(f.api.generateBundle(f.directory,{beforeCommit(){
      writeFileSync(join(f.directory,'plan.json'),JSON.stringify({...saved,bundle:{...saved.bundle,review:{...saved.bundle.review,
        history:[...saved.bundle.review.history,{event:'concurrent-review'}]}}}));
    }}),/changed before promotion/);
    assert.equal((await manifest(f)).bundle.review.history.at(-1).event,'concurrent-review');
  });
  await t.test('artifact identity',async()=>{
    const f=await generationFixture();t.after(f.cleanup);await f.api.generateBundle(f.directory,{development:true});
    const before=await f.read('plan.json'),file=await generationFile(f);
    await assert.rejects(f.api.generateBundle(f.directory,{beforeCommit(){writeFileSync(file,'changed during promotion');}}),/changed before promotion/);
    assert.equal(await f.read('plan.json'),before);
  });
});

test('generated workflow exposes compute and commit as explicit graph stages',async()=>{
  const file='core/print/workflow.mjs',source=await readFile(new URL('../print/workflow.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const page=flowPacket(context,`${file}::createBundleWorkflow::generateBundle`);
  const index=name=>page.components.find(component=>component.label===`createBundleWorkflow::${name}`)?.index;
  const candidate=index('currentGenerationCandidate'),prepare=index('prepareGeneration'),commit=index('commitGeneration');
  assert.ok(candidate&&prepare&&commit);
  assert.ok(page.wires.some(wire=>wire.from===prepare&&wire.to===commit&&wire.label==='prepared'));
});

test('manifest owns checks and references immutable output',async t=>{
  const f=await fixture(t);await f.api.generateBundle(f.directory,{development:true});const saved=await manifest(f);
  assert.equal(saved.bundle.review.generation.checks.schema,'saam-checks/1');
  assert.match(saved.bundle.review.generation.file,/^exports\/griffin-gcode\/[a-f0-9]{64}-part\.gcode$/);
  await access(join(f.directory,saved.bundle.review.generation.file));
  for(const name of ['checks.json','review.json','machine.json'])await assert.rejects(access(join(f.directory,name)),{code:'ENOENT'});
});
