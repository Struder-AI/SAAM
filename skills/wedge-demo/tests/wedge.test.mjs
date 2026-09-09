import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defaults, hash, distance, validatePlan, clone } from '../scripts/model.mjs';
import { createGeometry, rhino, verifyGeometry } from '../scripts/geometry.mjs';
import { generatePath } from '../scripts/path.mjs';
import { exportGcode, interpretGcode } from '../scripts/gcode.mjs';
import { initBundle, generateBundle, loadBundle, updatePlan, approve, deliver, root, adjustBundle, rememberSetup, bundleFingerprint } from '../scripts/bundle.mjs';
import { advancePlayback, frameAtTime } from '../../../studio/playback.mjs';
import { createStudio } from '../../../studio/server.mjs';

const machine=JSON.parse(await readFile(resolve(root,'machines/ultimaker-s5.json'),'utf8'));
const plan=defaults();
const path=generatePath(plan,machine),code=exportGcode(path,plan,machine);
async function fixture(t) {
  const dir=await mkdtemp(resolve(tmpdir(),'saam-synthetic-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const p=defaults();p.geometry={runMm:8,widthMm:8,baseMm:1,angleDeg:15};
  await initBundle(dir,p);return dir;
}
test('Rhino native solid and named face geometry survive a 3DM round trip',async()=>{
  const {bytes,descriptor}=await createGeometry(plan.geometry);
  await verifyGeometry(bytes,descriptor);
  const r=await rhino(),doc=r.File3dm.fromByteArray(bytes),solid=doc.objects().get(0).geometry();
  assert.equal(solid.isSolid,true);assert.equal(doc.settings().modelUnitSystem.value,r.UnitSystem.Millimeters.value);
  const box=solid.getBoundingBox();
  assert.ok(box.min.every(v=>Math.abs(v)<1e-10));
  const expected=[30,20,2+30*Math.tan(Math.PI/12)];
  assert.ok(box.max.every((v,i)=>Math.abs(v-expected[i])<1e-9));
  assert.equal(descriptor.features.length,6);
  const slope=doc.objects().get(6).geometry();
  const p=slope.pointAt(.5,.5);assert.ok(Math.abs(p[2]-(2+p[0]*Math.tan(Math.PI/12)))<1e-8);
  const changed=Uint8Array.from(bytes);changed[changed.length-20]^=1;
  await assert.rejects(verifyGeometry(changed,descriptor),/Geometry file changed/);doc.destroy();
});
test('flat layers precede 15 degree skin strokes that always alternate direction',()=>{
  let pos=path.initialPosition,skinStarted=false,skinCount=0;
  for(const action of path.actions) {
    if(action.kind!=='move')continue;
    if(action.volumeMm3>0) {
      if(action.phase==='inclined') {
        skinStarted=true;skinCount++;assert.equal(Math.sign(action.to[0]-pos[0]),action.stroke%2?-1:1);
        const angle=Math.atan2(action.to[2]-pos[2],Math.hypot(action.to[0]-pos[0],action.to[1]-pos[1]))*180/Math.PI;
        assert.ok(Math.abs(Math.abs(angle)-15)<1e-7);
        assert.ok(action.gapMm>0&&action.gapMm<=plan.process.skinNormalMm/Math.cos(Math.PI/12)+plan.process.layerMm+plan.process.lineWidthMm*Math.tan(Math.PI/12)/2);
      } else {assert.equal(skinStarted,false);assert.ok(Math.abs(action.to[2]-pos[2])<1e-10);}
    }
    pos=action.to;
  }
  assert.ok(skinCount>100);assert.ok(path.summary.maxTransitionGapMm>path.summary.minTransitionGapMm);
  const volume=path.actions.reduce((v,a)=>v+(a.volumeMm3??0),0);
  const ideal=30*20*(2+30*Math.tan(Math.PI/12)/2);
  assert.ok(Math.abs(volume-ideal)/ideal<.05,'Deposition should approximate the wedge volume.');
});
test('every horizontal travel uses the complete part height plus the locked clearance',()=>{
  let pos=path.initialPosition,high=0;
  for(const a of path.actions) {
    if(a.kind!=='move')continue;
    if(a.volumeMm3>0)high=Math.max(high,pos[2],a.to[2]);
    else if(Math.hypot(pos[0]-a.to[0],pos[1]-a.to[1])>1e-8){assert.ok(Math.abs(a.to[2]-(2+30*Math.tan(Math.PI/12)+plan.process.liftMm))<1e-7);assert.equal(a.to[2],pos[2]);}
    pos=a.to;
  }
});
test('deterministic Griffin export uses T1, filament-length E, 215 C and complete modal interpretation',()=>{
  assert.equal(exportGcode(generatePath(plan,machine),plan,machine),code);
  assert.match(code,/\nT1\n/);assert.doesNotMatch(code,/\nT0\n/);assert.match(code,/M109 T1 S215/);
  const program=interpretGcode(code,plan,machine),native=path.actions.filter(a=>a.kind==='move');
  assert.equal(program.moves.length,native.length);
  native.forEach((a,i)=>{
    assert.ok(distance(a.to,program.moves[i].to)<1e-5);
    assert.ok(Math.abs(a.volumeMm3-program.moves[i].volumeMm3)<.00007);
  });
  const area=Math.PI*(2.85/2)**2;
  assert.ok(Math.abs(program.summary.filamentMm-program.summary.volumeMm3/area)<1e-9);
  assert.ok(program.events.some(e=>e.kind==='firmware-prime'));
});
test('bad commands, unsupported state, temperatures and machine excursions are rejected',()=>{
  for(const [bad,pattern]of [
    [code.replace('G21','G20'),/Unsupported command/],
    [code.replace('G21','G21 X1'),/Unsupported arguments/],
    [code.replace('M82','M82 E1'),/Unsupported arguments/],
    [code.replace('M109 T1 S215','M104 T1 S215'),/priming state/],
    [code.replace('T1\nG21','T0\nG21'),/tool change/],
    [code.replace('G0 Z20 F300','G0 Z301 F300'),/Out-of-bounds/],
    [code.replace('M190 S60','M190 S150'),/Bed temperature/],
    [code.replace('G0 Z20 F300','G0 Z21 F300000'),/Axis speed/],
    [code.replace('G21','G21 @'),/Malformed/],
    [code.replace('G92 E0','G92 E0\nG1 E50 F300'),/stationary extrusion/]
  ]) assert.throws(()=>interpretGcode(bad,plan,machine),pattern);
});
test('valid parameter changes propagate while unsupported settings fail before generation',()=>{
  for(const angle of [1,5,15]) {
    const p=clone(plan);p.geometry.angleDeg=angle;p.geometry.runMm=12;p.setup.tool=0;
    const native=generatePath(p,machine),exported=exportGcode(native,p,machine);
    assert.match(exported,/\nT0\n/);interpretGcode(exported,p,machine);
  }
  for(const mutate of [p=>p.geometry.angleDeg=16,p=>p.placement.xMm=325,p=>p.setup.tool=2,p=>p.process.layerMm=NaN,p=>p.process.typo=3,p=>p.process.skinDirection='downhill',p=>p.setup.material='ABS']) {
    const p=clone(plan);mutate(p);assert.throws(()=>validatePlan(p,machine));
  }
});
test('development generation creates no approvals and cannot deliver',async t=>{
  const dir=await fixture(t);await generateBundle(dir,{development:true});
  const s=await loadBundle(dir);assert.deepEqual(s.review.approvals,{});assert.ok(s.program);assert.equal(s.toolpathApproved,false);
  await assert.rejects(deliver(dir),/requires approval/);await assert.rejects(generateBundle(dir),/Approve/);
});
test('three synthetic approvals, stale views, reopening and byte-identical delivery',async t=>{
  const dir=await fixture(t),actor='SYNTHETIC TEST REVIEWER — no real job';let s=await loadBundle(dir);
  await assert.rejects(approve(dir,{stage:'plan',actor,revision:s.revision}),/geometry first/);
  await approve(dir,{stage:'geometry',actor,revision:s.revision});
  await assert.rejects(approve(dir,{stage:'geometry',actor,revision:s.revision}),/stale/);
  s=await loadBundle(dir);
  assert.equal(s.plan.setup.firmwareVersion,'');assert.equal(s.plan.setup.startupVerified,false);
  await approve(dir,{stage:'plan',actor,revision:s.revision});await generateBundle(dir);
  s=await loadBundle(dir);assert.ok(s.program);await approve(dir,{stage:'toolpath',actor,revision:s.revision});
  const delivered=await deliver(dir),exported=resolve(dir,'exports/griffin-gcode/wedge.gcode');
  assert.equal(hash(await readFile(delivered)),hash(await readFile(exported)));
  assert.equal((await loadBundle(dir)).toolpathApproved,true);
  await writeFile(exported,(await readFile(exported,'utf8')).replace('S215','S216'));
  s=await loadBundle(dir);assert.match(s.programError,/files changed/);assert.equal(s.toolpathApproved,false);
  await assert.rejects(deliver(dir),/requires approval/);
});
test('base fill traversal and perimeter winding reverse on successive flat layers',()=>{
  const layers=[0,1].map(layer=>path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0&&a.phase==='planar'&&a.layer===layer));
  assert.equal(layers[0][0].role,'perimeter');assert.equal(layers[1].at(-1).role,'perimeter');
  const points=layers.map((actions,index)=>{
    let pos=path.initialPosition,result=[];
    for(const a of path.actions){if(a.kind!=='move')continue;if(a.phase==='planar'&&a.layer===index&&a.volumeMm3>0&&a.role==='fill'){if(!result.length)result.push(pos.slice(0,2));result.push(a.to.slice(0,2));}pos=a.to;}return result;
  });
  assert.deepEqual(points[0],points[1].reverse());
});
test('chat adjustments update snapshots, allow sloped-layer count changes, and retain geometry approval',async t=>{
  const dir=await fixture(t),s=await loadBundle(dir),before=await bundleFingerprint(dir);
  await approve(dir,{stage:'geometry',actor:'SYNTHETIC TEST',revision:s.revision});
  await adjustBundle(dir,{process:{skinLayers:3,layerMm:.2,skinNormalMm:.2}});
  const next=await loadBundle(dir);assert.equal(next.plan.process.skinLayers,3);assert.equal(next.geometryApproved,true);assert.equal(next.planApproved,false);
  assert.notEqual(before,await bundleFingerprint(dir));
  await generateBundle(dir,{development:true});assert.equal((await loadBundle(dir)).pathSummary.skinLayers,3);
  await assert.rejects(adjustBundle(dir,{process:{nonexistent:1}}),/Unknown setting/);
});
test('machine setup persists across prints without requiring a firmware version',async t=>{
  const dir=await fixture(t),setupFile=resolve(dir,'saved-setup.json');
  await adjustBundle(dir,{setup:{nozzleC:220}},{setupFile});
  const saved=JSON.parse(await readFile(setupFile,'utf8'));assert.equal(saved.setup.startupVerified,false);
  const next=resolve(dir,'next-print');await initBundle(next,undefined,{setupFile});
  assert.equal((await loadBundle(next)).plan.setup.nozzleC,220);
  assert.equal((await loadBundle(next)).plan.setup.firmwareVersion,'');
  await rememberSetup(next,{setupFile});
});
test('playback speed scales elapsed time and interpolates actual moves including idle gaps',()=>{
  assert.equal(advancePlayback(3,1000,1,100),4);assert.equal(advancePlayback(3,1000,50,100),53);assert.equal(advancePlayback(95,1000,10,100),100);
  const moves=[{startSeconds:2,durationSeconds:4,from:[0,0,0],to:[4,0,0]},{startSeconds:8,durationSeconds:2,from:[4,0,0],to:[4,0,2]}];
  assert.deepEqual(frameAtTime(moves,1).point,[0,0,0]);assert.deepEqual(frameAtTime(moves,4).point,[2,0,0]);
  assert.deepEqual(frameAtTime(moves,7).point,[4,0,0]);assert.deepEqual(frameAtTime(moves,9).point,[4,0,1]);
  assert.equal(frameAtTime(moves,10).completed,2);
});
test('geometry and process edits invalidate the correct approvals and reject stale writes',async t=>{
  const dir=await fixture(t),actor='SYNTHETIC TEST REVIEWER';let s=await loadBundle(dir);
  await approve(dir,{stage:'geometry',actor,revision:s.revision});s=await loadBundle(dir);
  const old=s.revision,p=clone(s.plan);p.process.skinSpeedMmS=8;await updatePlan(dir,p,s.revision);
  s=await loadBundle(dir);assert.equal(s.geometryApproved,true);assert.equal(s.planApproved,false);
  await assert.rejects(updatePlan(dir,p,old),/stale/);
  p.geometry.runMm=9;await updatePlan(dir,p,s.revision);s=await loadBundle(dir);assert.equal(s.geometryApproved,false);
});
test('Studio serves the exact export and rejects cross-origin or stale mutations',async t=>{
  const dir=await fixture(t);await generateBundle(dir,{development:true});
  const server=createStudio(dir);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const s=await(await fetch(origin+'/api/state')).json();assert.ok(s.program);assert.equal(s.code,undefined);
  assert.equal(await(await fetch(origin+'/api/gcode')).text(),await readFile(resolve(dir,'exports/griffin-gcode/wedge.gcode'),'utf8'));
  const denied=await fetch(origin+'/api/approve',{method:'POST',headers:{Origin:'https://example.com','X-SAAM-Token':token},body:'{}'});assert.equal(denied.status,403);
  const stale=await fetch(origin+'/api/plan',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({plan:s.plan,revision:'old'})});assert.equal(stale.status,400);
  const blocked=await fetch(origin+'/api/deliver',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:'{}'});assert.equal(blocked.status,400);
});
