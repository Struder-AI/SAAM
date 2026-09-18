// The reviewed workflow for shell prints: native geometry, one final confirmation and
// delivery of the exact reviewed bytes.
//
// Every approval here is written by the test with an actor name that says so.
// A synthetic approval must never be mistaken for a person's, and none of these
// checks establish that a part prints.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defaults, hash } from '../print/plan.mjs';
import { createGeometry, verifyGeometry } from '../print/geometry.mjs';
import {
  initBundle, loadBundle, generateBundle, updatePlan, adjustBundle, approve, deliver,
  rememberSetup, bundleFingerprint, EXPORT_PATH, changeMachine
} from '../print/bundle.mjs';
import { createStudio } from '../../studio/server.mjs';

const ACTOR = 'SYNTHETIC TEST REVIEWER — not a real approval';
const clone = value => structuredClone(value);

// Small enough to slice quickly, still a spline top surface with a real skin.
function smallPlan() {
  const plan = defaults();
  plan.geometry = { shape: 'spline-top', runMm: 16, widthMm: 12, cpU: 4, cpV: 4, heightsMm: [[3, 3, 3, 3], [3, 4, 4, 3], [3, 4, 4, 3], [3, 3, 3, 3]] };
  plan.process = { ...plan.process, minimumLayerSeconds: 0 };
  return plan;
}

async function fixture(t, plan = smallPlan()) {
  const dir = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-shell-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await initBundle(dir, plan);
  return dir;
}

test('changing printer clears final confirmation and rejects stale edits',async t=>{
  const dir=await fixture(t);let state=await loadBundle(dir);
  await generateBundle(dir);state=await loadBundle(dir);
  state=await approve(dir,{actor:ACTOR,revision:state.revision});
  await assert.rejects(changeMachine(dir,'bambu-h2d',{expectedRevision:'stale'}),/stale/);
  const setupFile=resolve(dir,'h2d-setup.json');
  await writeFile(setupFile,JSON.stringify({schema:'saam-machine-setup/1',machineId:'bambu-h2d',setup:{tool:1,core:'Hardened steel 0.6',nozzleMm:0.6,material:'PLA',filamentColor:'#8B5A2B',amsSlot:4}}));
  const next=await changeMachine(dir,'bambu-h2d',{expectedRevision:state.revision,setupFile});
  assert.equal(next.machine.id,'bambu-h2d');assert.equal(next.plan.output,'bambu-gcode');
  assert.equal(next.plan.setup.nozzleMm,0.6);assert.equal(next.plan.process.lineWidthMm,0.6);
  assert.equal(next.toolpathApproved,false);
  assert.deepEqual(next.plan.geometry,state.plan.geometry);
  await assert.rejects(changeMachine(dir,'missing-printer',{expectedRevision:next.revision}),/machine|Unknown/i);
  assert.equal((await loadBundle(dir,{program:false})).revision,next.revision);
});

test('a shell print stores native geometry that reopens as the same closed shell', async t => {
  const dir = await fixture(t);
  const state = await loadBundle(dir, { program: false });
  assert.equal(state.kind, 'shell');
  assert.equal(state.geometry.schema, 'saam-shell-geometry/1');
  assert.deepEqual(state.geometry.features.map(feature => feature.id), ['top', 'bottom', 'front', 'right', 'back', 'left']);
  assert.deepEqual(state.skills, ['full-fill', 'draped-skin']);

  // Reopening the stored file must rebuild the same closed shell.
  const bytes = await readFile(resolve(dir, 'geometry/model.3dm'));
  await verifyGeometry(bytes, state.geometry);

  // A 3DM written for other parameters is not this print's geometry.
  const other = await createGeometry({ ...smallPlan().geometry, runMm: 17 });
  await assert.rejects(verifyGeometry(other.bytes, state.geometry), /Geometry file changed/);
  await assert.rejects(verifyGeometry(other.bytes, { ...state.geometry, fileHash: hash(other.bytes) }),
    /written for different geometry parameters/);
  // Same file, a descriptor claiming different surfaces: the control nets decide.
  await assert.rejects(verifyGeometry(other.bytes, { ...other.descriptor, patchHash: state.geometry.patchHash }),
    /differ from the reviewed geometry/);

  // An edited file stops the print rather than being sliced as something else.
  await writeFile(resolve(dir, 'geometry/model.3dm'), other.bytes);
  await assert.rejects(loadBundle(dir, { program: false }), /Geometry file changed/);
});

test('development generation of a shell print creates no approvals and cannot deliver', async t => {
  const dir = await fixture(t);
  const checks = await generateBundle(dir, { development: true });
  assert.equal(checks.mode, 'development');
  assert.equal(checks.physicalValidation, 'not performed');
  assert.ok(checks.nonplanarLimit.machineMaxAngleDeg === 15, 'the declared machine limit is reported with the checks');
  assert.equal(checks.nonplanarLimit.effectiveMaxAngleDeg, 15, 'the default effective limit is the declared profile limit');
  const state = await loadBundle(dir);
  assert.deepEqual(state.review.approvals, {});
  assert.ok(state.program);
  assert.equal(state.toolpathApproved, false);
  await assert.rejects(deliver(dir), /requires approval/);
  const production=await generateBundle(dir);assert.equal(production.mode,'production');
  assert.deepEqual((await loadBundle(dir)).review.approvals,{});
});

test('one final confirmation, stale views, reopening and byte-identical delivery', async t => {
  const dir = await fixture(t);
  let state = await loadBundle(dir);
  await assert.rejects(approve(dir, { actor: ACTOR, revision: (await loadBundle(dir)).revision }),
    /Generate and check/);
  await generateBundle(dir);

  state = await loadBundle(dir);
  assert.ok(state.program && !state.programError);
  await approve(dir, { actor: ACTOR, revision: state.revision });

  const exported = resolve(dir, EXPORT_PATH), delivered = await deliver(dir);
  assert.match(delivered, /part\.gcode$/);
  assert.equal(hash(await readFile(delivered)), hash(await readFile(exported)));
  assert.equal((await loadBundle(dir)).toolpathApproved, true);
  const { approvals } = (await loadBundle(dir)).review;
  assert.deepEqual(Object.keys(approvals), ['toolpath']);
  assert.deepEqual(approvals.toolpath.scope, ['settings', 'toolpath']);
  assert.equal(approvals.toolpath.planHash, state.planHash);

  // An export edited after approval loses it, and cannot be delivered.
  await writeFile(exported, (await readFile(exported, 'utf8')).replace('S215', 'S216'));
  state = await loadBundle(dir);
  assert.match(state.programError, /files changed/);
  assert.equal(state.toolpathApproved, false);
  await assert.rejects(deliver(dir), /requires approval/);
});

test('reopening verifies the locked plan and detects a stale program', async t => {
  const dir = await fixture(t);
  await generateBundle(dir, { development: true });
  // Loading checks file identity and reuses only an exactly matching verified
  // program; a changed locked plan cannot reuse that result.
  const before = await loadBundle(dir);
  assert.equal(before.programError, undefined);
  await assert.rejects(readFile(resolve(dir, 'path.saampath')), {code:'ENOENT'});
  assert.equal(before.review.generation.pathHash,undefined);
  assert.equal(hash(await readFile(resolve(dir, EXPORT_PATH), 'utf8')), before.review.generation.exportHash);

  // A plan edit leaves the generated program stale until it is regenerated.
  const plan = clone(before.plan);
  plan.process.planarSpeedMmS = 18;
  await updatePlan(dir, plan, before.revision);
  const after = await loadBundle(dir);
  assert.equal(after.review.generation, null);
  assert.equal(after.program, undefined);
});

test('geometry and settings edits invalidate the approvals they affect', async t => {
  const dir = await fixture(t);
  let state = await loadBundle(dir);
  const fingerprint = await bundleFingerprint(dir);
  await generateBundle(dir);state=await loadBundle(dir);
  state=await approve(dir,{actor:ACTOR,revision:state.revision});
  assert.equal(state.toolpathApproved, true, 'the edit must invalidate an existing approval');
  const stale = state.revision;

  // A settings change drops the final plan/export approval.
  await adjustBundle(dir, { skills: { 'full-fill': { perimeters: 3 } } });
  state = await loadBundle(dir);
  assert.equal(state.plan.skills['full-fill'].perimeters, 3);
  assert.equal(state.toolpathApproved, false);
  assert.notEqual(fingerprint, await bundleFingerprint(dir));

  await assert.rejects(updatePlan(dir, state.plan, stale), /stale/);
  await assert.rejects(adjustBundle(dir, { skills: { 'full-fill': { perimeter: 3 } } }), /Unknown setting/);
  await assert.rejects(adjustBundle(dir, { process: { layerMm: 0.9 } }), /layerMm/);
  await adjustBundle(dir,{process:{primeLine:{startMm:[5,5],endMm:[20,5],zMm:.2,widthMm:.4,heightMm:.2,speedMmS:10}}});
  state=await loadBundle(dir);assert.equal(state.plan.process.primeLine.endMm[0],20);
  await adjustBundle(dir,{process:{primeLine:{passes:[
    {startMm:[5,5],endMm:[20,5],zMm:.2,widthMm:.4,heightMm:.2,speedMmS:6},
    {startMm:[20,7],endMm:[5,7],zMm:.2,widthMm:.6,heightMm:.2,speedMmS:8}
  ]}}});
  state=await loadBundle(dir);assert.equal(state.plan.process.primeLine.passes.length,2);

  // A chat request can switch shapes with different strict fields. It starts
  // from the new shape's template, keeps shared roof controls and rewrites the
  // 3DM and invalidates final review as well.
  await adjustBundle(dir, { geometry: { shape: 'spline-shell', longSideInsetMm: 1, shortSideOutsetMm: 1 } });
  state = await loadBundle(dir);
  assert.equal(state.toolpathApproved, false);
  assert.equal(state.geometry.parameters.shape, 'spline-shell');
  assert.equal(state.geometry.parameters.longSideInsetMm, 1);
  assert.equal(state.geometry.parameters.shortSideOutsetMm, 1);
  await verifyGeometry(await readFile(resolve(dir, 'geometry/model.3dm')), state.geometry);
});

test('remembered S5 setup carries into the next shell print without a firmware version', async t => {
  const dir = await fixture(t);
  const setupFile = resolve(dir, 'saved-setup.json');
  await adjustBundle(dir, { setup: { nozzleC: 205 } }, { setupFile });
  const saved = JSON.parse(await readFile(setupFile, 'utf8'));
  assert.equal(saved.schema, 'saam-machine-setup/1');
  assert.equal(saved.setup.startupVerified, false);

  const next = resolve(dir, 'next-print');
  await initBundle(next, undefined, { setupFile });
  const state = await loadBundle(next, { program: false });
  assert.equal(state.plan.setup.nozzleC, 205);
  assert.equal(state.plan.setup.firmwareVersion, '');
  assert.equal(state.toolpathApproved, false, 'reusing setup approves nothing');
  await rememberSetup(next, { setupFile });
});

test('selecting one skill still produces one program from one plan', async t => {
  const plan = smallPlan();
  plan.skills['draped-skin'].enabled = false;
  const dir = await fixture(t, plan);
  await generateBundle(dir, { development: true });
  const state = await loadBundle(dir);
  assert.deepEqual(state.skills, ['full-fill']);
  assert.ok(!state.program.moves.some(move => move.phase === 'draped-skin'), 'no skin is printed when it is not selected');
  assert.equal(state.pathSummary.nonplanarLimit, undefined);
});

test('Studio reviews a shell print and delivers it under its own export name', async t => {
  const dir = await fixture(t);
  await generateBundle(dir, { development: true });
  const server = createStudio(dir);
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
  assert.equal(await (await fetch(origin + '/api/gcode')).text(), await readFile(resolve(dir, EXPORT_PATH), 'utf8'));

  // A development preview cannot be delivered, whatever the viewer asks for.
  const blocked = await fetch(origin + '/api/deliver', { method: 'POST', headers: { Origin: origin, 'X-SAAM-Token': token }, body: '{}' });
  assert.equal(blocked.status, 400);

  // Approve through the same route a person uses, then deliver the reviewed bytes.
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { Origin: origin, 'X-SAAM-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let current = await (await fetch(origin + '/api/state')).json();
  assert.equal((await post('/api/approve', { actor: ACTOR, revision: current.revision })).status, 400, 'a development preview cannot be approved');
  assert.equal((await post('/api/generate', { development: false })).status, 200);
  current = await (await fetch(origin + '/api/state')).json();
  assert.equal((await post('/api/approve', { actor: ACTOR, revision: current.revision })).status, 200);

  const download = await post('/api/deliver', {});
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), new RegExp(encodeURIComponent(current.downloadName)));
  assert.equal(await download.text(), await readFile(resolve(dir, EXPORT_PATH), 'utf8'));
  const unauthorized=await fetch(origin+'/api/deliver',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({downloadLink:true})});
  assert.equal(unauthorized.status,403);
  const staged=await post('/api/deliver',{downloadLink:true});assert.equal(staged.status,200);
  const link=await staged.json();assert.match(link.url,/^\/api\/download\/[a-f0-9]{48}$/);
  const native=await fetch(origin+link.url),bytes=await readFile(resolve(dir,EXPORT_PATH));
  assert.equal(native.status,200);assert.match(native.headers.get('content-disposition'),/^attachment;/);
  assert.equal(native.headers.get('content-length'),String(bytes.length));
  assert.deepEqual(Buffer.from(await native.arrayBuffer()),bytes);
  assert.equal((await fetch(origin+link.url,{headers:{Origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await fetch(origin+'/api/download/not-a-issued-capability')).status,404);
  const before=await readFile(resolve(dir,'review.json'),'utf8');
  assert.equal((await fetch(origin+link.url)).status,200,'the same capability permits a direct download retry');
  assert.equal(await readFile(resolve(dir,'review.json'),'utf8'),before,'GET attachment does not mutate review or approval');
  await writeFile(resolve(dir,'delivery/part.gcode'),'changed after staging');
  const changed=await fetch(origin+link.url);assert.equal(changed.status,400);assert.match((await changed.json()).error,/staged delivery changed/);
});
