import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSleeveContact} from '../geom/sleeve-contact.mjs';
import {cleanPlanarLoop} from '../geom/polyline.mjs';
const square=[[0,0],[10,0],[10,10],[0,10]];
test('sleeve contact reports are detached snapshots of private query counters',()=>{
  const contact=prepareSleeveContact({loopsAt:()=>[square],anchorAt:()=>[5,5]});
  const changed=contact.report();changed.contactSamples=999;
  const frozen=Object.freeze(contact.report());
  contact.at([12,5,2]);
  const later=contact.report();
  assert.notStrictEqual(later,frozen);assert.notEqual(later.contactSamples,999);
  assert.equal(later.contactSamples,frozen.contactSamples+1);
});
test('contact compresses only the forbidden side and blends continuously',()=>{
  const c=prepareSleeveContact({loopsAt:()=>[square],anchorAt:()=>[5,5]});
  for(const fidelity of [0,.01,.27,.5,.93,1]){
    assert.deepEqual(c.at([8,5,2],fidelity),[8,5,2]);
    assert.deepEqual(c.at([12,5,2],fidelity),[12-2*fidelity,5,2]);
  }
  assert.deepEqual(c.at([12,12,2]),[10,10,2]);
  assert.equal(c.report().contactSections,1);
});
test('contact can face outward, keeps actual height and follows translated sections',()=>{
  const c=prepareSleeveContact({loopsAt:z=>[square.map(([x,y])=>[x+z,y-3])],anchorAt:z=>[5+z,2],side:'outside'});
  assert.deepEqual(c.at([3,2,2]),[2,2,2]);
  assert.deepEqual(c.at([20,2,2]),[20,2,2]);
  assert.deepEqual(c.at([4,2,3],.5),[3.5,2,3]);
});
test('zero fidelity avoids mesh queries; invalid contact inputs fail explicitly',()=>{
  const c=prepareSleeveContact({loopsAt:()=>{throw Error('queried');},anchorAt:()=>[5,5]});
  assert.deepEqual(c.at([1,2,3],0),[1,2,3]);
  assert.throws(()=>c.at([1,2,3],1.01),/fidelity/);
  assert.throws(()=>prepareSleeveContact({loopsAt:()=>[],anchorAt:()=>[5,5],side:'either'}),/inside\/outside/);
  assert.throws(()=>prepareSleeveContact({loopsAt:()=>[],anchorAt:()=>[5,5]}).at([1,2,3]),/boundary is empty/);
});

test('radial contact stays continuous across concave nearest-projection ambiguities',()=>{
  const loop=[[0,0],[10,0],[10,9],[6,6],[5,10],[0,10]];
  const contact=prepareSleeveContact({loopsAt:()=>[loop],anchorAt:()=>[5,5]});
  const p=contact.at([6,9,0]);
  assert.ok(Math.abs(p[0]-5.625)<1e-12);assert.ok(Math.abs(p[1]-7.5)<1e-12);
  for(let i=-100;i<100;i++){
    const a=contact.at([6+i*.0001,9,0]),b=contact.at([6+(i+1)*.0001,9,0]);
    assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.001);
  }
  const folded=[[0,0],[10,0],[10,10],[7,10],[7,3],[3,3],[3,10],[0,10]];
  const invalid=prepareSleeveContact({loopsAt:()=>[folded],anchorAt:()=>[5,1]});
  assert.throws(()=>invalid.at([11,5,0]),/star-shaped section/);
});

test('explicit grid cleanup may remove sub-tolerance reversals while the shared default preserves them',()=>{
  const loop=[[0,0],[10,0],[10,10],[5,10],[5,10.00001],[0,10]];
  assert.ok(cleanPlanarLoop(loop,.00002).some(p=>p[1]>10));
  const simplified=cleanPlanarLoop(loop,.00002,{preserveReversals:false});
  assert.ok(simplified.every(p=>p[1]<=10));
  const contact=prepareSleeveContact({loopsAt:()=>[simplified],anchorAt:()=>[5,5]});
  assert.deepEqual(contact.at([5,11,0]),[5,10,0]);
});
