import './temporary-home.mjs';
import {createPart} from '../application/part-execution.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {adjustRecipe} from '../print/edit-operations.mjs';
import {readDrawnPath} from '../../studio/drawn-path.mjs';
import {recipeSkills} from '../print/summary.mjs';
import {exportReviewed} from '../export/reviewed-export.mjs';
// Export returns an owned artifact; the test reads its bytes and releases it.
const exportedBytes=async(state,run=action=>action())=>{const {artifact}=await run(()=>exportReviewed(state));try{return await artifact.materialize();}finally{await artifact.release();}};
import {generateBundle} from '../application/generation.mjs';
import {pathPreview} from '../../studio/path-preview.mjs';
import {createStudio} from '../../studio/server.mjs';
import {createChatChannel} from '../application/chat-requests.mjs';

test('the complete regional stack uses native geometry, final confirmation, shared Studio and unchanged delivery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'saam-regional-workflow-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const machine=loadMachine('ultimaker-s5'),plan=regionalStackPlan(machine,'spline');
  await createPart(directory,plan,{machineId:machine.id});
  let state=await loadBundle(directory);
  const nativeFile=join(directory,state.geometryArtifact.file),native=await readFile(nativeFile);
  assert.deepEqual(new Set(recipeSkills(state.plan)),new Set(['slice','trace']));
  assert.doesNotMatch(state.limitations.join('\n'),/cap.*unsupported spans/,'no retired bridge-policy warning in the shared review workflow');
  await generateBundle(directory);state=await loadBundle(directory);
  assert.equal(state.programError,undefined);
  assert.equal(state.pathSummary.vaseWall.instances.length,1);
  assert.deepEqual(state.pathSummary.slices.instances.filter(i=>i.layers&&!i.referenceStackKind&&!i.construction).map(i=>i.owner),['base','cap','roof-body','upper']);
  const {moves}=pathPreview(JSON.parse(await readDrawnPath(state)),{plan:state.plan});
  assert.ok(moves.some(move=>move.phase==='vase-wall'&&move.extruding));
  state=await loadBundle(directory,{program:true});const bytes=await exportedBytes(state);assert.match(bytes.toString(),/G1/);
  assert.deepEqual(await exportedBytes(state),bytes);
  assert.deepEqual(await readFile(nativeFile),native);

  const server=createStudio(directory,{libraryRoot:directory,chat:createChatChannel(directory,{ownerId:'studio:test'}).binding});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const reviewed=await(await fetch(origin+'/api/state')).json();
  assert.deepEqual(reviewed.plan.slices.assignments,plan.slices.assignments);
  assert.equal((await fetch(origin+'/settings.mjs')).status,200);

  const assignments=structuredClone(plan.slices.assignments);assignments.find(a=>a.id==='cap').fillAnglesDeg=[0,90];
  // The open Studio owns edits to its print; delivery recorded itself, so the edit names the current revision.
  state=await loadBundle(directory);await server.runBundleEdit(directory,()=>adjustRecipe(directory,{slices:{assignments}},{expectedRevision:state.revision}));
  state=await loadBundle(directory);
  assert.equal(state.artifacts.program,'stale');
  assert.deepEqual(await exportedBytes(state,action=>server.runBundleEdit(directory,action)),bytes);
});
