import test from 'node:test';
import assert from 'node:assert/strict';
import {orbitSettings,orbitPrimaryPath} from '../scripts/orbit.mjs';
test('overlap controls forward pitch independently of head speed',()=>{
  const a=orbitSettings({wallWidthMm:2,beadWidthMm:.4,overlap:.25}),b=orbitSettings({wallWidthMm:2,beadWidthMm:.4,overlap:.5});
  assert.equal(a.amplitudeMm,.8);assert.equal(b.amplitudeMm,.8);assert.ok(Math.abs(a.pitchMm-1.2)<1e-12);assert.equal(b.pitchMm,.8);
  assert.throws(()=>orbitSettings({overlap:1}));
});
test('same orbit at different head speeds; original guide and rising Z retained',()=>{
  const primary=[[0,0,.8],[10,0,1]],copy=structuredClone(primary),a=orbitPrimaryPath(primary,{speedMmS:40}),b=orbitPrimaryPath(primary,{speedMmS:20});
  assert.deepEqual(primary,copy);assert.deepEqual(a.points,b.points);
  assert.ok(a.points.every(p=>p[1]>=0&&p[1]<=1.6));
  assert.equal(b.report.durationSeconds,2*a.report.durationSeconds);
  assert.equal(a.points.at(-1)[2],1);
});
