import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {initBundle,loadBundle,approve,generateBundle,deliver,adjustBundle} from '../print/bundle.mjs';
import {createStudio} from '../../studio/server.mjs';

test('the complete regional stack uses native geometry, final confirmation, shared Studio and unchanged delivery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'saam-regional-workflow-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const machine=loadMachine('ultimaker-s5'),plan=regionalStackPlan(machine,'spline');
  await initBundle(directory,plan,{machineId:machine.id});
  let state=await loadBundle(directory);
  const nativeFile=join(directory,state.geometryArtifact.file),native=await readFile(nativeFile);
  assert.deepEqual(new Set(state.skills),new Set(['full-fill','vase-wall','planar-infill','draped-skin']));
  assert.doesNotMatch(state.limitations.join('\n'),/cap.*unsupported spans/,'no retired bridge-policy warning in the shared review workflow');
  await generateBundle(directory);state=await loadBundle(directory);
  assert.equal(state.programError,undefined);
  assert.equal(state.pathSummary.regions.length,5);
  assert.ok(state.program.moves.some(move=>move.phase==='vase-wall'&&move.extruding));
  assert.ok(state.program.moves.some(move=>move.phase==='draped-skin'&&move.extruding));
  state=await loadBundle(directory);const bytes=await readFile(join(directory,state.review.generation.file));
  await assert.rejects(()=>deliver(directory),/approval/);
  state=await approve(directory,{actor:'SYNTHETIC REGIONAL SOFTWARE TEST ONLY',revision:state.revision});
  assert.deepEqual(await readFile(await deliver(directory)),bytes);
  assert.deepEqual(await readFile(nativeFile),native);

  const server=createStudio(directory,{libraryRoot:directory});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const reviewed=await(await fetch(origin+'/api/state')).json();
  assert.equal(reviewed.toolpathApproved,true);
  assert.deepEqual(reviewed.plan.composition.regions,plan.composition.regions);
  assert.equal((await fetch(origin+'/settings.mjs')).status,200);

  const regions=structuredClone(plan.composition.regions);regions.find(r=>r.id==='cap').skills['full-fill'].fillAnglesDeg=[0,90];
  await adjustBundle(directory,{composition:{regions}},{expectedRevision:state.revision});
  state=await loadBundle(directory);
  assert.equal(state.toolpathApproved,false);
  assert.deepEqual(await readFile(join(directory,'delivery/part.gcode')),bytes);
});
