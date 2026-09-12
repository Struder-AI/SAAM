import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../print/plan.mjs';
import {materialIntentModel} from '../../studio/material-intent.mjs';

const bounds=height=>({boundsMm:{min:[0,0,0],max:[20,20,height]}});
const region=(id,zStartMm,zEndMm,skills)=>({id,part:null,zStartMm,zEndMm,skills,lowerSurfaceFrom:null});

test('shot-glass review separates its solid bottom from process-created hollow walls',()=>{
  const plan=defaults();plan.geometry={shape:'box',runMm:20,widthMm:20,heightMm:30};
  plan.composition.regions=[region('base',0,.6,{'full-fill':{mode:'body'}}),region('walls',.6,30,{'vase-wall':{endTransition:'spiral'}})];
  const review=materialIntentModel(plan,bounds(30));
  assert.deepEqual(review.regions.map(({id,classification,zStartMm,zEndMm})=>({id,classification,zStartMm,zEndMm})),[
    {id:'base',classification:'solid',zStartMm:0,zEndMm:.6},
    {id:'walls',classification:'perimeter-only',zStartMm:.6,zEndMm:30}
  ]);
  assert.deepEqual(review.explicitVoids,[],'the process-created cavity is not mislabeled as modeled geometry');
});

test('four-layer panel review shows two solid base layers and two perimeter-only upper layers',()=>{
  const plan=defaults();plan.geometry={shape:'box',runMm:30,widthMm:30,heightMm:1.2};
  Object.assign(plan.process,{firstLayerMm:.3,layerMm:.3});
  Object.assign(plan.skills['planar-infill'],{enabled:true,density:0,perimeters:1});
  Object.assign(plan.skills['full-fill'],{enabled:true,mode:'solid-surfaces',bottomLayers:2,topLayers:0});
  plan.skills['draped-skin'].enabled=false;
  const review=materialIntentModel(plan,bounds(1.2));
  assert.deepEqual(review.regions.map(({classification,zStartMm,zEndMm})=>({classification,zStartMm,zEndMm})),[
    {classification:'solid',zStartMm:0,zEndMm:.6},
    {classification:'perimeter-only',zStartMm:.6,zEndMm:1.2}
  ]);
});

test('modeled pipe bore remains distinct from process-created material intent',()=>{
  const plan=defaults();plan.geometry={shape:'pipe',innerRadiusMm:7,outerRadiusMm:10,heightMm:12,toleranceMm:.01};
  plan.skills['draped-skin'].enabled=false;
  const review=materialIntentModel(plan,bounds(12));
  assert.equal(review.explicitVoids.length,1);assert.equal(review.explicitVoids[0].source,'geometry');
  assert.equal(review.explicitVoids[0].kind,'through-hole');assert.match(review.explicitVoids[0].detail,/14 mm/);
  assert.equal(review.regions[0].source,'process');assert.equal(review.regions[0].classification,'solid');
  assert.match(review.note,/process choices confirmed in Settings/);
});
