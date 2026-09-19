import test from 'node:test';
import assert from 'node:assert/strict';
import {textLayout} from '../geom/text-layout.mjs';
import {referenceSurface} from '../geom/reference-surface.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell} from '../print/generate.mjs';
import {tessellateShell} from '../geom/tessellate.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const layout=baseline=>textLayout({baseline,positionMm:[0,0],rotationDeg:0,mirror:false},0.02);

test('circular layout uses physical arc length, both directions and the left normal',()=>{
  const clockwise=layout({kind:'circle',radiusMm:10});
  const quarter=5*Math.PI;
  const top=clockwise(0,2),right=clockwise(quarter,2),left=clockwise(-quarter,2);
  near(top[0],0);near(top[1],12);near(right[0],12);near(right[1],0);near(left[0],-12);
  const ccw=layout({kind:'circle',radiusMm:10,clockwise:false,startAngleDeg:0});
  const p=ccw(quarter,2);near(p[0],0);near(p[1],8);
  // Positive layout orientation is retained in either direction.
  for(const map of [clockwise,ccw]){
    const a=map(2,1),b=map(2.001,1),c=map(2,1.001);
    assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0);
  }
  assert.throws(()=>clockwise(0,-10),/crosses its centre/);
  assert.throws(()=>layout({kind:'circle',radiusMm:0}),/positive radiusMm/);
  assert.throws(()=>layout({kind:'circle',radiusMm:5,stretch:true}),/Unknown/);
});

test('top reference retains XY and follows analytical curved spline height and normal',async()=>{
  const roof={shape:'spline-top',runMm:20,widthMm:12,cpU:4,cpV:4,
    heightsMm:[3,6,6,3].map(z=>[z,z+0.4,z+0.8,z+1.2])};
  const shell=buildShell(await rhino(),roof),map=referenceSurface({kind:'top'},shell);
  for(const [x,y] of [[2,5],[9,2],[17,10]]){
    const p=map(x,y),u=x/20;
    near(p.point[0],x);near(p.point[1],y);near(p.point[2],3+9*u*(1-u)+0.1*y);
    const n=[-9*(1-2*u)/20,-0.1,1],length=Math.hypot(...n);
    n.forEach((v,i)=>near(p.normal[i],v/length));
  }
  assert.throws(()=>map(-2,5),/outside.*top/);
  assert.throws(()=>referenceSurface({kind:'top'}),/original part/);
  assert.throws(()=>referenceSurface({kind:'top',sizeMm:[20,12]},shell),/Unknown/);
});

test('top reference also uses mesh geometry and reverses the relief normal explicitly',async()=>{
  const box=buildShell(await rhino(),{shape:'box',runMm:20,widthMm:12,heightMm:3});
  const mesh=tessellateShell(box),p=referenceSurface({kind:'top',normalSide:-1},mesh)(7,5);
  assert.deepEqual(p.point,[7,5,3]);near(p.normal[2],-1);
});

test('spline tessellation refines until its tolerance is met, past the retired triangle budget',async()=>{
  const shell=buildShell(await rhino(),{shape:'spline-top',runMm:20,widthMm:12,cpU:4,cpV:4,
    heightsMm:[[3,3,3,3],[3,5,5,3],[3,5,5,3],[3,3,3,3]]});
  // Six patches at 128 steps are 196,608 triangles; the old 100,000-triangle
  // budget refused this tolerance before any subdivision ran.
  const mesh=tessellateShell(shell,{toleranceMm:0.001});
  assert.equal(mesh.tessellation.steps,128);
  assert.ok(mesh.triangles.length>100000);
  assert.ok(mesh.tessellation.sampledErrorMm<=0.001);
});
