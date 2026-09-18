import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {compileGridfinity,gridfinityParameters} from '../scripts/gridfinity.mjs';
import {createGridfinityBundle,updateGridfinityBundle} from '../scripts/bundle.mjs';
import {makeMesh,sectionMesh} from '../../../core/geom/mesh.mjs';
import {pointInRegion,regionArea} from '../../../core/region/region2d.mjs';
import {solidKernel,solidFromMesh} from '../../../core/geom/solid.mjs';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {initBundle,loadBundle,adjustBundle,generateBundle,approve,deliver} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';
import {fileURLToPath} from 'node:url';

const mesh=record=>makeMesh(record.vertices,record.triangles);
const close=(actual,expected,tolerance=1e-4)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const section=(g,z)=>sectionMesh(mesh(g),z).loops;
async function temp(t){const dir=await mkdtemp(resolve(tmpdir(),'saam-synthetic-gridfinity-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function collision(a,b,shift){
  const k=await solidKernel(),sa=solidFromMesh(k,mesh(a)),sb=solidFromMesh(k,mesh(b)),moved=sb.translate(shift),intersection=sa.intersect(moved);
  try{return intersection.volume();}finally{intersection.delete();moved.delete();sb.delete();sa.delete();}
}

test('foot sections follow dimensional references and remain on 42 mm centres',async()=>{
  const g=await compileGridfinity({kind:'blank',xUnits:2});
  assert.deepEqual(mesh(g).bounds,{min:[0.25,0.25,0],max:[83.75,41.75,7]});
  for(const [z,width,radius] of [[0.4,36.4,1.2],[1.7,37.2,1.6],[3.6,39.2,2.6]]){
    const loops=section(g,z);assert.equal(loops.length,2);
    const bounds=loops.map(loop=>[Math.min(...loop.map(p=>p[0])),Math.max(...loop.map(p=>p[0]))]).sort((a,b)=>a[0]-b[0]);
    close(bounds[0][1]-bounds[0][0],width);close(bounds[1][0]-bounds[0][0],42);
    // Independent rounded-rectangle area; inscribed arcs converge from below.
    const analytic=2*(width*width-(4-Math.PI)*radius*radius);
    assert.ok(regionArea(loops)<=analytic+0.001&&analytic-regionArea(loops)<1.5);
  }
});

test('bins have physical floors, open cavities, equal dividers and finite stacking rims',async()=>{
  const g=await compileGridfinity({xUnits:2,compartmentsX:2,compartmentsY:2});
  close(mesh(g).bounds.max[2],24.8);
  assert.ok(pointInRegion([21,21],section(g,6.9)));
  const mid=section(g,10);assert.equal(mid.length,5);
  for(const point of [[21,10],[63,10],[21,32],[63,32]])assert.equal(pointInRegion(point,mid),false);
  for(const point of [[42,10],[21,21],[0.7,21]])assert.equal(pointInRegion(point,mid),true);
  assert.equal(section(g,23).length,2);
  const plain=await compileGridfinity({heightUnits:2,stackingLip:false});close(mesh(plain).bounds.max[2],14);
  assert.equal(pointInRegion([21,21],section(plain,13.9)),false);
});

test('default pockets have the specified centres, diameter and depth',async()=>{
  const g=await compileGridfinity({kind:'blank',magnetHoles:true}),loops=section(g,1.5);
  assert.equal(loops.length,5);
  for(const x of [8,34])for(const y of [8,34]){
    assert.equal(pointInRegion([x,y],loops),false);
    assert.equal(pointInRegion([x+3.1,y],loops),false);
    assert.equal(pointInRegion([x+3.4,y],loops),true);
    assert.equal(pointInRegion([x,y],section(g,2.5)),true);
  }
});

test('backed and open baseplates preserve webs and receive bins; stacking has no solid overlap',async()=>{
  const bin=await compileGridfinity({xUnits:2}),plate=await compileGridfinity({kind:'baseplate',xUnits:2});
  assert.deepEqual(mesh(plate).bounds.min,[0,0,0]);close(mesh(plate).bounds.max[0],84);close(mesh(plate).bounds.max[2],5.95);
  assert.ok(pointInRegion([21,21],section(plate,0.6)));
  assert.equal(pointInRegion([21,21],section(plate,2)),false);
  assert.ok(pointInRegion([42,21],section(plate,5.9)));
  close(await collision(plate,bin,[0,0,1.2]),0,0.01);
  close(await collision(bin,bin,[0,0,21]),0,0.01);
  assert.ok(await collision(plate,bin,[0,0,0.2])>1);
  const frame=await compileGridfinity({kind:'baseplate',floorMm:0});
  assert.equal(pointInRegion([21,21],section(frame,0.1)),false);
  assert.ok(pointInRegion([0.5,21],section(frame,0.1)));
});

test('arc refinement converges; invalid or irrelevant parameters fail',async()=>{
  const coarse=await compileGridfinity({kind:'blank',toleranceMm:0.1});
  const fine=await compileGridfinity({kind:'blank',toleranceMm:0.005});
  assert.ok(fine.triangles.length>coarse.triangles.length);
  const area=37.2**2-(4-Math.PI)*1.6**2;
  assert.ok(Math.abs(regionArea(section(fine,1.5))-area)<Math.abs(regionArea(section(coarse,1.5))-area));
  for(const input of [{xUnits:0},{xUnits:1.5},{xUnits:'2'},{yUnits:Infinity},{kind:'other'},{kind:'blank',wallMm:1},{kind:'baseplate',magnetHoles:true},{toleranceMm:0},{heightUnits:1},{compartmentsX:16},{wallMm:NaN},{stackingLip:'true'},{kind:'bin',heightUnits:2,floorMm:5.5},{typo:1}])
    assert.throws(()=>gridfinityParameters(input));
});

test('compiled mesh edits cannot retain a stale recipe identity; mixed assemblies use shared geometry',async()=>{
  const g=await compileGridfinity({kind:'blank'}),machine=loadMachine(),plan=defaults(machine);
  plan.skills['draped-skin'].enabled=false;plan.placement={xMm:20,yMm:20};plan.geometry=g;
  validatePlan(plan,machine);
  const stale=structuredClone(plan);stale.geometry.parameters.xUnits=2;
  assert.throws(()=>validatePlan(stale,machine),/Rebuild/);
  const changed=structuredClone(plan);changed.geometry.vertices[0][0]+=1;
  assert.throws(()=>validatePlan(changed,machine),/Rebuild/);
  plan.geometry={shape:'assembly',parts:[{id:'base',geometry:g,xMm:0,yMm:0,zMm:0},{id:'other',geometry:{shape:'box',runMm:5,widthMm:5,heightMm:2},xMm:50,yMm:0,zMm:0}]};
  validatePlan(plan,machine);const assembled=buildShell(await rhino(),plan.geometry);
  assert.equal(assembled.kind,'assembly');assert.equal(assembled.components[0].kind,'triangle-mesh');close(assembled.bounds.max[0],55);
});

test('dimension updates preserve lettering and plan settings, invalidate reviews, and reject stale/bad edits',async t=>{
  const dir=await temp(t);let state=await createGridfinityBundle(dir,{kind:'blank'},{setupFile:resolve(dir,'unused-setup.json')});
  assert.equal(state.geometry.nativeFile,'model.mesh.json');assert.deepEqual(state.review.approvals,{});
  const fontPath=fileURLToPath(new URL('../../text/tests/fixtures/Abel-Regular.ttf',import.meta.url));
  state=await applyText(dir,{feature:{text:'BO',fontPath,sizeMm:5,positionMm:[10,10],reference:{kind:'plane',origin:[0,0,7],xAxis:[1,0,0],yAxis:[0,1,0]}}},{expectedRevision:state.revision});
  state=await loadBundle(dir);const revision=state.revision;
  const changed=await updateGridfinityBundle(dir,{xUnits:2},{expectedRevision:revision});
  assert.equal(changed.plan.geometry.shape,'text');assert.equal(changed.plan.geometry.base.parameters.xUnits,2);
  assert.equal(changed.plan.geometry.features[0].text,'BO');assert.equal(changed.geometryApproved,false);
  assert.deepEqual(changed.plan.skills,state.plan.skills);assert.deepEqual(changed.plan.setup,state.plan.setup);
  await assert.rejects(updateGridfinityBundle(dir,{xUnits:3},{expectedRevision:revision}),/stale/);
  await assert.rejects(updateGridfinityBundle(dir,{xUnits:0},{expectedRevision:changed.revision}),/xUnits/);
  await assert.rejects(updateGridfinityBundle(dir,{kind:'bin'},{expectedRevision:changed.revision}),/another print/);
  assert.equal((await loadBundle(dir)).revision,changed.revision);
  await assert.rejects(createGridfinityBundle(dir,{kind:'blank'}),/already exists/);
  state=await applyText(dir,{remove:'text'},{expectedRevision:changed.revision});assert.equal(state.plan.geometry.shape,'gridfinity');
  await assert.rejects(adjustBundle(dir,{geometry:{parameters:{xUnits:3}}},{expectedRevision:state.revision}),/Rebuild/);
});

for(const machineId of ['ultimaker-s5','bambu-h2d'])test(`${machineId}: shared planar/solid generation, reopening and exact reviewed delivery`,async t=>{
  const dir=await temp(t);let state=await createGridfinityBundle(dir,{heightUnits:2,stackingLip:false},{machineId,setupFile:resolve(dir,'unused.json')});
  state=await adjustBundle(dir,{process:{minimumLayerSeconds:0}},{expectedRevision:state.revision});
  const actor='SYNTHETIC GRIDFINITY TEST — not a real approval';
  const checks=await generateBundle(dir);assert.ok(checks.moves>0);
  state=await loadBundle(dir);assert.ok(state.program&&!state.programError);
  const bytes=await readFile(resolve(dir,'exports',state.plan.output,state.exportName));
  await approve(dir,{stage:'toolpath',revision:state.revision,actor});
  const delivered=await deliver(dir);assert.ok((await readFile(delivered)).length>100);
  assert.deepEqual(await readFile(delivered),bytes);
  state=await loadBundle(dir);assert.equal(state.toolpathApproved,true);
  state=await updateGridfinityBundle(dir,{compartmentsX:2},{expectedRevision:state.revision});
  assert.deepEqual(state.review.approvals,{});assert.equal(state.review.generation,null);
});
