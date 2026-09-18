import test from 'node:test';
import assert from 'node:assert/strict';
import {materialRegion} from '../path/material.mjs';
import {PathBuilder,planarPolicy,surfacePolicy} from '../path/builder.mjs';
import {combRoute,combSegment} from '../path/comb.mjs';
import {composeResults} from '../path/compose.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

const box=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const frame=[box(0,0,12,12),box(4,4,8,8).reverse()];
const flat=(loops,z)=>planarPolicy(loops,{layerZ:z,liftMm:1,maxCombMm:40,lineWidthMm:0.4});
const curved=(loops,z=(x,y)=>1+x*0.1+y*0.02)=>surfacePolicy(loops,{surfaceZ:z,maxZ:4,maxCombMm:40,lineWidthMm:0.4,liftMm:1,sampleStepMm:0.25,sagMm:0.01});

test('local material preserves holes, islands, boundary contact and narrow crossings',()=>{
  const material=materialRegion([...frame,box(20,0,22,2)],{maxZ:5});
  assert.equal(material.blocksSegment([4.5,6,1],[7.5,6,1]),false,'hole is empty');
  assert.equal(material.blocksSegment([13,1,1],[19,1,1]),false,'between disconnected regions is empty');
  assert.equal(material.blocksSegment([19,1,1],[23,1,1]),true,'second island remains an obstacle');
  assert.equal(material.blocksSegment([-1,0,1],[13,0,1]),true,'collinear boundary contact');
  assert.equal(material.blocksSegment([2,2,6],[2,2,1]),true,'vertical descent');
  assert.equal(material.blocksSegment([6,6,6],[6,6,1]),false,'vertical descent in hole');
  const thin=materialRegion([box(4.123,0,4.124,2)],{maxZ:3});
  assert.equal(thin.blocksSegment([0,1,2],[10,1,2]),true,'boundary clipping catches material between sample stations');
  assert.equal(thin.blocksSegment([0,1,4],[10,1,4]),false);
});

test('obstacles compare height at the crossing, not the highest route endpoint',()=>{
  const obstacle=materialRegion([box(1,0,2,2)],{maxZ:4});
  assert.equal(obstacle.blocksSegment([0,1,1],[10,1,10]),true);
  assert.equal(obstacle.blocksSegment([10,1,10],[0,1,1]),true,'reverse travel checks the same intersection');
  const surface=materialRegion([box(0,0,10,2)],{maxZ:10,heightAt:x=>x,sampleStepMm:0.25});
  assert.equal(surface.blocksSegment([1,1,2],[2,1,3]),false,'high far end of surface does not block a low local travel');
  assert.equal(surface.blocksSegment([1,1,0.5],[2,1,1.5]),true);
  const unknown=materialRegion([box(0,0,10,2)],{maxZ:10,heightAt:()=>null});
  assert.equal(unknown.blocksSegment([1,1,1],[2,1,1]),true,'missing height inside occupied footprint is conservative');
});

test('local clipping retains small obstacles under large translations',()=>{
  for(const [dx,dy] of [[0,0],[1e6,-4e5]]){
    const material=materialRegion([box(dx+1.123,dy,dx+1.124,dy+2)],{maxZ:4});
    assert.equal(material.blocksSegment([dx,dy+1,1],[dx+3,dy+1,3]),true);
    assert.equal(material.blocksSegment([dx,dy+3,1],[dx+3,dy+3,3]),false);
  }
});

test('surface chord sag does not excuse crossing another deposit',()=>{
  const policy=curved([box(0,0,12,12)],()=>1);
  const obstacle=materialRegion([box(4,0,8,12)],{maxZ:1.005});
  policy.isTravelClear=(a,b)=>!obstacle.blocksSegment(a,b);
  assert.equal(combRoute([2,6,1],[10,6,1],policy),null,'even a low prior ridge requires clearance');
  const machine=loadMachine(),process=defaults(machine).process;process.minimumLayerSeconds=0;
  const builder=new PathBuilder({start:[4,6,1.005],machine,process,generatorVersion:'test'});
  const stroke=points=>({points,beadAreaMm2:0.08,speedMmS:10});
  composeResults(builder,[{operations:[
    {id:'ridge',layerId:'ridge',phase:'test',layer:0,rank:0,clearanceZ:2.005,
      travelPolicy:flat([box(4,0,8,12)],1.005),strokes:[stroke([[4,6,1.005],[8,6,1.005]])]},
    {id:'surface',after:['ridge'],layerId:'surface',phase:'test',layer:0,rank:1,clearanceZ:2,
      travelPolicy:curved([box(0,0,12,12)],()=>1),strokes:[stroke([[2,6,1],[3,6,1]]),stroke([[9,6,1],[10,6,1]])]}
  ]}]);
  assert.ok(!builder.actions.some(a=>a.operation==='surface'&&a.travel==='combed'),'composition cannot transfer destination sag to a prior obstacle');
});

test('direct surface turnarounds retain local edge allowance without crossing holes',()=>{
  const machine=loadMachine(),process=defaults(machine).process;
  const builder=new PathBuilder({start:[0.1,2,1],machine,process,generatorVersion:'test'});
  assert.equal(builder.canComb([0.1,2.4,1],curved([box(0,0,12,12)],()=>1),1),true);
  assert.equal(builder.canComb([0.1,2.4,1],flat([box(0,0,12,12)],1),1),false,'planar standoff stays unchanged');
  const hole=curved([box(0,0,12,12),box(0.05,2.15,0.15,2.16).reverse()],()=>1);
  assert.equal(builder.canComb([0.1,2.4,1],hole,1),false,'exact boundary check catches a hole between surface samples');
});

test('curved combing goes around holes using sampled surface heights and a 3D distance budget',()=>{
  const policy=curved(frame,(x,y)=>1+x*0.1+0.03*(y-6)**2);
  const from=[2,6,1.2],to=[10,6,2];
  const route=combRoute(from,to,policy);assert.ok(route?.length>4);
  let previous=from,length=0;
  for(const point of route){
    assert.ok(combSegment(previous,point,policy),'every emitted edge stays in material');
    assert.ok(Math.abs(point[2]-policy.combSurfaceZ(...point))<1e-9);
    assert.ok(policy.canTravelDirect(previous,point));
    length+=Math.hypot(...point.map((v,i)=>v-previous[i]));previous=point;
  }
  assert.deepEqual(route.at(-1),to);
  assert.equal(combRoute(from,to,{...policy,maxCombMm:length-0.001}),null);
  assert.equal(combRoute([2,2,1],[10,2,1],curved([box(0,0,4,4),box(8,0,12,4)],()=>1)),null);
  assert.equal(combRoute(from,to,{...policy,combStepMm:NaN}),null);
});

test('unrelated components do not exhaust the local comb corner budget',()=>{
  const loops=[...frame,...Array.from({length:80},(_,i)=>box(20+i*3,0,22+i*3,2))];
  assert.ok(combRoute([2,6,1],[10,6,1],curved(loops,()=>1)));
});

test('each detour edge checks earlier deposits and invalid surfaces, with hop fallback',()=>{
  const from=[2,6,1],to=[10,6,1],policy=curved(frame,()=>1);
  const obstacle=materialRegion([box(0,0,12,4)],{maxZ:3});
  const route=combRoute(from,to,{...policy,isTravelClear:(a,b)=>!obstacle.blocksSegment(a,b)});
  assert.ok(route&&route.some(p=>p[1]>8),'route takes the unblocked side of the hole');
  const wall=materialRegion([box(5,0,7,12)],{maxZ:3});
  assert.equal(combRoute(from,to,{...policy,isTravelClear:(a,b)=>!wall.blocksSegment(a,b)}),null);
  assert.equal(combRoute(from,to,curved(frame,(x)=>x>4&&x<8?null:1)),null);
  const machine=loadMachine(),process=defaults(machine).process;
  const builder=new PathBuilder({start:from,machine,process,generatorVersion:'test'});
  builder.depositedMaxZ=3;
  assert.equal(builder.travelTo(to,{...policy,isTravelClear:(a,b)=>!wall.blocksSegment(a,b)}),'hopped');
  assert.ok(builder.actions.some(a=>a.kind==='move'&&a.to[2]===4));
});

test('composition permits local curved connections after a remote high planar region, retaining legacy blockers',()=>{
  const machine=loadMachine(),process=defaults(machine).process;process.minimumLayerSeconds=0;
  const make=(id,policy,points,after=[])=>({id,rank:0,phase:'test',layer:0,layerId:id,after,clearanceZ:10,travelPolicy:policy,
    strokes:points.map(points=>({points,speedMmS:10,beadAreaMm2:0.08}))});
  const high=make('high',flat([box(20,20,24,24)],8),[[[21,21,8],[22,21,8]]]);
  const low=make('surface',curved([box(0,0,12,12)]),[[[2,2,1.24],[3,2,1.34]],[[3,2.5,1.35],[2,2.5,1.25]]],['high']);
  const run=prior=>{
    const builder=new PathBuilder({start:[21,21,8],machine,process,generatorVersion:'test'});
    composeResults(builder,[{operations:[prior,low]}]);return builder;
  };
  assert.ok(run(high).actions.some(a=>a.operation==='surface'&&a.travel==='combed'&&a.to[1]===2.5));
  assert.ok(!run({...high,travelPolicy:{clearanceFor:()=>9,maxCombMm:0}}).actions.some(a=>a.operation==='surface'&&a.travel==='combed'));
});
