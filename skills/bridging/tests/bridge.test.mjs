import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgingResult} from '../scripts/bridge.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {planToolpath} from '../../../core/path/toolpath.mjs';

function fixture(mode='alternating',changes={}){
  const machine=loadMachine('ultimaker-s5'),plan=defaults(machine);plan.placement={xMm:0,yMm:0};
  const rails=[[[40,40,2.2],[40,40.4,2.2],[40,40.8,2.2]],[[52,40,9],[52,40.4,9],[52,40.8,9]]];
  plan.skills.bridging={enabled:true,maxExcursionMm:10,bridges:[{id:'incline',mode,rails,overlapMm:.2,pressMm:0,jogMm:0,leadInMm:0,speedMmS:25,attachmentSpeedMmS:10,flowMultiplier:1,...changes}]};
  const support={id:'walls',operations:[{id:'walls:done',layerId:'walls',layer:0,rank:0,phase:'planar',after:[],order:'given',continuous:true,
    strokes:[{role:'perimeter',closed:false,points:[[39.8,38,2],[39.8,42,2]],speedMmS:20,beadAreaMm2:.08},{role:'perimeter',closed:false,points:[[52.2,38,8.8],[52.2,42,8.8]],speedMmS:20,beadAreaMm2:.08}],
    travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>10}}]};
  const result=bridgingResult({plan,modelResults:[support],bounds:machine.bounds});
  const path=planToolpath({start:[30,30,1],process:plan.process,machine,generatorVersion:'test',motionBounds:machine.bounds},[support,result],{prime:false});
  return {result,path};
}
test('inclined spans remain straight, alternate uphill/downhill and compose without internal travel',()=>{
  const {result,path}=fixture(),spans=result.operations[0].strokes.filter(s=>s.role==='bridge-span');
  assert.deepEqual(spans.map(s=>s.points.length),[2,2,2]);
  assert.deepEqual(spans.map(s=>Math.sign(s.points[1][2]-s.points[0][2])),[1,-1,1]);
  assert.deepEqual(result.operations[0].after,['walls:done']);
  const actions=path.actions.filter(a=>a.operation==='bridging:incline'),first=actions.findIndex(a=>a.volumeMm3>0),last=actions.findLastIndex(a=>a.volumeMm3>0);
  assert.ok(first>=0);
  assert.ok(actions.slice(first,last+1).every(a=>a.kind==='move'&&a.volumeMm3>0));
});
test('one-way diagnostics retain three uphill starts and shared travel between them',()=>{
  const {result,path}=fixture('one-way',{leadInMm:.8}),spans=result.operations[0].strokes.filter(s=>s.role==='bridge-span');
  assert.ok(spans.every(s=>s.points[1][2]>s.points[0][2]));
  const a=path.actions.filter(a=>a.operation==='bridging:incline');
  const first=a.findIndex(a=>a.volumeMm3>0),last=a.findLastIndex(a=>a.volumeMm3>0);
  assert.ok(a.slice(first,last+1).some(a=>a.kind==='move'&&!a.volumeMm3));
});
test('press and jog are supported, bridge flow does not alter attachment volume',()=>{
  const {result}=fixture('alternating',{pressMm:.04,jogMm:.4,flowMultiplier:.8});
  const strokes=result.operations[0].strokes;
  assert.equal(strokes.filter(s=>s.role==='bridge-press').length,6);
  assert.equal(strokes.filter(s=>s.role==='bridge-jog').length,3);
  for(const s of strokes)assert.ok(Math.abs(s.beadAreaMm2-(s.role==='bridge-span'?.064:.08))<1e-12);
});
test('missing support, overlarge press and full-surface excursion are rejected',()=>{
  assert.throws(()=>fixture('alternating',{overlapMm:1}),/supporting wall/);
  assert.throws(()=>fixture('alternating',{pressMm:.2}),/attachment layer/);
  assert.throws(()=>fixture('alternating',{rails:[[[40,40,2.2],[40,40.4,13]],[[52,40,2.2],[52,40.4,13]]]}),/excursion/);
});
