import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {regularizeDirectionalContour} from '../geom/directional-contour.mjs';
import {contourPath} from '../geom/contour-path.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

test('directional stages read frozen source points and return independent contour samples',()=>{
  const points=Object.freeze(Array.from({length:64},(_,i)=>Object.freeze([10*Math.cos(2*Math.PI*i/64),10*Math.sin(2*Math.PI*i/64)])));
  const anchor=Object.freeze([0,0]),before=JSON.stringify(points),curve=contourPath(points);
  const first=regularizeDirectionalContour(curve,anchor,{samples:512,toleranceMm:.1});
  const expected=structuredClone(first);
  first.loop[0].fill(999);first.report.movedVertices=-1;
  assert.deepEqual(regularizeDirectionalContour(curve,anchor,{samples:512,toleranceMm:.1}),expected);
  assert.equal(JSON.stringify(points),before);
});

test('directional input and sampling failures retain order before angular fitting',()=>{
  const never={at(){throw Error('should not sample');}};
  assert.throws(()=>regularizeDirectionalContour(never,[NaN,0],{samples:0,toleranceMm:.1}),/fixed sample count/);
  assert.throws(()=>regularizeDirectionalContour(never,[NaN,0],{samples:32,toleranceMm:.1}),/finite XY center/);
  const curve=contourPath([[0,0],[10,0],[10,10],[0,10]]);
  assert.throws(()=>regularizeDirectionalContour(curve,[5,5],{samples:33,toleranceMm:1e-8,logRadiusSlopeTarget:0}),/fixed sampling error/);
});

test('directional entry exposes sampled profile, constrained fit, reconstruction and verified report',async()=>{
  const file='core/geom/directional-contour.mjs';
  const context=await loadFlow({repo:fileURLToPath(new URL('../../',import.meta.url)),files:[file]});
  const page=flowPacket(context,`${file}::regularizeDirectionalContour`);
  const id=name=>page.components.find(c=>c.label===name)?.index;
  for(const [from,to,label] of [
    ['sampleDirectionalContour','unwrapDirectionalProfile','sampled.points'],
    ['unwrapDirectionalProfile','conditionDirectionalSpacing','profile'],
    ['conditionDirectionalSpacing','fitDirectionalAngles','spacing'],
    ['fitDirectionalAngles','reconstructDirectionalContour','angles'],
    ['reconstructDirectionalContour','verifyDirectionalContour','reconstructed']
  ])assert.ok(page.wires.some(w=>w.from===id(from)&&w.to===id(to)&&w.label===label),`${from} → ${to}: ${label}`);
  assert.ok(page.wires.some(w=>w.from===id('reconstructDirectionalContour')&&w.label==='loop'&&w.kind==='return'));
  assert.ok(page.wires.some(w=>w.from===id('verifyDirectionalContour')&&w.label==='report'&&w.kind==='return'));
});
