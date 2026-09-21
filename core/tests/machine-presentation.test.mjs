import test from 'node:test';
import assert from 'node:assert/strict';
import {densoGeometry,densoForward,densoInverse} from '../machine/denso-kinematics.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {rigid,point,compose,invert,mv,validateRigid,sub,rotation} from '../machine/rigid.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {interpretMachineStudy} from '../export/machine-study.mjs';
import {frameAtTime} from '../export/source-time.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('DENSO drawing zero pose and base quarter turn give independent centerline references',()=>{
  const g=densoGeometry(),a=densoForward(g,[0,0,0,0,0,0]),b=densoForward(g,[90,0,0,0,0,0]);
  assert.deepEqual(a.tcp,[350,0,565]);near(b.tcp[0],0);near(b.tcp[1],350);near(b.tcp[2],565);
  const solve=densoInverse(g,{tcp:b.tcp,rotation:b.rotation},{seed:[88,1,-1,2,1,-2]});assert.ok(solve.valid,solve.errors.join());solve.tcp.forEach((v,i)=>near(v,b.tcp[i],1e-4));
  // An unreachable pose ends on a residual that stops improving, not on a spent
  // iteration count: the retired ceiling gave up after 90 steps.
  const far=densoInverse(g,{tcp:[5000,0,565],rotation:b.rotation},{seed:[88,1,-1,2,1,-2]});
  assert.equal(far.valid,false);assert.match(far.errors[0],/stopped approaching the requested pose/);
});
test('source-time Euler interpolation, reverse seek and dwell are deterministic',()=>{
  const p=interpretMachineStudy({schema:'saam-machine-study-source/1',orientation:'euler-xyz',initial:{tcp:[0,0,20],anglesDeg:[0,0,0]},moves:[{tcp:[5,5,25],anglesDeg:[20,20,0],seconds:2},{tcp:[5,5,25],anglesDeg:[20,20,0],seconds:1}]});
  const middle=frameAtTime(p.moves,1);frameAtTime(p.moves,3);assert.deepEqual(frameAtTime(p.moves,1),middle);
  const expected=compose(rigid([0,0,0],rotation([0,1,0],10*Math.PI/180)),rigid([0,0,0],rotation([1,0,0],10*Math.PI/180))).rotation;
  middle.rotation.flat().forEach((v,i)=>near(v,expected.flat()[i]));assert.deepEqual(frameAtTime(p.moves,2.5).point,[5,5,25]);
});
test('providers align TCP with source coordinates and emit only finite declared frames',async()=>{
  for(const id of ['ultimaker-s5','bambu-h2d','dobot-mg400','denso-vp6242-rc8']){
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
test('a failed arm solve keeps the part where the source put it, never at an identity stand-in',async()=>{
  const machine=loadMachine('dobot-mg400'),tilt=[Math.sin(.3),0,-Math.cos(.3)],up=[0,1,0],center=[10,0,0];
  const move={from:[0,0,25],to:[0,0,25],startSeconds:0,durationSeconds:2,rotaryFromDeg:90,rotaryToDeg:90,rotaryCenterMm:center,toolAxisFrom:tilt,toolAxisTo:tilt,toolUpFrom:up,toolUpTo:up};
  const provider=await createMachinePresentation({program:{seconds:2,moves:[move]},machine,sourceIdentity:{printId:'fixture',revision:'1',exportHash:'tilt'},
    setup:{denso:{rotaryCenterMm:center},dobot:{scaleX:1,scaleY:1},kinematicModel:{worldFromBase:rigid([-300,0,0]),toolLengthMm:70}}});
  const pose=await provider.sample({requestId:1,seconds:1});
  assert.equal(pose.diagnostics[0].code,'model-solve');assert.equal(pose.status,'partial');
  [10,-10,0].forEach((v,i)=>near(pose.worldFromFrame.part.translationMm[i],v));near(pose.worldFromFrame.part.rotation[1][0],1);
  assert.ok(pose.worldFromFrame.tcp&&!pose.worldFromFrame['arm-0'],'source frames remain; unsolved arm frames are omitted');
  provider.dispose();
});
test('scaled Dobot output keeps source frames but omits the incompatible rigid arm overlay',async()=>{
  const machine=loadMachine('dobot-mg400'),program={language:'dobot-lua',seconds:1,moves:[{from:[0,0,25],to:[0,0,25],startSeconds:0,durationSeconds:1}]};
  const provider=await createMachinePresentation({program,machine,sourceIdentity:{printId:'fixture',revision:'1',exportHash:'scaled'},
    setup:{dobot:{scaleX:2,scaleY:1},kinematicModel:{worldFromBase:rigid([-300,0,0]),toolLengthMm:70}}});
  assert.deepEqual(provider.descriptor.controls,[]);
  assert.match(provider.descriptor.limitations.at(-1),/non-unit Dobot design calibration/);
  const pose=await provider.sample({requestId:1,seconds:.5});
  assert.equal(pose.status,'ready');assert.equal(pose.diagnostics[0].code,'arm-unavailable');
  assert.ok(pose.worldFromFrame.part&&pose.worldFromFrame.tcp&&!pose.worldFromFrame.base&&!pose.worldFromFrame['arm-0']);
  provider.dispose();
});
