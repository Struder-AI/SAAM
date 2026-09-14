import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainedJog} from '../machine/jog.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {tiltyBounds,tiltyGeometry,tiltyInverse,gimbalRotation} from '../machine/tilty.mjs';
import {railBoxLowerBound} from '../../tools/kinematics/rail-limits.mjs';
const binding={printId:'jog',revision:'1',exportHash:'unchanged'};

test('authored lower rail stops remove only unusable below-bed travel and retain near-limit poses',()=>{
  const g=tiltyGeometry(loadMachine('tilty').kinematicModel),rad=Math.PI/180;
  // Independent retained poses at each rail's new lower end; do not rerun the
  // offline global authoring search as part of every interactive-model check.
  const witnesses=[[-168.4665493743925,-42.804974258113496,-35.56640625,19.6484375],
    [116.94142932264688,-132.99895524315565,-7.9296875,-39.3359375],[116.94142932264688,132.99895524315565,7.9296875,-39.3359375],
    [-71.19680780181746,-113.77057367407193,-26.2890625,-28.4765625],
    [77.07740389860821,-63.457251947854516,27.578125,.078125],[77.07740389860821,63.457251947854516,-27.578125,.078125]];
  for(const [i,[x,y,a,b]] of witnesses.entries()){
    const s=tiltyInverse(g,{tcp:[x,y,0],rotation:gimbalRotation(a*rad,b*rad)}),height=[...s.mainHeights,...s.tiltHeights][i],minimum=i<3?g.railMinMm:g.tiltRailMinMm[i-3];
    assert.ok(s.valid,s.errors.join());assert.ok(height-minimum<1.2);
    const center=[...s.platform.slice(0,2),a*rad,b*rad],box=center.map(v=>[v,v]);
    assert.ok(Math.abs(railBoxLowerBound(g,box,i)-height)<1e-5);
    assert.ok(railBoxLowerBound(g,center.map((v,j)=>[v-(j<2?1:.01),v+(j<2?1:.01)]),i)<=height);
  }
});

test('Tilty slider bounds respect the rail cylinder and conservatively cover height',()=>{
  const g=tiltyGeometry(),b=tiltyBounds(g);
  assert.deepEqual(b.min.slice(0,2),[-g.towerRadiusMm,-g.towerRadiusMm]);
  assert.deepEqual(b.max.slice(0,2),[g.towerRadiusMm,g.towerRadiusMm]);
  assert.equal(b.min[2],0);assert.ok(b.max[2]<g.railMaxMm-g.toolLengthMm,'vertical rod projection tightens height span');
});

test('jog couples coordinates at a curved boundary and stops where two constraints meet',()=>{
  const evaluate=([x,y])=>{const margins=[1-x*x-y*y,y-.2];return {valid:margins.every(v=>v>=0),margins};};
  const request={from:[0,1],target:[.8,1],axis:0,scales:[1,1],evaluate};
  const a=constrainedJog(request);assert.ok(Math.abs(a.values[0]-.8)<1e-6);assert.ok(Math.abs(a.values[1]-.6)<1e-4);assert.equal(a.adjusted,true);
  assert.deepEqual(constrainedJog(request),a);
  const b=constrainedJog({...request,from:a.values,target:[1.2,a.values[1]]});
  assert.equal(b.limited,true);assert.ok(evaluate(b.values).valid);assert.ok(Math.abs(b.values[0]-Math.sqrt(.96))<.002);assert.ok(Math.abs(b.values[1]-.2)<.002);
});

test('Tilty gains height by moving XY and tilt within fixed rail limits; further requests stay reachable',async()=>{
  const machine=loadMachine('tilty'),program={seconds:1,moves:[{from:[80,0,40],to:[80,0,40],startSeconds:0,durationSeconds:1}]};
  const p=await createMachinePresentation({machine,program,setup:{kinematicModel:{railMaxMm:580}},sourceIdentity:binding});
  let pose=await p.sample({requestId:1,seconds:0});const original=structuredClone(program);
  const move=async(axis,value)=>{const from=pose.controlValues,manual=[...from];manual[axis]=value;
    const request={requestId:2,seconds:0,manual,jog:{axis,from}};pose=await p.sample(request);
    assert.equal(pose.status,'ready',JSON.stringify(pose.diagnostics));assert.deepEqual(await p.sample(request),pose);
    for(const [key,frame] of Object.entries(pose.worldFromFrame))if(key.includes('carriage'))assert.ok(frame.translationMm[2]>=0&&frame.translationMm[2]<=580+1e-7);
  };
  await move(2,70);assert.equal(pose.controlValues[2],70);assert.ok(pose.controlValues[0]<70,'height request moves X away from the limiting tower');
  await move(2,200);assert.ok(pose.controlValues[2]<200);assert.match(pose.diagnostics[0].message,/boundary/);
  await move(3,40);assert.equal(pose.controlValues[3],40);
  await move(4,40);assert.equal(pose.controlValues[4],40);assert.ok(Math.abs(pose.controlValues[3])<.01,'tilt axes bump one another at the cone');
  assert.deepEqual(program,original);p.dispose();
});

test('jog couples rail, tilt and main-arm envelope limits, then follows the radial boundary',async()=>{
  const machine=loadMachine('tilty'),program={seconds:1,moves:[{from:[0,0,25],to:[0,0,25],startSeconds:0,durationSeconds:1}]};
  const p=await createMachinePresentation({machine,program,sourceIdentity:binding});
  let s=await p.sample({requestId:1,seconds:0});
  for(const [axis,value] of [[3,40],[2,200],[0,180],[1,180]]){
    const from=s.controlValues,manual=[...from];manual[axis]=value;s=await p.sample({requestId:2,seconds:0,manual,jog:{axis,from}});
    assert.equal(s.status,'ready',JSON.stringify(s.diagnostics));
    assert.ok(Math.hypot(...s.controlValues.slice(0,2))<=180+1e-5);
    if(axis===2)assert.ok(s.controlValues[2]<200);
    else assert.ok(Math.abs(s.controlValues[axis]-value)<.001);
  }
  assert.ok(Math.abs(s.controlValues[0])<.01,'Y at the radial limit bumps X to zero');p.dispose();
});

test('Cartesian jog stops at the physical axis endpoint without moving unrelated axes',async()=>{
  const machine=loadMachine('ultimaker-s5'),program={seconds:1,moves:[{from:[100,80,10],to:[100,80,10],startSeconds:0,durationSeconds:1}]};
  const p=await createMachinePresentation({machine,program,sourceIdentity:binding}),from=[100,80,10];
  const s=await p.sample({requestId:1,seconds:0,manual:[1000,80,10],jog:{axis:0,from}});
  assert.equal(s.status,'ready');assert.ok(Math.abs(s.controlValues[0]-machine.bounds.max[0])<.002);assert.deepEqual(s.controlValues.slice(1),[80,10]);
  const rail=p.descriptor.components.find(c=>c.id==='z-rail-0');assert.equal(rail.shape.toMm[2],machine.bounds.max[2]);p.dispose();
});
