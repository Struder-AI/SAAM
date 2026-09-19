import test from 'node:test';
import assert from 'node:assert/strict';
import {tessellateShell} from '../geom/tessellate.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell} from '../print/generate.mjs';

function freezeRecords(value,seen=new Set()){
  if(!value||typeof value!=='object'||ArrayBuffer.isView(value)||seen.has(value))return value;
  seen.add(value);for(const item of Object.values(value))freezeRecords(item,seen);
  return Object.freeze(value);
}

test('tessellation accepts frozen shell records and preserves control nets across refinements',async()=>{
  const source=buildShell(await rhino(),{shape:'spline-top',runMm:20,widthMm:12,cpU:4,cpV:4,
    heightsMm:[[3,3,3,3],[3,5,5,3],[3,5,5,3],[3,3,3,3]]});
  const shell=freezeRecords({patches:source.patches,closure:source.closure});
  // Typed arrays cannot be frozen; retain their exact bytes separately.
  const patches=structuredClone(shell.patches);
  const coarse=tessellateShell(shell,{toleranceMm:0.08});
  const coarseGeometry=structuredClone({vertices:coarse.vertices,triangles:coarse.triangles});
  const fine=tessellateShell(shell,{toleranceMm:0.02});
  assert.deepEqual(shell.patches,patches);
  assert.deepEqual({vertices:coarse.vertices,triangles:coarse.triangles},coarseGeometry);
  assert.equal(coarse.tessellation.steps,8);assert.equal(fine.tessellation.steps,16);
  assert.ok(fine.tessellation.sampledErrorMm<coarse.tessellation.sampledErrorMm);
  const signedVolume=mesh=>mesh.triangles.reduce((sum,triangle)=>{
    const [a,b,c]=triangle.map(i=>mesh.vertices[i]);
    return sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  },0);
  assert.ok(signedVolume(coarse)>0);assert.ok(signedVolume(fine)>0);
  assert.ok(Math.abs(signedVolume(fine)-840)<Math.abs(signedVolume(coarse)-840));
});

test('existing mesh identity bypasses tessellation and malformed closure fails before sampling',()=>{
  const mesh=freezeRecords({kind:'triangle-mesh',vertices:[[0,0,0]],triangles:[]});
  assert.equal(tessellateShell(mesh),mesh);
  const shell=freezeRecords({patches:[],closure:{unmatched:[1],edges:[{curve:()=>{throw Error('must not sample');}}]}});
  assert.throws(()=>tessellateShell(shell),/requires a closed mesh/);
});
