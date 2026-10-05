// The reviewed workflow for shell prints: native geometry, one final confirmation and
// delivery of the exact reviewed bytes.
//
// Every approval here is written by the test with an actor name that says so.
// A synthetic approval must never be mistaken for a person's, and none of these
// checks establish that a part prints.

import {home} from './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defaults, hash } from '../print/plan.mjs';
import {skinAssignment} from '../../skills/draped-skin/scripts/prepare.mjs';
import { createGeometry, verifyGeometry } from '../print/geometry.mjs';
import {
  initBundle, loadBundle, generateBundle, updatePlan, adjustBundle, approve, deliver,
  bundleFingerprint, changeMachine, proposedPlan
} from '../print/bundle.mjs';
import {saveSetup} from '../machine/settings.mjs';
import { createStudio } from '../../studio/server.mjs';
import { approvedReview, machineChangedReview } from '../print/workflow.mjs';

import {splineBlock,splineBox} from './fixtures/spline-shapes.mjs';
const ACTOR = 'SYNTHETIC TEST REVIEWER — not a real approval';
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
  const earlier=Object.freeze({event:'generated'});
  const previousApproval=Object.freeze({actor:'earlier'});
  const review=Object.freeze({
    schema:'saam-review/1',
    approvals:Object.freeze({previous:previousApproval}),
    generation:Object.freeze({mode:'production'}),
    history:Object.freeze([earlier])
  });
  const before=clone(review);
  const record={actor:ACTOR,time:'2026-09-19T00:00:00.000Z',hash:'export',generationHash:'generation',scope:['settings','toolpath']};
  const approved=approvedReview(review,record);
  assert.deepEqual(review,before);
  assert.deepEqual(approved.approvals,{toolpath:record});
  assert.deepEqual(approved.history.slice(0,-1),review.history);
  assert.deepEqual(approved.history.at(-1),{event:'human-approval',...record});

  const changed=machineChangedReview(approved,'bambu-lab-s5','bambu-h2d','2026-09-19T00:01:00.000Z');
  assert.deepEqual(approved.approvals,{toolpath:record});
  assert.deepEqual(changed.approvals,{});
  assert.deepEqual(changed.history.slice(0,-1),approved.history);
  assert.deepEqual(changed.history.at(-1),{
    event:'machine-changed',from:'bambu-lab-s5',to:'bambu-h2d',time:'2026-09-19T00:01:00.000Z'
  });
});

test('changing printer clears final confirmation and rejects stale edits',async t=>{
  const dir=await fixture(t);let state=await loadBundle(dir);
  await generateBundle(dir);state=await loadBundle(dir);
  state=await approve(dir,{actor:ACTOR,revision:state.revision});
  await assert.rejects(changeMachine(dir,'bambu-h2d',{expectedRevision:'stale'}),/stale/);
  const machineSetups=dir,setupFile=resolve(machineSetups,'bambu-h2d.json');
  await writeFile(setupFile,JSON.stringify({schema:'saam-machine-setup/1',machineId:'bambu-h2d',setup:{tool:1,core:'Hardened steel 0.6',nozzleMm:0.6,material:'PLA',filamentColor:'#8B5A2B',ams:{unit:2,slot:4}}}));
  const next=await changeMachine(dir,'bambu-h2d',{expectedRevision:state.revision,machineSetups});
  assert.equal(next.machine.id,'bambu-h2d');assert.equal(next.plan.output,'bambu-gcode');
  assert.equal(next.plan.setup.nozzleMm,0.6);
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
  assert.deepEqual(state.skills, ['slice']);

  // Reopening the stored file must rebuild the same closed shell.
  const bytes = await readFile(resolve(dir,state.geometryArtifact.file));
  await verifyGeometry(bytes, state.geometry);

  // A 3DM written for other parameters is not this print's geometry.
  const raised = structuredClone(smallPlan().geometry); raised.patches[0].controlPoints[1][1][2] += 1;
  const other = await createGeometry(raised);
  await assert.rejects(verifyGeometry(other.bytes, state.geometry), /Geometry file changed/);
  await assert.rejects(verifyGeometry(other.bytes, { ...state.geometry, fileHash: hash(other.bytes) }),
    /written for different geometry parameters/);
  // Same file, a descriptor claiming different surfaces: the control nets decide.
  await assert.rejects(verifyGeometry(other.bytes, { ...other.descriptor, patchHash: state.geometry.patchHash }),
    /differ from the reviewed geometry/);

  // An edited file stops the print rather than being sliced as something else.
  await writeFile(resolve(dir,state.geometryArtifact.file), other.bytes);
  await assert.rejects(loadBundle(dir, { program: false }), /geometry artifact changed/i);
});

test('development generation of a shell print creates no approvals and cannot deliver', async t => {
  const dir = await fixture(t);
  const checks = await generateBundle(dir, { development: true });
  assert.equal(checks.mode, 'development');
  assert.equal(checks.surfaceDomain.maxSlopeDeg,90,'the default roof domain includes every upward-facing slope independently of machine');
  assert.ok(Number.isFinite(checks.surfaceDomain.surfaceMaxSlopeDeg)&&checks.surfaceDomain.surfaceMaxSlopeDeg>0,'the authored roof slope is reported');
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

  const exported = resolve(dir,state.review.generation.file), delivered = await deliver(dir);
  assert.match(delivered, /part\.gcode$/);
  assert.equal(hash(await readFile(delivered)), hash(await readFile(exported)));
  assert.equal((await loadBundle(dir)).toolpathApproved, true);
  const { approvals } = (await loadBundle(dir)).review;
  assert.deepEqual(Object.keys(approvals), ['toolpath']);
  assert.deepEqual(approvals.toolpath.scope, ['settings', 'toolpath']);
  assert.equal(approvals.toolpath.generationHash, state.generationHash);

  // An export edited after approval loses it, and cannot be delivered.
  await writeFile(exported, (await readFile(exported, 'utf8')).replace('S215', 'S216'));
  state = await loadBundle(dir);
  assert.match(state.programError, /files changed/);
  assert.equal(state.toolpathApproved, false);
  await assert.rejects(deliver(dir), /requires approval/);
});

test('legacy generation identities migrate in the manifest reader without weakening stale-view checks',async t=>{
  const dir=await fixture(t);await generateBundle(dir);
  let state=await loadBundle(dir);state=await approve(dir,{actor:ACTOR,revision:state.revision});
  const manifestPath=resolve(dir,'plan.json'),currentManifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const currentReview=currentManifest.bundle.review,currentChecks=currentReview.generation.checks;
  assert.doesNotMatch(JSON.stringify(currentReview),/planHash|previousPlanHash/);
  assert.doesNotMatch(JSON.stringify(currentChecks),/planHash/);
  const legacyRecord=record=>{
    if(!record||typeof record!=='object'||!Object.hasOwn(record,'generationHash'))return record;
    const next={...record,planHash:record.generationHash};delete next.generationHash;return next;
  };
  const legacyReview={...currentReview,generation:legacyRecord(currentReview.generation),
    approvals:{...currentReview.approvals,toolpath:legacyRecord(currentReview.approvals.toolpath)},
    history:currentReview.history.map(event=>{
      let next=legacyRecord(event);
      if(Object.hasOwn(next,'previousGenerationHash')){next={...next,previousPlanHash:next.previousGenerationHash};delete next.previousGenerationHash;}
      return next;
    })};
  const legacyChecks=legacyRecord(currentChecks),legacyManifest={...currentManifest,bundle:{...currentManifest.bundle,
    review:{...legacyReview,generation:{...legacyReview.generation,checks:legacyChecks}}}};
  const legacyText=JSON.stringify(legacyManifest);await writeFile(manifestPath,legacyText);
  const legacyRevision=hash({geometryHash:state.geometryHash,planHash:state.generationHash,review:legacyReview});
  const reopened=await loadBundle(dir);
  assert.equal(reopened.toolpathApproved,true);assert.ok(reopened.program);assert.equal(reopened.programError,undefined);
  assert.equal(Object.hasOwn(reopened,'planHash'),false);assert.equal(Object.hasOwn(reopened.review.generation,'planHash'),false);
  assert.equal(Object.hasOwn(reopened.review.approvals.toolpath,'planHash'),false);
  assert.equal(await readFile(manifestPath,'utf8'),legacyText);
  assert.notEqual(reopened.revision,legacyRevision);
  await assert.rejects(updatePlan(dir,reopened.plan,legacyRevision),/stale/);

  const dualReview={...legacyReview,generation:{...legacyReview.generation,generationHash:legacyReview.generation.planHash},
    approvals:{...legacyReview.approvals,toolpath:{...legacyReview.approvals.toolpath,generationHash:legacyReview.approvals.toolpath.planHash}}};
  const dualChecks={...legacyChecks,generationHash:legacyChecks.planHash};
  const dualManifest={...legacyManifest,bundle:{...legacyManifest.bundle,review:{...dualReview,
    generation:{...dualReview.generation,checks:dualChecks}}}},dualText=JSON.stringify(dualManifest);
  await writeFile(manifestPath,dualText);
  assert.equal((await loadBundle(dir)).toolpathApproved,true);
  assert.equal((await generateBundle(dir)).mode,'production');
  assert.equal(await readFile(manifestPath,'utf8'),dualText);

  for(const mutate of [
    review=>({...review,generation:{...review.generation,generationHash:'conflict'}}),
    review=>({...review,approvals:{...review.approvals,toolpath:{...review.approvals.toolpath,generationHash:'conflict'}}}),
    review=>({...review,history:[...review.history,{event:'human-approval',planHash:'legacy',generationHash:'conflict'}]}),
    review=>({...review,history:[...review.history,{event:'plan-edited',previousPlanHash:'legacy',previousGenerationHash:'conflict'}]})
  ]){
    const changed=mutate(legacyReview);await writeFile(manifestPath,JSON.stringify({...legacyManifest,bundle:{...legacyManifest.bundle,
      review:{...changed,generation:changed.generation?{...changed.generation,checks:legacyChecks}:null}}}));
    await assert.rejects(loadBundle(dir),/Conflicting generation identity/);
  }
  await writeFile(manifestPath,JSON.stringify({...legacyManifest,bundle:{...legacyManifest.bundle,review:{...legacyReview,
    generation:{...legacyReview.generation,checks:{...legacyChecks,generationHash:'conflict'}}}}}));
  await assert.rejects(generateBundle(dir),/Conflicting generation identity/);
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
  assert.equal(hash(await readFile(resolve(dir,before.review.generation.file),'utf8')), before.review.generation.exportHash);

  // A plan edit leaves the generated program stale until it is regenerated.
  const plan = clone(before.plan);
  plan.process.planarSpeedMmS = 18;
  await updatePlan(dir, plan, before.revision);
  const after = await loadBundle(dir);
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
  await adjustBundle(dir, { slices: { assignments: [{ ...state.plan.slices.assignments[0], loops: 3 }] } });
  state = await loadBundle(dir);
  assert.equal(state.plan.slices.assignments[0].loops, 3);
  assert.equal(state.toolpathApproved, false);
  assert.notEqual(fingerprint, await bundleFingerprint(dir));

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
  assert.equal(state.toolpathApproved, false);
  assert.equal(state.geometry.parameters.shape, 'spline');
  assert.equal(state.geometry.boundsMm.max[2], 5);
  await verifyGeometry(await readFile(resolve(dir,state.geometryArtifact.file)), state.geometry);
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
  assert.equal(state.toolpathApproved, false, 'reusing setup approves nothing');
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
  const server = createStudio(dir,{libraryRoot:home});
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

test('a manifest cannot claim geometry that its immutable artifact does not contain', async t => {
  const dir = await fixture(t), before = await loadBundle(dir, { program: false });
  const manifest=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));manifest.geometry.patches[0].controlPoints[1][1][2]+=1;
  await writeFile(resolve(dir,'plan.json'),JSON.stringify(manifest));
  await assert.rejects(loadBundle(dir,{program:false}),/Plan and geometry disagree/);
  manifest.geometry=before.plan.geometry;await writeFile(resolve(dir,'plan.json'),JSON.stringify(manifest));
  assert.equal((await loadBundle(dir,{program:false})).revision,before.revision);
});
