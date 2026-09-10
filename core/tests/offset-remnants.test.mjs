import test from 'node:test';
import assert from 'node:assert/strict';
import {offsetRegion,pointInRegion,SegmentIndex,regionArea} from '../region/region2d.mjs';

test('inward offsets collapse acute thin remnants instead of creating distant miter polygons',()=>{
  const thin=[[0,0],[10,0],[0,0.001]];
  assert.deepEqual(offsetRegion([thin],-0.2),[]);
  const square=[[20,0],[24,0],[24,4],[20,4]],offset=offsetRegion([thin,square],-0.2);
  assert.equal(offset.length,1);
  assert.ok(offset[0].every(p=>p[0]>=20&&p[0]<=24&&p[1]>=0&&p[1]<=4));
  // Actual six-vertex remnant from the curved vertical-shell reservation at
  // Z=2.8; its near-reversing corner previously produced a ~393x miter.
  const remnant=[[140.34389879667611,100.08328798982],[140.17777777777778,100.04394960403442],
    [139.78759253386878,100.49935042581177],[139.83854166666666,100.375],[139.91796875,100.1875],[140,100]];
  for(const shrink of [0.2,0.6,1.14])assert.deepEqual(offsetRegion([remnant],-shrink),[]);
});

test('outward offsets used for deposited coverage retain their rounded expansion',()=>{
  const square=[[0,0],[4,0],[4,4],[0,4]],outward=offsetRegion([square],0.2);
  assert.ok(Math.abs(regionArea(outward)-(16+16*0.2+Math.PI*0.2**2))<0.03);
  for(const point of [[0,0],[4,4],[-0.19,2],[4.19,2]])assert.ok(pointInRegion(point,outward));
});

test('a substantial concave outline cannot retain an inward spike outside its own material',()=>{
  const outline=[[0,0],[10,0],[10,10],[5.01,10],[5,0.1],[4.99,10],[0,10]];
  const loops=[outline],offset=offsetRegion(loops,-0.2),index=new SegmentIndex(loops,0.5);
  assert.ok(offset.length>0);
  for(const loop of offset)for(const p of loop){
    assert.ok(pointInRegion(p,loops),'inward point must belong to source material');
    assert.ok(index.distanceTo(p,1)>=0.199,'inward point retains its offset standoff');
  }
});
