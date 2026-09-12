import test from 'node:test';
import assert from 'node:assert/strict';
import {TOUR,setupNeeded} from '../../scripts/first-run.mjs';
import {checkSetup} from '../../scripts/setup-check.mjs';

test('first-run state repeats setup only for missing or changed dependencies',()=>{
  const marker={packageLockSha256:'same'};
  assert.equal(setupNeeded({marker:null,lockHash:'same',nodeModules:true}),true);
  assert.equal(setupNeeded({marker,lockHash:'changed',nodeModules:true}),true);
  assert.equal(setupNeeded({marker,lockHash:'same',nodeModules:false}),true);
  assert.equal(setupNeeded({marker,lockHash:'same',nodeModules:true}),false);
});

test('guided tour covers the complete maker review flow and stays optional',()=>{
  assert.equal(TOUR.length,5);
  const text=TOUR.flat().join(' ');
  for(const word of ['Describe','geometry','process','toolpath','Export'])assert.match(text,new RegExp(word,'i'));
});

test('lightweight setup check exercises the installed runtime without approvals',async()=>{
  const result=await checkSetup({log:()=>{}});
  assert.match(result.node,/^v\d+/);assert.ok(result.totalMs>=0);
  assert.deepEqual(Object.keys(result.stagesMs),['dependencies','geometry kernels','unapproved geometry and Studio']);
});
