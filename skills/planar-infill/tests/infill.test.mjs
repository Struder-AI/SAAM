import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {intersect,difference,union} from '../../../core/region/boolean.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';

test('coincident sections and shared edges retain exact solid masks',()=>{
  const a=[[[0,0],[10,0],[10,10],[0,10]]],b=[[[5,0],[15,0],[15,10],[5,10]]];
  assert.equal(regionArea(intersect(a,a)),100);assert.deepEqual(difference(a,a),[]);
  assert.equal(regionArea(intersect(a,b)),50);assert.equal(regionArea(union(a,b)),150);assert.equal(regionArea(difference(a,b)),50);
});
test('planar infill and full-fill share walls and partition the solid layers on both machines/backends',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const geometry of [{shape:'box',runMm:16,widthMm:12,heightMm:4},boxMesh(16,12,4)]){
    const machine=loadMachine(id),plan=defaults(machine);plan.geometry=geometry;plan.process.minimumLayerSeconds=0;
    plan.skills['draped-skin'].enabled=false;plan.skills['planar-infill'].enabled=true;plan.skills['full-fill'].mode='solid-surfaces';
    const path=generatePath(plan,machine,r),moves=path.actions.filter(a=>a.volumeMm3>0);
    const solidLayers=[...new Set(moves.filter(a=>a.role==='fill').map(a=>a.layer))];
    assert.deepEqual(solidLayers,[0,1,2,17,18,19]);
    assert.ok(moves.filter(a=>a.role==='infill').every(a=>a.layer>=3&&a.layer<=16));
    for(let i=0;i<20;i++){
      const loops=moves.filter(a=>a.layer===i&&a.role==='perimeter').length;
      assert.equal(loops,4,'outer wall printed once');
    }
    const volume=layer=>moves.filter(a=>a.layer===layer&&['infill','fill'].includes(a.role)).reduce((s,a)=>s+a.volumeMm3,0);
    assert.ok(volume(5)/volume(1)>0.17&&volume(5)/volume(1)<0.23,'20% sparse interior density');
    const order=path.summary.composition.operationOrder;
    assert.ok(order.indexOf('planar-infill:solid:0:fill')<order.indexOf('planar-infill:1:walls'));
    plan.skills['full-fill'].mode='body';assert.throws(()=>generatePath(plan,machine,r),/overlap/);
  }
});
test('local sloping roofs receive solid masks below their local tops',async()=>{
  const machine=loadMachine(),plan=defaults(machine);plan.geometry=boxMesh(16,12,2,2);
  plan.skills['draped-skin'].enabled=false;plan.skills['planar-infill'].enabled=true;plan.skills['full-fill'].mode='solid-surfaces';plan.process.minimumLayerSeconds=0;
  const path=generatePath(plan,machine,await rhino());
  assert.ok(path.actions.some(a=>a.role==='fill'&&a.layer>3&&a.layer<16),'solid region appears below a local roof, before the final three global layers');
});

test('sparse infill completes disconnected regions per layer instead of bouncing across the gap',async()=>{
  const left=boxMesh(8,8,4),right=boxMesh(8,8,4);
  const geometry={shape:'mesh',vertices:[...left.vertices,...right.vertices.map(p=>[p[0]+20,p[1],p[2]])],
    triangles:[...left.triangles,...right.triangles.map(triangle=>triangle.map(index=>index+left.vertices.length))],source:null};
  const plan=defaults();plan.geometry=geometry;plan.process.minimumLayerSeconds=0;
  plan.skills['draped-skin'].enabled=false;plan.skills['planar-infill'].enabled=true;plan.skills['full-fill'].mode='solid-surfaces';
  const path=generatePath(plan,loadMachine(),await rhino());
  const moves=path.actions.filter(action=>action.operation==='planar-infill:5:fill'&&action.volumeMm3>0);
  const sides=moves.map(move=>move.to[0]<plan.placement.xMm+14?'left':'right');
  const firstRight=sides.indexOf('right');
  assert.ok(firstRight>0&&firstRight<sides.length,'both disconnected regions receive sparse fill');
  assert.ok(sides.slice(0,firstRight).every(side=>side==='left'),'left region is filled first on the layer');
  assert.ok(sides.slice(firstRight).every(side=>side==='right'),'right region follows without interleaving');
});

test('sparse body, solid surface masks and drape compose without overlap or reversed support order',async()=>{
  for(const id of ['ultimaker-s5','bambu-h2d']){
    const machine=loadMachine(id),plan=defaults(machine);plan.geometry=boxMesh(16,12,4);plan.process.minimumLayerSeconds=0;
    plan.skills['planar-infill'].enabled=true;plan.skills['full-fill'].mode='solid-surfaces';
    const path=generatePath(plan,machine,await rhino()),moves=path.actions.filter(a=>a.volumeMm3>0);
    const firstSkin=moves.findIndex(a=>a.phase==='draped-skin');assert.ok(firstSkin>0);
    assert.ok(moves.slice(firstSkin).every(a=>a.phase==='draped-skin'));
    assert.ok(Math.max(...moves.slice(0,firstSkin).map(a=>a.to[2]))<=3.6+1e-8);
    assert.ok(moves.slice(0,firstSkin).some(a=>a.role==='infill'));
    assert.ok(moves.slice(0,firstSkin).some(a=>a.role==='fill'));
  }
});
