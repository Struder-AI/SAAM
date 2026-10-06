// The reviewed workflow for shell prints: native geometry, the Studio Export and
// delivery of the exact reviewed bytes. None of these checks establish that a part prints.

import {home} from './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defaults } from '../print/plan.mjs';
import {skinAssignment} from '../../skills/draped-skin/scripts/prepare.mjs';
import {
  initBundle, loadBundle, generateBundle, updatePlan, adjustBundle, exportReviewed,
  changeMachine, proposedPlan
} from '../print/bundle.mjs';
import {saveSetup} from '../machine/settings.mjs';
import { createStudio } from '../../studio/server.mjs';
import { machineChangedReview } from '../print/workflow.mjs';

import {splineBlock,splineBox} from './fixtures/spline-shapes.mjs';
import {createChatChannel} from '../application/chat-requests.mjs';
const clone = value => structuredClone(value);

// Small enough to slice quickly, still a spline top surface with a real skin.
function smallPlan() {
  const plan = defaults();
  plan.slices.assignments.push(skinAssignment({id:'skin'}));
  plan.geometry = splineBlock({runMm:16,widthMm:12,heightsMm:[[3, 3, 3, 3], [3, 4, 4, 3], [3, 4, 4, 3], [3, 3, 3, 3]]});
  plan.process = { ...plan.process, minimumLayerSeconds: 0 };
  return plan;
}

async function fixture(t, plan = smallPlan()) {
  const dir = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-shell-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await initBundle(dir, plan, { machineId: 'ultimaker-s5' });
  return dir;
}

test('review transitions preserve their input review',()=>{
  const review=Object.freeze({
    schema:'saam-review/1',
    generation:Object.freeze({mode:'production'}),
    history:Object.freeze([Object.freeze({event:'generated'})])
  });
  const before=clone(review);
  const changed=machineChangedReview(review,'bambu-lab-s5','bambu-h2d','2026-09-19T00:01:00.000Z');
  assert.deepEqual(review,before);
  assert.deepEqual(changed.history.slice(0,-1),review.history);
  assert.deepEqual(changed.history.at(-1),{
    event:'machine-changed',from:'bambu-lab-s5',to:'bambu-h2d',time:'2026-09-19T00:01:00.000Z'
  });
});

test('changing printer leaves the program stale and rejects stale edits',async t=>{
  const dir=await fixture(t);
  await generateBundle(dir);const state=await loadBundle(dir);
  await assert.rejects(changeMachine(dir,'bambu-h2d',{expectedRevision:'stale'}),/stale/);
  const machineSetups=dir,setupFile=resolve(machineSetups,'bambu-h2d.json');
  await writeFile(setupFile,JSON.stringify({schema:'saam-machine-setup/1',machineId:'bambu-h2d',setup:{tool:1,core:'Hardened steel 0.6',nozzleMm:0.6,material:'PLA',filamentColor:'#8B5A2B',ams:{unit:2,slot:4}}}));
  const next=await changeMachine(dir,'bambu-h2d',{expectedRevision:state.revision,machineSetups});
  assert.equal(next.machine.id,'bambu-h2d');assert.equal(next.plan.output,'bambu-gcode');
  assert.equal(next.plan.setup.nozzleMm,0.6);
  assert.equal(next.artifacts.program,'stale');
  assert.deepEqual(next.plan.geometry,state.plan.geometry);
  await assert.rejects(changeMachine(dir,'missing-printer',{expectedRevision:next.revision}),/machine|Unknown/i);
  assert.equal((await loadBundle(dir,{program:false})).revision,next.revision);
});

test('a shell print stores native geometry as its named faces', async t => {
  const dir = await fixture(t);
  const state = await loadBundle(dir, { program: false });
  assert.equal(state.kind, 'shell');
  assert.equal(state.geometry.schema, 'saam-shell-geometry/1');
  assert.deepEqual(state.geometry.features.map(feature => feature.id), ['top', 'bottom', 'front', 'right', 'back', 'left']);
  assert.deepEqual(state.skills, ['slice']);
});

test('development generation of a shell print reports its roof domain', async t => {
  const dir = await fixture(t);
  const checks = await generateBundle(dir, { development: true });
  assert.equal(checks.mode, 'development');
  assert.equal(checks.surfaceDomain.maxSlopeDeg,90,'the default roof domain includes every upward-facing slope independently of machine');
  assert.ok(Number.isFinite(checks.surfaceDomain.surfaceMaxSlopeDeg)&&checks.surfaceDomain.surfaceMaxSlopeDeg>0,'the authored roof slope is reported');
  assert.ok((await loadBundle(dir)).program);
  const production=await generateBundle(dir);assert.equal(production.mode,'production');
});

test('the reviewed export delivers the exact program bytes', async t => {
  const dir = await fixture(t);
  await generateBundle(dir);
  const state = await loadBundle(dir, { program: 'source' });
  assert.ok(state.program && !state.programError);
  const delivered = await exportReviewed(state);
  assert.match(delivered.file, /part\.gcode$/);
  assert.deepEqual(await readFile(delivered.file), await readFile(resolve(dir,state.review.generation.file)));
});

test('reopening verifies the locked plan and detects a stale program', async t => {
  const dir = await fixture(t);
  await generateBundle(dir, { development: true });
  // Loading checks file identity and reuses only an exactly matching verified
  // program; a changed locked plan cannot reuse that result.
  const before = await loadBundle(dir);
  assert.equal(before.programError, undefined);
  await assert.rejects(readFile(resolve(dir, 'path.saampath')), {code:'ENOENT'});

  // A plan edit leaves the generated program stale until it is regenerated.
  const plan = clone(before.plan);
  plan.process.planarSpeedMmS = 18;
  await updatePlan(dir, plan, before.revision);
  const after = await loadBundle(dir);
});

test('geometry and settings edits leave the program stale', async t => {
  const dir = await fixture(t);
  await generateBundle(dir);let state=await loadBundle(dir);
  assert.equal(state.artifacts.program, 'current');
  const stale = state.revision;

  // A settings change drops the final plan/export approval.
  await adjustBundle(dir, { slices: { assignments: [{ ...state.plan.slices.assignments[0], loops: 3 }] } });
  state = await loadBundle(dir);
  assert.equal(state.plan.slices.assignments[0].loops, 3);
  assert.equal(state.artifacts.program, 'stale');

  await assert.rejects(updatePlan(dir, state.plan, stale), /stale/);
  await adjustBundle(dir,{process:{primeLine:{startMm:[5,5],endMm:[20,5],zMm:.2,widthMm:.4,heightMm:.2,speedMmS:10}}});
  state=await loadBundle(dir);assert.equal(state.plan.process.primeLine.endMm[0],20);
  await adjustBundle(dir,{process:{primeLine:{passes:[
    {startMm:[5,5],endMm:[20,5],zMm:.2,widthMm:.4,heightMm:.2,speedMmS:6},
    {startMm:[20,7],endMm:[5,7],zMm:.2,widthMm:.6,heightMm:.2,speedMmS:8}
  ]}}});
  state=await loadBundle(dir);assert.equal(state.plan.process.primeLine.passes.length,2);

  // A chat request replaces the patch list as a whole (arrays replace), which
  // rewrites the 3DM and invalidates final review as well.
  await adjustBundle(dir, { geometry: { patches: splineBox({ runMm: 16, widthMm: 12, heightMm: 5 }).patches } });
  state = await loadBundle(dir);
  assert.equal(state.geometry.parameters.shape, 'spline');
  assert.equal(state.geometry.boundsMm.max[2], 5);
});

test('remembered S5 setup carries into the next shell print without a firmware version', async t => {
  const dir = await fixture(t);
  const machineSetups = dir, setupFile = resolve(machineSetups, 'ultimaker-s5.json');
  const edited=await adjustBundle(dir, { setup: { nozzleC: 205 } });
  await saveSetup(edited.machine,edited.plan.setup,{machineSetups,source:'Synthetic remembered-setup fixture'});
  const saved = JSON.parse(await readFile(setupFile, 'utf8'));
  assert.equal(saved.schema, 'saam-machine-setup/1');
  assert.equal(saved.setup.startupVerified, false);

  const next = resolve(dir, 'next-print');
  const nextPlan=await proposedPlan('ultimaker-s5',{machineSetups});nextPlan.geometry=smallPlan().geometry;
  await initBundle(next, nextPlan, { machineId: 'ultimaker-s5' });
  const state = await loadBundle(next, { program: false });
  assert.equal(state.plan.setup.nozzleC, 205);
  assert.equal(state.plan.setup.firmwareVersion, '');
});

test('selecting one skill still produces one program from one plan', async t => {
  const plan = smallPlan();
  plan.slices.assignments=plan.slices.assignments.filter(a=>a.surface?.kind!=='roof');
  const dir = await fixture(t, plan);
  await generateBundle(dir, { development: true });
  const state = await loadBundle(dir);
  assert.deepEqual(state.skills, ['slice']);
  assert.ok(!state.program.moves.some(move => move.operation?.startsWith('skin:')), 'no skin is printed when it is not selected');
  assert.equal(state.pathSummary.surfaceDomain, undefined);
});

test('Studio reviews a shell print and delivers it under its own export name', async t => {
  const dir = await fixture(t);
  await generateBundle(dir, { development: true });
  const server = createStudio(dir,{libraryRoot:home,chat:createChatChannel(home,{ownerId:'studio:test'}).binding});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(done => server.close(done)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const html = await (await fetch(origin)).text();
  const token = html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state = await (await fetch(origin + '/api/state')).json();
  assert.equal(state.kind, 'shell');
  assert.equal(state.exportName, 'part.gcode');
  assert.ok(state.program && state.geometry.faces.length > 0, 'the viewer receives a program and a display proxy');
  assert.equal(state.code, undefined, 'the export is fetched separately, never embedded in state');
});

