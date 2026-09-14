import test from 'node:test';
import assert from 'node:assert/strict';
import {geometry,inverse,forward,orientation,sub,norm,singularValues,assessCylinder,findCylinder,matvec,carriagePoint} from '../machine/split-delta.mjs';
import {scalePreviewSource,reserveRotations,assessPath,assessOperatingPath} from '../../tools/split-delta/optimize-path.mjs';
import {adaptDensoMotion} from '../../tools/split-delta/import-denso.mjs';
import {interpretSplitDelta,exportSplitDeltaPreview,eulerRotation} from '../export/split-delta-player.mjs';
import {loadMachine,validateSetup} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {outputAdapter} from '../export/registry.mjs';
import {createViewerServer} from '../../tools/split-delta/server.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`),g=geometry();
test('inclined-rail IK satisfies fixed rod lengths and seeded FK; height changes reach',()=>{
  const sloped=geometry({railTiltDeg:15,platformRadiusMm:30,platformPairMm:70,toolLengthMm:40}),p={tcp:[30,-20,80],tiltDeg:40,azimuthDeg:70};
  const a=inverse(sloped,p);assert.ok(a.valid);
  for(let i=0;i<6;i++){near(norm(sub(a.points[i],a.carriages[i])),450);near(norm(sub(a.carriages[i],carriagePoint(sloped,i,a.heights[i]))),0);}
  const solved=forward(sloped,a.heights,{...p,tcp:[31,-19,81],tiltDeg:39});near(norm(sub(solved.tcp,p.tcp)),0,1e-5);
  const b=inverse(sloped,{...p,tcp:[30,-20,180]});assert.ok(Math.abs(b.heights[0]-a.heights[0]-100)>1);assert.ok(Math.abs(a.singularRatio-b.singularRatio)>1e-4);
  const c=carriagePoint(sloped,0,900);near(c[0],180+900*Math.sin(Math.PI/12));near(c[2],900*Math.cos(Math.PI/12));
});
test('sloped cylinder assessment samples the full requested height',()=>{
  const s=assessCylinder(geometry({railTiltDeg:6}),{diameterMm:40,heightMm:100,radialSteps:1,azimuthSteps:4,tiltSteps:1,heightSteps:2});
  assert.equal(s.heightIndependentReach,false);assert.equal(s.grid.heightSteps,2);near(s.workingTrackMm,s.railIntervalMm[1]-s.railIntervalMm[0]);
});
test('compact near-edge pairs retain rank; radial alignment loses yaw control',()=>{
  const compact=geometry({platformRadiusMm:35,platformPairMm:40,toolLengthMm:40});assert.ok(inverse(compact,{tcp:[0,0,0]}).valid);
  const radial=geometry({platformRadiusMm:35,platformPairMm:50*35/180});assert.equal(inverse(radial,{tcp:[0,0,0]}).valid,false);
});
test('path scale preserves angle, extrusion and feed words; reserve probes reach limits',()=>{
  const code='G21\nG90\nM82\nG1 X10 Y-2 Z30 A0 B20 C0 E2 F600 ; X99';
  const scaled=scalePreviewSource(code,2);assert.match(scaled,/X20.000000 Y-4.000000 Z60.000000 A0 B20 C0 E2 F600 ; X99/);
  assert.throws(()=>scalePreviewSource(code,0),/Positive/);
  const poses=[{tcp:[10,0,20],line:4,rotations:reserveRotations(orientation(45,0),4,true)}];assert.equal(poses[0].rotations.length,27);
  assert.ok(assessPath(poses,g,1).passed);assert.equal(assessPath(poses,g,100).passed,false);
});
test('neutral analytic height and six independently constrained local coordinates',()=>{
  const s=inverse(g,{tcp:[0,0,0]});assert.ok(s.valid);assert.ok(s.singularRatio>.1);
  const h=g.toolLengthMm+Math.sqrt(g.rodLengthMm**2-(g.towerRadiusMm-g.platformRadiusMm)**2-((g.railSeparationMm-g.platformPairMm)/2)**2);
  for(const v of s.heights)near(v,h);for(let i=0;i<6;i++)near(norm(sub(s.points[i],s.carriages[i])),g.rodLengthMm);
});
test('all six carriage heights translate one for one with build height',()=>{
  const p={tcp:[65,-40,0],tiltDeg:43,azimuthDeg:217,spinDeg:3},a=inverse(g,p),b=inverse(g,{...p,tcp:[65,-40,180]});
  assert.ok(a.valid&&b.valid);for(let i=0;i<6;i++)near(b.heights[i]-a.heights[i],180);near(a.singularRatio,b.singularRatio);
});
test('seeded forward kinematics recovers tilted TCP and rotation, including tool lever',()=>{
  for(const azimuthDeg of [0,61,157,285]){
    const p={tcp:[35,-22,50],tiltDeg:42,azimuthDeg,spinDeg:4},a=inverse(g,p);
    const b=forward(g,a.heights,{...p,tcp:[36,-23,51],tiltDeg:41,spinDeg:3});assert.ok(b.valid);near(norm(sub(b.tcp,p.tcp)),0,1e-5);
    for(let i=0;i<3;i++)near(norm(sub(b.rotation[i],a.rotation[i])),0,1e-6);
  }
});
test('Jacobi singular values detect rank loss independent of matrix row ordering',()=>{
  const a=Array.from({length:6},(_,i)=>Array.from({length:6},(_,j)=>i===j?i:0));assert.deepEqual(singularValues(a),[0,1,2,3,4,5]);
  const s=inverse(geometry({railSeparationMm:120*180/55}),{tcp:[0,0,20]});assert.ok(!s.valid);assert.ok(s.singularRatio<1e-6);
});
test('unreachable rods, track ends, bad rotations and joint cone limits fail',()=>{
  assert.equal(inverse(g,{tcp:[1000,0,0]}).valid,false);
  assert.equal(inverse(g,{tcp:[0,0,1000]}).valid,false);
  assert.throws(()=>inverse(g,{tcp:[0,0,0],rotation:[[1,0,0],[0,2,0],[0,0,1]]}),/orthonormal/);
  assert.equal(inverse(geometry({jointConeDeg:25}),{tcp:[70,0,30],tiltDeg:45,azimuthDeg:180}).valid,false);
  assert.throws(()=>geometry({rodLengthMm:0}),/positive/);
});
test('disk assessment tests reserve and reports height-dependent rail interval',()=>{
  const options={diameterMm:200,radialSteps:2,azimuthSteps:12,tiltSteps:4,spinValues:[-4,0,4]},a=assessCylinder(g,{...options,heightMm:0}),b=assessCylinder(g,{...options,heightMm:180});
  assert.ok(a.passed&&b.passed);assert.equal(a.testedTiltDeg,45);assert.equal(a.kinematicProbeTiltDeg,49);near(b.workingTrackMm-a.workingTrackMm,180);near(a.overheadMm,b.overheadMm);assert.ok(a.requiredJointConeDeg>80&&a.requiredJointConeDeg<90);
  assert.equal(assessCylinder(geometry({jointConeDeg:60}),options).passed,false);
});
test('interpreter samples between commands and keeps absolute extrusion and elapsed dwell time',()=>{
  const p=interpretSplitDelta('G21\nG90\nM82\nG1 X60 Y0 Z40 A0 B30 C0 E2 F600\nG4 P500\nG1 X0 Y0 Z20 A0 B0 C0 E3',g);
  assert.ok(p.samples.length>p.commands.length);assert.equal(p.samples.at(-1).e,3);assert.ok(p.seconds>12);
  const first=p.samples.find(s=>s.line===4&&s.abc[1]>10);for(let i=0;i<6;i++)near(first.heights[i],inverse(g,{tcp:first.tcp,rotation:eulerRotation(first.abc)}).heights[i]);
});
test('interpreter rejects unsupported commands, pure spin timing, overtilt, and sample overruns',()=>{
  const prefix='G21\nG90\nM82\n';
  for(const s of ['M104 S200','G1 X1 X2','G91','G1 B46 X20','G1 C20','G1 X1 Q2','G1 XNaN','G1 X1 F0'])assert.throws(()=>interpretSplitDelta(prefix+s,g));
  assert.throws(()=>interpretSplitDelta(prefix+'G1 X90',g,{maxSamples:3}),/budget/);
  assert.throws(()=>interpretSplitDelta('G1 X10',g),/declare/);
});
test('SAAMpath preview preserves TCP, orientation and deposited volume; no silent rotary loss',()=>{
  const R=orientation(32,50,3),pose={toolAxis:matvec(R,[0,0,-1]),toolUp:matvec(R,[0,1,0])};
  const path={initialPosition:[0,0,20],actions:[{kind:'move',to:[30,15,40],pose,speedMmS:10,volumeMm3:5}]},text=exportSplitDeltaPreview(path),p=interpretSplitDelta(text,g),last=p.samples.at(-1);
  assert.deepEqual(last.tcp,[30,15,40]);near(last.e*Math.PI*(1.75/2)**2,5,2e-6);
  const actual=eulerRotation(last.abc);for(let i=0;i<3;i++)near(norm(sub(actual[i],R[i])),0,1e-6);
  path.actions[0].pose.rotaryDeg=30;assert.throws(()=>exportSplitDeltaPreview(path),/external rotary/);
});
test('profile is discoverable and setup-compatible while unimplemented hardware export fails explicitly',()=>{
  const machine=loadMachine('split-delta'),plan=defaults(machine);validateSetup(plan,machine);assert.ok(geometry(machine.kinematicModel));assert.equal(machine.jointDesign.maximumLayers,2);
  assert.throws(()=>outputAdapter(plan,machine),/Controller dialect/);
});
test('diameter search distinguishes a sampled passing cap from an impossible center',()=>{
  const options={maxDiameterMm:100,radialSteps:1,azimuthSteps:6,tiltSteps:2,spinValues:[-4,0,4]};
  const a=findCylinder(g,options);assert.equal(a.diameterMm,100);assert.ok(a.limitedBySearchCap&&a.assessment.passed);
  const b=findCylinder(geometry({jointConeDeg:20}),options);assert.equal(b.centerReachable,false);assert.equal(b.diameterMm,0);
});
test('G93 preserves explicit move duration and supports stationary TCP rotation',()=>{
  const p=interpretSplitDelta('G21\nG90\nM82\nG93\nG1 B30 F30\nG1 X20 F60',g);near(p.seconds,3);assert.ok(p.samples.length>=31);
  assert.throws(()=>interpretSplitDelta('G21\nG90\nM82\nG93\nG1 X10',g),/requires F/);
});
test('DENSO adaptation explicitly clips tilt while preserving source TCP, duration and volume',()=>{
  const axis=[-Math.sin(Math.PI/3),0,-.5],m={from:[0,0,20],to:[10,0,20],toolAxisFrom:[0,0,-1],toolAxisTo:axis,durationSeconds:2,startSeconds:0,speedMmS:5,commandedVolumeMm3:1,phase:'test',layer:0},source={moves:[m],seconds:2};
  const {path,adaptation}=adaptDensoMotion(source);assert.equal(adaptation.changedTiltEndpoints,1);near(adaptation.maxSourceTiltDeg,60);assert.deepEqual(path.actions[0].to,m.to);assert.deepEqual(m.toolAxisTo,axis);
  const result=interpretSplitDelta(exportSplitDeltaPreview(path),g);near(result.seconds,2);near(result.samples.at(-1).abc[1],45);near(result.samples.at(-1).e*Math.PI*(1.75/2)**2,1,2e-6);
});
test('standalone server serves only viewer and shared reference modules',async()=>{
  const server=createViewerServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const url=`http://127.0.0.1:${server.address().port}`;assert.match(await(await fetch(url)).text(),/Kinematics Lab/);assert.equal((await fetch(url+'/core/machine/split-delta.mjs')).status,200);assert.equal((await fetch(url+'/package.json')).status,404);assert.equal((await fetch(url,{method:'POST'})).status,404);}finally{await new Promise(resolve=>server.close(resolve));}
});

test('40-degree operation applies the joint margin once and keeps probe travel separate',()=>{
  const g=geometry({operatingTiltDeg:40,toolLengthMm:64,platformRadiusMm:34,platformPairMm:86,rodLengthMm:450,towerRadiusMm:220,railMaxMm:1200});
  const rotation=orientation(40,0),tcp=[0,0,50],state=inverse(g,{tcp,rotation});
  const a=assessOperatingPath([{tcp,rotation,line:1}],g,1,{dense:true});
  assert.ok(a.passed);near(state.tiltDeg,40);near(a.requiredJointConeDeg,state.maxJointDeflectionDeg+4);
  near(a.railIntervalMm[0],Math.min(...state.heights));near(a.railIntervalMm[1],Math.max(...state.heights));
});
