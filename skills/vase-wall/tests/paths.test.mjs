import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {loopDemoPlan} from '../scripts/loop-demo.mjs';

const wall=path=>path.actions.filter(a=>a.role==='vase-wall'||a.role==='segmented-path');

test('wide inward and outward loops map continuously across wavy mesh triangle seams',async()=>{
  const plan=loopDemoPlan({courses:36,loopsPerTurn:20,samplesPerLoop:64,
    exterior:'both-scalloped',tileWidthMm:8,tileDepthMm:4.8,waveDepthMm:.6});
  // Keep the full host's curvature but cover only the first six courses,
  // including the formerly unstable section near Z 1.234797974 mm.
  plan.skills['vase-wall'].pattern.repeats=6;
  const path=generatePath(plan,loadMachine(),await rhino()),moves=wall(path);
  assert.equal(path.summary.vaseWall.paths,6);
  const radii=moves.map(m=>Math.hypot(m.to[0]-125,m.to[1]-105));
  assert.ok(Math.min(...radii)<11,'pattern extends inward from the wavy guide');
  assert.ok(Math.max(...radii)>16,'pattern extends outward from the wavy guide');
  assert.ok(path.actions.slice(path.actions.indexOf(moves[0]),path.actions.indexOf(moves.at(-1))+1).every(a=>a.kind==='move'&&a.volumeMm3>0));
});
