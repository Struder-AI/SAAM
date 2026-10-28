import './temporary-home.mjs';
import {createPart} from '../application/part-execution.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {scheduled,actionsOf,writePrepared} from './fixtures/scheduled.mjs';
import {exportProgram} from '../export/registry.mjs';
import {preparePath} from '../export/registry.mjs';
import {unpackZip} from '../export/zip.mjs';
import {pathPreview} from '../../studio/path-preview.mjs';
import {LuaRuntime} from '../../machines/dobot/debug/dobot-lua-subset.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {adjustRecipe} from '../print/edit-operations.mjs';
import {generateBundle} from '../application/generation.mjs';
import {syntheticDobotSetup} from './fixtures/dobot.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';
const release={generatorVersion:'SYNTHETIC TEST',buildDate:'2026-09-09'};
function fixture(){
  const machine=loadMachine('dobot-mg400'),plan=syntheticDobotSetup(defaults(machine));
  plan.geometry=splineBox({runMm:8,widthMm:8,heightMm:2});plan.process.minimumLayerSeconds=0;
  return {machine,plan};
}
test('Dobot unconfigured profile generates and shows the SAAMpath; only the program waits',async()=>{
  const machine=loadMachine('dobot-mg400'),plan=defaults(machine);plan.geometry=splineBox({runMm:8,widthMm:8,heightMm:2});
  validatePlan(plan,machine);
  const dir=await mkdtemp(join(tmpdir(),'saam-dobot-unconfigured-'));
  try{
    await createPart(dir,plan,{machineId:machine.id});
    const result=await generateBundle(dir,{development:true});
    assert.match(result.message,/^Toolpath ready\. The .* program is not written yet: Dobot installation is unconfigured/);
    const state=await loadBundle(dir);
    assert.equal(state.artifacts.path,'current');assert.equal(state.review.generation,null);
    assert.match(state.outputAvailability,/Dobot installation is unconfigured/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Dobot export preserves solid and sparse paths and reports relay estimates separately',async()=>{
  const {machine,plan}=fixture(),path=scheduled(await generatePath(plan,machine),{machine,plan});
  const {bytes,report}=(await exportProgram(path,plan,machine,release)),prepared=(await preparePath(path,plan,machine)),program=pathPreview(prepared,{plan});
  assert.deepEqual(bytes,(await exportProgram(path,plan,machine,release)).bytes);
  assert.equal(report.moves,actionsOf(prepared).filter(a=>a.kind==='move').length);
  assert.ok(program.moves.some(m=>/^body:\d+:fill$/.test(m.operation)),'solid top and bottom layers');
  assert.ok(program.moves.some(m=>/^body:\d+:infill$/.test(m.operation)),'sparse infill');
  assert.equal(report.materialModel,'relay-estimate');
  assert.ok(report.estimatedRelayVolumeMm3>0);assert.notEqual(report.volumeMm3,report.estimatedRelayVolumeMm3);
  assert.ok(report.seconds>0);
});
test('the Lua reader stops a program that commands nothing, not one that keeps commanding',async()=>{
  const commanded=[];
  const runtime=new LuaRuntime({host:{DO:args=>{commanded.push(args[1]);}}});
  // Far more steps than the program itself contains, but every pass commands
  // the machine, so there is no step count at which it is refused.
  runtime.load('local i=0\nwhile i<2000 do\n  DO("DO_1",i)\n  i=i+1\nend\n','loop.lua');
  assert.equal(commanded.length,2000);
  assert.equal(commanded[1999],1999);
  assert.throws(()=>new LuaRuntime({host:{}}).load('while true do end','spin.lua'),/looping without making progress/);
});

test('Dobot rejects invalid command settings and adapts feed without claiming rectangular reachability',async()=>{
  const {machine,plan}=fixture(),path=scheduled(await generatePath(plan,machine),{machine,plan});
  for(const [key,value,pattern] of [['scaleX',0,/scaleX/],['relayPolicy','continuous',/relay policy/],['temperatureControl',null,/unconfigured/]]){
    const p=structuredClone(plan);p.setup.dobot[key]=value;await assert.rejects(()=>exportProgram(path,p,machine,release),pattern);
  }
  const envelope=structuredClone(plan);envelope.setup.dobot.workspaceMaxMm=[0,0,1];
  assert.ok((await exportProgram(path,envelope,machine,release)).report.seconds>0);
  const limited=structuredClone(plan);limited.setup.dobot.maxLinearSpeedMmS=1;
  assert.ok((await exportProgram(path,limited,machine,release)).report.limitations.some(text=>/representable SpeedL/.test(text)));
  // A relay has no retraction or fan: the program omits them and says so.
  // Inserted physical actions are schedule execution entries that machine preparation carries in order;
  // a retract entry withdraws the selected process's retraction distance.
  const fan=structuredClone(path),retracting=structuredClone(plan);retracting.process.retractMm=1;
  fan.schedule.execution.push({kind:'retract'},{kind:'fan',percent:50});
  assert.ok((await exportProgram(fan,retracting,machine,release)).report.limitations.some(text=>/no retraction or fan control/.test(text)));
  // Heating is external: an unstated nozzle temperature is reported, not refused.
  const cold=structuredClone(plan);cold.setup.nozzleC=0;
  assert.match((await exportProgram(path,cold,machine,release)).report.notice,/External start and heating are declared in setup/);
});
test('Dobot relay policy keeps adjacent print moves on, turns off for travel/dwell and adds no priming wait',async()=>{
  // Hand-built machine motion is a prepared path for the selected writer.
  // Bed-frame paths: no placement offset.
  const {machine,plan}=fixture();plan.placement={xMm:0,yMm:0};const action=(to,volumeMm3)=>({kind:'move',to,speedMmS:10,volumeMm3,phase:'test',layer:0});
  const path={initialPosition:[200,180,20],actions:[
    action([190,180,20],0),action([180,180,20],0.8),action([170,180,20],0.8),
    {kind:'dwell',seconds:0.5,phase:'test',layer:0},action([160,180,20],0),action([150,180,20],0.8)
  ]};
  const body=unpackZip((await writePrepared(path,plan,machine,release)).bytes).get('src1.lua').toString();
  assert.equal(body.split('DO("DO_1",1)').length-1,2,'relay on once per adjacent print run');
  assert.deepEqual(body.match(/Wait\(\d+\)/g),['Wait(500)'],'one dwell, no priming wait');
});
test('a pause longer than one Wait command is split, not refused',async()=>{
  const {machine,plan}=fixture();plan.placement={xMm:0,yMm:0};const action=(to,volumeMm3)=>({kind:'move',to,speedMmS:10,volumeMm3,phase:'test',layer:0});
  const program=async seconds=>{
    const path={initialPosition:[200,180,20],actions:[
      action([190,180,20],0),{kind:'dwell',seconds,phase:'test',layer:0},action([180,180,20],0.8)]};
    const bytes=(await writePrepared(path,plan,machine,release)).bytes;
    return {body:unpackZip(bytes).get('src1.lua').toString()};
  };
  const short=await program(12);
  assert.ok(short.body.includes('Wait(12000)')&&!short.body.includes('Wait(60000)'),'a pause that fits one command is unchanged');
  const long=await program(150);
  assert.deepEqual(long.body.match(/Wait\(\d+\)/g),['Wait(60000)','Wait(60000)','Wait(30000)']);
});

test('Dobot shared lifecycle generates through the bundle and refuses a stale edit',async()=>{
  const {machine,plan}=fixture(),dir=await mkdtemp(join(tmpdir(),'saam-dobot-bundle-'));
  try{
    await createPart(dir,plan,{machineId:machine.id});let state=await loadBundle(dir);

    const checks=await generateBundle(dir);
    assert.equal(checks.materialModel,'relay-estimate');
    state=await loadBundle(dir);assert.equal(state.programError,undefined);
    await assert.rejects(()=>adjustRecipe(dir,{process:{planarSpeedMmS:15}},{expectedRevision:'stale'}),/stale/);
    await adjustRecipe(dir,{process:{planarSpeedMmS:15}},{expectedRevision:state.revision});
  }finally{await rm(dir,{recursive:true,force:true});}
});
