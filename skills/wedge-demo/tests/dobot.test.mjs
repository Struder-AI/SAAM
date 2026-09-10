import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults} from '../scripts/model.mjs';
import {generatePath} from '../scripts/path.mjs';
import {initBundle,generateBundle,loadBundle,approve,deliver} from '../scripts/bundle.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';

test('bounded wedge preserves its native geometry and inclined strokes through Dobot Lua and delivery',async t=>{
  const machine=loadMachine('dobot-mg400'),plan=syntheticDobotSetup(defaults(machine));
  const path=generatePath(plan,machine);
  assert.deepEqual(path.initialPosition,plan.setup.dobot.initialPositionMm);
  const program=interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'SYNTHETIC TEST',buildDate:'2026-09-09'}),plan,machine);
  const moves=path.actions.filter(a=>a.kind==='move');
  assert.equal(program.moves.length,moves.length);
  assert.ok(program.moves.some(m=>m.phase==='inclined'&&m.extruding));
  moves.forEach((m,i)=>{
    m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6));
    assert.equal(m.volumeMm3,program.moves[i].volumeMm3);
  });
  const dir=await mkdtemp(join(tmpdir(),'saam-dobot-wedge-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await initBundle(dir,plan,{machineId:machine.id});
  let state=await loadBundle(dir);
  assert.equal(state.geometry.nativeFile,'model.mesh.json');
  assert.equal(state.geometry.vertices.length,8);
  await assert.rejects(deliver(dir),/approval/);
  for(const stage of ['geometry','plan'])state=await approve(dir,{stage,actor:'SYNTHETIC TEST ONLY — Dobot wedge',revision:state.revision});
  await generateBundle(dir);state=await loadBundle(dir);
  assert.equal(state.programError,undefined);
  assert.equal(state.exportName,'wedge.zip');
  state=await approve(dir,{stage:'toolpath',actor:'SYNTHETIC TEST ONLY — Dobot wedge',revision:state.revision});
  assert.deepEqual(await readFile(await deliver(dir)),await readFile(join(dir,'exports/dobot-lua/wedge.zip')));
});
