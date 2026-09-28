import test from 'node:test';
import assert from 'node:assert/strict';
import {uniformKnots,createVoxelEvaluator,validateVoxelField} from '../geom/voxel.mjs';
import {refineHierarchy} from '../geom/voxel-hierarchy.mjs';
import {insertVoxelKnot} from '../geom/voxel-refine.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10);
test('local hierarchical and tensor knot refinement preserve rational field values and gradients',()=>{
 const counts=[7,7,7],field={schema:'saam-voxel-field/1',originMm:[0,0,0],sizeMm:[4,2,2],counts,degrees:[2,2,2],knots:counts.map(n=>uniformKnots(n,2)),values:Array.from({length:343},(_,i)=>Math.sin(i)),weights:Array.from({length:343},(_,i)=>1+i%4),isoValue:0};
 const a=createVoxelEvaluator(field),local=refineHierarchy(field,171).field,fine=local.hierarchy.controls.findIndex(c=>c.level===1),nested=refineHierarchy(local,fine,{maxControls:4000}).field;
 for(const refined of [local,nested,insertVoxelKnot(field,0,.37)]){
  const b=createVoxelEvaluator(refined);
  for(let i=0;i<101;i++){const p=[4*i/100,2*((i*37)%101)/100,2*((i*61)%101)/100],u=a(p,{derivatives:true}),v=b(p,{derivatives:true});close(u.value,v.value);u.gradient.forEach((x,j)=>close(x,v.gradient[j]));}
 }
 const edited=structuredClone(local);edited.values[fine]+=5;close(createVoxelEvaluator(edited)([3.9,1.9,1.9]).value,a([3.9,1.9,1.9]).value);
 nested.hierarchy.controls.shift();nested.values.shift();nested.weights.shift();assert.throws(()=>validateVoxelField(nested),/missing active basis/);
});
