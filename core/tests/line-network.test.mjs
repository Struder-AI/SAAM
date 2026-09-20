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

function mixedPlan(networks,{experimental=true}={}){
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry=boxMesh();plan.placement={xMm:80,yMm:80};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.process,{firstLayerMm:.2,layerMm:.2,lineWidthMm:.4,firstLayerSpeedMmS:20,planarSpeedMmS:20,maxFlowMm3S:experimental?30:4,minimumLayerSeconds:0,experimentalDeposition:experimental});
  Object.assign(plan.skills['line-network'],{enabled:true,layers:1,networks});
  return {machine,plan};
}
const bar=id=>({id,strokes:[{closed:false,points:[[0,0],[10,0]]}]});
const sequence=moves=>{const seen=[];for(const m of moves){const key=`${m.region}@${m.to[2]}`;if(seen.at(-1)!==key)seen.push(key);}return seen;};

test('line networks with their own layer grids print fine courses first, thick ones after the fine courses beneath them',async()=>{
  const {machine,plan}=mixedPlan([
    {...bar('thick'),layers:1,process:{firstLayerMm:1,layerMm:1,lineWidthMm:2}},
    {...bar('fine'),layers:4,process:{firstLayerMm:.25,layerMm:.25,lineWidthMm:.5}}
  ]);
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino()),moves=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
  assert.deepEqual(sequence(moves),['fine@0.25','fine@0.5','fine@0.75','fine@1','thick@1'],'the fine line builds up to the height where the single thick course goes on, even though the thick network was listed first');
  const volume=region=>moves.filter(m=>m.region===region).reduce((s,m)=>s+m.volumeMm3,0);
  assert.ok(Math.abs(volume('fine')-4*10*.5*.25)<1e-6&&Math.abs(volume('thick')-10*2*1)<1e-6,'each network deposits its own width times its own layer height');
  assert.deepEqual([...new Set(moves.map(m=>m.layer))],[0,1,2,3],'layer is the height\'s place among all course heights, shared by both networks');
  assert.equal(path.summary.lineNetwork.courses,5);
});

test('course heights that coincide across grids are exactly equal so the finer line still goes first',async()=>{
  // 0.1 + 2 x 0.1 is 0.30000000000000004 in floating point; the network at 0.3 must still tie with it.
  const {machine,plan}=mixedPlan([
    {...bar('coarse'),layers:1,process:{firstLayerMm:.3,layerMm:.3,lineWidthMm:.6}},
    {...bar('fine'),layers:3,process:{firstLayerMm:.1,layerMm:.1,lineWidthMm:.35}}
  ],{experimental:false});
  validatePlan(plan,machine);
  const moves=generatePath(plan,machine,await rhino()).actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
  assert.deepEqual(sequence(moves).slice(-2),['fine@0.3','coarse@0.3']);
});

test('a network override is validated against the machine limits as if the whole print used it',()=>{
  const bad=(process,extra={},experimental=false)=>{const {machine,plan}=mixedPlan([{...bar('a'),process,...extra}],{experimental});return ()=>validatePlan(plan,machine);};
  assert.doesNotThrow(bad({layerMm:.25,firstLayerMm:.25,lineWidthMm:.5}));
  assert.throws(bad({lineWidthMm:1.5}),/./,'a 1.5 mm bead is beyond the ordinary width limit');
  assert.doesNotThrow(bad({lineWidthMm:1.5,layerMm:.75,firstLayerMm:.75},{},true));
  assert.throws(bad({lineWidthMm:2.5,layerMm:1,firstLayerMm:1},{},true),/./,'2.5 mm exceeds the experimental width limit');
  assert.throws(bad({retractMm:3}),/process overrides must be/,'only the five region-overridable keys');
  assert.throws(bad({}),/process overrides must be/,'an empty override is not omitted');
  assert.throws(bad({layerMm:.2},{layers:0}),/course count/);
  assert.throws(()=>{const {machine,plan}=mixedPlan([{id:'a',layers:2,strokes:[{closed:false,points:[[0,0],[5,0]],layers:[2]}]}]);validatePlan(plan,machine);},/stroke layers/,'stroke courses are checked against the network\'s own count');
});

test('plans without network overrides keep their exact shape and behavior',()=>{
  const {machine,plan}=mixedPlan([bar('a')]);
  const before=JSON.stringify(plan);
  validatePlan(plan,machine);
  assert.equal(JSON.stringify(plan),before,'validation still never mutates the plan');
});
