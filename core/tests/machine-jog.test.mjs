import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainedJog} from '../machine/jog.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {tiltyBounds,tiltyGeometry,tiltyInverse,gimbalRotation} from '../machine/tilty.mjs';
import {lowerRailLimits} from '../../tools/kinematics/rail-limits.mjs';
const binding={printId:'jog',revision:'1',exportHash:'unchanged'};

test('authored lower rail stops remove only unusable below-bed travel and retain near-limit poses',()=>{
  const profile=loadMachine('tilty'),g=tiltyGeometry(profile.kinematicModel),limits=lowerRailLimits(profile.kinematicModel);
  assert.equal(g.railMinMm,limits.railMinMm);assert.deepEqual(g.tiltRailMinMm,limits.tiltRailMinMm);
  for(const [i,r] of limits.rails.entries()){
    assert.ok(r.gapMm<=.02);assert.ok(g.tiltRailMinMm[i]<=r.tiltLowerBoundMm);
    const w=r.witness,s=tiltyInverse(g,{tcp:w.tcp,rotation:gimbalRotation(w.pitchDeg*Math.PI/180,w.tiltDeg*Math.PI/180)});
    assert.ok(s.valid,s.errors.join());assert.ok(s.tiltHeights[i]-g.tiltRailMinMm[i]<.12);
    assert.ok(s.minRodElevationDeg>=g.marginDeg-1e-7);
    assert.match(tiltyInverse(tiltyGeometry({...profile.kinematicModel,marginDeg:4.1}),{tcp:w.tcp,rotation:s.rotation}).errors.join(),/elevation reserve/);
  }
  const a=g.maxTiltDeg*Math.PI/180,R=gimbalRotation(0,a),carrierX=g.towerRadiusMm-g.platformRadiusMm-g.rodLengthMm*Math.cos(g.marginDeg*Math.PI/180)+1e-7;
  const edge=tiltyInverse(g,{tcp:[carrierX-g.toolLengthMm*Math.sin(a),0,0],rotation:R});
  assert.ok(edge.valid,edge.errors.join());assert.ok(edge.mainHeights[0]-g.railMinMm<.1);
});

test('Tilty slider bounds use the main-rod disk intersections and the nozzle tilt lever',()=>{
  const g=tiltyGeometry(),b=tiltyBounds(g),r=g.towerRadiusMm-g.platformRadiusMm,L=g.rodLengthMm*Math.cos(g.marginDeg*Math.PI/180),side=g.toolLengthMm*Math.sin(g.maxTiltDeg*Math.PI/180);
  assert.ok(Math.abs(b.min[0]-(r-L-side))<1e-6);
  assert.ok(Math.abs(b.max[0]-(Math.sqrt(L*L-3*r*r/4)-r/2+side))<1e-6);
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

test('a rail correction respects an already-active tilt boundary instead of stalling between the two',async()=>{
  const machine=loadMachine('tilty'),from=[8,0,177,40,0],program={seconds:1,moves:[{from:from.slice(0,3),to:from.slice(0,3),startSeconds:0,durationSeconds:1}]};
  const p=await createMachinePresentation({machine,program,sourceIdentity:binding});
  const s=await p.sample({requestId:1,seconds:0,manual:[8,0,185,40,0],jog:{axis:2,from}});
  assert.equal(s.status,'ready');assert.equal(s.controlValues[2],185);assert.ok(s.controlValues[0]>8);p.dispose();
});

test('Cartesian jog stops at the physical axis endpoint without moving unrelated axes',async()=>{
  const machine=loadMachine('ultimaker-s5'),program={seconds:1,moves:[{from:[100,80,10],to:[100,80,10],startSeconds:0,durationSeconds:1}]};
  const p=await createMachinePresentation({machine,program,sourceIdentity:binding}),from=[100,80,10];
  const s=await p.sample({requestId:1,seconds:0,manual:[1000,80,10],jog:{axis:0,from}});
  assert.equal(s.status,'ready');assert.ok(Math.abs(s.controlValues[0]-machine.bounds.max[0])<.002);assert.deepEqual(s.controlValues.slice(1),[80,10]);
  const rail=p.descriptor.components.find(c=>c.id==='z-rail-0');assert.equal(rail.shape.toMm[2],machine.bounds.max[2]);p.dispose();
});
