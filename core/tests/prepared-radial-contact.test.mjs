import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRadialSleeveContact} from '../geom/prepared-radial-contact.mjs';
import {contourPath} from '../geom/contour-path.mjs';
import {pointSegmentDistance} from '../region/region2d.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {createMeshDistanceQuery} from '../geom/mesh-distance.mjs';
const loop=()=>[[0,10],[.1,10],[.099,12],[.11,12],...[.2,.4,.6,.8,1,1.2,1.4,1.6,1.8].map(a=>[a*Math.PI,10])].map(([a,r])=>[r*Math.cos(a),r*Math.sin(a)]);
test('radial contact reports are detached snapshots of private query counters',()=>{
  const contact=prepareRadialSleeveContact({curveAt:()=>contourPath(loop()),anchorAt:()=>[0,0],startMm:0,endMm:1,toleranceMm:.1});
  const changed=contact.report();changed.contactSamples=999;
  const frozen=Object.freeze(contact.report());
  contact.at([15,0,.2]);
  const later=contact.report();
  assert.notStrictEqual(later,frozen);assert.notEqual(later.contactSamples,999);
  assert.equal(later.contactSamples,frozen.contactSamples+1);
});
test('radial preparation shares interval endpoints and preserves unilateral fidelity',()=>{
  const source=loop(),contact=prepareRadialSleeveContact({curveAt:z=>contourPath(source.map(([x,y])=>[x*(1+z*.01),y*(1+z*.01)])),
    anchorAt:()=>[0,0],startMm:0,endMm:1,stepMm:.4,toleranceMm:.1});
  for(const z of [0,.2,.4,.8,1]){
    const p=[15,0,z],full=contact.at(p),partial=contact.at(p,.37);
    full.forEach((v,k)=>assert.ok(Math.abs(partial[k]-(p[k]+.37*(v-p[k])))<1e-9));
    assert.deepEqual(contact.at([2,2,z]),[2,2,z]);
  }
  for(const z of [.4,.8])assert.ok(Math.hypot(...contact.at([15,0,z-1e-9]).map((v,k)=>v-contact.at([15,0,z+1e-9])[k]))<1e-7);
  assert.ok(contact.report().maxDetailCorrespondenceMm<.095);
});
test('moving radial folds retain boundary detail with continuous contact across height slabs',()=>{
  const source=loop(),at=z=>source.map(([x,y])=>[x*Math.cos(z*.002)-y*Math.sin(z*.002),x*Math.sin(z*.002)+y*Math.cos(z*.002)]);
  const contact=prepareRadialSleeveContact({curveAt:z=>contourPath(at(z)),anchorAt:()=>[0,0],startMm:0,endMm:1,stepMm:.4,toleranceMm:.1});
  for(const z of [.07,.21,.4,.63,.8,.97])for(let i=0;i<64;i++){
    const theta=i*Math.PI/32,p=contact.at([15*Math.cos(theta),15*Math.sin(theta),z]),boundary=at(z);
    assert.ok(Math.min(...boundary.map((a,j)=>pointSegmentDistance(p,a,boundary[(j+1)%boundary.length])))<=.1);
  }
  for(const z of [.4,.8])for(const theta of [.099,.100,.101]){
    const a=contact.at([15*Math.cos(theta),15*Math.sin(theta),z-1e-9]),b=contact.at([15*Math.cos(theta),15*Math.sin(theta),z+1e-9]);
    assert.ok(Math.hypot(...a.map((v,k)=>v-b[k]))<1e-5);
  }
  const outside=prepareRadialSleeveContact({curveAt:z=>contourPath(at(z)),anchorAt:()=>[0,0],startMm:0,endMm:1,side:'outside',toleranceMm:.1});
  assert.deepEqual(outside.at([20,0,.2]),[20,0,.2]);assert.ok(outside.at([5,0,.2])[0]>9);
});
test('floating-point terminal heights do not create a zero-width preparation slab',()=>{
  const contact=prepareRadialSleeveContact({curveAt:()=>contourPath(loop()),anchorAt:()=>[0,0],startMm:11.6,endMm:12.4,stepMm:.4,toleranceMm:.1});
  assert.ok(contact.at([15,0,12.4]).every(Number.isFinite));
});
test('profile interpolation spends only the tolerance remaining after actual source approximation',()=>{
  const ring=r=>Array.from({length:32},(_,i)=>[r*Math.cos(i*Math.PI/16),r*Math.sin(i*Math.PI/16)]);
  const contact=prepareRadialSleeveContact({curveAt:z=>contourPath(ring(12+z*z)),anchorAt:()=>[0,0],startMm:0,endMm:1,stepMm:1,toleranceMm:.1,samples:256});
  for(const z of [.25,.75]){
    const p=contact.at([20,0,z]);assert.ok(Math.abs(p[0]-(12+z*z))<=.1);
  }
  assert.equal(contact.report().contactIntervals,3,'source profiles with negligible sampling error retain a larger interpolation allowance');
  assert.ok(contact.report().maxProfileInterpolationTargetMm>.099);
  assert.ok(contact.report().maxSampledProfileCombinedErrorMm>.05&&contact.report().maxSampledProfileCombinedErrorMm<=.1);
});
test('a horizontal mesh ledge permits a continuous centerline transition within 3D tolerance',()=>{
  const n=16,ring=r=>Array.from({length:n},(_,i)=>[r*Math.cos(i*2*Math.PI/n),r*Math.sin(i*2*Math.PI/n)]);
  const vertices=[[0,0,0],...[[12,0],[12,1],[10,1],[10,2]].flatMap(([r,z])=>ring(r).map(p=>[...p,z])),[0,0,2]],triangles=[];
  for(let i=0;i<n;i++){
    triangles.push([0,1+(i+1)%n,1+i],[vertices.length-1,1+3*n+i,1+3*n+(i+1)%n]);
    for(let row=0;row<3;row++){
      const a=1+row*n+i,b=1+row*n+(i+1)%n,c=b+n,d=a+n;triangles.push([a,b,c],[a,c,d]);
    }
  }
  const distance=createMeshDistanceQuery(makeMesh(vertices,triangles));
  const contact=prepareRadialSleeveContact({curveAt:z=>contourPath(ring(z<=1?12:10)),anchorAt:()=>[0,0],
    startMm:.2,endMm:1.8,stepMm:.4,toleranceMm:.1,samples:256,distanceToSourceWithin:distance});
  const points=[1-1e-7,1,1+1e-7].map(z=>contact.at([15,0,z]));
  assert.ok(contact.report().meshTransitionIntervals>0);assert.ok(points.every(p=>distance(p,.1)<=.1));
  assert.ok(Math.hypot(...points[0].map((v,k)=>v-points[2][k]))<.01);
  assert.deepEqual(contact.at([2,0,1]),[2,0,1]);
});

test('a step the source cannot interpolate is reported as a step, not a spent budget',()=>{
  const ring=r=>Array.from({length:32},(_,i)=>[r*Math.cos(i*Math.PI/16),r*Math.sin(i*Math.PI/16)]);
  const contact=prepareRadialSleeveContact({curveAt:z=>contourPath(ring(z<=1?12:10)),anchorAt:()=>[0,0],
    startMm:.2,endMm:1.8,stepMm:.4,toleranceMm:.1,samples:256});
  assert.throws(()=>contact.at([15,0,1]),/steps within one representable height/);
  // The retired depth-16 ceiling stopped long before the height itself ran out.
  assert.ok(contact.report().maxDepth>16);
});
