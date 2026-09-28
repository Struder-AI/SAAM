import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createSplineFieldEvaluator,uniformKnots,validateSplineField} from '../geom/spline-field.mjs';
import {compileSplineField} from '../geom/spline-field-compile.mjs';
import {solidKernel,preciseSolidMesh} from '../geom/solid.mjs';
import {validateSplineFieldRecord} from '../geom/spline-field-record.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {sectionGeometry,topAt} from '../geom/query.mjs';
import {regionArea} from '../region/region2d.mjs';
import {createSplineFieldBundle,updateSplineFieldBundle} from '../print/spline-field.mjs';
import {loadBundle,generateBundle,approve,deliver,initBundle} from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {createGeometry,verifyGeometry} from '../print/geometry.mjs';
import {splineBox} from '../geom/spline-solid.mjs';

function field({counts=[2,2,2],degrees=[1,1,1],sizeMm=[12,12,2],originMm=[0,0,0],value=()=>1,isoValue=0.5}={}){
  const values=[];
  for(let z=0;z<counts[2];z++)for(let y=0;y<counts[1];y++)for(let x=0;x<counts[0];x++)values.push(value(x,y,z));
  return {schema:'saam-spline-field/1',originMm,sizeMm,counts,degrees,knots:counts.map((n,i)=>uniformKnots(n,degrees[i])),values,weights:null,isoValue};
}
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);



test('solid export retains coordinates below a Float32 ULP and honors property seams',async()=>{
  const kernel=await solidKernel(),cube=kernel.Manifold.cube([1,2,3]),moved=cube.translate([1.00000003,0,0]);
  const seams=moved.calculateNormals(0,0);
  try{
    const {vertices,triangles}=preciseSolidMesh(seams),mesh=makeMesh(vertices,triangles);
    close(mesh.bounds.min[0],1.00000003,1e-14);close(mesh.bounds.max[0],2.00000003,1e-14);
    assert.equal(vertices.length,8);
  }finally{seams.delete();moved.delete();cube.delete();}
});

test('trilinear field reproduces an affine scalar with physical gradients and control sensitivities',()=>{
  const f=field({sizeMm:[4,6,8],originMm:[-3,7,10],value:(x,y,z)=>2*x+3*y-4*z}),evaluate=createSplineFieldEvaluator(f);
  const at=evaluate([-2,10,12],{derivatives:true,influences:true});
  close(at.value,1);at.gradient.forEach((v,i)=>close(v,[0.5,0.5,-0.5][i]));
  close(at.influences.reduce((s,t)=>s+t.weight,0),1);
  const changed=structuredClone(f);changed.values[3]+=1e-5;
  close((createSplineFieldEvaluator(changed)([-2,10,12]).value-at.value)/1e-5,at.influences.find(t=>t.index===3).weight);
  f.values.fill(100);close(evaluate([-2,10,12]).value,1);
  assert.equal(evaluate([-4,10,12]),null);
});

test('quadratic tensor field reproduces a cylinder; rational derivatives match independent finite differences',()=>{
  const f=field({counts:[3,3,2],degrees:[2,2,1],value:(x,y)=>25-[36,-36,36][x]-[36,-36,36][y],isoValue:0});
  const evaluate=createSplineFieldEvaluator(f);
  for(const [x,y] of [[6,6],[3,7],[0,2],[12,12]]){
    const at=evaluate([x,y,1],{derivatives:true});close(at.value,25-(x-6)**2-(y-6)**2);
    close(at.gradient[0],-2*(x-6));close(at.gradient[1],-2*(y-6));close(at.gradient[2],0);
  }
  f.weights=f.values.map((_,i)=>1+i/20);const rational=createSplineFieldEvaluator(f),point=[4,5,1],at=rational(point,{derivatives:true,influences:true});
  for(let axis=0;axis<3;axis++){
    const a=[...point],b=[...point];a[axis]-=1e-5;b[axis]+=1e-5;
    close(at.gradient[axis],(rational(b).value-rational(a).value)/2e-5,1e-7);
  }
  close(at.influences.reduce((s,t)=>s+t.weight*f.values[t.index],0),at.value);
});

test('nonuniform cubic knots remain continuous and invalid lattices fail at input',()=>{
  const f=field({counts:[6,2,2],degrees:[3,1,1],value:x=>x});f.knots[0]=[0,0,0,0,0.2,0.7,1,1,1,1];
  const evaluate=createSplineFieldEvaluator(f);
  for(const t of [0.2,0.7])close(evaluate([12*t-1e-8,6,1]).value,evaluate([12*t+1e-8,6,1]).value,1e-7);
  for(const modify of [f=>f.values.pop(),f=>f.values[0]=NaN,f=>f.weights=[-1],f=>f.sizeMm[0]=0,f=>f.knots[0][4]=-1,f=>f.degrees[0]=6]){
    const bad=structuredClone(f);modify(bad);assert.throws(()=>validateSplineField(bad),/Spline field|spline field/);
  }
});

test('extraction clips a fully occupied domain exactly and the sampling budget fails before huge allocation',async()=>{
  const f=field(),g=await compileSplineField(f,{edgeMm:1}),mesh=makeMesh(g.vertices,g.triangles);
  assert.deepEqual(mesh.bounds,{min:[0,0,0],max:[12,12,2]});close(regionArea(sectionGeometry(mesh,1).loops),144);
  await assert.rejects(compileSplineField(f,{edgeMm:1e-12,maxEvaluations:1000}),/maxEvaluations/);
  await assert.rejects(compileSplineField({...f,values:f.values.map(()=>0)},{edgeMm:1}),/empty/);
  const changed=structuredClone(g);changed.field.isoValue=0.7;assert.throws(()=>validateSplineFieldRecord(changed),/Rebuild/);
});

test('spline cylinder sections converge to analytical area as extraction resolution improves',async()=>{
  const f=field({counts:[3,3,2],degrees:[2,2,1],value:(x,y)=>25-[36,-36,36][x]-[36,-36,36][y],isoValue:0});
  const errors=[];
  for(const edgeMm of [1.5,0.5]){
    const g=await compileSplineField(f,{edgeMm}),mesh=makeMesh(g.vertices,g.triangles);
    errors.push(Math.abs(regionArea(sectionGeometry(mesh,1).loops)-Math.PI*25));
    close(topAt(mesh,6,6).zMm,2,1e-6);
  }
  assert.ok(errors[1]<errors[0]/2);assert.ok(errors[1]<0.3,JSON.stringify(errors));
});

test('sampled fields preserve a through-hole and disconnected islands in mesh sections',async()=>{
  for(const [value,loops] of [
    [(x,y)=>Math.min(5-Math.hypot(x-6,y-6),Math.hypot(x-6,y-6)-2),2],
    [(x,y)=>Math.max(1.5-Math.hypot(x-3,y-6),1.5-Math.hypot(x-9,y-6)),2]
  ]){
    const f=field({counts:[13,13,2],value,isoValue:0}),g=await compileSplineField(f,{edgeMm:0.7}),mesh=makeMesh(g.vertices,g.triangles);
    assert.equal(sectionGeometry(mesh,1).loops.length,loops);assert.equal(topAt(mesh,6,6),null);
  }
});

test('enclosed void remains empty in middle sections and covered at the roof',async()=>{
  const f=field({counts:[3,3,3],degrees:[2,2,2],sizeMm:[12,12,12],value:(x,y,z)=>[36,-36,36][x]+[36,-36,36][y]+[36,-36,36][z]-9,isoValue:0});
  const g=await compileSplineField(f,{edgeMm:0.7}),mesh=makeMesh(g.vertices,g.triangles);
  const middle=sectionGeometry(mesh,6).loops;
  assert.equal(middle.length,2);close(regionArea(middle),144-Math.PI*9,0.5);
  close(regionArea(sectionGeometry(mesh,1).loops),144,1e-6);close(topAt(mesh,6,6).zMm,12,1e-6);
});

test('CLI creates and rebuilds a field from a request file without approving it',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-spline-field-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const bundle=join(dir,'print'),file=join(dir,'request.json'),request={field:field(),extraction:{edgeMm:1}};
  await writeFile(file,JSON.stringify(request));
  execFileSync(process.execPath,['core/print/cli.mjs','spline-field-create',bundle,file,'ultimaker-s5'],{stdio:'pipe'});
  const state=await loadBundle(bundle);request.field.isoValue=0.7;await writeFile(file,JSON.stringify(request));
  execFileSync(process.execPath,['core/print/cli.mjs','spline-field-update',bundle,file,'--revision',state.revision],{stdio:'pipe'});
  const next=await loadBundle(bundle);assert.equal(next.plan.geometry.field.isoValue,0.7);assert.deepEqual(next.review.approvals,{});
});

test('spline field lifecycle retains source, slices, reopens, delivers exact bytes and invalidates changed controls',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-spline-field-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const request={field:field(),extraction:{edgeMm:1}};
  let state=await createSplineFieldBundle(dir,request);
  assert.deepEqual(state.plan.geometry.field,request.field);assert.equal(state.geometry.nativeFile,'model.mesh.json');
  const native=await createGeometry(state.plan.geometry),fake=structuredClone(native.descriptor);fake.vertices[0][0]+=1;
  await assert.rejects(verifyGeometry(native.bytes,fake),/display\/identity/);
  await generateBundle(dir);state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.ok(state.program.moves.length>0);
  const bytes=await readFile(join(dir,state.review.generation.file));
  await approve(dir,{actor:'SYNTHETIC SPLINE FIELD TEST',revision:state.revision});state=await loadBundle(dir);
  assert.deepEqual(await readFile(await deliver(dir)),bytes);
  request.field.values[0]=0;
  state=await updateSplineFieldBundle(dir,request,{expectedRevision:state.revision});
  assert.equal(state.toolpathApproved,false);
  await assert.rejects(updateSplineFieldBundle(dir,request,{expectedRevision:'stale'}),/stale/);
  execFileSync(process.execPath,['core/print/cli.mjs','check',dir],{stdio:'pipe'});
});

test('spline field components compose with spline geometry and planar infill through shared generation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-spline-field-mixed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const plan=defaults();plan.skills['draped-skin'].enabled=false;plan.skills['full-fill'].enabled=false;plan.skills['planar-infill'].enabled=true;
  plan.geometry={shape:'assembly',parts:[{id:'field',geometry:await compileSplineField(field(),{edgeMm:1}),xMm:0,yMm:0,zMm:0},
    {id:'spline',geometry:splineBox({runMm:12,widthMm:12,heightMm:2}),xMm:20,yMm:0,zMm:0}]};
  await initBundle(dir,plan);await generateBundle(dir,{development:true});const state=await loadBundle(dir);
  assert.equal(state.programError,undefined);assert.equal(state.pathSummary.planarInfill.instances.length,2);
});
