import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {generatePath,buildShell,translateShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {boxMesh,ringMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {loopArea,pointSegmentDistance} from '../../../core/region/region2d.mjs';
import {contourPath} from '../../../core/geom/contour-path.mjs';
import {distance} from '../../../core/geom/tolerance.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {initBundle,loadBundle,approve,generateBundle,deliver,adjustBundle,EXPORT_PATH} from '../../../core/print/bundle.mjs';
import {skillSettingsRows} from '../../../studio/settings.mjs';
import {loopDemoPlan,loopHost} from '../scripts/loop-demo.mjs';

function recipe(machine=loadMachine(),geometry=boxMesh(20,15,2)) {
  const plan=defaults(machine);plan.geometry=geometry;
  for(const s of Object.values(plan.skills))s.enabled=false;
  Object.assign(plan.skills['vase-wall'],{enabled:true,endTransition:'spiral',pattern:{advance:[1,.2],repeats:4,
    paths:[{points:[[0,0],[.25,.12],[.5,.08],[.75,.19],[1,.2]],beadHeightMm:.2}]}});
  return plan;
}
const wall=path=>path.actions.filter(a=>a.role==='vase-wall'||a.role==='segmented-path');

test('motifs follow actual solid and sleeve contours, including tapered meshes and concave splines',async()=>{
  const r=await rhino(),machine=loadMachine();
  const tapered=boxMesh(20,15,2);
  tapered.vertices=tapered.vertices.map(([x,y,z])=>[x*(1+z*.04)+z*.1,y*(1+z*.03),z]);
  for(const geometry of [boxMesh(20,15,2),tapered,ringMesh(),{shape:'vertical-spline-shell',runMm:10,widthMm:10,cpU:4,cpV:4,xBulgeMm:0,yInsetMm:1,heightsMm:Array.from({length:4},()=>[2,2,2,2])}]){
    const plan=recipe(machine,geometry),path=generatePath(plan,machine,r),shell=translateShell(buildShell(r,geometry),plan.placement.xMm,plan.placement.yMm);
    assert.equal(path.summary.vaseWall.repeats,4);
    for(const a of wall(path)) {
      const outer=sectionGeometry(shell,a.to[2]).loops.find(loop=>loopArea(loop)>0);
      assert.ok(Math.abs(Math.min(...outer.map((p,i)=>pointSegmentDistance(a.to,p,outer[(i+1)%outer.length])))-.2)<=plan.skills['vase-wall'].boundaryToleranceMm);
    }
    const moves=wall(path),between=path.actions.slice(path.actions.indexOf(moves[0]),path.actions.indexOf(moves.at(-1))+1);
    assert.ok(between.every(a=>a.kind==='move'&&a.volumeMm3>0));
    assert.ok(moves.some((a,i)=>i&&a.to[2]<moves[i-1].to[2]),'zigzag descends locally while advancing around the host');
  }
});

test('changing the host changes the pattern and cyclic contour ordering does not change its seam',async()=>{
  const r=await rhino(),a=recipe(),b=recipe();b.geometry=boxMesh(30,15,2);
  const ax=wall(generatePath(a,loadMachine(),r)),bx=wall(generatePath(b,loadMachine(),r));
  assert.ok(Math.abs(Math.max(...bx.map(m=>m.to[0]))-Math.max(...ax.map(m=>m.to[0]))-10)<1e-8);
  const loop=[[0,0],[10,0],[10,2],[2,2],[2,8],[10,8],[10,10],[0,10]];
  const curve=contourPath(loop),rotated=contourPath([...loop.slice(3),...loop.slice(0,3)]);
  for(let i=0;i<=100;i++)assert.ok(distance(curve.at(i/100),rotated.at(i/100))<1e-10);
});

test('continuity includes mapped periodic seams and repetition boundaries; segmented mode owns travel',async()=>{
  const machine=loadMachine(),r=await rhino(),plan=recipe();
  plan.skills['vase-wall'].pattern.advance[0]=0; // u=1 and u=0 are the same sleeve point.
  generatePath(plan,machine,r);
  plan.skills['vase-wall'].pattern.advance[0]=.5;
  assert.throws(()=>validatePlan(plan,machine),/repetitions must meet/);
  plan.skills['vase-wall'].pathMode='segmented';const path=generatePath(plan,machine,r),moves=wall(path);
  assert.ok(path.actions.slice(path.actions.indexOf(moves[0]),path.actions.indexOf(moves.at(-1))).some(a=>a.kind==='retract'));
  assert.ok(moves.every(a=>a.role==='segmented-path'));
  assert.match(JSON.stringify(skillSettingsRows('vase-wall',plan.skills['vase-wall'])),/selected solid or sleeve/);
});

test('only motif turns deposit, without a guide ring, lead-in or invented material under them',async()=>{
  const plan=recipe();plan.skills['vase-wall'].pattern.paths[0].points=[[0,0],[1,.2]];
  const path=generatePath(plan,loadMachine(),await rhino()),moves=wall(path),turn=moves.filter(m=>m.layer===1);
  assert.ok(path.summary.vaseWall.points>80,'full turns are sampled before collinear move compaction');
  assert.ok(turn.length>=4,'the complete contour survives compaction');let previous=path.initialPosition;
  assert.equal(path.summary.vaseWall.paths,4);
  assert.ok(moves.every(m=>m.layer>=1),'no implicit foundation or lead-in layer');
  for(const move of path.actions){
    if(move.kind!=='move')continue;
    if(move.role==='vase-wall'&&move.layer===1){
      const expected=distance(previous,move.to)*.4*.2;
      assert.ok(Math.abs(move.volumeMm3-expected)<1e-8);
    }previous=move.to;
  }
});

test('invalid motifs fail explicitly while pattern tilt remains a reported recipe choice',async()=>{
  const machine=loadMachine(),r=await rhino();
  const invalid=recipe();invalid.skills['vase-wall'].pattern.paths[0].points[0]=[0,0,.2];
  assert.throws(()=>validatePlan(invalid,machine),/not XYZ/);
  const tall=recipe();tall.skills['vase-wall'].pattern.repeats=20;
  assert.throws(()=>generatePath(tall,machine,r),/height interval/);
  const steep=recipe();steep.skills['vase-wall'].pattern.paths[0].points=[[0,0],[.0001,1],[1,.2]];
  assert.ok(generatePath(steep,machine,r).summary.vaseWall.maximumAngleDeg>machine.nonplanar.maxAngleDeg);
  const level=recipe();level.skills['vase-wall'].endTransition='level';assert.equal(generatePath(level,machine,r).summary.vaseWall.levelRimMm,2);
  // A finer sampling step takes more points; no construction budget can fail it.
  const fine=recipe();fine.skills['vase-wall'].sampleStepMm=.1;
  assert.ok(generatePath(fine,machine,r).summary.vaseWall.points>generatePath(recipe(),machine,r).summary.vaseWall.points);
});

test('mapped patterns round-trip machine source on S5, H2D and configured Dobot',async()=>{
  const r=await rhino();
  for(const machineId of ['ultimaker-s5','bambu-h2d','dobot-mg400']){
    const machine=loadMachine(machineId),plan=recipe(machine);if(machineId==='dobot-mg400')syntheticDobotSetup(plan);
    plan.skills['vase-wall'].pattern.paths[0].offsetMm=[0,1,2,1,0];
    const path=generatePath(plan,machine,r),program=interpretProgram(exportProgram(path,plan,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-09'}),plan,machine);
    const expected=path.actions.filter(a=>a.kind==='move');assert.equal(expected.length,program.moves.length);
    expected.forEach((m,i)=>m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6)));
  }
});

test('sleeve-relative offsets extend the motif and participate in continuous joins',async()=>{
  const plan=recipe(),machine=loadMachine(),r=await rhino();
  const baseline=wall(generatePath(plan,machine,r));
  plan.skills['vase-wall'].pattern.paths[0].offsetMm=[0,1,2,1,0];
  const expanded=wall(generatePath(plan,machine,r));
  assert.ok(Math.min(...expanded.map(m=>m.to[0]))<Math.min(...baseline.map(m=>m.to[0]))-1.7);
  const broken=structuredClone(plan);broken.skills['vase-wall'].pattern.paths[0].offsetMm[4]=1;
  assert.throws(()=>validatePlan(broken,machine),/repetitions must meet/);
  broken.skills['vase-wall'].pattern.paths[0].offsetMm=[0,1];
  assert.throws(()=>validatePlan(broken,machine),/one finite offset per point/);
  const explicitZero=recipe();explicitZero.skills['vase-wall'].pattern.paths[0].offsetMm=0;
  assert.deepEqual(wall(generatePath(explicitZero,machine,r)),baseline);
});

test('tilted overlapping loops wind inward, preserve the exterior and rise continuously through courses',async()=>{
  const plan=loopDemoPlan({courses:3}),path=generatePath(plan,loadMachine(),await rhino()),moves=wall(path);
  const radius=m=>Math.hypot(m.to[0]-125,m.to[1]-105);
  assert.ok(Math.max(...moves.map(radius))<=13.801,'the bead outer edge stays within the 14 mm host radius');
  assert.ok(Math.min(...moves.map(radius))<9.01,'the small loops have real inward depth');
  const between=path.actions.slice(path.actions.indexOf(moves[0]),path.actions.indexOf(moves.at(-1))+1);
  assert.ok(between.every(a=>a.kind==='move'&&a.volumeMm3>0));
  assert.equal(path.summary.vaseWall.paths,3,'only the three authored looping courses');
  assert.ok(moves.some((m,i)=>i&&m.to[2]<moves[i-1].to[2]),'loop tilt includes local descents');
  assert.ok(path.summary.vaseWall.maximumAngleDeg<10,'this example deliberately uses a gentle tilt');
  assert.ok(moves.at(-1).to[2]>.7,'the course repeats build up the host');
});

test('a motif away from the guide receives no extra deposition on the guide',async()=>{
  const plan=recipe();plan.skills['vase-wall'].pattern.paths[0].offsetMm=1;
  const path=generatePath(plan,loadMachine(),await rhino());
  assert.equal(path.summary.vaseWall.paths,4);
  const moves=wall(path);
  assert.ok(moves.every(m=>m.layer>=1));
  const hostMinX=plan.placement.xMm,hostMaxX=hostMinX+20,hostMinY=plan.placement.yMm,hostMaxY=hostMinY+15;
  assert.ok(moves.every(m=>m.to[0]<hostMinX||m.to[0]>hostMaxX||m.to[1]<hostMinY||m.to[1]>hostMaxY));
});

test('outward motifs scallop a solid host and actual-Z waves shift successive courses',async()=>{
  const plan=loopDemoPlan({courses:3,loopsPerTurn:8,samplesPerLoop:24,exterior:'scalloped',motifDepthMm:1.2,motifWidthMm:3.2});
  const r=await rhino(),machine=loadMachine();
  const straight=generatePath(plan,machine,r),straightMoves=wall(straight);
  assert.ok(Math.max(...straightMoves.map(m=>Math.hypot(m.to[0]-125,m.to[1]-105)))>14.9,'lobes extend beyond the guide');
  plan.geometry=loopHost({radius:14,heightMm:8,waveDepthMm:.6});
  const shell=buildShell(r,plan.geometry);
  assert.equal(sectionGeometry(shell,.4).loops.length,1,'the input is solid with no modeled bore');
  const wavy=generatePath(plan,machine,r),moves=wall(wavy),radialByLayer=new Map();
  for(const m of moves){
    const radius=Math.hypot(m.to[0]-125,m.to[1]-105);
    const range=radialByLayer.get(m.layer)??[Infinity,-Infinity];
    range[0]=Math.min(range[0],radius);range[1]=Math.max(range[1],radius);radialByLayer.set(m.layer,range);
  }
  assert.ok(Math.max(...moves.map(m=>Math.hypot(m.to[0]-125,m.to[1]-105)))<Math.max(...straightMoves.map(m=>Math.hypot(m.to[0]-125,m.to[1]-105)))-.02);
  assert.ok(Math.abs(radialByLayer.get(1)[0]-radialByLayer.get(2)[0])>.02,'courses follow changing host radii rather than register vertically');
  assert.ok(wavy.actions.slice(wavy.actions.indexOf(moves[0]),wavy.actions.indexOf(moves.at(-1))+1).every(a=>a.kind==='move'&&a.volumeMm3>0));
});

test('wide inward and outward loops map continuously across wavy mesh triangle seams',async()=>{
  const plan=loopDemoPlan({courses:36,loopsPerTurn:20,samplesPerLoop:64,
    exterior:'both-scalloped',motifWidthMm:8,motifDepthMm:4.8,waveDepthMm:.6});
  // Keep the full host's curvature but cover only the first six courses,
  // including the formerly unstable section near Z 1.234797974 mm.
  plan.skills['vase-wall'].pattern.repeats=6;
  const path=generatePath(plan,loadMachine(),await rhino()),moves=wall(path);
  assert.equal(path.summary.vaseWall.paths,6);
  const radii=moves.map(m=>Math.hypot(m.to[0]-125,m.to[1]-105));
  assert.ok(Math.min(...radii)<11,'motif extends inward from the wavy guide');
  assert.ok(Math.max(...radii)>16,'motif extends outward from the wavy guide');
  assert.ok(path.actions.slice(path.actions.indexOf(moves[0]),path.actions.indexOf(moves.at(-1))+1).every(a=>a.kind==='move'&&a.volumeMm3>0));
});

test('regional mapping retains translated placement and does not publish an invented finished wall',async()=>{
  const plan=recipe();plan.geometry={shape:'assembly',parts:[{id:'host',geometry:boxMesh(20,15,2),xMm:3,yMm:4,zMm:0},{id:'other',geometry:boxMesh(5,5,2),xMm:30,yMm:0,zMm:0}]};
  plan.composition.regions=[{id:'base',part:'host',zStartMm:0,zEndMm:.4,skills:{'full-fill':{}},lowerSurfaceFrom:null},
    {id:'pattern',part:'host',zStartMm:.4,zEndMm:2,skills:{'vase-wall':{}},lowerSurfaceFrom:null}];
  const path=generatePath(plan,loadMachine(),await rhino()),moves=wall(path);
  assert.ok(Math.abs(Math.max(...moves.map(a=>a.to[0]))-(plan.placement.xMm+3+19.8))<1e-8);
  assert.equal(path.summary.regions.find(r=>r.id==='pattern').publishedSurface,null);
});

test('mapped pattern edits use ordinary reviews and exact-byte delivery',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-synthetic-sleeve-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  await initBundle(dir,recipe());const actor='SYNTHETIC SLEEVE TEST — not a human approval';
  await generateBundle(dir);let state=await loadBundle(dir);assert.equal(state.programError,undefined);
  await approve(dir,{actor,revision:state.revision});assert.deepEqual(await readFile(await deliver(dir)),await readFile(join(dir,EXPORT_PATH)));
  const pattern=structuredClone(state.plan.skills['vase-wall'].pattern);pattern.repeats=3;
  await adjustBundle(dir,{skills:{'vase-wall':{pattern}}});state=await loadBundle(dir,{program:false});
  assert.equal(state.toolpathApproved,false);
});
