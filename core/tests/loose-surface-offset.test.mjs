import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSurfaceOffsets} from '../geom/surface-offset.mjs';
import {evaluate} from '../geom/nurbs.mjs';

const patch=()=>({nu:2,nv:2,orderU:2,orderV:2,domainU:[2,5],domainV:[-3,1],
  knotsU:new Float64Array([2,2,5,5]),knotsV:new Float64Array([-3,-3,1,1]),
  cp:new Float64Array([0,0,0,1,0,3,0,1.5,4,0,0,2,2,2,2,1])});

test('generic nonperiodic rational surface offsets retain layout and support loose/tight normal interpolation',()=>{
  const source=patch(),original=source.cp.slice(),prepared=prepareSurfaceOffsets({patch:source,mode:'normal'});
  const loosePatch=prepared.offsetPatch(2);
  for(const key of ['nu','nv','orderU','orderV','knotsU','knotsV','domainU','domainV'])assert.deepEqual(loosePatch[key],source[key]);
  assert.equal(loosePatch.cp.length,source.cp.length);
  for(let k=3;k<source.cp.length;k+=4)assert.equal(loosePatch.cp[k],source.cp[k]);
  for(const u of [2,2.37,4.13,5])for(const v of [-3,-2.73,.71,1]){
    const loose=prepared.at(u,v,2,0),expected=evaluate(loosePatch,u,v,false).point,base=evaluate(source,u,v),tight=prepared.at(u,v,2,1),middle=prepared.at(u,v,2,.41);
    for(let k=0;k<3;k++){
      assert.ok(Math.abs(loose[k]-expected[k])<1e-12);
      assert.ok(Math.abs(tight[k]-(base.point[k]+2*base.normal[k]))<1e-12);
      assert.ok(Math.abs(middle[k]-(loose[k]+.41*(tight[k]-loose[k])))<1e-12);
    }
  }
  assert.deepEqual(source.cp,original);
  assert.throws(()=>prepared.at(5.1,0),/outside its patch domain/);
  assert.throws(()=>prepared.offsetPatch(2,.01),/Only zero tightness/);
  const horizontal=prepareSurfaceOffsets({patch:source,mode:'horizontal'});
  const base=evaluate(source,3,0,false).point;
  for(const t of [0,.5,1])assert.equal(horizontal.at(3,0,3,t)[2],base[2]);
});
