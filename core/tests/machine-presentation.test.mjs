import test from 'node:test';
import assert from 'node:assert/strict';
import {tiltyGeometry,tiltyInverse,tiltyForward,gimbalRotation} from '../machine/tilty.mjs';
import {densoGeometry,densoForward,densoInverse} from '../machine/denso-kinematics.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {rigid,identity,point,compose,invert,mv,validateRigid,norm,sub,rotation} from '../machine/rigid.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {interpretMachineStudy} from '../export/machine-study.mjs';
import {frameAtTime} from '../export/source-time.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('Tilty neutral geometry gives equal analytical main/tilt heights and nine fixed rods',()=>{
  const g=tiltyGeometry(),s=tiltyInverse(g,{tcp:[0,0,0],rotation:identity()});assert.ok(s.valid,s.errors.join());
  s.mainHeights.forEach(h=>near(h,70+Math.sqrt(350**2-145**2)));s.tiltHeights.forEach(h=>near(h,190+Math.sqrt(350**2-160**2)));
  assert.equal(s.rods.length,9);s.rods.forEach(r=>near(norm(sub(r.from,r.to)),350));
});
test('Tilty enforces four degrees before rod inversion and rejects a parallel singularity',()=>{
  const g=tiltyGeometry({railMinMm:0,tiltRailMinMm:[0,0,0]}),a=g.maxTiltDeg*Math.PI/180,R=gimbalRotation(0,a);
  const atElevation=degrees=>tiltyInverse(g,{tcp:[g.towerRadiusMm-g.platformRadiusMm-g.rodLengthMm*Math.cos(degrees*Math.PI/180)-g.toolLengthMm*Math.sin(a),0,0],rotation:R});
  const safe=atElevation(4.01),unsafe=atElevation(3.99);
  assert.ok(safe.valid,safe.errors.join());near(safe.minRodElevationDeg,4.01);
  assert.equal(unsafe.valid,false);assert.match(unsafe.errors.join(),/elevation reserve/);
  const singular=tiltyInverse(tiltyGeometry({towerRadiusMm:35,platformRadiusMm:35,rearRadiusMm:35}),{tcp:[0,0,0],rotation:identity()});
  near(singular.minRodElevationDeg,90);assert.equal(singular.valid,false);
  assert.match(singular.errors.join(),/parallel singularity/);assert.ok(singular.singularRatio<.02);
  assert.throws(()=>tiltyGeometry({marginDeg:-1}),/singularity reserve/);
});
test('Tilty compensates nozzle lever, keeps carrier level and rejects independent roll/inconsistent actuators',()=>{
  const g=tiltyGeometry(),tcp=[5,8,25],R=gimbalRotation(.2,-.25),s=tiltyInverse(g,{tcp,rotation:R});assert.ok(s.valid);
  point(rigid(s.platform,R),[0,0,-70]).forEach((v,i)=>near(v,tcp[i]));
  const h=[...s.mainHeights,...s.tiltHeights],fk=tiltyForward(g,h,{tcp:[4,7,24],gimbalRadians:[.19,-.24]});fk.tcp.forEach((v,i)=>near(v,tcp[i],1e-5));
  h[5]+=2;assert.throws(()=>tiltyForward(g,h,{tcp,gimbalRadians:[.2,-.25]}),/Incompatible/);
  assert.equal(tiltyInverse(g,{tcp,rotation:rotation([0,0,1],.2)}).valid,false);
});
test('DENSO drawing zero pose and base quarter turn give independent centerline references',()=>{
  const g=densoGeometry(),a=densoForward(g,[0,0,0,0,0,0]),b=densoForward(g,[90,0,0,0,0,0]);
  assert.deepEqual(a.tcp,[350,0,565]);near(b.tcp[0],0);near(b.tcp[1],350);near(b.tcp[2],565);
  const solve=densoInverse(g,{tcp:b.tcp,rotation:b.rotation},{seed:[88,1,-1,2,1,-2]});assert.ok(solve.valid,solve.errors.join());solve.tcp.forEach((v,i)=>near(v,b.tcp[i],1e-4));
});
test('source-time gimbal interpolation stays on the two-axis manifold, reverse seek and dwell are deterministic',()=>{
  const p=interpretMachineStudy({schema:'saam-machine-study-source/1',orientation:'gimbal-rx-ry',initial:{tcp:[0,0,20],anglesDeg:[0,0,0]},moves:[{tcp:[5,5,25],anglesDeg:[20,20,0],seconds:2},{tcp:[5,5,25],anglesDeg:[20,20,0],seconds:1}]});
  const middle=frameAtTime(p.moves,1);frameAtTime(p.moves,3);assert.deepEqual(frameAtTime(p.moves,1),middle);
  assert.ok(tiltyInverse(tiltyGeometry(),{tcp:middle.point,rotation:middle.rotation}).valid);assert.deepEqual(frameAtTime(p.moves,2.5).point,[5,5,25]);
});
test('providers align TCP with source coordinates and emit only finite declared frames',async()=>{
  for(const id of ['ultimaker-s5','bambu-h2d','split-delta','tilty','dobot-mg400','denso-vp6242-rc8']){
    const machine=loadMachine(id),program={seconds:2,moves:[{from:[0,0,25],to:[5,2,30],startSeconds:0,durationSeconds:2}]};
    const provider=await createMachinePresentation({program,machine,setup:machine.defaultSetup,sourceIdentity:{printId:'fixture',revision:'1',exportHash:'study'}});
    const pose=await provider.sample({requestId:1,seconds:1});assert.notEqual(pose.status,'unavailable',id);
    for(const [name,t] of Object.entries(pose.worldFromFrame)){assert.ok(provider.descriptor.frameIds.includes(name),name);validateRigid(t);}
    for(const c of provider.descriptor.components)if(c.shape.pointsMm)c.shape.pointsMm.flat().forEach(v=>assert.ok(Number.isFinite(v),id));
    if(pose.worldFromFrame.tcp)point(pose.worldFromFrame.part,[2.5,1,27.5]).forEach((v,i)=>near(v,pose.worldFromFrame.tcp.translationMm[i]));
    const again=await provider.sample({requestId:2,seconds:0});assert.equal(again.seconds,0);provider.dispose();await assert.rejects(provider.sample({requestId:3,seconds:0}),/disposed/);
  }
});
test('DENSO ceiling installation and off-center rotary are applied once to the complete arm',async()=>{
  const machine=loadMachine('denso-vp6242-rc8'),seed=[0,0,0,0,35,0],base=rigid([40,20,800],rotation([1,0,0],Math.PI)),nominal=densoForward(densoGeometry(),seed);
  const tip=compose(base,rigid(nominal.tcp,nominal.rotation)),center=[20,10,0],r=rotation([0,0,1],Math.PI/2),part=rigid(sub(center,mv(r,center)),r);
  const p=point(invert(part),tip.translationMm),axis=mv(invert(part).rotation,mv(tip.rotation,[0,0,-1])),up=mv(invert(part).rotation,mv(tip.rotation,[0,1,0]));
  const program={seconds:1,moves:[{from:p,to:p,startSeconds:0,durationSeconds:1,rotaryFromDeg:90,rotaryToDeg:90,rotaryCenterMm:center,toolAxisFrom:axis,toolAxisTo:axis,toolUpFrom:up,toolUpTo:up}]};
  const provider=await createMachinePresentation({program,machine,setup:{denso:{rotaryCenterMm:center},kinematicModel:{worldFromBase:base,toolLengthMm:70,modelSeedDeg:seed}},sourceIdentity:{printId:'fixture',revision:'1',exportHash:'nominal'}});
  const s=await provider.sample({requestId:1,seconds:.5});assert.equal(s.status,'ready',JSON.stringify(s.diagnostics));
  s.worldFromFrame.tcp.translationMm.forEach((v,i)=>near(v,tip.translationMm[i]));assert.deepEqual(s.worldFromFrame.base,base);
  point(s.worldFromFrame.part,p).forEach((v,i)=>near(v,tip.translationMm[i]));
});

test('manual Tilty pose uses the gimbal solver without changing source motion and reports unreachable input',async()=>{
  const machine=loadMachine('tilty'),program=interpretMachineStudy({schema:'saam-machine-study-source/1',orientation:'gimbal-rx-ry',initial:{tcp:[0,0,20],anglesDeg:[0,0,0]},moves:[{tcp:[5,5,25],anglesDeg:[10,15,0],seconds:2}]});
  const original=structuredClone(program),provider=await createMachinePresentation({machine,program,sourceIdentity:{printId:'manual',revision:'1',exportHash:'source'}});
  assert.equal(provider.descriptor.controls.length,5);
  const source=await provider.sample({requestId:1,seconds:1});
  assert.deepEqual(source.controlValues.slice(0,3),[2.5,2.5,22.5]);
  const manual=[30,-20,80,15,-10],pose=await provider.sample({requestId:2,seconds:1,manual});
  assert.equal(pose.status,'ready',JSON.stringify(pose.diagnostics));assert.deepEqual(pose.manual,manual);
  assert.deepEqual(pose.worldFromFrame.tcp.translationMm,manual.slice(0,3));
  assert.deepEqual(pose.worldFromFrame.platform.rotation,identity());
  const R=gimbalRotation(15*Math.PI/180,-10*Math.PI/180);
  pose.worldFromFrame.tcp.rotation.flat().forEach((v,i)=>near(v,R.flat()[i]));
  const invalid=await provider.sample({requestId:3,seconds:1,manual:[1000,0,80,0,0]});
  assert.equal(invalid.status,'partial');assert.ok(invalid.diagnostics.length);assert.equal(invalid.worldFromFrame.tcp,undefined);
  const resumed=await provider.sample({requestId:4,seconds:1});assert.deepEqual(resumed.worldFromFrame,source.worldFromFrame);assert.deepEqual(program,original);
  await assert.rejects(provider.sample({requestId:5,seconds:1,manual:[0,0,0,NaN,0]}),/manual/);
});
