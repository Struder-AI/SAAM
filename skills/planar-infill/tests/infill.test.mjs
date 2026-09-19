import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {infillStrokes,INFILL_PATTERNS} from '../scripts/patterns.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {planarInfillResults} from '../scripts/infill.mjs';

test('sparse and solid partners clip a shared reservation only once per layer',()=>{
  const geometry=boxMesh(12,10,2),shell=makeMesh(geometry.vertices,geometry.triangles),plan=defaults();
  const footprint=[[[0,0],[12,0],[12,10],[0,10]]];
  for(const solid of [false,true]){
    let footprintReads=0;
    const reserve={get footprint(){footprintReads++;return footprint;},field:{xs:[0,12],ys:[0,10],values:[[1.5,1.5],[2.5,2.5]]}};
    const results=planarInfillResults({shell,plan,reserve,solid});
    assert.equal(footprintReads,10,'one reservation clipping pass for ten layers, including partial layers');
    const expected=planarInfillResults({shell,plan,reserve:{footprint,field:reserve.field},solid});
    assert.deepEqual(results.map(r=>r.operations.map(op=>op.strokes)),expected.map(r=>r.operations.map(op=>op.strokes)));
    assert.ok(results.some(r=>r.operations.length));
  }
});

test('a wall count above the rarely-useful advice is accepted and printed',async()=>{
  // Eight walls is manual advice, not a ceiling; ten walls must generate.
  const r=await rhino(),machine=loadMachine(),plan=defaults(machine);
  plan.geometry={shape:'box',runMm:16,widthMm:14,heightMm:1};plan.process.minimumLayerSeconds=0;
  plan.skills['draped-skin'].enabled=false;
  Object.assign(plan.skills['planar-infill'],{enabled:true,perimeters:10});
  Object.assign(plan.skills['full-fill'],{mode:'solid-surfaces',bottomLayers:0,topLayers:0});
  validatePlan(plan,machine);
  const walls=n=>{const p=structuredClone(plan);p.skills['planar-infill'].perimeters=n;
    return generatePath(p,machine,r).actions.filter(a=>a.volumeMm3>0&&a.role?.startsWith('perimeter')).length;};
  assert.ok(walls(10)>walls(2),'ten walls deposit more than two');
  plan.skills['planar-infill'].perimeters=-1;
  assert.throws(()=>validatePlan(plan,machine),/Infill perimeters/);
});

test('zero infill makes an open vessel with planar walls and a solid base through both exporters',async()=>{
  const region=[[[0,0],[10,0],[10,10],[0,10]]];
  for(const pattern of INFILL_PATTERNS)assert.deepEqual(infillStrokes(region,{pattern,widthMm:0.4,density:0}),[]);
  for(const density of [-0.1,NaN,Infinity])assert.throws(()=>infillStrokes(region,{widthMm:0.4,density}),/density/);
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const geometry of [boxMesh(16,12,4),{shape:'box',runMm:16,widthMm:12,heightMm:4}]){
    const machine=loadMachine(id),plan=defaults(machine);plan.geometry=geometry;plan.process.minimumLayerSeconds=0;
    plan.skills['draped-skin'].enabled=false;
    Object.assign(plan.skills['planar-infill'],{enabled:true,density:0,perimeters:2});
    Object.assign(plan.skills['full-fill'],{mode:'solid-surfaces',bottomLayers:5,topLayers:0});
    const path=generatePath(plan,machine,r),moves=path.actions.filter(a=>a.volumeMm3>0);
    assert.ok(!moves.some(a=>a.role==='infill'));
    assert.deepEqual([...new Set(moves.filter(a=>a.role==='fill').map(a=>a.layer))],[0,1,2,3,4]);
    assert.equal(new Set(moves.filter(a=>a.role==='perimeter').map(a=>a.layer)).size,20);
    let previous;
    for(const action of path.actions)if(action.kind==='move'){
      if(action.role==='perimeter'&&action.volumeMm3>0)assert.ok(previous&&Math.abs(action.to[2]-previous[2])<1e-9);
      previous=action.to;
    }
    const program=exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'});
    assert.equal(interpretProgram(program,plan,machine).moves.length,path.actions.filter(a=>a.kind==='move').length);
    plan.skills['planar-infill'].density=0.005;
    assert.throws(()=>generatePath(plan,machine,r),/zero or 0.01/);
  }
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
      const loops=moves.filter(a=>a.layer===i&&a.role==='perimeter'&&!a.connector).length;
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
