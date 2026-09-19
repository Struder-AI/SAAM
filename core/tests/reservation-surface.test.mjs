import test from 'node:test';
import assert from 'node:assert/strict';
import {clipAboveSurface,surfaceStroke} from '../region/reservation.mjs';
import {regionArea,pointInRegion} from '../region/region2d.mjs';
const rectangle=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const surface={footprint:[rectangle(0,0,10,10)],field:{xs:[0,10],ys:[0,10],values:[[0.2,0.2],[0.7,0.7]]},topAt:(x,y)=>({zMm:0.2+0.05*x})};
test('a generic lower interface clips horizontal sections and rejects uncovered consumer material',()=>{
  const region=[rectangle(0,0,10,10)],cut=clipAboveSurface(region,0.5,surface);
  assert.ok(Math.abs(regionArea(cut)-60)<1e-3);assert.equal(pointInRegion([2,5],cut),true);assert.equal(pointInRegion([8,5],cut),false);
  assert.deepEqual(clipAboveSurface(region,0.1,surface),[]);assert.ok(Math.abs(regionArea(clipAboveSurface(region,0.8,surface))-100)<1e-6);
  assert.throws(()=>clipAboveSurface([rectangle(0,0,12,10)],0.8,surface),/does not cover/);
  const touching={...surface,field:{xs:[0,10],ys:[0,10],values:[[3-1e-14,3],[3,3+1e-14]]},topAt:()=>3};
  assert.deepEqual(clipAboveSurface(region,3,touching),[],'floating-point contact does not create a spurious thin sheet');
});
test('horizontal surface strokes integrate changing first-contact gap with bounded subdivision',()=>{
  const stroke=surfaceStroke({points2d:[[0,5],[5,5]],z:0.5,nominalHeightMm:0.2,widthMm:0.4,surface,maxStepMm:0.5,toleranceMm:1e-6});
  assert.ok(stroke.points.length>10);assert.ok(stroke.points.every(p=>p[2]===0.5));
  assert.ok(Math.abs(stroke.volumesMm3.reduce((a,b)=>a+b,0)-0.31)<2e-6,'integral of clamped linear gap equals the analytic material area');
  assert.ok(stroke.segmentMetadata.every(m=>m.sampledGapErrorMm<=1e-6));
  for(let i=1;i<stroke.points.length;i++)assert.ok(Math.hypot(stroke.points[i][0]-stroke.points[i-1][0],stroke.points[i][1]-stroke.points[i-1][1])<=0.5+1e-9);
  assert.throws(()=>surfaceStroke({points2d:[[0,5],[10,5]],z:0.5,nominalHeightMm:0.2,widthMm:0.4,surface}),/clipping boundary/);
});
test('surface sampling sees interior curvature, closes wall strokes and reports an unresolvable step',()=>{
  const curved={...surface,topAt:x=>0.3+0.1*Math.sin(Math.PI*x/10)};
  const args={points2d:[[0,5],[10,5]],z:0.5,nominalHeightMm:0.3,widthMm:0.4,surface:curved,maxStepMm:0.25,toleranceMm:1e-5};
  const stroke=surfaceStroke(args),expected=0.4*(2-2/Math.PI);
  assert.ok(Math.abs(stroke.volumesMm3.reduce((a,b)=>a+b,0)-expected)<1e-4);
  const closed=surfaceStroke({...args,points2d:rectangle(1,1,2,2),closed:true});assert.deepEqual(closed.points[0],closed.points.at(-1));
  // The retired maxSegments budget (20,000) refused this stroke before it ran.
  const dense=surfaceStroke({...args,maxStepMm:4e-4});
  assert.ok(dense.volumesMm3.length>20000);
  assert.ok(Math.abs(dense.volumesMm3.reduce((a,b)=>a+b,0)-expected)<1e-4);
  // A step in the published surface is what subdivision cannot resolve.
  assert.throws(()=>surfaceStroke({...args,surface:{...curved,topAt:x=>x<5?0.3:0.35}}),/does not converge/);
  assert.throws(()=>surfaceStroke({...args,surface:{...curved,topAt:()=>null}}),/does not cover/);
});
