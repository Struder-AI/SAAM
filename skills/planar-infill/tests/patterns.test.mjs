import test from 'node:test';
import assert from 'node:assert/strict';
import {infillStrokes,INFILL_PATTERNS} from '../scripts/patterns.mjs';
import {clipOpenPaths} from '../../../core/region/intersection.mjs';
import {pointInRegion} from '../../../core/region/region2d.mjs';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {planarInfillResults} from '../scripts/infill.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';

const square=[[[0,0],[20,0],[20,20],[0,20]]];
const length=strokes=>strokes.reduce((sum,s)=>sum+s.points.reduce((n,p,i)=>n+(i?Math.hypot(p[0]-s.points[i-1][0],p[1]-s.points[i-1][1]):0),0)+(s.closed?Math.hypot(s.points[0][0]-s.points.at(-1)[0],s.points[0][1]-s.points.at(-1)[1]):0),0);

test('open clipping retains bends and splits at holes without closing or rotating paths',()=>{
  const hole=[[[0,0],[10,0],[10,10],[0,10]],[[4,4],[4,6],[6,6],[6,4]]];
  const strokes=clipOpenPaths([[[-2,5],[3,5],[5,5],[7,5],[12,5]]],hole);
  assert.equal(strokes.length,2);
  assert.ok(Math.abs(length(strokes.map(points=>({points})))-8)<1e-8);
  const bent=clipOpenPaths([[[1,1],[1,3],[3,3]]],hole);
  assert.equal(bent.length,1);assert.equal(bent[0].length,3);
  assert.ok(Math.abs(length(bent.map(points=>({points})))-4)<1e-8);
});

test('grid and triangles divide material across directions and concentric closes contours',()=>{
  const options={widthMm:0.4,density:0.2,angleDeg:13};
  for(const pattern of ['rectilinear','grid','triangles']){
    const strokes=infillStrokes(square,{...options,pattern});
    assert.ok(Math.abs(length(strokes)*0.4/400-0.2)<0.015,`${pattern} keeps density`);
    const directions=new Set(strokes.map(s=>Math.round(((Math.atan2(s.points[1][1]-s.points[0][1],s.points[1][0]-s.points[0][0])*180/Math.PI)%180+180)%180)));
    assert.equal(directions.size,{rectilinear:1,grid:2,triangles:3}[pattern]);
  }
  const concentric=infillStrokes(square,{...options,pattern:'concentric'});
  assert.ok(concentric.length>2&&concentric.every(s=>s.closed));
});

test('all patterns preserve holes and disconnected islands without extrusion across gaps',()=>{
  const region=[...square,[[7,7],[7,13],[13,13],[13,7]],[[25,0],[30,0],[30,5],[25,5]]];
  for(const pattern of INFILL_PATTERNS){
    const strokes=infillStrokes(region,{pattern,widthMm:0.4,density:0.2,zMm:0.37});
    assert.ok(strokes.some(s=>s.points.some(p=>p[0]>25)),`${pattern} reaches island`);
    for(const stroke of strokes){
      const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
      for(let i=1;i<points.length;i++)for(const t of [0.25,0.5,0.75]){
        const p=points[i].map((v,k)=>v*t+points[i-1][k]*(1-t));
        assert.ok(!(p[0]>7+1e-7&&p[0]<13-1e-7&&p[1]>7+1e-7&&p[1]<13-1e-7),`${pattern} crosses hole`);
        assert.ok(!(p[0]>20+1e-7&&p[0]<25-1e-7),`${pattern} crosses gap`);
      }
    }
  }
});

test('gyroid follows its implicit field, changes with Z, converges and reports exhausted budgets',()=>{
  const options={pattern:'gyroid',widthMm:0.4,density:0.2,zMm:0.73};
  const coarse=infillStrokes(square,{...options,sampleStepMm:0.2}),fine=infillStrokes(square,{...options,sampleStepMm:0.1});
  assert.ok(coarse.some(s=>s.points.length>5));
  assert.ok(Math.abs(length(coarse)/length(fine)-1)<0.01);
  const k=2*Math.PI/(2.4*0.4/0.2);
  for(const stroke of fine)for(const [x,y] of stroke.points){
    const f=Math.sin(k*x)*Math.cos(k*y)+Math.sin(k*y)*Math.cos(k*options.zMm)+Math.sin(k*options.zMm)*Math.cos(k*x);
    assert.ok(Math.abs(f)<0.012,`gyroid residual ${f}`);
  }
  assert.notDeepEqual(coarse,infillStrokes(square,{...options,zMm:1.1}));
  assert.throws(()=>infillStrokes(square,{...options,maxPatternCells:10}),/increase.*maxPatternCells/);
});

test('new sparse patterns compose with unchanged solid skins and one wall owner on mesh and splines',async()=>{
  const r=await rhino();
  for(const pattern of INFILL_PATTERNS)for(const geometry of [boxMesh(12,10,2),{shape:'box',runMm:12,widthMm:10,heightMm:2}]){
    const plan=defaults();plan.geometry=geometry;plan.skills['draped-skin'].enabled=false;
    plan.skills['planar-infill'].enabled=true;plan.skills['planar-infill'].pattern=pattern;
    plan.skills['full-fill'].mode='solid-surfaces';plan.process.minimumLayerSeconds=0;
    const path=generatePath(plan,loadMachine(),r);checkMachinePath(path,plan,loadMachine());
    assert.ok(path.actions.some(a=>a.role==='infill'));
    assert.deepEqual([...new Set(path.actions.filter(a=>a.role==='fill'&&a.volumeMm3>0).map(a=>a.layer))],[0,1,2,7,8,9]);
    assert.equal(path.actions.filter(a=>a.layer===4&&a.role==='perimeter'&&a.volumeMm3>0).length,4);
    // Closed concentric interiors belong to fill operations, never to wall operations.
    const results=planarInfillResults({shell:buildShell(r,geometry),plan,solid:true});
    assert.ok(results[0].operations.filter(op=>op.id.endsWith(':walls')).every(op=>op.strokes.every(s=>s.role!=='infill')));
  }
});

test('missing and malformed pattern settings fail before generation',()=>{
  const plan=defaults();assert.equal(plan.skills['planar-infill'].pattern,'rectilinear');
  for(const field of ['pattern','sampleStepMm','maxPatternCells']){
    const missing=defaults();delete missing.skills['planar-infill'][field];
    assert.throws(()=>validatePlan(missing,loadMachine()),/Unexpected or missing fields/);
  }
  plan.skills['planar-infill'].pattern='typo';assert.throws(()=>validatePlan(plan,loadMachine()),/Unknown infill pattern/);
});

test('all added infill patterns round trip S5, H2D and configured Dobot exports with drape',async()=>{
  const r=await rhino(),release={generatorVersion:'synthetic-test',buildDate:'2026-09-10'};
  for(const machineId of ['ultimaker-s5','bambu-h2d','dobot-mg400'])for(const pattern of INFILL_PATTERNS.slice(1)){
    const machine=loadMachine(machineId),plan=defaults(machine);
    if(machineId==='dobot-mg400')syntheticDobotSetup(plan);
    plan.geometry=boxMesh(12,10,3);plan.process.minimumLayerSeconds=0;
    plan.skills['planar-infill'].enabled=true;plan.skills['planar-infill'].pattern=pattern;plan.skills['full-fill'].mode='solid-surfaces';
    const path=generatePath(plan,machine,r),bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
    const expected=path.actions.filter(a=>a.kind==='move');assert.equal(program.moves.length,expected.length);
    expected.forEach((m,i)=>{m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6));assert.ok(Math.abs(m.volumeMm3-program.moves[i].volumeMm3)<1e-4);});
    assert.ok(program.moves.some(m=>m.phase==='draped-skin'));
  }
});
