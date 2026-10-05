import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildShell} from '../geom/build.mjs';
import {rhino} from '../geom/runtime.mjs';
import {topAt} from '../geom/query.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import {section} from '../region/section.mjs';
import {splineSolidShell} from '../geom/spline-solid.mjs';
import {tessellateShell} from '../geom/tessellate.mjs';
import {regionArea} from '../region/region2d.mjs';
import {defaults} from '../print/plan.mjs';
import {initBundle,loadBundle,generateBundle} from '../print/bundle.mjs';
import {intersectGeometry,intersectRequest,combineGeometry} from '../print/geometry-tools.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

// An exact cylinder as GEOMETRY.md writes it: the rational circle along U, a
// ruled side and two caps closing on their centre poles.
const s=Math.SQRT1_2,circle=[[1,0,1],[1,1,s],[0,1,1],[-1,1,s],[-1,0,1],[-1,-1,s],[0,-1,1],[1,-1,s],[1,0,1]],knotsU=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1];
const cylinder=(cx,cy,r,z0,z1)=>({shape:'spline',patches:[
  {name:'side',degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([x,y,w])=>[[cx+r*x,cy+r*y,z0,w],[cx+r*x,cy+r*y,z1,w]])},
  {name:'cap-top',degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([x,y,w])=>[[cx,cy,z1,w],[cx+r*x,cy+r*y,z1,w]])},
  {name:'cap-bottom',degreeU:2,degreeV:1,knotsU,controlPoints:circle.map(([x,y,w])=>[[cx,cy,z0,w],[cx+r*x,cy+r*y,z0,w]])}]});
const box=splineBox({runMm:20,widthMm:20,heightMm:5});
const close=(a,b,tolerance)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('layer booleans of spline solids follow their exact sections: through hole, union and intersection',async()=>{
  const r=await rhino(),shell=g=>buildShell(r,g);
  const drilled=shell({shape:'boolean',operation:'difference',operands:[box,cylinder(10,10,4,-1,6)]}),cut=section(drilled,horizontalSlice(2.5));
  assert.equal(cut.loops.length,2);close(regionArea(cut.loops),400-16*Math.PI,0.02);
  assert.equal(topAt(drilled,10,10),null);close(topAt(drilled,2,2).zMm,5,1e-9);
  const post=shell({shape:'boolean',operation:'union',operands:[box,cylinder(10,10,4,0,9)]});
  close(topAt(post,10,10).zMm,9,1e-9);close(regionArea(section(post,horizontalSlice(7)).loops),16*Math.PI,0.02);
  const half=shell({shape:'boolean',operation:'intersection',operands:[box,cylinder(20,10,6,0,9)]});
  close(regionArea(section(half,horizontalSlice(2)).loops),18*Math.PI,0.02);close(half.bounds.max[2],5,1e-9);
});

test('a blind pocket reports its floor as the top, and nested booleans combine',async()=>{
  const r=await rhino(),pocket=buildShell(r,{shape:'boolean',operation:'difference',operands:[box,cylinder(10,10,3,3,6)]});
  close(topAt(pocket,10,10).zMm,3,1e-9);close(topAt(pocket,11,10).zMm,3,1e-9);
  const nested=buildShell(r,{shape:'boolean',operation:'union',operands:[
    {shape:'boolean',operation:'difference',operands:[box,cylinder(10,10,3,3,6)]},cylinder(10,10,1,0,8)]});
  close(topAt(nested,10,10).zMm,8,1e-9);close(topAt(nested,12,10).zMm,3,1e-9);
});

test('revolved caps tessellate across their seams and report a top at the pole',async()=>{
  const shell=splineSolidShell(await rhino(),cylinder(10,10,4,0,6));
  assert.ok(tessellateShell(shell,{toleranceMm:0.05}).tessellation.sampledErrorMm<=0.05);
  close(topAt(shell,10,10).zMm,6,1e-9);
});

test('intersect reports sections and tops of a supplied geometry in its own coordinates',async()=>{
  const result=await intersectGeometry({shape:'boolean',operation:'difference',operands:[box,cylinder(10,10,4,-1,6)]},{sectionsAtZ:[2],topsAtXY:[[10,10],[1,1]],includeLoops:true});
  assert.equal(result.sections[0].islands,1);assert.equal(result.sections[0].holes,1);
  assert.ok(result.sections[0].loops.every(loop=>loop.pointsMm.length===loop.points));
  assert.equal(result.tops[0].zMm,null);assert.equal(result.tops[1].zMm,5);assert.equal(result.tops[1].surface,'top');
});

test('combine drills a print, which reopens, generates, and answers intersect',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-boolean-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const bundle=join(dir,'print'),plan=defaults();plan.geometry=box;
  await initBundle(bundle,plan);let state=await loadBundle(bundle,{program:false});
  await combineGeometry(bundle,{operation:'difference',operand:cylinder(10,10,4,-1,6)},{expectedRevision:state.revision});
  state=await loadBundle(bundle,{program:false});
  assert.equal(state.plan.geometry.shape,'boolean');assert.equal(state.geometry.nativeFile,'model.mesh.json');assert.ok(state.geometry.faces.length>0);
  const answer=await intersectRequest(bundle,{sectionsAtZ:[2.5]});
  assert.equal(answer.sections[0].holes,1);
  await generateBundle(bundle,{development:true});state=await loadBundle(bundle);
  assert.equal(state.programError,undefined);assert.ok(state.program.moves.length>0);
});
