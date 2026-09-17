import test from 'node:test';
import assert from 'node:assert/strict';
import rhino3dm from 'rhino3dm';
import {defaults,validatePlan,VERSION,BUILD_DATE} from '../../../core/print/plan.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {exportGriffin,interpretGriffin} from '../../../core/export/griffin.mjs';
import {exportBambu,interpretBambu} from '../../../core/export/bambu.mjs';
import {staggeredWeldSites} from '../scripts/weld.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {decodeSource} from '../../../studio/source-player.mjs';
import {frameAtTime} from '../../../studio/playback.mjs';
import {buildMaterialScene} from '../../../studio/material-view.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initBundle,generateBundle,loadBundle,approve,deliver,adjustBundle} from '../../../core/print/bundle.mjs';
const rhino=await rhino3dm(),release={generatorVersion:VERSION,buildDate:BUILD_DATE};
function recipe(machine=loadMachine()){
  const p=defaults(machine);p.geometry={shape:'box',runMm:20,widthMm:16,heightMm:6};
  p.placement={xMm:140,yMm:100};// fixed placement keeps injection coordinates independent of the centering default
  p.skills['draped-skin'].enabled=false;p.process.minimumLayerSeconds=0;
  Object.assign(p.skills['plastic-weld'],{enabled:true,sites:[{id:'anchor',part:null,xMm:7,yMm:8,zBottomMm:0.8,zTopMm:4.8}]});
  return p;
}
test('solid blind cavity is reserved, metered and injected before cover layers',async()=>{
  const m=loadMachine(),p=recipe(m),path=generatePath(p,m,rhino);
  checkMachinePath(path,p,m);
  const injection=path.actions.findIndex(a=>a.kind==='extrude');assert.ok(injection>0);
  const volume=path.actions[injection].volumeMm3;
  // Independent stepped-frustum volume: six 0.2 mm bands, then 2.8 mm shaft.
  const expected=(Array.from({length:6},(_,i)=>Math.PI*(1.5-0.15*i)**2*.2).reduce((a,b)=>a+b,0)+Math.PI*.6**2*2.8)*Math.sin(2*Math.PI/96)/(2*Math.PI/96);
  assert.ok(Math.abs(volume-expected)<1e-4,`${volume} vs ${expected}`);
  assert.ok(path.actions.slice(0,injection).filter(a=>a.kind==='move'&&a.volumeMm3>0).every(a=>a.to[2]<=4.8+1e-8));
  assert.ok(path.actions.slice(injection+1).some(a=>a.kind==='move'&&a.volumeMm3>0&&a.to[2]>4.8));
  const program=interpretGriffin(exportGriffin(path,p,m,release),p,m),event=program.events.find(e=>e.kind==='injection');
  assert.ok(Math.abs(event.volumeMm3-volume)<1e-4);
  assert.deepEqual(event.positionMm,[147,108,4.8]);
  const total=path.actions.reduce((v,a)=>v+(a.volumeMm3??0),0);
  assert.ok(Math.abs(program.volumeMm3-total)<.001);
  const decoded=decodeSource({program:exportGriffin(path,p,m,release)},p,m);
  const at=frameAtTime(decoded.moves,event.startSeconds+event.seconds/2);
  assert.deepEqual(at.point,event.positionMm);
  assert.deepEqual(decoded.events,program.events);
  const scene=await buildMaterialScene(decoded.moves,p,{});
  assert.ok(!scene.unsupported.includes('plastic-weld'));
  assert.equal(scene.supported[at.active],1);
});
test('sparse infill gains a local solid sealed envelope through complementary masks',()=>{
  const p=recipe();p.skills['full-fill'].enabled=false;p.skills['planar-infill'].enabled=true;
  const path=generatePath(p,loadMachine(),rhino);
  assert.equal(path.actions.filter(a=>a.kind==='extrude').length,1);
  assert.ok(path.summary.fullFill.instances.length>0);
  assert.ok(path.summary.planarInfill.instances[0].density===.2);
});
test('temperature is operation scoped, restored, and included in H2D source playback',()=>{
  const m=loadMachine('bambu-h2d'),p=recipe(m);p.skills['plastic-weld'].nozzleC=225;
  const path=generatePath(p,m,rhino);checkMachinePath(path,p,m);
  assert.deepEqual(path.actions.filter(a=>a.kind==='temperature').map(a=>a.targetC),[225,p.setup.nozzleC]);
  const bytes=exportBambu(path,p,m,release),program=interpretBambu(bytes,p,m);
  const event=program.events.find(e=>e.kind==='injection');assert.equal(event.nozzleC,225);
  assert.ok(Math.abs(event.volumeMm3-path.actions.find(a=>a.kind==='extrude').volumeMm3)<.001);
});
test('overlapping heights across flat region bands and deterministic generation',()=>{
  const p=recipe();p.geometry.heightMm=9;
  p.skills['plastic-weld'].sites=staggeredWeldSites({columns:1,rows:1,levels:2,pitchMm:12,xMm:5,yMm:8});
  p.composition.regions=[{id:'body',part:null,zStartMm:0,zEndMm:4.8,skills:{'full-fill':{}},lowerSurfaceFrom:null},
    {id:'cap',part:null,zStartMm:4.8,zEndMm:null,skills:{'full-fill':{}},lowerSurfaceFrom:null}];
  const path=generatePath(p,loadMachine(),rhino);
  assert.equal(path.actions.filter(a=>a.kind==='extrude').length,2);
  assert.deepEqual(generatePath(p,loadMachine(),rhino),path);
});
test('completed rivet mouths publish a consumable surface with injection prerequisites',()=>{
  const p=recipe();p.composition.regions=[
    {id:'body',part:null,zStartMm:0,zEndMm:4.8,skills:{'full-fill':{}},lowerSurfaceFrom:null},
    {id:'cap',part:null,zStartMm:4.8,zEndMm:null,skills:{'full-fill':{}},lowerSurfaceFrom:'body'}];
  const path=generatePath(p,loadMachine(),rhino),index=path.actions.findIndex(a=>a.kind==='extrude');
  assert.ok(index>0);assert.ok(path.actions.findIndex(a=>a.region==='cap')>index);
});
test('translated mesh assembly and a separate vase share one composer',()=>{
  const p=recipe();p.geometry={shape:'assembly',parts:[
    {id:'host',geometry:boxMesh(20,16,6),xMm:3,yMm:2,zMm:1},
    {id:'vase',geometry:boxMesh(10,10,6),xMm:30,yMm:0,zMm:0}]};
  p.skills['full-fill'].parts=['host'];
  Object.assign(p.skills['vase-wall'],{enabled:true,part:'vase'});
  p.skills['plastic-weld'].sites[0].part='host';
  const path=generatePath(p,loadMachine(),rhino);
  assert.ok(path.actions.some(a=>a.phase==='vase-wall'));
  assert.deepEqual(path.summary.plasticWeld.sites[0].positionMm,[150,110,5.8]);
});
test('shared bundle reopening and exact-byte delivery include weld settings in approval identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-weld-')),dir=join(root,'coupon');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await initBundle(dir,recipe());
  let state=await loadBundle(dir),actor='SYNTHETIC weld test; not a manufacturing approval';
  await approve(dir,{stage:'geometry',actor,revision:state.revision});
  await generateBundle(dir);state=await loadBundle(dir);
  assert.equal(state.program.events.filter(e=>e.kind==='injection').length,1);
  state=await approve(dir,{stage:'toolpath',actor,revision:state.revision});
  const delivery=await deliver(dir);
  assert.ok(delivery);
  const before=await readFile(join(dir,'exports','griffin-gcode',state.exportName));
  assert.deepEqual(await readFile(delivery),before);
  const updated=await adjustBundle(dir,{skills:{'plastic-weld':{volumeFactor:1.05}}},{expectedRevision:state.revision});
  assert.equal(updated.toolpathApproved,false);
  await assert.rejects(deliver(dir),/requires approval/);
});
test('unsealed exterior, colliding sites, off-grid heights and unsupported controls fail clearly',()=>{
  const m=loadMachine();
  const edge=recipe();edge.skills['plastic-weld'].sites[0].xMm=.5;
  assert.throws(()=>generatePath(edge,m,rhino),/solid enclosing/);
  const overlap=recipe();overlap.skills['plastic-weld'].sites.push({...overlap.skills['plastic-weld'].sites[0],id:'second'});
  assert.throws(()=>generatePath(overlap,m,rhino),/Overlapping rivet/);
  const offgrid=recipe();offgrid.skills['plastic-weld'].sites[0].zTopMm=4.81;
  assert.throws(()=>generatePath(offgrid,m,rhino),/layer grid/);
  const temperature=recipe();temperature.skills['plastic-weld'].nozzleC=300;
  assert.throws(()=>validatePlan(temperature,m),/temperature outside/);
  const robot=loadMachine('dobot-mg400');assert.throws(()=>validatePlan(recipe(robot),robot),/relay robot/);
});
