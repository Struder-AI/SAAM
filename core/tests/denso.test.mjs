import {home} from './temporary-home.mjs';
import {createPlanningState,planningPath,planMove} from '../path/planning.mjs';
import {contextualActions} from '../path/action-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {loadMachine} from '../machine/profile.mjs';
import {validateDensoConfiguration} from '../machine/denso.mjs';
import {defaults,validatePlan} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {createGeometry} from '../print/geometry.mjs';
import {rhino} from '../geom/runtime.mjs';
import {initBundle,generateBundle,loadBundle,readToolpath} from '../print/bundle.mjs';
import {exportProgram} from '../export/registry.mjs';
import {prepareExportPath} from '../export/prepare-path.mjs';
import {uprightPose} from '../path/pose.mjs';
import {prepareSliceContexts} from '../print/slices.mjs';
import {prepareDepositionWork,constructDepositionWork} from '../print/slice-deposition.mjs';
import {buildShell} from '../geom/build.mjs';
import {splineTube} from './fixtures/spline-shapes.mjs';
import {scheduleOperations} from '../path/compose.mjs';
import {pathPreview,loadPathPreview} from '../../studio/path-preview.mjs';
import {createStudio} from '../../studio/server.mjs';
import {outputView} from '../../studio/refresh-plan.mjs';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
import {createChatChannel} from '../application/chat-requests.mjs';
const machine=loadMachine('denso-vs068a4-rc8a'),near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
// The pipe-cladding example recipe on a 1.2 mm tube.
const densoTube=JSON.parse(readFileSync(new URL('../../skills/pipe-cladding/examples/denso-tube.json',import.meta.url),'utf8')).plan;
const small=()=>{const p=structuredClone(densoTube);p.geometry=splineTube({columns:24,heightMm:1.2,boreRadiusMm:8,radiusAt:()=>10.4});p.slices.assignments.find(a=>a.stack?.direction==='normal').within[0].toMm=.4;return p;};
const drawn=(path,plan)=>pathPreview(prepareExportPath(path,plan,machine),{plan});

test('DENSO setup is unresolved by default; tube geometry uses the shared native spline lifecycle',async()=>{
  const unconfigured=defaults(machine);assert.equal(validateDensoConfiguration(unconfigured).configured,false);
  assert.throws(()=>validateDensoConfiguration(unconfigured,{required:true}),/unconfigured/);
  const plan=small();validatePlan(plan,machine);
  const native=await createGeometry(plan.geometry);
  assert.equal(native.descriptor.nativeFile,undefined);
  const s5=loadMachine(),old=defaults(s5);old.geometry=plan.geometry;old.placement={xMm:100,yMm:100};
  const path=await generatePath(old,s5);assert.ok(exportProgram(path,old,s5,{generatorVersion:'test',buildDate:'2026-09-10'}).report.volumeMm3>0);
  old.slices.assignments.push(structuredClone(plan.slices.assignments.find(a=>a.stack?.direction==='normal')));validatePlan(old,s5);
  const oriented=await generatePath(old,s5);assert.ok(oriented.actions.some(action=>action.pose),'derived poses survive machine-independent generation');
  assert.throws(()=>exportProgram(oriented,old,s5,{generatorVersion:'test',buildDate:'2026-09-10'}).bytes,/cannot represent non-upright orientation or rotary motion/);
});

test('same-height cylindrical shells retain explicit prerequisites in the existing scheduler',async()=>{
  // The cladding family resolves from the body's finished results; the work graph turns that source into operation prerequisites.
  const plan=small(),shell=buildShell(await rhino(),plan.geometry),completed=new Map();
  const {contexts}=prepareSliceContexts({plan,machine,shells:[[null,shell,true]],volumes:new Map()});
  for(const node of prepareDepositionWork(contexts))completed.set(node.key,{node,result:constructDepositionWork(node,completed,{plan})});
  const operations=id=>[...completed.values()].filter(({node})=>node.sourceId===id).flatMap(({result})=>result.operations);
  const body=operations('body'),clad=operations('pipe-cladding'),last=body.at(-1).id;
  assert.deepEqual(scheduleOperations([{operations:[...clad,...body]}]).map(o=>o.id).slice(-3),[last,'pipe-cladding:0:fill','pipe-cladding:1:fill']);
  assert.throws(()=>scheduleOperations([{operations:clad}]),/unknown operation body:/);
  assert.throws(()=>scheduleOperations([{operations:[...body,...clad]}],{order:['pipe-cladding:1:fill',last]}),/cycle/);
  assert.ok(clad[0].strokes.every(s=>s.points[0][2]!==s.points.at(-1)[2]));
});

test('existing mesh/spline regional skills use RC8A at fixed orientation',async()=>{
  for(const backend of ['mesh','spline']) {
    const plan=regionalStackPlan(machine,backend);plan.setup=small().setup;
    const path=await generatePath(plan,machine),program={...exportProgram(path,plan,machine).report,moves:drawn(path,plan).moves};
    for(const phase of ['planar','vase-wall'])assert.ok(program.moves.some(m=>m.extruding&&m.phase===phase),phase);
    assert.ok(program.moves.some(m=>m.extruding&&m.operation?.startsWith('roof:roof-finish:')),'roof Slice deposition survives export');
    assert.ok(program.moves.every(m=>m.rotaryToDeg===0&&m.toolAxisTo[2]===-1));
    near(program.volumeMm3,path.actions.reduce((sum,a)=>sum+(a.volumeMm3??0),0));
  }
});

test('oriented motion preserves pose-only actions and unsupported outputs reject rather than flatten',()=>{
  const plan=small(),initial=createPlanningState({start:[10,0,1],machine,process:plan.process,generatorVersion:'test',motion:plan.setup.denso});
  const rotated=planMove(initial,[10,0,1],10,0,{pose:{...uprightPose(),rotaryDeg:720},durationSeconds:2});
  const raised=planMove(rotated.state,[10,0,2],10,.08,{pose:{...uprightPose(),rotaryDeg:720}});
  const path={...planningPath(raised.state,[rotated.actions,raised.actions]),completion:{contract:'saam-neutral-motion/1'}};
  const actions=[...contextualActions(path)].map(({action})=>action);
  assert.equal(actions.length,2);assert.equal(actions[0].pose.rotaryDeg,720);
  const s5=loadMachine(),unsupported=defaults(s5);
  assert.throws(()=>exportProgram(path,unsupported,s5,{generatorVersion:'test',buildDate:'2026-09-10'}).bytes,/cannot represent non-upright orientation or rotary motion/);
});

test('rotary deposition across multiple turns reports its written timing, volume and relay estimate',()=>{
  const plan=small(),c=plan.setup.denso;c.initialPositionMm=[10,0,1];c.workOffsetMm=[15,-8,12];c.workYawDeg=37;c.rotarySign=-1;c.rotaryZeroDeg=20;
  const path={schema:'saampath/1',completion:{contract:'saam-neutral-motion/1'},initialPosition:c.initialPositionMm,initialPose:c.initialPose,actions:[{kind:'move',to:[10,0,1],pose:{...uprightPose(),rotaryDeg:720},durationSeconds:4,speedMmS:10,volumeMm3:8,phase:'hoop',layer:0}]};
  const {report}=exportProgram(path,plan,machine),moves=drawn(path,plan).moves,deposition=moves.filter(m=>m.extruding);
  near(deposition.reduce((seconds,m)=>seconds+m.durationSeconds,0),4);near(report.volumeMm3,8);near(moves.at(-1).rotaryToDeg,720);near(report.estimatedRelayVolumeMm3,2.56);
});

test('tube export retains the substrate and normal-aligned axial/hoop shells outside it',async()=>{
  const plan=small(),path=await generatePath(plan,machine),program=drawn(path,plan);
  const order=path.summary.composition.operationOrder;assert.deepEqual(order.slice(-2),['pipe-cladding:0:fill','pipe-cladding:1:fill']);
  const body=program.moves.filter(m=>m.extruding&&m.phase==='planar'),clad=program.moves.filter(m=>m.extruding&&m.operation?.startsWith('pipe-cladding:'));
  assert.ok(body.length&&clad.length);
  // The substrate stays inside the tube's exterior; cladding builds outward.
  const outside=Math.max(...body.map(m=>Math.hypot(...m.to.slice(0,2))));
  assert.ok(clad.every(m=>Math.hypot(...m.to.slice(0,2))>outside-1e-6));
  for(const m of clad){near(Math.acos(-m.toolAxisTo[2])*180/Math.PI,90,.001);assert.ok(m.to[2]>=-1e-8&&m.to[2]<=1.2+1e-8);}
  // The retired maxPoints budget is an unknown field.
  const stale=structuredClone(plan);stale.slices.assignments.find(a=>a.stack?.direction==='normal').maxPoints=100;assert.throws(()=>validatePlan(stale,machine),/unexpected maxPoints/);
});

test('RC8A uses the public bundle, the drawn prepared path and cold reopen without reslicing',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-denso-'));t.after(()=>rm(dir,{recursive:true,force:true}));const plan=small();
  await initBundle(dir,plan,{machineId:machine.id});const checks=await generateBundle(dir,{development:true});assert.equal(checks.mode,'development');
  const state=await loadBundle(dir);assert.equal(state.programError,undefined);
  const server=createStudio(dir,{libraryRoot:home,chat:createChatChannel(home,{ownerId:'studio:test'}).binding});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,fetcher=(url,...args)=>fetch(origin+url,...args),remote=outputView(await(await fetcher('/api/state')).json());
  assert.equal(remote.program.moves,state.program.moves,"the page receives the stored report, not move rows");
  const preview=await loadPathPreview(remote,{id:remote.outputId},fetcher),expected=drawn(JSON.parse(await readToolpath(state)),plan);
  assert.deepEqual(preview.moves,expected.moves);assert.ok(preview.moves.some(m=>m.rotaryToDeg!==undefined));
  for(const name of ['/core/geom/frame.mjs','/core/geom/tolerance.mjs','/studio/path-preview.mjs'])assert.equal((await fetcher(name)).status,200);
  const script=`import {loadBundle} from './core/print/bundle.mjs';const s=await loadBundle(process.argv[1]);if(s.programError)throw new Error(s.programError);console.log(s.outputId);`;
  assert.equal(execFileSync(process.execPath,['--input-type=module','-e',script,dir],{encoding:'utf8'}).trim(),state.outputId);
});
