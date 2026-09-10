import test from 'node:test';
import assert from 'node:assert/strict';
import {PathBuilder,planarPolicy} from '../path/builder.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

function builder(){const machine=loadMachine(),plan=defaults(machine);return new PathBuilder({start:[10,10,1],process:plan.process,machine,generatorVersion:'test'});}
test('all skill writers coalesce a straight run while preserving volume and endpoints',()=>{
  for(const phase of ['planar','draped-skin','vase-wall','inclined']) {
    const b=builder();b.setContext(phase,1);b.operationId=phase+':test';
    for(let i=1;i<=100;i++)b.move([10+i*.1,10+i*.2,1+i*.05],10,Math.hypot(.1,.2,.05)*.08,{role:'test'});
    assert.equal(b.actions.length,1,phase);
    assert.deepEqual(b.actions[0].to,[20,30,6]);
    assert.ok(Math.abs(b.actions[0].volumeMm3-Math.hypot(10,20,5)*.08)<1e-10);
    assert.ok(Math.abs(b.stats.printMm-Math.hypot(10,20,5))<1e-10);
  }
  const travel=builder();travel.move([11,10,1],20);travel.move([12,10,1],20);
  assert.equal(travel.actions.length,1);assert.equal(travel.actions[0].volumeMm3,0);
});
test('corners, reversals, curves and process/semantic changes remain explicit commands',()=>{
  for(const change of [
    b=>b.move([12,11,1],10,.08),
    b=>b.move([10,10,1],10,.08),
    b=>b.move([12,10,1],20,.08),
    b=>b.move([12,10,1],10,.04),
    b=>b.move([12,10,1],10,0),
    b=>{b.operationId='other';b.move([12,10,1],10,.08);},
    b=>{b.setContext('other',1);b.move([12,10,1],10,.08);},
    b=>b.move([12,10,1],10,.08,{gapMm:.1}),
    b=>{b.fan(100);b.move([12,10,1],10,.08);}
  ]) {const b=builder();b.move([11,10,1],10,.08);change(b);assert.equal(b.actions.filter(a=>a.kind==='move').length,2);}
  const curve=builder();
  for(let i=1;i<=100;i++)curve.move([10+i*.1,10+0.00001*i*i,1],10,.008);
  assert.ok(curve.actions.length>90,'small cumulative bends cannot turn into one straight line');
});

test('nearby stroke starts move directly without retraction or lift, retaining hole and surface checks',()=>{
  const region=[[[0,0],[20,0],[20,20],[0,20]]];
  const policy=planarPolicy(region,{layerZ:1,liftMm:1,maxCombMm:0,lineWidthMm:.4});
  const b=builder();b.move([11,10,1],10,.08);
  assert.equal(b.travelTo([11,11,1],policy),'combed');
  assert.equal(b.stats.retractions,0);assert.equal(b.stats.hopped,0);
  assert.deepEqual(b.actions.at(-1).to,[11,11,1]);assert.equal(b.actions.at(-1).travel,'combed');
  assert.equal(b.actions.at(-1).volumeMm3,0,'repositioning does not invent deposition');
  const hole=[[[10.3,9],[10.3,11],[10.6,11],[10.6,9]]];
  const blocked=builder(),holePolicy=planarPolicy([...region,...hole],{layerZ:1,liftMm:1,maxCombMm:0,lineWidthMm:.4});
  assert.equal(blocked.travelTo([10.9,10,1],holePolicy),'hopped','a short gap across a slot still preserves the opening');
  const surface=builder();
  assert.equal(surface.travelTo([10.5,10,1.2],{canTravelDirect:(a,b,limit)=>limit===1&&b[2]>=a[2]}),'combed');
  const obstructed=builder();assert.equal(obstructed.travelTo([10.5,10,1],{canTravelDirect:()=>false}),'hopped');
});
