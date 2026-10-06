import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {exportProgram} from '../export/registry.mjs';
import {prepareExportPath} from '../export/prepare-path.mjs';
import {unpackZip} from '../export/zip.mjs';
import {pathPreview} from '../../studio/path-preview.mjs';
import {LuaRuntime} from '../export/dobot-lua-subset.mjs';
import {initBundle,generateBundle,loadBundle,adjustBundle} from '../print/bundle.mjs';
import {syntheticDobotSetup} from './fixtures/dobot.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';
import {skinAssignment} from '../../skills/draped-skin/scripts/prepare.mjs';
const release={generatorVersion:'SYNTHETIC TEST',buildDate:'2026-09-09'};
function fixture(){
  const machine=loadMachine('dobot-mg400'),plan=syntheticDobotSetup(defaults(machine));
  plan.geometry=splineBox({runMm:8,widthMm:8,heightMm:2});plan.process.minimumLayerSeconds=0;plan.slices.assignments.push(skinAssignment({id:'skin'}));
  return {machine,plan};
}
test('Dobot unconfigured profile is discoverable and allows geometry review, but refuses export',async()=>{
  const machine=loadMachine('dobot-mg400'),plan=defaults(machine);plan.geometry=splineBox({runMm:8,widthMm:8,heightMm:2});
  validatePlan(plan,machine);
  const dir=await mkdtemp(join(tmpdir(),'saam-dobot-unconfigured-'));
  try{
    await initBundle(dir,plan,{machineId:machine.id});
    const state=await loadBundle(dir);
    await assert.rejects(()=>generateBundle(dir,{development:true}),/Dobot installation is unconfigured/);
    assert.equal(state.review.generation,null);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Dobot export preserves three skill paths and reports relay estimates separately',async()=>{
  const {machine,plan}=fixture(),path=await generatePath(plan,machine);
  const {bytes,report}=exportProgram(path,plan,machine,release),prepared=prepareExportPath(path,plan,machine),program=pathPreview(prepared,{plan});
  assert.deepEqual(bytes,exportProgram(path,plan,machine,release).bytes);
  assert.equal(report.moves,prepared.actions.filter(a=>a.kind==='move').length);
  assert.ok(program.moves.some(m=>/^body:\d+:fill$/.test(m.operation)),'solid top and bottom layers');
  assert.ok(program.moves.some(m=>/^body:\d+:infill$/.test(m.operation)),'sparse infill');
  assert.ok(program.moves.some(m=>m.operation?.startsWith('skin:')));
  assert.equal(report.materialModel,'relay-estimate');
  assert.ok(report.estimatedRelayVolumeMm3>0);assert.notEqual(report.volumeMm3,report.estimatedRelayVolumeMm3);
  assert.ok(report.seconds>0);
});
test('the Lua reader stops a program that commands nothing, not one that keeps commanding',()=>{
  const commanded=[];
  const runtime=new LuaRuntime({host:{DO:args=>{commanded.push(args[1]);}}});
  // Far more steps than the program itself contains, but every pass commands
  // the machine, so there is no step count at which it is refused.
  runtime.load('local i=0\nwhile i<2000 do\n  DO("DO_1",i)\n  i=i+1\nend\n','loop.lua');
  assert.equal(commanded.length,2000);
  assert.equal(commanded[1999],1999);
  assert.throws(()=>new LuaRuntime({host:{}}).load('while true do end','spin.lua'),/looping without making progress/);
});

test('Dobot rejects invalid instance/unsupported process and checks calibrated workspace and feed',async()=>{
  const {machine,plan}=fixture(),path=await generatePath(plan,machine);
  for(const [key,value,pattern] of [['scaleX',0,/scaleX/],['relayPolicy','continuous',/relay policy/],['temperatureControl',null,/unconfigured/],['workspaceMaxMm',[0,0,1],/workspace/],['maxLinearSpeedMmS',1,/linear speed/]]){
    const p=structuredClone(plan);p.setup.dobot[key]=value;assert.throws(()=>exportProgram(path,p,machine,release).bytes,pattern);
  }
  const p=structuredClone(plan);p.process.retractMm=1;assert.throws(()=>exportProgram(path,p,machine,release).bytes,/cannot retract/);
  const fan=structuredClone(path);fan.actions.push({kind:'fan',percent:50,phase:'test',layer:0});assert.throws(()=>exportProgram(fan,plan,machine,release).bytes,/fan control/);
});
test('Dobot relay policy keeps adjacent print moves on, turns off for travel/dwell and adds no priming wait',()=>{
  const {machine,plan}=fixture(),action=(to,volumeMm3)=>({kind:'move',to,speedMmS:10,volumeMm3,phase:'test',layer:0});
  const path={schema:'saampath/1',completion:{contract:'saam-neutral-motion/1'},initialPosition:[200,180,20],actions:[
    action([190,180,20],0),action([180,180,20],0.8),action([170,180,20],0.8),
    {kind:'dwell',seconds:0.5,phase:'test',layer:0},action([160,180,20],0),action([150,180,20],0.8)
  ]};
  const body=unpackZip(exportProgram(path,plan,machine,release).bytes).get('src1.lua').toString();
  assert.equal(body.split('DO("DO_1",1)').length-1,2,'relay on once per adjacent print run');
  assert.deepEqual(body.match(/Wait\(\d+\)/g),['Wait(500)'],'one dwell, no priming wait');
});
test('a pause longer than one Wait command is split, not refused',()=>{
  const {machine,plan}=fixture(),action=(to,volumeMm3)=>({kind:'move',to,speedMmS:10,volumeMm3,phase:'test',layer:0});
  const program=seconds=>{
    const path={schema:'saampath/1',completion:{contract:'saam-neutral-motion/1'},initialPosition:[200,180,20],actions:[
      action([190,180,20],0),{kind:'dwell',seconds,phase:'test',layer:0},action([180,180,20],0.8)]};
    const bytes=exportProgram(path,plan,machine,release).bytes;
    return {body:unpackZip(bytes).get('src1.lua').toString()};
  };
  const short=program(12);
  assert.ok(short.body.includes('Wait(12000)')&&!short.body.includes('Wait(60000)'),'a pause that fits one command is unchanged');
  const long=program(150);
  assert.deepEqual(long.body.match(/Wait\(\d+\)/g),['Wait(60000)','Wait(60000)','Wait(30000)']);
});

test('Dobot shared lifecycle generates through the bundle and refuses a stale edit',async()=>{
  const {machine,plan}=fixture(),dir=await mkdtemp(join(tmpdir(),'saam-dobot-bundle-'));
  try{
    await initBundle(dir,plan,{machineId:machine.id});let state=await loadBundle(dir);

    const checks=await generateBundle(dir);
    assert.equal(checks.materialModel,'relay-estimate');
    state=await loadBundle(dir);assert.equal(state.programError,undefined);
    await assert.rejects(()=>adjustBundle(dir,{process:{planarSpeedMmS:15}},{expectedRevision:'stale'}),/stale/);
    await adjustBundle(dir,{process:{planarSpeedMmS:15}},{expectedRevision:state.revision});
  }finally{await rm(dir,{recursive:true,force:true});}
});
