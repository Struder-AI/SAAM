import {test} from 'node:test';
import assert from 'node:assert/strict';
import {segmentDistance,assemblyClearance,railBodyPoint} from './assembly-clearance.mjs';
import {geometry,inverse,pairedEdgeLayout} from '../../core/machine/split-delta.mjs';
test('finite segment distances distinguish crossing, skew, parallel and endpoints',()=>{
  assert.equal(segmentDistance([-1,0,0],[1,0,0],[0,-1,0],[0,1,0]),0);
  assert.equal(segmentDistance([-1,0,0],[1,0,0],[0,-1,3],[0,1,3]),3);
  assert.equal(segmentDistance([0,0,0],[1,0,0],[0,2,0],[1,2,0]),2);
  assert.equal(segmentDistance([0,0,0],[1,0,0],[2,0,0],[3,0,0]),1);
  assert.equal(segmentDistance([0,0,0],[0,0,0],[1,-1,0],[1,1,0]),1);
});
test('a rod through a different rail is rejected away from its own attachment',()=>{
  const g=geometry(),state=inverse(g,{tcp:[0,0,20]});
  state.points[0]=railBodyPoint(g,2,0).map((v,i)=>v+(i===0?-50:i===2?300:0));
  state.carriages[0]=railBodyPoint(g,2,0).map((v,i)=>v+(i===0?50:i===2?300:0));
  const r=assemblyClearance(g,state,{stopEarly:false});assert.equal(r.passed,false);assert.ok(r.minGapMm<0);
});
test('plate pairs stay on their own edges instead of interleaving into a triangle',()=>{
  assert.equal(pairedEdgeLayout(geometry()).passed,true);
  assert.equal(pairedEdgeLayout(geometry({platformRadiusMm:30,platformPairMm:35})).passed,true);
  const bad=pairedEdgeLayout(geometry({platformRadiusMm:10,platformPairMm:53.270741745289406,platformPairSkewDeg:-34.623633088544004,platformClockDeg:-3.3239123392850165}));
  assert.equal(bad.passed,false);assert.ok(bad.errors.includes('Tower pairs interleave around the plate'));
});
