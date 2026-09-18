import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {developmentPipePlan} from '../../skills/pipe-cladding/scripts/demo.mjs';
import {bumpyPlan} from '../../skills/pipe-cladding/scripts/bumpy-demo.mjs';
import {pipeCladdingResult} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {validatePlan} from '../print/plan.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell,generatePath} from '../print/generate.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';
import {distance} from '../geom/tolerance.mjs';
import {validatePose} from '../path/pose.mjs';
import {initBundle,loadBundle,approve,adjustBundle,generateBundle,deliver} from '../print/bundle.mjs';
import {recipeRows} from '../../studio/settings.mjs';
import {beadSection} from '../../studio/material-view.mjs';
import {toolpathStyle,TOOLPATH_COLORS} from '../../studio/toolpath-view.mjs';

const machine=loadMachine('denso-vp6242-rc8'),r=await rhino();
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
function crossed(){const p=developmentPipePlan();p.geometry.heightMm=4;Object.assign(p.skills['pipe-cladding'],{pattern:'crossed-helices',spacingFactor:8,shells:4});return p;}
function verifyHelices(result,plan){
  let previousAngle;
  for(const [i,op] of result.operations.entries()){
    assert.equal(op.phase,i%2?'cladding-helix-reverse':'cladding-helix-forward');
    assert.equal(op.strokes.length,1);const s=op.strokes[0];
    assert.ok(s.points.at(-1)[2]>s.points[0][2]);
    assert.equal(s.poses.length,s.points.length);assert.equal(s.volumesMm3.length,s.points.length-1);
    const sign=i%2?1:-1;
    assert.ok(sign*(s.poses.at(-1).rotaryDeg-s.poses[0].rotaryDeg)>360);
    if(previousAngle!==undefined){
      // Same U can have a different azimuth at the lower end of a curved
      // surface; its transition must stay on the nearest unwrapped revolution.
      if(plan.skills['pipe-cladding'].surface)assert.ok(Math.abs(s.poses[0].rotaryDeg-previousAngle)<180);
      else near(s.poses[0].rotaryDeg,previousAngle);
    }
    previousAngle=s.poses.at(-1).rotaryDeg;
    for(let j=1;j<s.points.length;j++){
      validatePose(s.poses[j]);
      assert.ok(sign*(s.poses[j].rotaryDeg-s.poses[j-1].rotaryDeg)>=-1e-7);
      assert.ok(distance(s.points[j],s.points[j-1])<=plan.skills['pipe-cladding'].sampleStepMm+1e-6);
      assert.ok(Number.isFinite(s.volumesMm3[j-1])&&s.volumesMm3[j-1]>=0);
    }
    if(i)assert.deepEqual(op.after,[result.operations[i-1].id]);
  }
}

test('cladding pattern is required and rejects unknown choices',()=>{
  const p=developmentPipePlan();p.geometry.heightMm=1.2;
  const missing=structuredClone(p);delete missing.skills['pipe-cladding'].pattern;
  assert.throws(()=>validatePlan(missing,machine),/Unexpected or missing fields/);
  for(const value of ['spiral',null,42]){p.skills['pipe-cladding'].pattern=value;assert.throws(()=>validatePlan(p,machine),/Cladding pattern/);}
});

test('circular helices change geometric handedness, keep bead size and respect three-dimensional sampling',()=>{
  const p=crossed(),result=pipeCladdingResult({plan:p});verifyHelices(result,p);
  for(const op of result.operations){const s=op.strokes[0];
    for(let j=1;j<s.points.length;j++)assert.ok(s.volumesMm3[j-1]/distance(s.points[j],s.points[j-1])<=p.process.lineWidthMm*p.skills['pipe-cladding'].normalMm+1e-7);
  }
  const wider=crossed();wider.skills['pipe-cladding'].spacingFactor=16;
  const open=pipeCladdingResult({plan:wider});
  near(Math.abs(open.operations[0].strokes[0].poses.at(-1).rotaryDeg),Math.abs(result.operations[0].strokes[0].poses.at(-1).rotaryDeg)/2);
});

test('opposite-handed helices reuse both native spline and explicit mesh-strip surface charts',()=>{
  const spline=bumpyPlan();spline.geometry.heightMm=8;for(const c of spline.geometry.controlPoints)for(const pt of c)pt[2]/=4;
  Object.assign(spline.skills['pipe-cladding'],{pattern:'crossed-helices',spacingFactor:8,shells:2});
  verifyHelices(pipeCladdingResult({plan:spline,shell:buildShell(r,spline.geometry)}),spline);
  const mesh=pipeMesh({innerRadiusMm:8,outerRadiusMm:10,heightMm:8,toleranceMm:.02}),n=mesh.vertices.length/4,p=crossed();
  p.skills['pipe-cladding'].shells=2;
  p.skills['pipe-cladding'].surface={kind:'mesh-strip',rows:Array.from({length:n+1},(_,i)=>[i%n,2*n+i%n]),periodicU:true,normalSide:1};
  verifyHelices(pipeCladdingResult({plan:p,shell:mesh}),p);
});

test('checked robot output preserves both winding directions, review invalidation and exact-byte delivery',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-synthetic-crossed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=developmentPipePlan();p.geometry.heightMm=1.2;p.skills['pipe-cladding'].shells=2;
  await initBundle(dir,p,{machineId:machine.id});let state=await loadBundle(dir);
  state=await adjustBundle(dir,{skills:{'pipe-cladding':{pattern:'crossed-helices',spacingFactor:3}}},{expectedRevision:state.revision});
  assert.ok(!state.toolpathApproved);
  assert.ok(recipeRows(state.plan,machine).some(([k,v])=>k.endsWith('Pattern')&&v==='crossed helices'));

  await generateBundle(dir);state=await loadBundle(dir);assert.equal(state.programError,undefined);
  for(const [phase,sign] of [['cladding-helix-forward',-1],['cladding-helix-reverse',1]]){
    const moves=state.program.moves.filter(m=>m.extruding&&m.phase===phase);assert.ok(moves.length>10);
    assert.ok(moves.some(m=>sign*(m.rotaryToDeg-m.rotaryFromDeg)>0));
  }
  await approve(dir,{revision:state.revision,actor:'SYNTHETIC CROSSED-HELIX TEST ONLY'});
  assert.deepEqual(await readFile(await deliver(dir)),await readFile(join(dir,'exports/denso-pacscript/part.zip')));
});

test('both helical phases retain radial bead frames and distinct preview colors',()=>{
  const p=crossed(),result=pipeCladdingResult({plan:p});
  for(const [i,op] of result.operations.slice(0,2).entries()){
    const s=op.strokes[0],j=Math.floor(s.points.length/2),m={from:s.points[j-1],to:s.points[j],phase:op.phase,layer:i,extruding:true,commandedVolumeMm3:s.volumesMm3[j-1]};
    const bead=beadSection(m,p,{});assert.ok(bead);assert.deepEqual(bead.a.center,m.from);
    near(bead.height,p.skills['pipe-cladding'].normalMm);
    assert.equal(toolpathStyle(m,m).color,i?TOOLPATH_COLORS.orange:TOOLPATH_COLORS.teal);
  }
});
