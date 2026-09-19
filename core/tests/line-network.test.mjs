import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {boxMesh} from './fixtures/mesh.mjs';

test('line-network repeats explicit centerlines without filling their envelope',async()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry=boxMesh();plan.placement={xMm:80,yMm:80};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.process,{firstLayerMm:.6,layerMm:.6,lineWidthMm:2,firstLayerSpeedMmS:20,planarSpeedMmS:20,maxFlowMm3S:25,minimumLayerSeconds:0,experimentalDeposition:true});
  Object.assign(plan.skills['line-network'],{enabled:true,layers:2,networks:[{id:'panel',strokes:[
    {closed:true,points:[[0,0],[20,0],[20,20],[0,20]]},{closed:false,points:[[0,10],[20,10]]}
  ]}]});
  validatePlan(plan,machine);const path=generatePath(plan,machine,await rhino()),moves=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
  assert.equal(path.summary.lineNetwork.layers,2);assert.equal(path.summary.lineNetwork.networks,1);
  assert.ok(moves.every(move=>move.role==='line-network'));assert.deepEqual([...new Set(moves.map(move=>move.layer))],[0,1]);
  assert.ok(Math.abs(moves.reduce((sum,move)=>sum+move.volumeMm3,0)-240)<1e-6);
});

test('line-network rejects centerlines outside the selected tool bounds',async()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry=boxMesh();plan.placement={xMm:80,yMm:80};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.process,{minimumLayerSeconds:0});
  Object.assign(plan.skills['line-network'],{enabled:true,layers:1,networks:[{id:'panel',strokes:[{closed:false,points:[[0,0],[5000,0]]}]}]});
  validatePlan(plan,machine);
  const r=await rhino();assert.throws(()=>generatePath(plan,machine,r),/Line network panel exceeds the selected tool bounds/);
});

test('an authored frame past the retired count limits validates on its own shape',()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry=boxMesh();plan.placement={xMm:80,yMm:80};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  // 24 groups of 120 strokes, one of them a 2,000-point curve, over 40 courses:
  // past the retired 20 group, 100 stroke, 1,000 point and 10 course limits.
  const curve=Array.from({length:2000},(_,i)=>[i/200,Math.sin(i/50)]);
  const networks=Array.from({length:24},(_,n)=>({id:'frame-'+n,strokes:Array.from({length:120},(_,s)=>
    s?{closed:false,points:[[s/10,0],[s/10,10]]}:{closed:false,points:curve})}));
  Object.assign(plan.skills['line-network'],{enabled:true,layers:40,networks});
  validatePlan(plan,machine);
  // A prime line with more passes than the retired eight is equally ordinary.
  plan.process.primeLine={passes:Array.from({length:12},(_,i)=>({startMm:[10,10+i],endMm:[40,10+i],zMm:.2,widthMm:.4,heightMm:.2,speedMmS:20}))};
  validatePlan(plan,machine);
});

test('line-network supports course-specific reinforcement strokes',async()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry=boxMesh();plan.placement={xMm:80,yMm:80};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.process,{firstLayerMm:.6,layerMm:.6,lineWidthMm:2,firstLayerSpeedMmS:20,planarSpeedMmS:20,maxFlowMm3S:25,minimumLayerSeconds:0,experimentalDeposition:true});
  Object.assign(plan.skills['line-network'],{enabled:true,layers:4,networks:[{id:'panel',strokes:[
    {closed:true,points:[[0,0],[20,0],[20,20],[0,20]]},
    {closed:false,points:[[0,10],[20,10]],layers:[0]},
    {closed:false,points:[[0,10],[20,10]],layers:[1]}
  ]}]});
  validatePlan(plan,machine);const path=generatePath(plan,machine,await rhino()),moves=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
  assert.deepEqual([...new Set(moves.map(move=>move.layer))],[0,1,2,3]);
  assert.equal(path.summary.lineNetwork.strokes,6,'frame repeats four times and one connector prints on each of the first two courses');
});
