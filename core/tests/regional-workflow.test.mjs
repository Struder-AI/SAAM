import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {initBundle,loadBundle,approve,generateBundle,deliver,adjustBundle} from '../print/bundle.mjs';
import {createStudio} from '../../studio/server.mjs';
import {createChatChannel} from '../application/chat-requests.mjs';

test('the complete regional stack uses native geometry, final confirmation, shared Studio and unchanged delivery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'saam-regional-workflow-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const machine=loadMachine('ultimaker-s5'),plan=regionalStackPlan(machine,'spline');
  await initBundle(directory,plan,{machineId:machine.id});
  let state=await loadBundle(directory);
  const nativeFile=join(directory,state.geometryArtifact.file),native=await readFile(nativeFile);
  assert.deepEqual(new Set(state.skills),new Set(['slice','trace']));
  assert.doesNotMatch(state.limitations.join('\n'),/cap.*unsupported spans/,'no retired bridge-policy warning in the shared review workflow');
  await generateBundle(directory);state=await loadBundle(directory);
  assert.equal(state.programError,undefined);
  assert.equal(state.pathSummary.vaseWall.instances.length+state.pathSummary.referenceFamilies.roof.length,2);
  assert.deepEqual(state.pathSummary.slices.instances.filter(i=>i.layers&&!i.referenceFamily&&!i.construction).map(i=>i.owner),['base','cap','roof-body','upper']);
  assert.ok(state.program.moves.some(move=>move.phase==='vase-wall'&&move.extruding));
  assert.ok(state.program.moves.some(move=>move.operation?.startsWith('roof:roof-finish:')&&move.extruding));
  state=await loadBundle(directory);const bytes=await readFile(join(directory,state.review.generation.file));
  await assert.rejects(()=>deliver(directory),/approval/);
  state=await approve(directory,{actor:'SYNTHETIC REGIONAL SOFTWARE TEST ONLY',revision:state.revision});
  assert.deepEqual(await readFile(await deliver(directory)),bytes);
  assert.deepEqual(await readFile(nativeFile),native);

  const server=createStudio(directory,{libraryRoot:directory,chat:createChatChannel(directory,{ownerId:'studio:test'}).binding});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const reviewed=await(await fetch(origin+'/api/state')).json();
  assert.equal(reviewed.toolpathApproved,true);
  assert.deepEqual(reviewed.plan.slices.assignments,plan.slices.assignments);
  assert.equal((await fetch(origin+'/settings.mjs')).status,200);

  const assignments=structuredClone(plan.slices.assignments);assignments.find(a=>a.id==='cap').fillAnglesDeg=[0,90];
  // The open Studio owns edits to its print; delivery recorded itself, so the edit names the current revision.
  state=await loadBundle(directory);await server.runBundleEdit(directory,()=>adjustBundle(directory,{slices:{assignments}},{expectedRevision:state.revision}));
  state=await loadBundle(directory);
  assert.equal(state.toolpathApproved,false);
  assert.deepEqual(await readFile(join(directory,'delivery/part.gcode')),bytes);
});
