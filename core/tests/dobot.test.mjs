import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine,checkMachinePath} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {packZip,unpackZip} from '../export/zip.mjs';
import {LuaRuntime} from '../export/dobot-lua-subset.mjs';
import {initBundle,generateBundle,loadBundle,approve,deliver,adjustBundle} from '../print/bundle.mjs';
import {syntheticDobotSetup} from './fixtures/dobot.mjs';
const release={generatorVersion:'SYNTHETIC TEST',buildDate:'2026-09-09'};
const actor='SYNTHETIC DOBOT TEST — not a real approval';
function fixture(){
  const machine=loadMachine('dobot-mg400'),plan=syntheticDobotSetup(defaults(machine));
  plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:2};plan.process.minimumLayerSeconds=0;
  plan.skills['full-fill'].mode='solid-surfaces';plan.skills['planar-infill'].enabled=true;
  return {machine,plan};
}
test('Dobot unconfigured profile is discoverable and allows geometry review, but refuses export',async()=>{
  const machine=loadMachine('dobot-mg400'),plan=defaults(machine);
  validatePlan(plan,machine);
  const dir=await mkdtemp(join(tmpdir(),'saam-dobot-unconfigured-'));
  try{
    await initBundle(dir,plan,{machineId:machine.id});
    const state=await loadBundle(dir);
    assert.equal(state.machineConfiguration.configured,false);assert.match(state.outputAvailability,/unconfigured/);
    await assert.rejects(()=>generateBundle(dir,{development:true}),/Dobot installation is unconfigured/);
    assert.equal(state.review.generation,null);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Dobot executes actual archived Lua, preserves three skill paths and reports relay estimates separately',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(bytes,exportProgram(path,plan,machine,release));
  const expected=path.actions.filter(a=>a.kind==='move');assert.equal(program.moves.length,expected.length);
  expected.forEach((m,i)=>{m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6));assert.equal(m.volumeMm3,program.moves[i].volumeMm3);});
  assert.ok(program.moves.some(m=>m.operation?.includes(':solid:')),'full-fill solid surfaces');
  assert.ok(program.moves.some(m=>/^planar-infill:\d+:fill$/.test(m.operation)),'sparse infill');
  assert.ok(program.moves.some(m=>m.phase==='draped-skin'));
  assert.notDeepEqual(program.moves[0].to,program.moves[0].controllerTo,'display is inverse-calibrated to geometry');
  assert.equal(program.summary.filamentMm,null);assert.equal(program.summary.materialModel,'relay-estimate');
  assert.ok(program.summary.estimatedRelayVolumeMm3>0);assert.notEqual(program.volumeMm3,program.summary.estimatedRelayVolumeMm3);
  assert.ok(program.moves.every(m=>m.durationSeconds>0&&m.interpolation==='rest-to-rest-linear'));
  assert.equal(checkMachinePath(path,plan,machine).configuration.configured,true);
});
test('Dobot Lua interpreter rejects missing helpers, unsupported commands, altered frames, blending and relay state',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino()),bytes=exportProgram(path,plan,machine,release);
  const change=(file,before,after)=>{const e=unpackZip(bytes);e.set(file,Buffer.from(e.get(file).toString().replace(before,after)));return packZip(e);};
  const e=unpackZip(bytes);e.delete('global.lua');assert.throws(()=>interpretProgram(packZip(e),plan,machine),/must contain exactly/);
  assert.throws(()=>interpretProgram(change('src1.lua','  MovL(','  MovJ('),plan,machine),/MovJ/);
  assert.throws(()=>interpretProgram(change('global.lua','tool=1','tool=3'),plan,machine),/tool\/user frame/);
  assert.throws(()=>interpretProgram(change('src1.lua','CP=0','CP=1'),plan,machine),/CP=0/);
  assert.throws(()=>interpretProgram(change('src1.lua','DO("DO_1",1)','DO("DO_1",0)'),plan,machine),/relay state/);
  assert.throws(()=>interpretProgram(change('src0.lua','RunPlan()','while true do end'),plan,machine),/looping without making progress/);
  assert.throws(()=>interpretProgram(change('src1.lua','  MovL(','  DO("DO_2",1)\n  MovL('),plan,machine),/Unexpected relay/);
  // Change P's arithmetic: playback must execute it, not recover geometry from intent.
  const changed=interpretProgram(change('global.lua','x*1.02+-100','x*1.02+-99'),plan,machine);
  const original=interpretProgram(bytes,plan,machine);
  assert.ok(Math.abs(changed.moves[0].to[0]-original.moves[0].to[0]-1/1.02)<1e-6);
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
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  for(const [key,value,pattern] of [['scaleX',0,/scaleX/],['relayPolicy','continuous',/relay policy/],['temperatureControl',null,/unconfigured/],['workspaceMaxMm',[0,0,1],/workspace/],['maxLinearSpeedMmS',1,/linear speed/],['initialPositionMm',[1,1,1],/initial position/]]){
    const p=structuredClone(plan);p.setup.dobot[key]=value;assert.throws(()=>exportProgram(path,p,machine,release),pattern);
  }
  const p=structuredClone(plan);p.process.retractMm=1;assert.throws(()=>exportProgram(path,p,machine,release),/Retraction/);
  const fan=structuredClone(path);fan.actions.push({kind:'fan',percent:50,phase:'test',layer:0});assert.throws(()=>exportProgram(fan,plan,machine,release),/fan control/);
});
test('Dobot relay policy keeps adjacent print moves on, turns off for travel/dwell and adds no priming wait',()=>{
  const {machine,plan}=fixture(),action=(to,volumeMm3)=>({kind:'move',to,speedMmS:10,volumeMm3,phase:'test',layer:0});
  const path={schema:'saampath/1',initialPosition:[200,180,20],actions:[
    action([190,180,20],0),action([180,180,20],0.8),action([170,180,20],0.8),
    {kind:'dwell',seconds:0.5,phase:'test',layer:0},action([160,180,20],0),action([150,180,20],0.8)
  ]};
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(program.moves.map(m=>m.extruding),[false,true,true,false,true]);
  assert.equal(program.events.filter(e=>e.kind==='extrusion-on').length,2);
  const dwells=program.events.filter(e=>e.kind==='dwell');assert.equal(dwells.length,1);assert.equal(dwells[0].seconds,0.5);
  assert.ok(program.moves.every(m=>Math.abs(m.speedMmS-10)<1e-8),'SpeedL percent accounts for calibration scaling');
  const entries=unpackZip(bytes),body=entries.get('src1.lua').toString();assert.ok(!body.includes('Wait(4000)'));
  entries.set('src1.lua',Buffer.from(body.replace('DO("DO_1",1)','DO("DO_1",1)\n  Wait(4000)')));
  assert.throws(()=>interpretProgram(packZip(entries),plan,machine),/Dwell requires relay off/);
});
test('a pause longer than one Wait command is split, not refused',()=>{
  const {machine,plan}=fixture(),action=(to,volumeMm3)=>({kind:'move',to,speedMmS:10,volumeMm3,phase:'test',layer:0});
  const program=seconds=>{
    const path={schema:'saampath/1',initialPosition:[200,180,20],actions:[
      action([190,180,20],0),{kind:'dwell',seconds,phase:'test',layer:0},action([180,180,20],0.8)]};
    const bytes=exportProgram(path,plan,machine,release);
    return {body:unpackZip(bytes).get('src1.lua').toString(),read:interpretProgram(bytes,plan,machine)};
  };
  const short=program(12);
  assert.ok(short.body.includes('Wait(12000)')&&!short.body.includes('Wait(60000)'),'a pause that fits one command is unchanged');
  const long=program(150);
  assert.deepEqual(long.body.match(/Wait\(\d+\)/g),['Wait(60000)','Wait(60000)','Wait(30000)']);
  const dwells=long.read.events.filter(e=>e.kind==='dwell');
  assert.equal(dwells.length,3);
  assert.equal(dwells.reduce((sum,e)=>sum+e.seconds,0),150);
});

test('Dobot shared lifecycle binds exact ZIP to synthetic approvals, detects helper changes and delivers unchanged',async()=>{
  const {machine,plan}=fixture(),dir=await mkdtemp(join(tmpdir(),'saam-dobot-bundle-'));
  try{
    await initBundle(dir,plan,{machineId:machine.id});let state=await loadBundle(dir);

    const checks=await generateBundle(dir);assert.ok(checks.checks.includes('strict-lua-execution'));
    assert.ok(!checks.checks.includes('temperature-state'));assert.ok(!checks.checks.includes('extrusion-flow'));
    assert.equal(checks.materialModel,'relay-estimate');
    state=await loadBundle(dir);assert.equal(state.programError,undefined);
    state=await approve(dir,{actor,revision:state.revision});
    const output=join(dir,state.review.generation.file),original=await readFile(output);
    const delivery=await deliver(dir);assert.deepEqual(await readFile(delivery),original);
    const entries=unpackZip(original);entries.set('global.lua',Buffer.from(entries.get('global.lua').toString().replace('tool=1','tool=3')));await writeFile(output,packZip(entries));
    state=await loadBundle(dir);assert.equal(state.toolpathApproved,false);assert.match(state.programError,/Generated files changed/);
    await assert.rejects(()=>deliver(dir),/exact current export/);
    await writeFile(output,original);state=await loadBundle(dir);
    await assert.rejects(()=>adjustBundle(dir,{process:{planarSpeedMmS:15}},{expectedRevision:'stale'}),/stale/);
    const revised=await adjustBundle(dir,{process:{planarSpeedMmS:15}},{expectedRevision:state.revision});assert.equal(revised.toolpathApproved,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
