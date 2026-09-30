import test from 'node:test';
import assert from 'node:assert/strict';
import {solidKernel,meshFromSolid} from '../../../core/geom/solid.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {sectionGeometry as sectionResult} from '../../../core/geom/query.mjs';
import {compileHeatSet} from '../scripts/geometry.mjs';
import {heatSetDetails} from '../scripts/reinforcement.mjs';
import {difference,intersect} from '../../../core/region/boolean.mjs';
import {regionArea,pointInRegion} from '../../../core/region/region2d.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
const sectionGeometry=(geometry,z)=>sectionResult(geometry,z).loops;
const options={stars:true,widthMm:0.4,perimeters:2,pitchMm:0.4};
const buildGeometry=g=>makeMesh(g.vertices,g.triangles);

test('bottom-entry long inserts retain through-bores and emit continuous boundary-limited stars in an 8 mm fin',async()=>{
  const k=await solidKernel();
  const base=k.Manifold.cube([48,32,4]),fin=k.Manifold.cube([36,8,12]).translate([6,12,4]);
  let host=base.add(fin);base.delete();fin.delete();
  for(const x of [15,24,33]){const bore=k.Manifold.cylinder(18,1.5,1.5,96).translate([x,16,-1]);const next=host.subtract(bore);host.delete();bore.delete();host=next;}
  const mesh=meshFromSolid(host);host.delete();
  const input={shape:'mesh',vertices:mesh.vertices,triangles:mesh.triangles,source:null};
  const record=await compileHeatSet(input,[15,24,33].map((x,i)=>({id:'mount-'+i,entry:'bottom',positionMm:[x,16,0]})),{buildGeometry});
  const result=buildGeometry(record),details=heatSetDetails(record.features);
  assert.deepEqual(result.bounds,mesh.bounds);
  const below=sectionGeometry(result,2),above=sectionGeometry(result,8);
  assert.equal(pointInRegion([16.8,16],below),false);
  assert.equal(pointInRegion([16.8,16],above),true);
  assert.equal(pointInRegion([15,16],above),false);
  for(const z of [0.2,2,4.2,5.5]){
    const region=sectionGeometry(result,z),d=details.at(region,z,options);
    assert.equal(d.walls.filter(s=>s.role==='heat-set-loop').length,9);
    const stars=d.walls.filter(s=>s.role==='heat-set-star');
    assert.equal(stars.length,3);
    assert.equal(d.fins.length,0);
    for(const star of stars){
      assert.equal(star.closed,true);
      const rays=star.points.filter((p,i,all)=>i>0&&i<all.length-1&&Math.hypot(all[i-1][0]-all[i+1][0],all[i-1][1]-all[i+1][1])<1e-9&&Math.hypot(p[0]-all[i-1][0],p[1]-all[i-1][1])>1e-6);
      assert.equal(rays.length,12);
      for(const tip of rays){const i=star.points.indexOf(tip);assert.ok(Math.hypot(tip[0]-star.points[i-1][0],tip[1]-star.points[i-1][1])<=7.98+1e-8);}
      for(const p of star.points)assert.ok(pointInRegion(p,region),'Star remains in solid material.');
      assert.ok(rays.some(tip=>!pointInRegion(tip,d.fillExclusion)),'Rays do not exclude crossing infill.');
    }
  }
  assert.equal(details.at(above,8,options).walls.length,0);
});

test('top and bottom entries mirror bore depth and constant ray length, with default top behavior retained',async()=>{
  const k=await solidKernel(),solid=k.Manifold.cube([30,30,12]),mesh=meshFromSolid(solid);solid.delete();
  const input={shape:'mesh',vertices:mesh.vertices,triangles:mesh.triangles,source:null};
  const top=await compileHeatSet(input,[{positionMm:[15,15,12]}],{buildGeometry});
  const bottom=await compileHeatSet(input,[{positionMm:[15,15,0],entry:'bottom'}],{buildGeometry});
  for(const distance of [0.2,2,5.5]){
    const a=heatSetDetails(top.features).at(sectionGeometry(buildGeometry(top),12-distance),12-distance,options);
    const b=heatSetDetails(bottom.features).at(sectionGeometry(buildGeometry(bottom),distance),distance,options);
    assert.equal(a.walls.length,4);assert.equal(b.walls.length,4);
    for(const d of [a,b]){
      const pts=d.walls[3].points;
      const lengths=pts.flatMap((p,i)=>i>0&&i<pts.length-1&&Math.hypot(pts[i-1][0]-pts[i+1][0],pts[i-1][1]-pts[i+1][1])<1e-9&&Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1])>1e-6?[Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1])]:[]);
      assert.equal(lengths.length,12);
      assert.ok(lengths.every(length=>Math.abs(length-7.98)<1e-8));
    }
    assert.ok(Math.abs(regionArea(a.finRegion)-regionArea(b.finRegion))<0.001);
  }
  await assert.rejects(compileHeatSet(input,[{positionMm:[15,15,12],entry:'bottom'}],{buildGeometry}),/depth|face/);
});

test('solid surface masks suppress stars; sparse stars stop at insert length and preserve inner-out order',async()=>{
  const {loadMachine}=await import('../../../core/machine/profile.mjs');
  const {defaults}=await import('../../../core/print/plan.mjs');
  const {planarInfillResults}=await import('../../planar-infill/scripts/infill.mjs');
  const {fullFillResult}=await import('../../full-fill/scripts/fill.mjs');
  const k=await solidKernel(),solid=k.Manifold.cube([30,30,12]),mesh=meshFromSolid(solid);solid.delete();
  const base={shape:'mesh',vertices:mesh.vertices,triangles:mesh.triangles,source:null};
  const machine=loadMachine('ultimaker-s5'),plan=defaults(machine);
  for(const entry of ['bottom','top']){
    const record=await compileHeatSet(base,[{entry,positionMm:[15,15,entry==='bottom'?0:12]}],{buildGeometry});
    const shell=buildGeometry(record);shell.planarDetails=heatSetDetails(record.features);
    const results=planarInfillResults({shell,plan,machine,solid:true});
    const ops=results.flatMap(r=>r.operations),stars=ops.filter(op=>op.strokes.some(s=>s.role==='heat-set-star'));
    assert.ok(stars.length>0);
    for(const op of stars){
      assert.equal(op.order,'given');
      const roles=op.strokes.filter(s=>s.role.startsWith('heat-set')).map(s=>s.role);
      assert.deepEqual(roles,['heat-set-loop','heat-set-loop','heat-set-loop','heat-set-star']);
      const z=op.strokes[0].points[0][2],distance=entry==='bottom'?z:12-z;
      assert.ok(z>0.6+1e-7&&z<11.6-1e-7,'No stars on bottom/top solid layers.');
      assert.ok(distance<5.74,'No stars in the clearance beyond insert length.');
    }
    const dense=structuredClone(plan);dense.skills['planar-infill'].density=1;
    assert.ok(planarInfillResults({shell,plan:dense,machine,solid:true}).every(r=>r.operations.every(op=>op.strokes.every(s=>s.role!=='heat-set-star'))));
    assert.ok(fullFillResult({shell,plan,machine}).operations.every(op=>op.strokes.every(s=>s.role!=='heat-set-star')));
  }
});
