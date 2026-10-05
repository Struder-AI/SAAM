import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {splineSolidShell} from '../geom/spline-solid.mjs';
import {rhino} from '../geom/runtime.mjs';
import {intersectPatches} from '../geom/surface-intersection.mjs';
import {surfaceInside} from '../region/section.mjs';
import {referencePatch} from '../geom/reference-surface.mjs';
import {evaluate} from '../geom/nurbs.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {regionArea} from '../region/region2d.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

const s=Math.SQRT1_2,circle=[[1,0,1],[1,1,s],[0,1,1],[-1,1,s],[-1,0,1],[-1,-1,s],[0,-1,1],[1,-1,s],[1,0,1]],knotsU=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1];
const cylinder=(r,z0,z1)=>({shape:'spline',patches:[
  {name:'side',degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([x,y,w])=>[[10+r*x,10+r*y,z0,w],[10+r*x,10+r*y,z1,w]])},
  {name:'cap-top',degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([x,y,w])=>[[10,10,z1,w],[10+r*x,10+r*y,z1,w]])},
  {name:'cap-bottom',degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([x,y,w])=>[[10,10,z0,w],[10+r*x,10+r*y,z0,w]])}]});
const crosswise=r=>referencePatch({degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([a,b,w])=>[[0,10+r*a,5+r*b,w],[20,10+r*a,5+r*b,w]])});
const length=points=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-points[i][k])),0);
const close=(a,b,tolerance)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const shell=async g=>splineSolidShell(await rhino(),g);
const patch=async(g,name)=>(await shell(g)).patches.find(p=>p.name===name);

test('a plane cuts a cylinder in a circle that ends exactly on the seam',async()=>{
  const {curves}=intersectPatches(await patch(splineBox({runMm:20,widthMm:20,heightMm:5}),'top'),await patch(cylinder(4,-1,6),'side'));
  assert.equal(curves.length,1);assert.deepEqual(curves[0].ends,['boundary','boundary']);
  for(const p of curves[0].points){close(Math.hypot(p[0]-10,p[1]-10),4,1e-8);close(p[2],5,1e-8);}
  close(length(curves[0].points),8*Math.PI,2e-3);
  assert.deepEqual(curves[0].uvB.map(uv=>uv[0]).filter(u=>u===0||u===1).length,2);
});

test('crossed cylinders intersect in two loops, split only at their seams, on both surfaces',async()=>{
  const {curves}=intersectPatches(await patch(cylinder(4,-1,11),'side'),crosswise(3));
  assert.equal(curves.length,4);
  assert.ok(curves.every(c=>c.ends.every(e=>e==='boundary')));
  for(const c of curves)for(const p of c.points){close(Math.hypot(p[0]-10,p[1]-10),4,1e-8);close(Math.hypot(p[1]-10,p[2]-5),3,1e-8);}
  close(curves.reduce((sum,c)=>sum+length(c.points),0),39.5519,5e-3);
});

test('a boundary edge lying in the other surface is itself the intersection curve',async()=>{
  const {curves}=intersectPatches(await patch(splineBox({runMm:20,widthMm:20,heightMm:5}),'bottom'),await patch(cylinder(4,0,5),'side'));
  assert.equal(curves.length,1);assert.deepEqual(curves[0].ends,['edge','edge']);close(length(curves[0].points),8*Math.PI,2e-3);
});

test('a wavy surface inside a spline solid and inside the same solid as a mesh give one region',async()=>{
  const g=[0,1/6,1/2,5/6,1],zs=[[2.5,2.5,2.5,2.5,2.5],[2.5,20,2.5,-15,2.5],[2.5,2.5,2.5,2.5,2.5],[2.5,-15,2.5,20,2.5],[2.5,2.5,2.5,2.5,2.5]];
  const P=referencePatch({degreeU:3,degreeV:3,controlPoints:g.map((a,i)=>g.map((b,j)=>[-5+30*a,-5+30*b,zs[i][j]]))});
  const box=await shell(splineBox({runMm:20,widthMm:20,heightMm:5}));
  const mesh=makeMesh([[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,5],[20,0,5],[20,20,5],[0,20,5]],
    [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]);
  const spline=regionArea(surfaceInside(P,box).loops),triangles=regionArea(surfaceInside(P,mesh).loops);
  close(spline,triangles,1e-6);
  let inside=0;const n=200;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){const p=evaluate(P,(i+.5)/n,(j+.5)/n,false).point;if(p[0]>0&&p[0]<20&&p[1]>0&&p[1]<20&&p[2]>0&&p[2]<5)inside++;}
  close(spline,inside/n/n,2e-3);
  const flat=referencePatch({degreeU:1,degreeV:1,controlPoints:[[[-5,-5,2],[-5,25,2]],[[25,-5,2],[25,25,2]]]});
  close(regionArea(surfaceInside(flat,await shell(cylinder(4,-1,6))).loops),16*Math.PI/900,2e-5);
});
