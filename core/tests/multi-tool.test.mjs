import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportMotion,validatePath} from '../export/griffin.mjs';
import {boxMesh} from './fixtures/mesh.mjs';

const LEFT={index:0,core:'Hardened steel 0.4',nozzleMm:0.4},RIGHT={index:1,core:'Hardened steel 0.6',nozzleMm:0.6};
const bar=(id,extra={})=>({id,strokes:[{closed:false,points:[[0,0],[20,0]]}],...extra});

function planWith(networks,{x=100,y=100}={}){
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry=boxMesh();plan.placement={xMm:x,yMm:y};
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.process,{firstLayerMm:.2,layerMm:.2,lineWidthMm:.5,firstLayerSpeedMmS:20,planarSpeedMmS:20,maxFlowMm3S:4,minimumLayerSeconds:0});
  Object.assign(plan.skills['line-network'],{enabled:true,layers:1,networks});
  return {machine,plan};
}
const background=()=>bar('background',{tool:LEFT,layers:2,process:{firstLayerMm:.2,layerMm:.2,lineWidthMm:.5}});
const lettering=()=>bar('lettering',{tool:RIGHT,baseMm:.4,layers:3,process:{layerMm:.3,lineWidthMm:.72}});
const part=a=>a.kind==='move'&&a.volumeMm3>0&&a.role!=='prime';
const deposits=path=>path.actions.filter(part);

test('a network may name its own nozzle, checked against that nozzle\'s own limits',()=>{
  const ok=networks=>{const {machine,plan}=planWith(networks);return()=>validatePlan(plan,machine);};
  assert.doesNotThrow(ok([background(),lettering()]));
  assert.throws(ok([bar('a',{tool:{...RIGHT,index:2}})]),/does not have/,'a nozzle the machine lacks');
  assert.throws(ok([bar('a',{tool:{...RIGHT,core:'Hardened steel 0.7',nozzleMm:0.7}})]),/./,'a core that tool does not carry');
  assert.throws(ok([bar('a',{tool:{index:1,core:'Hardened steel 0.6'}})]),/must give index, core, nozzleMm/);
  assert.throws(ok([bar('a',{baseMm:-1})]),/baseMm/);
  // The same 0.3 mm bead is fine for the 0.4 mm nozzle and refused for the 0.6, whose thinnest bead is 0.45.
  assert.doesNotThrow(ok([bar('a',{tool:LEFT,process:{lineWidthMm:.35}})]));
  assert.throws(ok([bar('a',{tool:RIGHT,process:{lineWidthMm:.35}})]),/./,'bead width limits follow the network\'s nozzle');
});

test('a job on two nozzles changes once, between the background and the lettering above it',async()=>{
  const {machine,plan}=planWith([lettering(),background()]);
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino()),changes=path.actions.filter(a=>a.kind==='tool');
  assert.deepEqual(changes.map(a=>[a.fromTool,a.toTool]),[[0,1]],'listing the lettering first does not change the order: one change, left then right');
  const moves=deposits(path),zs=[...new Set(moves.map(m=>m.to[2]))];
  assert.deepEqual(zs.map(z=>+z.toFixed(6)),[.2,.4,.7,1,1.3],'the background courses, then the lettering starting 0.4 mm up in 0.3 mm layers');
  const volume=(region,z)=>moves.filter(m=>m.region===region&&Math.abs(m.to[2]-z)<1e-9).reduce((s,m)=>s+m.volumeMm3,0);
  near(volume('lettering',.7),20*.72*.3);near(volume('lettering',1.3),20*.72*.3,1e-6);
  near(volume('background',.2),20*.5*.2);
  const change=path.actions.indexOf(changes[0]);
  assert.ok(path.actions.slice(0,change).filter(part).every(m=>m.region==='background'),'nothing of the lettering comes before the change');
  assert.ok(path.actions.slice(change).filter(part).every(m=>m.region==='lettering'),'nothing of the background comes after it');
});

function near(a,b,tol=1e-6){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);}

test('after a change the head reaches the next stroke by a lifted hop, even a nearby one at the same height',async()=>{
  // Two nozzles laying first courses side by side: without the rule the builder would comb a short direct move,
  // from a head position the nozzle-change sequence has already moved.
  const {machine,plan}=planWith([
    {id:'left-bar',tool:LEFT,strokes:[{closed:false,points:[[0,0],[10,0]]}]},
    {id:'right-bar',tool:RIGHT,process:{lineWidthMm:.72,layerMm:.2},strokes:[{closed:false,points:[[10.6,0],[20,0]]}]}
  ]);
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino()),at=path.actions.findIndex(a=>a.kind==='tool');
  assert.ok(at>0,'the nozzle changes between the two bars');
  const next=path.actions.slice(at+1),firstDeposit=next.findIndex(part),travel=next.slice(0,firstDeposit).filter(a=>a.kind==='move');
  assert.ok(travel.length>=2&&travel.some(m=>m.to[2]>=plan.process.liftMm-1e-9),'it rises to clearance before crossing');
  assert.ok(travel.every(m=>m.travel!=='combed'),'and never combs');
});

test('plans without a network nozzle are unchanged: no tool action, one nozzle',async()=>{
  const {machine,plan}=planWith([bar('a')]);
  const path=generatePath(plan,machine,await rhino());
  assert.equal(path.actions.filter(a=>a.kind==='tool').length,0);
  const same=planWith([background(),{...bar('again'),tool:LEFT,process:{lineWidthMm:.5}}]);
  assert.equal(generatePath(same.plan,same.machine,await rhino()).actions.filter(a=>a.kind==='tool').length,0,'two networks on the same nozzle need no change');
});

test('each network is held to its own nozzle\'s reach',async()=>{
  // The right nozzle cannot reach x below 25, the left can.
  const left=planWith([bar('a',{tool:LEFT})],{x:10}),right=planWith([bar('a',{tool:RIGHT,process:{lineWidthMm:.72}})],{x:10});
  const r=await rhino();
  assert.doesNotThrow(()=>generatePath(left.plan,left.machine,r));
  assert.throws(()=>generatePath(right.plan,right.machine,r),/exceeds the selected tool bounds/,'the network\'s strokes, not the placeholder shape, are held to the right nozzle\'s reach');
});

test('a job that changes nozzles cannot be exported until a machine declares a validated sequence',async()=>{
  const {machine,plan}=planWith([background(),lettering()]);
  const path=generatePath(plan,machine,await rhino());
  assert.throws(()=>exportMotion(path,plan),/no validated nozzle-change sequence/);
  assert.doesNotThrow(()=>validatePath(path),'the path itself is well formed; only a writer without a sequence refuses it');
  const bad=structuredClone(path),change=bad.actions.find(a=>a.kind==='tool');
  change.toTool=1.5;
  assert.throws(()=>validatePath(bad),/./,'a malformed tool action is refused at the path');
});
