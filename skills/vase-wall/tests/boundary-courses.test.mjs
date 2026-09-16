import test from 'node:test';
import assert from 'node:assert/strict';
import {patternCourses} from '../scripts/boundary-courses.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {vaseWallResult} from '../scripts/vase.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {loopMotif} from '../scripts/motif.mjs';
import {strokeRegion} from '../../../core/region/stroke.mjs';
import {pointInRegion,regionArea} from '../../../core/region/region2d.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);

test('flat courses preserve every motif vertex and mirror departure/arrival with nominal gap volume',()=>{
  const points=Array.from({length:9},(_,i)=>[i/8,i*.2/8]);
  const pattern={paths:[{points,offsetMm:0,beadHeightMm:.2}],advance:[1,.2],repeats:4};
  const courses=[...patternCourses(pattern,{level:true,spanMm:.8,firstHeightMm:.2,referenceLengthMm:50})];
  assert.equal(courses.length,6);
  assert.ok(courses[0].paths[0].vertices.every(p=>p[1]===0));
  assert.ok(courses.at(-1).paths[0].vertices.every(p=>p[1]===.8));
  for(let c=1;c<courses.length;c++){
    const a=courses[c-1].paths[0].vertices.at(-1),b=courses[c].paths[0].vertices[0];
    near(a[0],b[0]);near(a[1],b[1]);near(a[2],b[2]);
  }
  const departure=courses[1].paths[0],arrival=courses.at(-2).paths[0];
  departure.vertices.forEach((p,i)=>near(p[1],.8-arrival.vertices.at(-1-i)[1]));
  for(let i=0;i<points.length;i++){
    near(courses.reduce((sum,c)=>sum+c.paths[0].heights[i],0),1);
    for(const c of courses)assert.ok(c.paths[0].heights[i]>=0);
  }
  assert.deepEqual(courses[2].paths[0].vertices,points.map(([u,z])=>[u+1,z+.2,0]));
});

test('a wide looping motif has complete flat first/last courses with continuous joins after flow mapping',async()=>{
  const machine=loadMachine(),plan=defaults(machine),r=await rhino();
  plan.geometry={shape:'box',runMm:25,widthMm:20,heightMm:2};
  plan.skills['vase-wall'].pattern={motif:loopMotif({widthCells:2.8,depthMm:4.8,samples:32}),cellsPerTurn:8,courseRiseMm:.2,repeats:8,tiltDeg:0};
  const result=vaseWallResult({shell:buildShell(r,plan.geometry),plan,machine}),strokes=result.operations[0].strokes;
  assert.equal(plan.skills['vase-wall'].endTransition,'level');
  assert.equal(strokes.length,10);
  assert.ok(strokes[0].points.every(p=>p[2]===.2));
  assert.ok(strokes.at(-1).points.every(p=>p[2]===2));
  for(let i=1;i<strokes.length;i++)strokes[i].points[0].forEach((v,k)=>near(v,strokes[i-1].points.at(-1)[k]));
  assert.ok(strokes.every(s=>s.volumesMm3.every(v=>v>0)));
  assert.equal(result.report.boundaryCourses,2);
});

test('a swept self-crossing bead footprint retains holes and does not fill its guide',()=>{
  const ring=[[0,0],[10,0],[10,10],[0,10],[0,0]],cross=[[3,3],[7,7],[3,7],[7,3]];
  const area=strokeRegion([ring,cross],.4);
  assert.ok(pointInRegion([0,5],area));assert.ok(pointInRegion([5,5],area));
  assert.ok(!pointInRegion([2,2],area));
  assert.ok(regionArea(area)<30);
});
