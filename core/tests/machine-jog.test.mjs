import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainedJog} from '../machine/jog.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {loadMachine} from '../machine/profile.mjs';
const binding={printId:'jog',revision:'1',exportHash:'unchanged'};



test('jog couples coordinates at a curved boundary and stops where two constraints meet',()=>{
  const evaluate=([x,y])=>{const margins=[1-x*x-y*y,y-.2];return {valid:margins.every(v=>v>=0),margins};};
  const request={from:[0,1],target:[.8,1],axis:0,scales:[1,1],evaluate};
  const a=constrainedJog(request);assert.ok(Math.abs(a.values[0]-.8)<1e-6);assert.ok(Math.abs(a.values[1]-.6)<1e-4);assert.equal(a.adjusted,true);
  assert.deepEqual(constrainedJog(request),a);
  const b=constrainedJog({...request,from:a.values,target:[1.2,a.values[1]]});
  assert.equal(b.limited,true);assert.ok(evaluate(b.values).valid);assert.ok(Math.abs(b.values[0]-Math.sqrt(.96))<.002);assert.ok(Math.abs(b.values[1]-.2)<.002);
});



test('Cartesian jog stops at the physical axis endpoint without moving unrelated axes',async()=>{
  const machine=loadMachine('ultimaker-s5'),program={seconds:1,moves:[{from:[100,80,10],to:[100,80,10],startSeconds:0,durationSeconds:1}]};
  const p=await createMachinePresentation({machine,program,sourceIdentity:binding}),from=[100,80,10];
  const s=await p.sample({requestId:1,seconds:0,manual:[1000,80,10],jog:{axis:0,from}});
  assert.equal(s.status,'ready');assert.ok(Math.abs(s.controlValues[0]-machine.bounds.max[0])<.002);assert.deepEqual(s.controlValues.slice(1),[80,10]);
  const rail=p.descriptor.components.find(c=>c.id==='z-rail-0');assert.equal(rail.shape.toMm[2],machine.bounds.max[2]);p.dispose();
});
