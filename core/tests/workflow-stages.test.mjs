import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBundleWorkflow,programCacheEntry} from '../print/workflow.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

test('program cache projection preserves frozen producer output without copying motion history',()=>{
  const moves=Object.freeze([Object.freeze({to:Object.freeze([1,2,3])})]),events=Object.freeze([]);
  const sources=Object.freeze({'main.gcode':'G1 X1\n'});
  const program=Object.freeze({code:'G1 X1\n',sources,moves,events,seconds:1,summary:Object.freeze({moves:1})});
  const entry=programCacheEntry('identity',program,Buffer.from('unused fallback'));
  assert.equal(program.code,'G1 X1\n');assert.equal(program.sources,sources);
  assert.equal(entry.program.moves,moves);assert.equal(entry.program.events,events);
  assert.equal(entry.program.code,undefined);assert.equal(entry.program.sources,undefined);
  assert.equal(entry.metadata.moves,undefined);assert.equal(entry.metadata.events,undefined);
  assert.equal(entry.metadata.sources[0].name,'main.gcode');
  assert.match(entry.metadata.sources[0].sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(programCacheEntry('identity',program,Buffer.from('unused fallback')),entry);
});

test('bundle stages reuse semantic validation while reading current bytes and isolate returned plans',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'saam-workflow-stages-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const counts={plan:0,geometry:0};
  const api=createBundleWorkflow({kind:'test',defaults,version:'test',buildDate:'2026-09-19',exportName:'part.gcode',
    machineFile:'machines/ultimaker-s5.json',limitations:()=>[],
    validatePlan:plan=>{counts.plan++;if(plan.rejected)throw Error('Rejected fixture plan');return plan;},
    createGeometry:async parameters=>({bytes:Buffer.from(JSON.stringify(parameters)),descriptor:{nativeFile:'model.mesh.json',parameters}}),
    verifyGeometry:async(bytes,descriptor)=>{counts.geometry++;assert.deepEqual(JSON.parse(bytes),descriptor.parameters);},
    generatePath:()=>{throw Error('Loading must not generate');}});
  await api.initBundle(directory,defaults(loadMachine()));
  const first=await api.loadBundle(directory,{program:false});
  assert.deepEqual(counts,{plan:2,geometry:1});
  first.plan.placement.xMm=-999;
  const cached=await api.loadBundle(directory,{program:false});
  assert.notEqual(cached.plan.placement.xMm,-999);assert.equal(cached.generationHash,first.generationHash);
  assert.deepEqual(counts,{plan:2,geometry:1});
  const file=join(directory,'plan.json'),plan=JSON.parse(await readFile(file,'utf8'));
  await writeFile(file,JSON.stringify(plan));
  assert.equal((await api.loadBundle(directory,{program:false})).generationHash,first.generationHash);
  assert.deepEqual(counts,{plan:2,geometry:1},'formatting alone preserves semantic validation');
  await writeFile(file,JSON.stringify({...plan,rejected:true}));
  await assert.rejects(()=>api.loadBundle(directory,{program:false}),/Rejected fixture plan/);
  await writeFile(file,JSON.stringify(plan));
  assert.equal((await api.loadBundle(directory,{program:false})).generationHash,first.generationHash);
  assert.deepEqual(counts,{plan:3,geometry:1},'a failed plan does not discard successful geometry checks');
});
