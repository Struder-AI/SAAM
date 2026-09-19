import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bumpyPlan} from '../../skills/pipe-cladding/scripts/bumpy-demo.mjs';
import {pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {fullFillResult} from '../../skills/full-fill/scripts/fill.mjs';
import {buildShell} from '../print/generate.mjs';
import {rhino,createGeometry,verifyGeometry} from '../print/geometry.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {surfaceRegion} from '../geom/surface-region.mjs';
import {normalSurfacePoint,sampleSurfaceCurve} from '../region/normal-surface.mjs';
import {sectionGeometry} from '../geom/query.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';
import {evaluate} from '../geom/nurbs.mjs';
import {distance,dot,normalize,subtract} from '../geom/tolerance.mjs';
import {regionArea} from '../region/region2d.mjs';
import {packZip,unpackZip} from '../export/zip.mjs';
import {initBundle,generateBundle,loadBundle,deliver,adjustBundle} from '../print/bundle.mjs';
import {beadSection} from '../../studio/material-view.mjs';
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const plan=bumpyPlan(),shell=buildShell(await rhino(),plan.geometry),chart=surfaceRegion(shell,plan.skills['pipe-cladding'].surface);

test('16x8 periodic native spline retains circular bore and 2–8 mm variable substrate',async()=>{
  const native=await createGeometry(plan.geometry);await verifyGeometry(native.bytes,native.descriptor);
  assert.equal(native.descriptor.nativeFile,undefined);assert.match(native.descriptor.nativeForm,/NURBS/);
  assert.equal(plan.geometry.controlPoints.length,16);assert.equal(plan.geometry.controlPoints[0].length,8);
  let low=Infinity,high=-Infinity;
  for(let i=0;i<128;i++)for(let j=0;j<=32;j++){
    const e=chart.at(i/128,j/32),r=Math.hypot(...e.point.slice(0,2))-8;
    low=Math.min(low,r);high=Math.max(high,r);
    assert.ok(dot(e.normal,[e.point[0],e.point[1],0])>0);
  }
  near(low,2,.03);near(high,8,.03);
  const bore=shell.patches.find(p=>p.name==='bore');
  for(let i=0;i<128;i++){const p=evaluate(bore,2*Math.PI*i/128,.4).point;near(Math.hypot(p[0],p[1]),8,1e-8);}
  for(const v of [0,.13,.6,1]){near(distance(chart.at(0,v).point,chart.at(1,v).point),0);near(distance(chart.at(0,v).normal,chart.at(1,v).normal),0);}
});

test('shared normal offsets preserve native parameter correspondence and converge',()=>{
  for(const [u,v] of [[.05,.15],[.31,.47],[.81,.77]]){
    const base=chart.at(u,v),e=normalSurfacePoint(chart,u,v,.6);
    near(distance(base.point,e.point),.6);near(dot(subtract(e.point,base.point),base.normal),.6);
  }
  const coarse=sampleSurfaceCurve(chart,t=>[t,.43],.6,{toleranceMm:.02,maxStepMm:1}),fine=sampleSurfaceCurve(chart,t=>[t,.43],.6,{toleranceMm:.005,maxStepMm:.5});
  const length=xs=>xs.slice(1).reduce((n,e,i)=>n+distance(xs[i].point,e.point),0);
  assert.ok(fine.length>coarse.length);assert.ok(Math.abs(length(fine)-length(coarse))<.04);
  // The retired maxPoints budget refused any curve past 100,000 evaluations.
  const parabola={at:(u,v)=>({point:[u,v,u*u],normal:[0,0,1],du:[1,0,2*u],dv:[0,1,0]})};
  assert.ok(sampleSurfaceCurve(parabola,t=>[t,0],.2,{toleranceMm:1e-9,maxStepMm:8e-6}).length>100000,'sampling ends on its tolerance and step, not on a point budget');
  // A step in the chart never meets the chord target; refinement reports the
  // parameter it can no longer halve instead of a spent budget.
  const stepped={at:u=>({point:[u<.3?0:1,0,0],normal:[0,0,1],du:[1,0,0],dv:[0,1,0]})};
  assert.throws(()=>sampleSurfaceCurve(stepped,t=>[t,0],0,{toleranceMm:.01,maxStepMm:1}),/no longer distinct/);
});

test('adaptive normal-offset sampling evaluates each retained parameter only once',()=>{
  const visits=new Set();
  const analytic={at(u,v){
    const key=u+','+v;assert.ok(!visits.has(key),'subdivision must reuse an already evaluated native parameter');visits.add(key);
    return {point:[u,v,u*u],normal:[0,0,1],du:[1,0,2*u],dv:[0,1,0]};
  }};
  const samples=sampleSurfaceCurve(analytic,t=>[t,0],.2,{maxStepMm:.15,toleranceMm:.001});
  assert.ok(samples.length>8,'exercise multiple recursive subdivisions');
  for(const e of samples){near(e.point[0],e.t);near(e.point[2],e.t*e.t+.2);}
  for(let i=1;i<samples.length;i++)assert.ok(distance(samples[i-1].point,samples[i].point)<=.15);
});

test('explicit mesh strip uses source triangle positions and a shared normal field',()=>{
  const mesh=pipeMesh({innerRadiusMm:8,outerRadiusMm:10,heightMm:4,toleranceMm:.02}),n=mesh.vertices.length/4;
  const rows=Array.from({length:n+1},(_,i)=>[i%n,2*n+i%n]);
  const source={kind:'mesh-strip',rows,periodicU:true,normalSide:1},mapped=surfaceRegion(mesh,source);
  for(const [u,v] of [[0,.5],[.23,.8],[.7,.1]]){
    const a=mapped.at(u,v),b=normalSurfacePoint(mapped,u,v,.2);
    near(a.point[2],v*4);near(distance(a.point,b.point),.2);
    assert.ok(Math.hypot(...a.point.slice(0,2))<=10+1e-8);
    near(distance(mapped.at(0,v).point,mapped.at(1,v).point),0);
  }
  const bad=structuredClone(source);bad.rows[2][1]=bad.rows[4][1];assert.throws(()=>surfaceRegion(mesh,bad),/triangles/);
});

test('three perimeter offsets and interior fill consume the actual spline annulus',()=>{
  const result=fullFillResult({shell,plan,zEndMm:.4}),section=sectionGeometry(shell,.2);
  assert.equal(result.report.layers,2);assert.ok(result.report.perimeterLoops>=8&&result.report.perimeterLoops<12,'opposing perimeter fronts meet in the narrow portions');assert.ok(result.report.fillRows>0);
  assert.equal(section.loops.length,2);assert.ok(regionArea(section.loops)>200);
  for(const op of result.operations)for(const s of op.strokes)for(const p of s.points)assert.ok(Math.hypot(...p.slice(0,2))>=8-1e-5,'bore stays open');
});

test('surface variation creates partial vertical courses, outward shell ordering and smooth source frames',()=>{
  const p=structuredClone(plan);p.skills['pipe-cladding'].shells=2;
  const result=pipeCladdingResult({plan:p,shell,after:['substrate']});
  assert.ok(result.report.partialAxialPasses>20);assert.ok(result.report.fullAxialPasses>100);
  assert.deepEqual(result.operations[0].after,['substrate']);assert.deepEqual(result.operations[1].after,['pipe-cladding:0']);
  assert.equal(result.operations[1].strokes.length,1);assert.ok(result.operations[1].strokes[0].poses.at(-1).rotaryDeg<-360*20);
  assert.ok(result.operations[0].strokes.some(s=>Math.abs(s.points[0][2]-s.points.at(-1)[2])<20));
  for(const op of result.operations)for(const s of op.strokes){
    assert.equal(s.points.length,s.poses.length);assert.equal(s.volumesMm3.length,s.points.length-1);
    assert.ok(s.volumesMm3.every(v=>Number.isFinite(v)&&v>=0));
    for(let i=1;i<s.poses.length;i++)assert.ok(Math.abs(s.poses[i].rotaryDeg-s.poses[i-1].rotaryDeg)<10);
  }
  const s=result.operations[0].strokes.find(s=>s.points.length>10),i=3;
  const m={from:s.points[i-1],to:s.points[i],phase:'cladding-axial',extruding:true,layer:0,commandedVolumeMm3:s.volumesMm3[i-1],
    toolAxisFrom:s.poses[i-1].toolAxis,toolAxisTo:s.poses[i].toolAxis,toolUpFrom:s.poses[i-1].toolUp,toolUpTo:s.poses[i].toolUp};
  const bead=beadSection(m,p,{});assert.ok(bead);near(distance(bead.a.center,m.from),0);near(Math.hypot(...bead.a.short),.1);
});

test('ZIP32 round-trips more than 64 RC8 helper files',()=>{
  const files=new Map(Array.from({length:90},(_,i)=>['chunk'+i+'.pcs','Sub Test\nEnd Sub\n']));
  const read=unpackZip(packZip(files));assert.equal(read.size,90);assert.equal(read.get('chunk89.pcs').toString(),files.get('chunk89.pcs'));
});

test('spline cladding uses shared checked export, cold reopening and approval invalidation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-surface-clad-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=bumpyPlan();p.geometry.heightMm=1.2;
  for(const row of p.geometry.controlPoints)for(const q of row)q[2]*=1.2/32;
  p.skills['pipe-cladding'].shells=2;p.skills['pipe-cladding'].sampleStepMm=1;
  await initBundle(dir,p,{machineId:'denso-vp6242-rc8'});await generateBundle(dir,{development:true});
  const state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.deepEqual(state.review.approvals,{});
  assert.ok(state.program.moves.some(m=>m.extruding&&m.phase==='cladding-axial'));
  assert.ok(state.program.moves.some(m=>m.extruding&&m.phase==='cladding-hoop'));
  await assert.rejects(()=>deliver(dir),/approv/);
  const bytes=await readFile(join(dir,'exports/denso-pacscript/part.zip'));assert.ok(unpackZip(bytes).has('main.pcs'));
  await adjustBundle(dir,{skills:{'pipe-cladding':{enabled:false,surface:null}}});
  await adjustBundle(dir,{skills:{'pipe-cladding':{enabled:true,surface:p.skills['pipe-cladding'].surface}}});
  await adjustBundle(dir,{skills:{'pipe-cladding':{normalMm:.21}}});
  const changed=await loadBundle(dir);assert.equal(changed.toolpathApproved,false);assert.equal(changed.review.generation,null);
});
