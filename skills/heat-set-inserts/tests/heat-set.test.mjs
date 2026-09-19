import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../../../core/print/plan.mjs';
import {buildShell,translateShell,generatePath} from '../../../core/print/generate.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {fullFillResult} from '../../full-fill/scripts/fill.mjs';
import {planarInfillResults} from '../../planar-infill/scripts/infill.mjs';
import {compileHeatSet} from '../scripts/geometry.mjs';
import {heatSetFeature,dimensions} from '../scripts/feature.mjs';
import {heatSetDetails} from '../scripts/reinforcement.mjs';
import {INSERT_CATALOG} from '../scripts/catalog.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {loopArea,pointInRegion} from '../../../core/region/region2d.mjs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compileText} from '../../text/scripts/text.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {initBundle} from '../../../core/print/bundle.mjs';
import {applyHeatSet} from '../../../core/print/heat-set.mjs';

const machine=loadMachine(),base=boxMesh(40,40,12),feature=heatSetFeature({positionMm:[20,20,12]});
const geometry=await compileHeatSet(base,[feature],{buildGeometry:g=>buildShell(null,g)});
const shell=buildShell(null,geometry),plan=defaults(machine);
plan.geometry=geometry;plan.placement={xMm:30,yMm:30};plan.skills['draped-skin'].enabled=false;

test('catalog hole geometry matches independent dimensions and blind depth',()=>{
  assert.deepEqual(dimensions(feature),{diameterMm:3.99,depthMm:6.74,ribCount:7,chamferDepthMm:0,chamferAngleDeg:45,minWallThicknessMm:null});
  assert.equal(sectionGeometry(shell,5).loops.length,1);
  const hole=sectionGeometry(shell,6).loops.find(l=>loopArea(l)<0);
  assert.ok(hole);
  for(const p of hole)assert.ok(Math.abs(Math.hypot(p[0]-20,p[1]-20)-1.995)<0.011);
});

test('ribs: one per 2 mm of bore perimeter, 10 mm long, full length over the whole bore depth',()=>{
  const detailAt=z=>shell.planarDetails.at(sectionGeometry(shell,z).loops,z,{widthMm:.4,perimeters:2,pitchMm:.4});
  assert.equal(dimensions(feature).ribCount,Math.ceil(Math.PI*3.99/2));
  for(const z of [5.4,7,9.6,12]){
    const detail=detailAt(z),pieces=detail.finRegion.filter(l=>loopArea(l)>0);
    assert.equal(pieces.length,7,'one rib per 2 mm of bore perimeter, rounded up');
    const reach=Math.max(...pieces.flat().map(p=>Math.hypot(p[0]-20,p[1]-20)));
    assert.ok(Math.abs(reach-(1.995+4*.4+10))<.03,'ribs extend 10 mm beyond the four sleeve loops at every layer, not a taper');
    assert.equal(detail.fins.length,0,'ribs are part of the last loop, not separate strokes');
    assert.equal(detail.walls.length,4);
  }
});

test('the last loop is one continuous closed path with a two-bead out-and-back tendril per rib',()=>{
  const detail=shell.planarDetails.at(sectionGeometry(shell,8).loops,8,{widthMm:.4,perimeters:2,pitchMm:.4});
  const star=detail.walls.at(-1),ring=detail.walls[2],tip=20+1.995+4*.4+10-.2;
  assert.equal(star.closed,true);
  // Rib 0 lies along +X: its tip is a 0.4 mm cross-step between two legs at +/-0.2 mm.
  const atTip=star.points.filter(p=>Math.abs(p[0]-tip)<.01).sort((a,b)=>a[1]-b[1]);
  assert.equal(atTip.length,2,'exactly one turnaround at the tip');
  assert.ok(Math.abs(atTip[0][1]-19.8)<.01&&Math.abs(atTip[1][1]-20.2)<.01,'two touching beads, 0.4 mm apart');
  const at=star.points.findIndex(p=>Math.abs(p[0]-tip)<.01&&p[1]<20);
  const before=star.points[at-1],after=star.points[at+2];
  assert.ok(Math.abs(before[1]-19.8)<.01&&Math.abs(after[1]-20.2)<.01&&before[0]<tip-5&&after[0]<tip-5,'straight legs out and straight back, each starting on the loop');
  const reach=Math.max(...star.points.map(p=>Math.hypot(p[0]-20,p[1]-20)));
  assert.ok(reach>tip-20-.05&&reach<tip-20+.1);
  assert.ok(Math.max(...ring.points.map(p=>Math.hypot(p[0]-20,p[1]-20)))<1.995+3*.4,'the inner loops stay plain rings');
});

test('sparse infill runs straight across the ribs instead of stopping at them',()=>{
  const p=structuredClone(plan);p.skills['planar-infill'].enabled=true;p.skills['full-fill'].mode='solid-surfaces';
  const placed=translateShell(shell,30,40,0);
  const detail=placed.planarDetails.at(sectionGeometry(placed,10).loops,10,{widthMm:.4,perimeters:2,pitchMm:.4});
  assert.equal(pointInRegion([50+8,60],detail.fillExclusion),false,'ribs are not reserved from infill');
  assert.equal(pointInRegion([50+2.5,60],detail.fillExclusion),true,'the bore and loops still are');
  const infill=planarInfillResults({shell:placed,plan:p,machine,solid:true}).flatMap(r=>r.operations).filter(o=>Math.abs(o.rank-10)<1e-8).flatMap(o=>o.strokes).filter(s=>s.role==='infill');
  const inRib=q=>pointInRegion(q,detail.finRegion);
  const crosses=infill.some(s=>s.points.slice(1).some((b,i)=>{
    const a=s.points[i];if(inRib(a)||inRib(b))return false;
    for(let t=.05;t<1;t+=.05)if(inRib([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]))return true;
    return false;
  }));
  assert.ok(crosses,'a single infill stroke passes over a rib without starting or stopping there');
});

test('ribs stop at ordinary walls and other holes instead of failing, and skip already-solid layers',async()=>{
  const small=boxMesh(24,24,12),geometry2=await compileHeatSet(small,[heatSetFeature({positionMm:[12,12,12]})],{buildGeometry:g=>buildShell(null,g)});
  const shell2=buildShell(null,geometry2),loops=sectionGeometry(shell2,8).loops;
  const detail=shell2.planarDetails.at(loops,8,{widthMm:.4,perimeters:2,pitchMm:.4});
  const points=detail.finRegion.flat();
  assert.ok(points.length>0);
  assert.ok(points.every(p=>p[0]>=.8-.02&&p[0]<=23.2+.02&&p[1]>=.8-.02&&p[1]<=23.2+.02),'ribs end at the inside of the last ordinary perimeter');
  assert.ok(Math.max(...points.map(p=>p[0]))>23.2-.05,'a rib actually reaches the wall to tie the sleeve to it');
  const solid=[[[0,0],[24,0],[24,24],[0,24]]],skinDetail=shell2.planarDetails.at(loops,8,{widthMm:.4,perimeters:2,pitchMm:.4,solid});
  assert.equal(skinDetail.fins.length,0,'no ribs inside a solid surface layer');
  assert.equal(skinDetail.walls.length,4,'the four loops still surround the bore');
  const starPoints=detail.walls.at(-1).points;
  assert.ok(starPoints.every(p=>p[0]>=.8-.02&&p[0]<=23.2+.02&&p[1]>=.8-.02&&p[1]<=23.2+.02),'tendrils stay inside the exterior perimeters');
  assert.ok(Math.max(...skinDetail.walls.at(-1).points.map(p=>Math.hypot(p[0]-12,p[1]-12)))<1.995+4*.4+.1,'a solid layer leaves the last loop a plain ring');
});

test('four contiguous loops override ordinary loop count and spacing; interiors exclude sleeve and ribs',()=>{
  for(const perimeters of [0,1,3,8])for(const spacingFactor of [1,1.4]){
    const p=structuredClone(plan);Object.assign(p.skills['full-fill'],{perimeters,spacingFactor});
    const result=fullFillResult({shell,plan:p,machine});
    const layer=result.operations.filter(o=>Math.abs(o.rank-8)<1e-8),strokes=layer.flatMap(o=>o.strokes);
    const loops=strokes.filter(s=>s.role==='heat-set-loop');assert.equal(loops.length,4);
    assert.equal(strokes.filter(s=>s.role==='heat-set-fin').length,0);
    const radii=loops.map(s=>s.points.reduce((sum,q)=>sum+Math.hypot(q[0]-20,q[1]-20),0)/s.points.length).sort((a,b)=>a-b);
    radii.slice(0,3).forEach((r,i)=>assert.ok(Math.abs(r-(1.995+(i+.5)*.4))<.025));
    assert.ok(radii[3]>1.995+3.5*.4+1,'the last loop carries the tendrils');
    const detail=shell.planarDetails.at(sectionGeometry(shell,8).loops,8,{widthMm:.4,perimeters,pitchMm:.4*spacingFactor});
    for(const s of strokes.filter(s=>s.role==='fill'))for(let i=1;i<s.points.length;i++)for(let t=0;t<=1;t+=.2){
      const a=s.points[i-1],b=s.points[i],q=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
      assert.equal(pointInRegion(q,detail.fillExclusion),false,'fill enters reserved reinforcement');
    }
  }
});

test('sparse and solid surface composition emits details once, keeps solid skins rib-free and retains local details when translated',()=>{
  const p=structuredClone(plan);p.skills['planar-infill'].enabled=true;p.skills['full-fill'].mode='solid-surfaces';
  const placed=translateShell(shell,30,40,2);
  const results=planarInfillResults({shell:placed,plan:p,machine,solid:true});
  const strokesAt=rank=>results.flatMap(r=>r.operations).filter(o=>Math.abs(o.rank-rank)<1e-8).flatMap(o=>o.strokes);
  const sparse=strokesAt(10),reachOf=loop=>Math.max(...loop.points.map(q=>Math.hypot(q[0]-50,q[1]-60)));
  assert.equal(sparse.filter(s=>s.role==='heat-set-loop').length,4);
  assert.equal(sparse.filter(s=>s.role==='heat-set-fin').length,0);
  const lastLoop=strokes=>strokes.filter(s=>s.role==='heat-set-loop').sort((a,b)=>reachOf(b)-reachOf(a))[0];
  assert.ok(reachOf(lastLoop(sparse))>10,'sparse layers print the tendrils, once');
  assert.ok(sparse.filter(s=>s.role==='heat-set-loop').every(s=>s.points.every(q=>Math.abs(q[0]-50)<14&&Math.abs(q[1]-60)<14)));
  const skin=strokesAt(13.8);
  assert.equal(skin.filter(s=>s.role==='heat-set-loop').length,4);
  assert.ok(reachOf(lastLoop(skin))<1.995+4*.4+.1,'ribs begin below the last solid surface layer');
});

test('blind holes get solid layers under their floor as wide as the ribs',()=>{
  const p=structuredClone(plan);p.skills['planar-infill'].enabled=true;p.skills['full-fill'].mode='solid-surfaces';
  const context={layerMm:.2,widthMm:.4,topLayers:3,bottomLayers:3},reach=1.995+4*.4+10,inside=(z,r)=>pointInRegion([20+r,20],shell.planarDetails.solidRegionAt(z,context));
  assert.ok(inside(5.2,reach-.5)&&inside(4.8,reach-.5),'the last three layers under the floor span the rib diameter');
  assert.ok(!inside(5.2,reach+.5)&&!inside(4.6,3)&&!inside(6,3),'and only those layers');
  const results=planarInfillResults({shell:translateShell(shell,30,40,0),plan:p,machine,solid:true});
  const floorFill=results.flatMap(r=>r.operations).filter(o=>Math.abs(o.rank-5.2)<1e-8).flatMap(o=>o.strokes).filter(s=>s.role==='fill');
  assert.ok(floorFill.some(s=>s.points.some(q=>Math.hypot(q[0]-50,q[1]-60)>6)),'solid floor fill extends well past the bore');
  const through=heatSetDetails([heatSetFeature({positionMm:[20,20,12],throughHole:true})]);
  assert.equal(through.hasSolidRegions,false,'through-holes have no closed end to widen');
});

test('native assembly and planar material regions use the same detail producer',()=>{
  const p=structuredClone(plan);p.geometry={shape:'assembly',parts:[{id:'mount',geometry,xMm:0,yMm:0,zMm:0},{id:'other',geometry:boxMesh(8,8,2),xMm:45,yMm:0,zMm:0}]};
  p.composition.regions=[{id:'base',part:'mount',zStartMm:0,zEndMm:4,lowerSurfaceFrom:null,skills:{'full-fill':{}}},{id:'mount',part:'mount',zStartMm:4,zEndMm:null,lowerSurfaceFrom:null,skills:{'planar-infill':{density:.15},'full-fill':{mode:'solid-surfaces'}}}];
  const result=generatePath(p,machine,null);
  assert.ok(result.actions.some(m=>m.role==='heat-set-loop'));
});

test('insert edits under raised text preserve text and rebuild the original bore once',async()=>{
  const r=await rhino(),bytes=await readFile(new URL('../../text/tests/fixtures/Abel-Regular.ttf',import.meta.url));
  const font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
  const p=structuredClone(plan);p.geometry=await compileText(geometry,[{id:'label',text:'A',font,positionMm:[2,2],sizeMm:3,reference:{kind:'plane',origin:[0,0,12],xAxis:[1,0,0],yAxis:[0,1,0]}}],{buildGeometry:g=>buildShell(r,g)});
  const dir=await mkdtemp(join(tmpdir(),'saam-heat-text-'));
  try{
    await initBundle(dir,p);
    const updated=await applyHeatSet(dir,{feature:{diameterAdjustmentMm:.1}});
    assert.equal(updated.plan.geometry.shape,'text');
    assert.equal(updated.plan.geometry.base.features.length,1);
    assert.equal(updated.plan.geometry.base.features[0].diameterAdjustmentMm,.1);
    const removed=await applyHeatSet(dir,{remove:'insert'});
    assert.equal(removed.plan.geometry.shape,'text');assert.equal(removed.plan.geometry.base.shape,'mesh');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('insufficient host and invalid feature settings fail explicitly',async()=>{
  assert.throws(()=>heatSetFeature({insertId:'M3'}),/catalog/);
  assert.throws(()=>heatSetFeature({finCount:0}),/finCount/);
  const unsupported=structuredClone(plan);unsupported.skills['full-fill'].enabled=false;unsupported.skills['vase-wall'].enabled=true;
  assert.throws(()=>generatePath(unsupported,machine,null),/planar fill/);
  await assert.rejects(compileHeatSet(base,[heatSetFeature({positionMm:[20,20,11]})],{buildGeometry:g=>buildShell(null,g)}),/insertion face/);
  const p=structuredClone(plan);p.skills['full-fill'].perimeters=45;
  assert.throws(()=>fullFillResult({shell,plan:p,machine}),/ordinary walls/);
});

test('catalog gained CNC Kitchen and a McMaster-Carr selection up to 1/2"-13, and neither offers M12',()=>{
  const cnckitchen=INSERT_CATALOG.filter(i=>i.manufacturer==='CNC Kitchen');
  assert.equal(cnckitchen.length,25);
  assert.ok(cnckitchen.some(i=>i.thread==='M10'));
  assert.ok(!INSERT_CATALOG.some(i=>i.thread==='M12'),'M12 is not a published heat-set-for-plastic size at either verified source');
  const mcmaster=INSERT_CATALOG.find(i=>i.id==='mcmaster-1_2-13');
  assert.ok(mcmaster);
  assert.equal(mcmaster.thread,'1/2-13');
  assert.equal(mcmaster.lengthMm,15.875);
  assert.equal(mcmaster.minWallThicknessMm,16.64);
});

test('chamfer widens the mouth radius and returns to nominal below it',async()=>{
  const chamferDepthMm=1,chamferAngleDeg=45;
  const chamfered=heatSetFeature({id:'chamfered',positionMm:[20,20,12],chamferDepthMm,chamferAngleDeg});
  const chamferedGeometry=await compileHeatSet(base,[chamfered],{buildGeometry:g=>buildShell(null,g)});
  const chamferedShell=buildShell(null,chamferedGeometry);
  const nominalR=dimensions(chamfered).diameterMm/2;
  const radiusAt=z=>{const hole=sectionGeometry(chamferedShell,z).loops.find(l=>loopArea(l)<0);return Math.max(...hole.map(p=>Math.hypot(p[0]-20,p[1]-20)));};
  assert.ok(Math.abs(radiusAt(12-chamferDepthMm-0.3)-nominalR)<0.02,'below the chamfer the hole stays nominal radius');
  const expectedAtMouth=nominalR+chamferDepthMm*Math.tan(chamferAngleDeg*Math.PI/180);
  assert.ok(Math.abs(radiusAt(11.99)-expectedAtMouth)<0.05,'near the mouth the hole widens by chamferDepthMm*tan(angle)');
});

test('a through-hole needs only the insert length, not the blind bottom clearance',async()=>{
  const thin=boxMesh(40,40,5.74);
  await assert.rejects(compileHeatSet(thin,[heatSetFeature({positionMm:[20,20,5.74]})],{buildGeometry:g=>buildShell(null,g)}),/floor/);
  const throughGeometry=await compileHeatSet(thin,[heatSetFeature({positionMm:[20,20,5.74],throughHole:true})],{buildGeometry:g=>buildShell(null,g)});
  const throughShell=buildShell(null,throughGeometry);
  assert.ok(sectionGeometry(throughShell,0.1).loops.some(l=>loopArea(l)<0),'the hole reaches the opposite face');
});

test('insertionSide bottom bores upward from the host\'s flat lowest face, with ribs over the whole depth',async()=>{
  const bottomFeature=heatSetFeature({positionMm:[20,20,0],insertionSide:'bottom'});
  const bottomGeometry=await compileHeatSet(base,[bottomFeature],{buildGeometry:g=>buildShell(null,g)});
  const bottomShell=buildShell(null,bottomGeometry);
  assert.ok(sectionGeometry(bottomShell,0.5).loops.some(l=>loopArea(l)<0),'bore is open near the bottom mouth');
  assert.equal(sectionGeometry(bottomShell,12).loops.filter(l=>loopArea(l)<0).length,0,'the top face is untouched');
  const nearMouth=sectionGeometry(bottomShell,0.5).loops;
  const nearMouthDetail=bottomShell.planarDetails.at(nearMouth,0.5,{widthMm:.4,perimeters:2,pitchMm:.4});
  const reach=d=>Math.max(...d.walls.at(-1).points.map(p=>Math.hypot(p[0]-20,p[1]-20)));
  assert.ok(reach(nearMouthDetail)>10,'ribs start at the bottom mouth');
  const floorZ=dimensions(bottomFeature).depthMm-0.2,nearFloor=sectionGeometry(bottomShell,floorZ).loops;
  const nearFloorDetail=bottomShell.planarDetails.at(nearFloor,floorZ,{widthMm:.4,perimeters:2,pitchMm:.4});
  assert.ok(Math.abs(reach(nearFloorDetail)-reach(nearMouthDetail))<.01,'ribs keep the same length all the way to the closed end');
});

test('manufacturer minimum wall is measured from the bore to the host wall',async()=>{
  const build=async(host,insertId,position)=>{
    const geometry3=await compileHeatSet(host,[heatSetFeature({positionMm:position,insertId})],{buildGeometry:g=>buildShell(null,g)});
    const shell3=buildShell(null,geometry3),plan3=defaults(machine);
    plan3.geometry=geometry3;plan3.placement={xMm:5,yMm:5};plan3.skills['draped-skin'].enabled=false;
    return ()=>fullFillResult({shell:shell3,plan:plan3,machine});
  };
  await assert.doesNotReject(async()=>(await build(boxMesh(20,20,16),'cnckitchen-m6-12.7',[10,10,16]))(),'6 mm of wall meets CNC Kitchen\'s 3.3 mm M6 minimum');
  assert.throws(await build(boxMesh(40,40,30),'mcmaster-1_2-13',[20,20,30]),/minimum wall/,'12 mm of wall is short of McMaster\'s 16.64 mm');
});
