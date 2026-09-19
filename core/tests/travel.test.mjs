import test from 'node:test';
import assert from 'node:assert/strict';
import {PathBuilder,planarPolicy} from '../path/builder.mjs';
import {combSegment,combRoute} from '../path/comb.mjs';
import {pointInRegion,SegmentIndex} from '../region/region2d.mjs';
import {composeResults} from '../path/compose.mjs';
import {defaults,validatePlan} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';

test('indexed travel queries retain boundary, hole and crossing decisions',()=>{
  const loops=[[[0,0],[12,0],[12,12],[8,12],[8,5],[4,5],[4,12],[0,12]],[[1,1],[1,3],[3,3],[3,1]]];
  const policy=planarPolicy(loops,{layerZ:.2,liftMm:1,maxCombMm:20,lineWidthMm:.4});
  const plain={...policy,combIndex:undefined,combCorners:undefined};
  const points=[...loops.flat(),[-.0000001,1],[0,1],[.0000001,1],[1,0],[2,2],[6,4.8],[6,5.2]];
  let seed=123;
  for(let i=0;i<160;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed/2**32*14-1;seed=(Math.imul(seed,1664525)+1013904223)>>>0;points.push([x,seed/2**32*14-1]);}
  for(const point of points)assert.equal(policy.combIndex.contains(point),pointInRegion(point,loops));
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j+=13)
    assert.equal(combSegment(points[i],points[j],policy),combSegment(points[i],points[j],plain));
  for(const [a,b] of [[[2,4],[10,4]],[[2,8],[10,8]],[[.5,2],[3.5,2]]])
    assert.deepEqual(combRoute([...a,.2],[...b,.2],policy),combRoute([...a,.2],[...b,.2],plain));
  const before=policy.combCorners();assert.strictEqual(({...policy}).combCorners(),before,'stroke policy copies share the prepared layer');
  const changed=new SegmentIndex([[[20,20],[22,20],[22,22],[20,22]]],.5);
  assert.equal(changed.contains([21,21]),true);assert.equal(changed.contains([1,1]),false);
});

test('a detailed outline routes on its own geometry instead of degrading into a hop',()=>{
  // 320 points around the hole, so the inset outline carries far more corners
  // than the retired 256-corner bound, on a part of ordinary size.
  const hole=Array.from({length:320},(_,i)=>{const t=-2*Math.PI*i/320;return [15+5*Math.cos(t),15+5*Math.sin(t)];});
  const loops=[[[0,0],[30,0],[30,30],[0,30]],hole];
  const policy=planarPolicy(loops,{layerZ:.2,liftMm:1,maxCombMm:18,lineWidthMm:.4});
  const from=[9,15,.2],to=[21,15,.2];
  assert.ok(policy.combCorners(from,to).length>256,'the inset outline exceeds the retired corner bound');
  const route=combRoute(from,to,policy);
  assert.ok(route&&route.length>1,'the travel routes around the hole');
  let length=0,previous=from;
  for(const point of route){
    assert.ok(combSegment(previous,point,policy),'every routed edge clears the outline');
    length+=Math.hypot(...point.map((v,i)=>v-previous[i]));previous=point;
  }
  assert.deepEqual(previous,to);
  assert.ok(length>12&&length<=18,`the detour stays inside the route budget: ${length}`);
  assert.equal(combRoute(from,to,{...policy,maxCombMm:length-0.001}),null,'a budget under the shortest route still hops');
});

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
    travelPolicy:{maxCombMm:0,clearanceFor:()=>101},
    strokes:[stroke([[10,10,1],[11,10,9],[12,10,2]]),stroke([[20,10,2],[21,10,2]]),stroke([[30,10,2],[31,10,20]])]}]}]);
  const traverse=b.actions.find(a=>a.kind==='move'&&a.to[0]===20);
  assert.equal(traverse.to[2],10,'the later 20 mm stroke does not affect this traverse');
  assert.equal(b.depositedMaxZ,20);
});

test('one millimeter is the default and zero clearance generates and round trips for a shell',async()=>{
  const native=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d']) {
    const machine=loadMachine(id),plan=defaults(machine);
    assert.equal(plan.process.liftMm,1);
    plan.process.liftMm=0;plan.process.minimumLayerSeconds=0;
    plan.geometry={shape:'box',runMm:10,widthMm:10,heightMm:2};plan.skills['draped-skin'].enabled=false;plan.process.maxCombMm=0;
    validatePlan(plan,machine);
    const path=generatePath(plan,machine,native);
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
    plan.process.liftMm=-.1;assert.throws(()=>validatePlan(plan,machine),/liftMm/);
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
