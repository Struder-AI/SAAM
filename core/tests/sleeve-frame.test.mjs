import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLooseSleeveOffsets} from '../geom/sleeve-frame.mjs';
import {fitMeshSleeve} from '../geom/mesh-sleeve.mjs';
import {evaluate} from '../geom/nurbs.mjs';
import {flutedVase} from './fixtures/mesh-sleeve.mjs';

test('ordinary loose offsets preserve control count, degrees, knots and weights at signed depths',()=>{
  const fit=fitMeshSleeve(flutedVase(),{zMinMm:.2,zMaxMm:19.8}),frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm});
  for(const depth of [-5,-.2,0,.2,3]){
    const shifted=frame.offsetPatch(depth);
    for(const key of ['nu','nv','orderU','orderV','knotsU','knotsV'])assert.deepEqual(shifted[key],fit.patch[key]);
    assert.equal(shifted.cp.length,fit.patch.cp.length);
    for(let i=0;i<shifted.cp.length;i+=4){assert.equal(shifted.cp[i+3],fit.patch.cp[i+3]);assert.equal(shifted.cp[i+2],fit.patch.cp[i+2]);}
    for(const u of [0,.013,.371,.999])for(const z of [.2,3.7,13.9,19.8]){
      const actual=frame.at(u,z,depth),expected=evaluate(shifted,u,(z-.2)/19.6,false).point;
      assert.ok(Math.hypot(...actual.map((x,k)=>x-expected[k]))<1e-12);
      assert.equal(actual[2],z);
    }
  }
  assert.equal(frame.report().offsetControlCount,90);
});

test('ordinary loose offsets retain periodic phase and are affine in depth without renormalization',()=>{
  const fit=fitMeshSleeve(flutedVase(),{zMinMm:.2,zMaxMm:19.8}),frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm});
  let nonunit=false;
  for(const z of [.2,7.3,19.8])for(let i=0;i<31;i++){
    const u=i/31,a=frame.at(u,z,0),b=frame.at(u,z,1),c=frame.at(u,z,-3),f=frame.frameAt(u,z);
    for(let k=0;k<3;k++)assert.ok(Math.abs(c[k]-(a[k]-3*(b[k]-a[k])))<1e-12);
    assert.ok(Math.hypot(...a.map((x,k)=>x-frame.at(u+1,z,0)[k]))<1e-12);
    assert.ok(Math.hypot(...frame.at(-1e-10,z,-3).map((x,k)=>x-frame.at(1e-10,z,-3)[k]))<1e-7);
    if(Math.abs(Math.hypot(...f.direction)-1)>.001)nonunit=true;
  }
  assert.ok(nonunit,'the fixed spline direction field is not normalized pointwise');
  assert.throws(()=>frame.at(.1,22,0),/height range/);
  assert.throws(()=>frame.offsetPatch(Infinity),/finite/);
});

test('offset tightness continuously blends loose and exact horizontal-normal queries without changing the reference net',()=>{
  const fit=fitMeshSleeve(flutedVase(),{zMinMm:.2,zMaxMm:19.8}),original=fit.patch.cp.slice(),frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm});
  for(const u of [.017,.213,.71])for(const z of [.2,3.7,19.8])for(const d of [-2,.2,3]){
    const loose=frame.at(u,z,d,0),tight=frame.at(u,z,d,1),middle=frame.at(u,z,d,.37),base=fit.pointAt(u,z);
    const {du}=evaluate(fit.patch,u,(z-.2)/19.6),length=Math.hypot(du[0],du[1]);
    assert.ok(Math.abs(Math.hypot(tight[0]-base[0],tight[1]-base[1])-Math.abs(d))<1e-12);
    assert.ok(Math.abs((tight[0]-base[0])*du[0]+(tight[1]-base[1])*du[1])<1e-10);
    assert.ok(Math.abs((tight[0]-base[0])*du[1]/length-(tight[1]-base[1])*du[0]/length-d)<1e-12);
    for(let k=0;k<3;k++)assert.ok(Math.abs(middle[k]-(loose[k]+.37*(tight[k]-loose[k])))<1e-12);
    assert.equal(tight[2],z);
  }
  assert.deepEqual(fit.patch.cp,original);
  assert.throws(()=>frame.at(0,2,1,1.1),/tightness/);
  assert.throws(()=>frame.offsetPatch(1,.5),/Only zero tightness/);
});

test('over-curvature limits local sleeve depth while retaining smooth periodic control structure',()=>{
  const fit=fitMeshSleeve(flutedVase({ripple:0})),original=fit.patch.cp.slice();
  const frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm});
  const shallow=frame.offsetPatch(-1),limited=frame.offsetPatch(-11.5);
  const depths=[];
  for(let i=0;i<limited.cp.length;i+=4){
    const direction=[0,1].map(k=>shallow.cp[i+k]-original[i+k]),delta=[0,1].map(k=>limited.cp[i+k]-original[i+k]);
    depths.push(Math.hypot(...delta)/Math.hypot(...direction));
    assert.equal(limited.cp[i+3],original[i+3]);assert.equal(limited.cp[i+2],original[i+2]);
  }
  assert.ok(Math.min(...depths)<10.5);assert.ok(Math.max(...depths)>11.49,'safe upper controls retain the requested depth');
  for(const key of ['nu','nv','orderU','orderV','knotsU','knotsV'])assert.deepEqual(limited[key],fit.patch[key]);
  for(const depth of [-11.5,-30]){
    const patch=frame.offsetPatch(depth);
    // Independent, denser samples between the limiter's construction grid.
    for(let j=0;j<=29;j++)for(let i=0;i<97;i++){
      const u=(i+.37)/97,v=j/29,a=evaluate(fit.patch,u,v),b=evaluate(patch,u,v);
      assert.ok(a.du[0]*b.du[0]+a.du[1]*b.du[1]>0,'offset traversal never reverses');
      assert.ok(Math.hypot(...b.du)>1e-3);
      if(i===0){
        const left=evaluate(patch,0,v),right=evaluate(patch,1,v);
        for(const name of ['point','du','dv'])for(let k=0;k<3;k++)assert.ok(Math.abs(left[name][k]-right[name][k])<1e-9);
      }
    }
    const a=frame.at(.13,7.1,depth),expected=evaluate(patch,.13,7.1/20,false).point;
    for(let k=0;k<3;k++)assert.ok(Math.abs(a[k]-expected[k])<1e-10);
    const next=frame.at(.13,7.1,depth+1e-7);
    assert.ok(Math.hypot(...a.map((x,k)=>x-next[k]))<1e-5,'depth changes remain continuous');
  }
  const cached=frame.offsetPatch(-30);cached.cp.fill(0);
  assert.ok(frame.offsetPatch(-30).cp.some(x=>x!==0),'callers cannot mutate the cached patch');
  assert.deepEqual(fit.patch.cp,original);assert.ok(frame.report().maxControlDepthReductionMm>0);
});
