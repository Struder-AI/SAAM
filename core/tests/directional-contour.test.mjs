import test from 'node:test';
import assert from 'node:assert/strict';
import {regularizeDirectionalContour,prepareRegularizedSleeveContact} from '../geom/directional-contour.mjs';
import {contourPath} from '../geom/contour-path.mjs';
import {pointSegmentDistance} from '../region/region2d.mjs';
const loop=()=>[[0,10],[.1,10],[.099,12],[.11,12],...[.2,.4,.6,.8,1,1.2,1.4,1.6,1.8].map(a=>[a*Math.PI,10])].map(([a,r])=>[r*Math.cos(a),r*Math.sin(a)]);
test('bounded angular unfolding retains a long radial fold and preserves unilateral smooth backs',()=>{
  const source=loop(),curve=contourPath(source),result=regularizeDirectionalContour(curve,[0,0],{toleranceMm:.05});
  assert.ok(result.report.movedVertices>0);assert.ok(result.report.correspondenceErrorMm<=.05);
  for(const p of source)assert.ok(Math.min(...result.loop.map((a,i)=>pointSegmentDistance(p,a,result.loop[(i+1)%result.loop.length])))<=.05);
  assert.ok(Math.max(...result.loop.map(p=>Math.hypot(...p)))>11.95);
  const contact=prepareRegularizedSleeveContact({curveAt:()=>curve,anchorAt:()=>[0,0],toleranceMm:.05});
  for(const f of [0,.37,1])assert.deepEqual(contact.at([2,2,0],f),[2,2,0]);
  const p=[15,0,0],full=contact.at(p,1),partial=contact.at(p,.37);
  partial.forEach((v,k)=>assert.ok(Math.abs(v-(p[k]+.37*(full[k]-p[k])))<1e-10));
});
test('fixed arc-length samples make collinear source subdivisions irrelevant',()=>{
  const a=loop(),b=a.flatMap((p,i)=>[p,p.map((v,k)=>(v+a[(i+1)%a.length][k])/2)]);
  const x=regularizeDirectionalContour(contourPath(a),[0,0],{toleranceMm:.05}),y=regularizeDirectionalContour(contourPath(b),[0,0],{toleranceMm:.05});
  x.loop.forEach((p,i)=>assert.ok(Math.hypot(p[0]-y.loop[i][0],p[1]-y.loop[i][1])<1e-10));
  assert.throws(()=>regularizeDirectionalContour(contourPath(a),[0,0],{toleranceMm:.00001}),/sampling error|folds need/);
});
