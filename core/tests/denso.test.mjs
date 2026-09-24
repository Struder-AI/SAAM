import {createPlanningState,planningPath,planMove} from '../path/planning.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {developmentPipePlan} from '../../skills/pipe-cladding/scripts/demo.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {validateDensoConfiguration} from '../machine/denso.mjs';
import {defaults,validatePlan} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino,createGeometry,verifyGeometry} from '../print/geometry.mjs';
import {initBundle,generateBundle,loadBundle,approve,deliver,adjustBundle} from '../print/bundle.mjs';
import {exportProgram,interpretProgram,exportAndInterpretProgram} from '../export/registry.mjs';
import {interpretDensoFiles} from '../export/denso-player.mjs';
import {unpackZip} from '../export/zip.mjs';
import {bedPoint,uprightPose} from '../path/pose.mjs';
import {pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {scheduleOperations} from '../path/compose.mjs';
import {frameAtTime,displayPoint} from '../../studio/playback.mjs';
import {decodeSource,fetchSources} from '../../studio/source-player.mjs';
import {createStudio} from '../../studio/server.mjs';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
const machine=loadMachine('denso-vs068a4-rc8a'),near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const small=()=>{const p=developmentPipePlan();p.geometry.heightMm=1.2;p.skills['pipe-cladding'].shells=2;return p;};
const sources=bytes=>Object.fromEntries([...unpackZip(bytes)].filter(([name])=>name.endsWith('.pcs')).map(([name,b])=>[name,b.toString()]));

test('DENSO setup is unresolved by default; pipe geometry uses the shared native mesh lifecycle',async()=>{
  const unconfigured=defaults(machine);assert.equal(validateDensoConfiguration(unconfigured).configured,false);
  assert.throws(()=>validateDensoConfiguration(unconfigured,{required:true}),/unconfigured/);
  const plan=small();validatePlan(plan,machine);
  const native=await createGeometry(plan.geometry);await verifyGeometry(native.bytes,native.descriptor);
  assert.equal(native.descriptor.nativeFile,'model.mesh.json');
  const s5=loadMachine(),old=defaults(s5);old.geometry=plan.geometry;old.placement={xMm:100,yMm:100};old.skills['draped-skin'].enabled=false;
  const path=generatePath(old,s5,await rhino());assert.ok(interpretProgram(exportProgram(path,old,s5,{generatorVersion:'test',buildDate:'2026-09-10'}),old,s5).moves.some(m=>m.extruding));
  old.skills['pipe-cladding'].enabled=true;assert.throws(()=>validatePlan(old,s5),/orientation/);
});

test('same-height cylindrical shells retain explicit prerequisites in the existing scheduler',()=>{
  const plan=small(),result=pipeCladdingResult({plan,after:['body']}),first=result.operations[0];
  const body={...first,id:'body',layerId:'body',after:[],rank:999};
  assert.deepEqual(scheduleOperations([{operations:[...result.operations,body]}]).map(o=>o.id),['body','pipe-cladding:0','pipe-cladding:1']);
  assert.throws(()=>scheduleOperations([result]),/Unknown/);
  assert.throws(()=>scheduleOperations([{operations:[body,...result.operations]}],{order:['pipe-cladding:1','body']}),/cycle/);
  assert.ok(result.operations[0].strokes.every(s=>s.points[0][2]!==s.points.at(-1)[2]));
});

test('three-loop pipe body survives shared composition and RC8A source interpretation',async()=>{
  const plan=small();plan.geometry.outerRadiusMm=9.6;
  plan.skills['full-fill'].perimeters=0;plan.skills['full-fill'].fillOverlap=0;
  const path=generatePath(plan,machine,await rhino());
  assert.equal(path.summary.fullFill.fillRows,path.summary.fullFill.layers*3);
  assert.equal(path.summary.fullFill.perimeterLoops,0);
  const program=interpretProgram(exportProgram(path,plan,machine),plan,machine);
  const radii=new Map();
  for(const move of program.moves)if(move.extruding&&move.phase==='planar'){
    const radius=Math.hypot(move.to[0]-plan.placement.xMm,move.to[1]-plan.placement.yMm);
    const ring=[8.2,8.6,9].findIndex(r=>Math.abs(r-radius)<.015);
    assert.ok(ring>=0,'body deposition stays on one of three distinct concentric loops');
    if(!radii.has(move.layer))radii.set(move.layer,new Set());
    radii.get(move.layer).add(ring);
  }
  assert.equal(radii.size,path.summary.fullFill.layers);
  for(const rings of radii.values())assert.equal(rings.size,3);
});

test('existing mesh/spline regional skills use RC8A at fixed orientation',async()=>{
  for(const backend of ['mesh','spline']) {
    const plan=regionalStackPlan(machine,backend);plan.setup=small().setup;
    const path=generatePath(plan,machine,await rhino()),program=interpretProgram(exportProgram(path,plan,machine),plan,machine);
    for(const phase of ['planar','vase-wall','draped-skin'])assert.ok(program.moves.some(m=>m.extruding&&m.phase===phase),phase);
    assert.ok(program.moves.every(m=>m.rotaryToDeg===0&&m.toolAxisTo[2]===-1));
    near(program.volumeMm3,path.actions.reduce((sum,a)=>sum+(a.volumeMm3??0),0));
  }
});

test('oriented motion preserves pose-only actions and unsupported outputs reject rather than flatten',()=>{
  const plan=small(),initial=createPlanningState({start:[10,0,1],machine,process:plan.process,generatorVersion:'test',motion:plan.setup.denso});
  const rotated=planMove(initial,[10,0,1],10,0,{pose:{...uprightPose(),rotaryDeg:720},durationSeconds:2});
  const raised=planMove(rotated.state,[10,0,2],10,.08,{pose:{...uprightPose(),rotaryDeg:720}});
  const path=planningPath(raised.state,[rotated.actions,raised.actions]);
  assert.equal(path.actions.length,2);assert.equal(path.actions[0].pose.rotaryDeg,720);
  const s5=loadMachine(),unsupported=defaults(s5);
  assert.throws(()=>exportProgram(path,unsupported,s5),/cannot represent/);
  assert.throws(()=>exportAndInterpretProgram(path,unsupported,s5),/cannot represent/);
});

test('actual T/EX commands reconstruct fixed-room rotary deposition across multiple turns',()=>{
  const plan=small(),c=plan.setup.denso;c.initialPositionMm=[10,0,1];c.workOffsetMm=[15,-8,12];c.workYawDeg=37;c.rotarySign=-1;c.rotaryZeroDeg=20;
  const path={initialPosition:c.initialPositionMm,initialPose:c.initialPose,actions:[{kind:'move',to:[10,0,1],pose:{...uprightPose(),rotaryDeg:720},durationSeconds:4,speedMmS:10,volumeMm3:8,phase:'hoop',layer:0}]};
  const bytes=exportProgram(path,plan,machine),program=interpretProgram(bytes,plan,machine),moves=program.moves;
  near(program.seconds,4);near(program.volumeMm3,8);near(moves.at(-1).rotaryToDeg,720);near(program.summary.estimatedRelayVolumeMm3,2.56);
  let length=0;for(const m of moves){length+=Math.hypot(...m.to.map((v,i)=>v-m.from[i]));const p=bedPoint(m.to,m.rotaryToDeg,c.rotaryCenterMm);p.forEach((v,i)=>near(v,[10,0,1][i]));}
  near(length,40*Math.PI,.01);
  const at=frameAtTime(moves,1.123),room=displayPoint(at.point,at.rotaryDeg,c.rotaryCenterMm,false);room.forEach((v,i)=>near(v,[10,0,1][i]));
  assert.notDeepEqual(displayPoint(at.point,at.rotaryDeg,c.rotaryCenterMm,true),room);
  const files=sources(bytes),key=Object.keys(files).find(k=>k.startsWith('chunk'));
  const edited={...files,[key]:files[key].replace(/T\(([-\d.]+)/,(_,x)=>'T('+(Number(x)+1))};
  const changed=interpretDensoFiles(edited,plan,machine);assert.ok(Math.abs(changed.finalPosition[0]-program.finalPosition[0])>.1,'source geometry, not metadata, drives playback');
  assert.throws(()=>interpretDensoFiles({...files,[key]:files[key].replace('Move L','Move P')},plan,machine),/Unsupported/);
  assert.throws(()=>interpretDensoFiles({...files,[key]:files[key].replace('Set IO[64]','Set IO[65]')},plan,machine),/relay output/);
  assert.throws(()=>interpretDensoFiles({...files,[key]:files[key].replace(/Time=[\d.]+/,'Time=0')},plan,machine),/motion time/);
  const missing={...files};delete missing[key];assert.throws(()=>interpretDensoFiles(missing,plan,machine),/Missing/);
});

test('pipe export retains substrate, tilted axial/hoop shells and radial ownership at any sample count',async()=>{
  const plan=small(),path=generatePath(plan,machine,await rhino()),program=interpretProgram(exportProgram(path,plan,machine),plan,machine);
  const order=path.summary.composition.operationOrder;assert.deepEqual(order.slice(-2),['pipe-cladding:0','pipe-cladding:1']);
  const body=program.moves.filter(m=>m.extruding&&m.phase==='planar'),clad=program.moves.filter(m=>m.extruding&&m.phase.startsWith('cladding'));
  assert.ok(body.length&&clad.length);const boundary=plan.geometry.outerRadiusMm-2*.2;
  assert.ok(body.every(m=>Math.hypot(...m.to.slice(0,2))<=boundary+1e-6));
  for(const m of clad){near(Math.acos(-m.toolAxisTo[2])*180/Math.PI,45,.001);assert.ok(m.to[2]>=0&&m.to[2]<=plan.geometry.heightMm+1e-8);}
  // Each end index between neighboring axial tracks continues deposition.
  assert.ok(!path.actions.some(a=>a.travel==='surface-index'));assert.ok(path.summary.travel.connected>0);
  assert.equal(program.summary.shortTravel.count,0);
  // The retired maxPoints budget is an unknown field, and a sampling step far
  // finer than that former 500,000-point budget now completes.
  const stale=structuredClone(plan);stale.skills['pipe-cladding'].maxPoints=100;assert.throws(()=>validatePlan(stale,machine),/Unexpected or missing fields/);
  const dense=structuredClone(plan);dense.skills['pipe-cladding'].sampleStepMm=.0005;
  assert.ok(pipeCladdingResult({plan:dense,after:['body']}).report.points>500000);
});

test('RC8A uses the public bundle, exact browser source and cold reopen without reslicing',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-denso-'));t.after(()=>rm(dir,{recursive:true,force:true}));const plan=small();
  await initBundle(dir,plan,{machineId:machine.id});const checks=await generateBundle(dir,{development:true});assert.equal(checks.mode,'development');assert.ok(!checks.checks.includes('axis-feed'));
  const state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.deepEqual(state.review.approvals,{});await assert.rejects(()=>deliver(dir),/approv/);
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();return new Promise(done=>server.close(done));});
  const origin=`http://127.0.0.1:${server.address().port}`,fetcher=(url,...args)=>fetch(origin+url,...args),remote=await(await fetcher('/api/state')).json();
  assert.equal(remote.program.moves,undefined);
  const files=await fetchSources(remote,fetcher),decoded=decodeSource(files,remote.plan,remote.machine);
  assert.deepEqual([...decoded.moves],state.program.moves);
  for(const name of ['/core/export/denso-player.mjs','/core/path/pose.mjs','/core/machine/denso.mjs'])assert.equal((await fetcher(name)).status,200);
  const bytes=await readFile(join(dir,state.review.generation.file));
  for(const [name,source] of Object.entries(files))assert.equal(source,unpackZip(bytes).get(name).toString());
  const script=`import {loadBundle} from './core/print/bundle.mjs';const s=await loadBundle(process.argv[1]);if(s.programError)throw new Error(s.programError);console.log(s.exportHash);`;
  assert.equal(execFileSync(process.execPath,['--input-type=module','-e',script,dir],{encoding:'utf8'}).trim(),state.exportHash);
  const actor='SYNTHETIC TEST REVIEWER — no human or hardware approval';
  await generateBundle(dir);const ready=await loadBundle(dir);await approve(dir,{actor,revision:ready.revision});
  const delivered=await deliver(dir);assert.deepEqual(await readFile(delivered),bytes);
  await adjustBundle(dir,{setup:{denso:{workYawDeg:5}}},{setupFile:join(dir,'synthetic-setup.json')});const altered=await loadBundle(dir);assert.equal(altered.toolpathApproved,false);
});
