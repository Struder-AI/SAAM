import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initBundle,loadBundle,generateBundle,approve,deliver} from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'saam-final-confirmation-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  const directory=join(root,'part'),plan=defaults(loadMachine('ultimaker-s5'));
  plan.geometry=splineBox({runMm:12,widthMm:10,heightMm:2});
  await initBundle(directory,plan,{machineId:'ultimaker-s5',setupFile:join(root,'setup.json')});
  return {root,directory};
}

test('generation needs no geometry approval and only final toolpath approval enables delivery',async t=>{
  const {directory}=await fixture(t);let state=await loadBundle(directory,{program:false});
  await assert.rejects(approve(directory,{actor:'SYNTHETIC TEST',revision:state.revision}),/Generate and check/);
  const checks=await generateBundle(directory);assert.equal(checks.mode,'production');
  state=await loadBundle(directory);assert.equal(state.toolpathApproved,false);assert.deepEqual(state.review.approvals,{});
  await assert.rejects(deliver(directory),/requires approval/);
  state=await approve(directory,{actor:'SYNTHETIC TEST',revision:state.revision});
  assert.equal(state.toolpathApproved,true);assert.deepEqual(Object.keys(state.review.approvals),['toolpath']);assert.ok(await deliver(directory));
});
