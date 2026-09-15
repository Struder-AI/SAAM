import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../scripts/model.mjs';
import {generatePath} from '../scripts/path.mjs';
import {initBundle,generateBundle,loadBundle,approve,deliver,upgradeBundle} from '../scripts/bundle.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';

test('bounded wedge runs on both H2D nozzles through the shared exporter',()=>{
  const machine=loadMachine('bambu-h2d');
  for(const tool of [0,1]){
    const plan=defaults(machine);plan.setup.tool=tool;
    assert.equal(plan.process.startupRetracted,false);assert.equal(plan.process.retractMm,0.8);
    const path=generatePath(plan,machine);checkMachinePath(path,plan,machine);
    const bytes=exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'});
    const program=interpretProgram(bytes,plan,machine),moves=path.actions.filter(a=>a.kind==='move');
    assert.equal(program.moves.length,moves.length);
    assert.ok(program.moves.some(m=>m.phase==='inclined'&&m.extruding));
    assert.equal(program.events.some(e=>e.kind==='startup-recover'),false);
    moves.forEach((m,i)=>{m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6));assert.ok(Math.abs(m.volumeMm3-program.moves[i].volumeMm3)<1e-4);});
    plan.process.startupRetracted=true;assert.throws(()=>validatePlan(plan,machine),/unretracted/);plan.process.startupRetracted=false;
    plan.process.retractMm=6.5;assert.throws(()=>validatePlan(plan,machine),/Retraction/);plan.process.retractMm=.8;
    if(tool===1){plan.placement.xMm=5;assert.throws(()=>validatePlan(plan,machine),/Placement X/);}
  }
});

test('H2D wedge keeps two confirmations and exact archive delivery, including upgrade',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-h2d-wedge-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  await initBundle(dir,plan,{machineId:machine.id});await generateBundle(dir,{development:true});
  let state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.equal(state.exportName,'wedge.gcode.3mf');
  assert.deepEqual(state.review.approvals,{});await assert.rejects(deliver(dir),/approval/);
  for(const stage of ['geometry'])state=await approve(dir,{stage,actor:'SYNTHETIC TEST H2D wedge',revision:state.revision});
  await generateBundle(dir);state=await loadBundle(dir);
  state=await approve(dir,{stage:'toolpath',actor:'SYNTHETIC TEST H2D wedge',revision:state.revision});
  const bytes=await readFile(join(dir,'exports/bambu-gcode/wedge.gcode.3mf'));
  assert.deepEqual(await readFile(await deliver(dir)),bytes);
  assert.equal((await loadBundle(dir)).toolpathApproved,true);
  await upgradeBundle(dir);state=await loadBundle(dir);
  assert.equal(state.plan.setup.materialGuid,null);assert.equal(state.plan.setup.buildVolumeC,0);
  assert.equal(state.geometryApproved,true);assert.equal(state.planApproved,false);
  assert.deepEqual(await readFile(join(dir,'delivery/wedge.gcode.3mf')),bytes);
});
