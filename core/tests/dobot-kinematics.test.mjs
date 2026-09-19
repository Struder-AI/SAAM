import test from 'node:test';
import assert from 'node:assert/strict';
import {dobotGeometry,dobotForward,dobotInverse} from '../machine/dobot-kinematics.mjs';
const g=dobotGeometry(),near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('MG400 nominal zero pose matches the summed official URDF offsets',()=>{
  const p=dobotForward(g,[0,0,0,0]);assert.ok(p.valid);near(p.tcp[0],278.4189104503622);near(p.tcp[1],0);near(p.tcp[2],337.249518361984);
});
test('MG400 analytic inverse round-trips independent shoulder, forearm and wrist angles',()=>{
  for(const q of [[0,0,0,0],[40,30,50,70],[-100,45,65,-90],[15,-10,40,250]]){
    const p=dobotForward(g,q),back=dobotInverse(g,{tcp:p.tcp,yawDeg:p.yawDeg},{seed:q});assert.ok(p.valid&&back.valid);for(let i=0;i<4;i++)near(back.joints[i],q[i]);
  }
});
test('MG400 rejects reach, tilt, branch and angular-limit violations',()=>{
  assert.equal(dobotInverse(g,{tcp:[1000,0,0]}).valid,false);
  assert.equal(dobotForward(g,[180,0,0,0]).valid,false);
  assert.throws(()=>dobotInverse(g,{tcp:[280,0,300],toolAxis:[1,0,0]}),/cannot tilt/);
  const p=dobotForward(g,[0,20,40,0]);assert.equal(dobotInverse(dobotGeometry({branch:'elbow-positive'}),{tcp:p.tcp}).valid,false);
});
test('MG400 wrist winding is deterministic from the preceding joint seed',()=>{
  const p=dobotForward(g,[0,0,0,0]);near(dobotInverse(g,{tcp:p.tcp,yawDeg:350},{seed:[0,0,0,-20]}).joints[3],-10);near(dobotInverse(g,{tcp:p.tcp,yawDeg:350},{seed:[0,0,0,340]}).joints[3],350);
});
