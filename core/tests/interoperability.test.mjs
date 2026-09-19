import {createPlanningState,planningPath,planTravel,travelClearance} from '../path/planning.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine,checkMachinePath} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {planComposition} from '../path/compose.mjs';
import {combSegment} from '../path/comb.mjs';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initBundle,loadBundle,rememberSetup,generateBundle} from '../print/bundle.mjs';
import {createStudio} from '../../studio/server.mjs';

test('S5 and H2D speed defaults are shared by shell plans',()=>{
  for(const id of ['ultimaker-s5','bambu-h2d']){
    const machine=loadMachine(id);
    const plan=defaults(machine);validatePlan(plan,machine);
    for(const [key,value] of Object.entries({planarSpeedMmS:40,skinSpeedMmS:20,firstLayerSpeedMmS:24,travelSpeedMmS:120,zSpeedMmS:10}))assert.equal(plan.process[key],value,`${id} ${key}`);
    assert.equal(plan.process.maxFlowMm3S,4);
  }
  assert.equal(defaults(loadMachine('dobot-mg400')).process.planarSpeedMmS,20);
});

test('machine validation respects selected tool, filament, material and skill capabilities',async()=>{
  const s5=loadMachine(),h2d=loadMachine('bambu-h2d'),plan=defaults(h2d);
  assert.throws(()=>validatePlan(defaults(s5),h2d),/Nozzle|Filament|missing fields in plan.setup/);
  const flatOnly=structuredClone(h2d);flatOnly.capabilities=['xyz-extrusion','planar'];
  assert.throws(()=>validatePlan(plan,flatOnly),/nonplanar/);
  plan.skills['draped-skin'].enabled=false;validatePlan(plan,flatOnly);
  plan.setup.material='unknown';assert.throws(()=>validatePlan(plan,h2d),/Material/);plan.setup.material='PLA';
  plan.geometry={shape:'box',runMm:12,widthMm:10,heightMm:2};plan.setup.tool=1;plan.placement.xMm=5;
  assert.throws(()=>generatePath(plan,h2d,{}),/Placement X/);
  assert.throws(()=>checkMachinePath({initialPosition:[0,0,20],actions:[]},plan,h2d),/tool bounds/);
});
test('hops and cooling use deposited height without anticipating later tall operations',()=>{
  const machine=loadMachine(),plan=defaults();plan.process.minimumLayerSeconds=60;
  const initial=createPlanningState({start:[10,10,25],machine,process:plan.process,generatorVersion:'test'});
  const op=(id,z)=>({id,rank:z,layerId:id,layer:0,phase:'test',after:[],travelPolicy:{clearanceFor:()=>z+2,maxCombMm:0},strokes:[{points:[[20,20,z],[22,20,z]],speedMmS:10,beadAreaMm2:0.08,role:'fill'}]});
  const result=planComposition(initial,[{operations:[op('low',1),op('later-high',18)]}]);
  const {actions}=planningPath(result.state,[result.actions]);
  assert.equal(travelClearance(result.state),19);
  const firstTraverse=actions.find(a=>a.kind==='move'&&a.to[0]===20&&a.to[1]===20);
  assert.equal(firstTraverse.to[2],25);
  const firstDwell=actions.findIndex(a=>a.kind==='dwell');assert.equal(actions[firstDwell-1].to[2],2);
  const tooHigh=createPlanningState({start:[10,10,20],machine,process:plan.process,generatorVersion:'test'});
  assert.throws(()=>planComposition(tooHigh,[{operations:[op('high',300)]}]),/clearance exceeds/);
});
test('combing routes around a hole and falls back when the route exceeds the locked limit',()=>{
  const machine=loadMachine(),plan=defaults();plan.process.minimumLayerSeconds=0;
  const region=[[[0,0],[20,0],[20,20],[0,20]],[[8,8],[8,12],[12,12],[12,8]]];
  const policy=planarPolicy(region,{layerZ:1,liftMm:2,maxCombMm:30,lineWidthMm:0.4});
  const initial=createPlanningState({start:[5,10,1],machine,process:plan.process,generatorVersion:'test'});
  const traveled=planTravel(initial,[15,10,1],policy);
  const {actions}=planningPath(traveled.state,[traveled.actions]);
  assert.equal(traveled.travelKind,'combed');
  let from=[5,10,1];
  for(const move of actions){assert.equal(move.to[2],1);assert.ok(combSegment(from,move.to,policy));from=move.to;}
  assert.ok(actions.length>=3);assert.equal(traveled.state.stats.retractions,0);
  policy.maxCombMm=10;const short=createPlanningState({start:[5,10,1],machine,process:plan.process,generatorVersion:'test'});
  const hopped=planTravel({...short,depositedMaxZ:19},[15,10,1],policy);
  assert.equal(hopped.travelKind,'hopped');assert.ok(planningPath(hopped.state,[hopped.actions]).actions.some(a=>a.to?.[2]===20));
});
test('H2D setup and development output use the shared bundle without creating approvals',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-h2d-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  const setupFile=join(root,'h2d-setup.json'),dir=join(root,'print'),machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  plan.geometry={shape:'box',runMm:12,widthMm:10,heightMm:2};plan.process.minimumLayerSeconds=0;
  await initBundle(dir,plan,{machineId:machine.id});await rememberSetup(dir,{setupFile});
  const state=await loadBundle(dir);assert.equal(state.machine.id,'bambu-h2d');assert.equal(state.plan.setup.tool,0);
  assert.equal(generatePath(state.plan,state.machine,await rhino()).summary.nonplanarLimit.experimentalOverride,true);
  await generateBundle(dir,{development:true});
  const generated=await loadBundle(dir);assert.equal(generated.programError,undefined);
  assert.equal(generated.exportName,'part.gcode.3mf');assert.equal(generated.toolpathApproved,false);
  assert.equal(JSON.parse(await readFile(join(dir,'review.json'),'utf8')).generation.mode,'development');
  const other=join(root,'next');await initBundle(other,undefined,{machineId:machine.id,setupFile});
  assert.equal((await loadBundle(other)).plan.setup.filamentMm,1.75);
});
