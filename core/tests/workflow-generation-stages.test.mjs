import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {generationFixture} from './workflow-generation-fixture.mjs';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
async function fixture(t){const f=await generationFixture();t.after(f.cleanup);return f;}

test('prepared calculations commit once and reviewed promotion checks bytes without regenerating',async t=>{
  const f=await fixture(t);
  await f.api.checkPathBundle(f.directory,f.options);
  assert.deepEqual(f.events,['Preparing geometry','generate','Writing and checking machine commands']);
  const checks=await f.api.generateBundle(f.directory,{...f.options,development:true});
  assert.equal(f.generateCount,1);
  assert.deepEqual(f.events.slice(3),['commit','Saving your toolpath']);
  const source=await f.read('exports/griffin-gcode/part.gcode');
  f.events.length=0;
  const production=await f.api.generateBundle(f.directory,f.options);
  assert.deepEqual(production,{...checks,mode:'production'});
  assert.deepEqual(f.events,['Checking the reviewed file','commit']);assert.equal(f.generateCount,1);
  assert.equal(await f.read('exports/griffin-gcode/part.gcode'),source);
  const review=JSON.parse(await f.read('review.json'));
  assert.deepEqual(review.approvals,{});assert.deepEqual(review.history.map(h=>h.event),['generated','generation-reused']);
});

test('cancelled commit preserves files and prepared candidate, while failed generation clears the candidate',async t=>{
  const f=await fixture(t),original=await f.read('review.json');
  await assert.rejects(f.api.generateBundle(f.directory,{...f.options,development:true,beforeCommit(){throw Error('stop commit');}}),/stop commit/);
  assert.equal(await f.read('review.json'),original);
  await assert.rejects(f.read('checks.json'),{code:'ENOENT'});
  await f.api.generateBundle(f.directory,{development:true});assert.equal(f.generateCount,1);
  f.generateHook=()=>{throw Error('generation failed');};
  await assert.rejects(f.api.generateBundle(f.directory,{development:true}),/generation failed/);
  f.generateHook=null;
  await f.api.generateBundle(f.directory,{development:true});assert.equal(f.generateCount,3);
});

test('saved-check mismatch fails before commit while changed export falls back to generation',async t=>{
  const f=await fixture(t);
  const checks=await f.api.generateBundle(f.directory,{development:true});
  await writeFile(join(f.directory,'checks.json'),JSON.stringify({...checks,planHash:'wrong'}));
  const review=await f.read('review.json');f.events.length=0;
  await assert.rejects(f.api.generateBundle(f.directory,f.options),/Saved checks do not match/);
  assert.deepEqual(f.events,['Checking the reviewed file']);assert.equal(f.generateCount,1);
  assert.equal(await f.read('review.json'),review);
  await writeFile(join(f.directory,'exports/griffin-gcode/part.gcode'),'changed');f.events.length=0;
  const fallback=await f.api.generateBundle(f.directory,f.options);
  assert.equal(fallback.mode,'production');assert.equal(f.generateCount,2);
  assert.deepEqual(f.events,['Checking the reviewed file','Preparing geometry','generate','Writing and checking machine commands','commit','Saving your toolpath']);
});

test('changed plan during generation is rejected before commit',async t=>{
  const f=await fixture(t),before=await f.read('review.json');
  f.generateHook=async()=>{
    const plan=JSON.parse(await f.read('plan.json'));plan.placement.xMm++;
    await writeFile(join(f.directory,'plan.json'),JSON.stringify(plan));
  };
  await assert.rejects(f.api.generateBundle(f.directory,f.options),/print changed during generation/);
  assert.ok(!f.events.includes('commit'));assert.equal(await f.read('review.json'),before);
  await assert.rejects(f.read('checks.json'),{code:'ENOENT'});
});

test('failed persistence leaves review untouched and keeps checked candidate for retry',async t=>{
  const f=await fixture(t),review=await f.read('review.json');
  const checksPath=join(f.directory,'checks.json');await mkdir(checksPath);
  await assert.rejects(f.api.generateBundle(f.directory,{...f.options,development:true}));
  assert.equal(f.generateCount,1);assert.equal(await f.read('review.json'),review);
  assert.match(await f.read('exports/griffin-gcode/part.gcode'),/START_OF_HEADER/);
  await rm(checksPath,{recursive:true});f.events.length=0;
  await f.api.generateBundle(f.directory,{...f.options,development:true});
  assert.equal(f.generateCount,1);assert.deepEqual(f.events,['commit','Saving your toolpath']);
});

test('generated workflow links candidate verification and checked output to persistence',async()=>{
  const file='core/print/workflow.mjs',source=await readFile(new URL('../print/workflow.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const page=flowPacket(context,`${file}::createBundleWorkflow::generateBundle`);
  const index=name=>page.components.find(c=>c.label===`createBundleWorkflow::${name}`)?.index;
  const candidate=index('reviewedGenerationCandidate'),promote=index('persistReviewedGeneration');
  const prepared=index('prepareProgram'),checks=index('generationChecks'),persist=index('persistGeneratedProgram');
  assert.ok(candidate&&promote&&prepared&&checks&&persist);
  for(const [from,to,label] of [[candidate,promote,'reusable'],[prepared,checks,'prepared'],[prepared,persist,'prepared'],[checks,persist,'checks']])
    assert.ok(page.wires.some(w=>w.from===from&&w.to===to&&w.label===label),`${label}: ${from} -> ${to}`);
  assert.ok(page.wires.some(w=>w.from===persist&&w.kind==='return'&&w.label==='committed.checks'));
});
