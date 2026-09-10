import test from 'node:test';
import assert from 'node:assert/strict';
import {PathBuilder} from '../path/builder.mjs';
import {composeResults} from '../path/compose.mjs';
import {defaults,validatePlan} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {defaults as wedgeDefaults,validatePlan as validateWedge} from '../../skills/wedge-demo/scripts/model.mjs';
import {generatePath as wedgePath} from '../../skills/wedge-demo/scripts/path.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';

test('deposition height follows both ends of sloping segments; travel and repeated parks do not raise it',()=>{
  const machine=loadMachine(),plan=defaults(machine);
  const b=new PathBuilder({start:[10,10,6],machine,process:plan.process,generatorVersion:'test'});
  b.move([12,10,2],10,1);
  b.move([12,10,25],10);b.move([12,10,2],10);
  assert.equal(b.depositedMaxZ,6);
  const start=b.actions.length;
  b.travelTo([20,10,2],{maxCombMm:0,clearanceFor:()=>100});
  assert.deepEqual(b.actions.slice(start).filter(a=>a.kind==='move').map(a=>a.to),[[12,10,7],[20,10,7],[20,10,2]]);
  b.park();b.park();assert.equal(b.position[2],7);
  b.travelTo([22,10,10],{maxCombMm:0});
  assert.equal(b.position[2],10,'a higher destination remains reachable');
  assert.equal(b.depositedMaxZ,6,'moving higher without deposition does not add material');
});

test('multiple strokes in one operation clear only the material already emitted',()=>{
  const machine=loadMachine(),plan=defaults(machine);plan.process.minimumLayerSeconds=0;
  const b=new PathBuilder({start:[10,10,1],machine,process:plan.process,generatorVersion:'test'});
  const stroke=points=>({points,beadAreaMm2:.08,speedMmS:10});
  composeResults(b,[{operations:[{id:'slopes',rank:100,layerId:'one',layer:0,phase:'test',
    travelPolicy:{maxCombMm:0,clearanceFor:()=>101},clearanceZ:101,
    strokes:[stroke([[10,10,1],[11,10,9],[12,10,2]]),stroke([[20,10,2],[21,10,2]]),stroke([[30,10,2],[31,10,20]])]}]}]);
  const traverse=b.actions.find(a=>a.kind==='move'&&a.to[0]===20);
  assert.equal(traverse.to[2],10,'the later 20 mm stroke does not affect this traverse');
  assert.equal(b.depositedMaxZ,20);
});

test('one millimeter is the default and zero clearance generates and round trips for shell and wedge',async()=>{
  const native=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const wedge of [false,true]) {
    const machine=loadMachine(id),plan=wedge?wedgeDefaults(machine):defaults(machine);
    assert.equal(plan.process.liftMm,1);
    plan.process.liftMm=0;plan.process.minimumLayerSeconds=0;
    if(wedge)plan.process.combTravelMm=0;
    else {plan.geometry={shape:'box',runMm:10,widthMm:10,heightMm:2};plan.skills['draped-skin'].enabled=false;plan.process.maxCombMm=0;}
    (wedge?validateWedge:validatePlan)(plan,machine);
    const path=wedge?wedgePath(plan,machine):generatePath(plan,machine,native);
    let from=path.initialPosition,high=0,atMaterialHeight=0;
    for(const a of path.actions)if(a.kind==='move') {
      if(a.volumeMm3>0)high=Math.max(high,from[2],a.to[2]);
      else if(Math.hypot(a.to[0]-from[0],a.to[1]-from[1])>1e-7&&Math.abs(a.to[2]-high)<1e-7)atMaterialHeight++;
      from=a.to;
    }
    assert.ok(atMaterialHeight>0);
    assert.equal(from[2],high,'final park has zero clearance');
    const program=interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'}),plan,machine);
    assert.equal(program.moves.length,path.actions.filter(a=>a.kind==='move').length);
    plan.process.liftMm=-.1;assert.throws(()=>(wedge?validateWedge:validatePlan)(plan,machine),/liftMm/);
  }
});

test('unselected tall geometry does not raise travel or final parking',async()=>{
  for(const id of ['ultimaker-s5','bambu-h2d']) {
  const machine=loadMachine(id),plan=defaults(machine);plan.process.minimumLayerSeconds=0;
  plan.geometry={shape:'assembly',parts:[
    {id:'printed',geometry:{shape:'box',runMm:10,widthMm:10,heightMm:2},xMm:0,yMm:0,zMm:0},
    {id:'unselected',geometry:{shape:'box',runMm:10,widthMm:10,heightMm:40},xMm:20,yMm:0,zMm:0}]};
  plan.skills['full-fill'].parts=['printed'];plan.skills['draped-skin'].enabled=false;
  const path=generatePath(plan,machine,await rhino());
  assert.equal(path.summary.boundsMm.max[2],40);
  assert.ok(Math.abs(path.actions.findLast(a=>a.kind==='move').to[2]-3)<1e-7);
  assert.ok(path.actions.filter(a=>a.kind==='move').every(a=>a.to[2]<40));
  const program=interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'}),plan,machine);
  assert.equal(program.moves.length,path.actions.filter(a=>a.kind==='move').length);
  }
});
