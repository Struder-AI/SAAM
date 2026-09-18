import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {initBundle,loadBundle,approve,adjustBundle} from '../../../core/print/bundle.mjs';
import {skillSettingsRows} from '../../../studio/settings.mjs';
import {tileVaseMotif,loopMotif} from '../scripts/motif.mjs';

const pattern=()=>({motif:{points:[[0,0],[.5,.02],[1,0]],offsetMm:[0,-.5,0],beadHeightMm:.2},cellsPerTurn:2,courseRiseMm:.2,repeats:2,tiltDeg:0});
function recipe(machine=loadMachine()){
  const p=defaults(machine);p.geometry=boxMesh(20,15,2);
  for(const s of Object.values(p.skills))s.enabled=false;
  Object.assign(p.skills['vase-wall'],{enabled:true,endTransition:'spiral',pattern:pattern()});return p;
}
const wall=p=>p.actions.filter(a=>a.role==='vase-wall');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);

test('one cell tiles and rises exactly like an independently authored connected course',async()=>{
  const p=recipe(),q=recipe(),r=await rhino(),machine=loadMachine();
  q.skills['vase-wall'].pattern={paths:[{points:[[0,0],[.25,.07],[.5,.1],[.75,.17],[1,.2]],offsetMm:[0,-.5,0,-.5,0],beadHeightMm:.2}],advance:[1,.2],repeats:2};
  validatePlan(p,machine);
  const actual=generatePath(p,machine,r),expected=generatePath(q,machine,r),a=wall(actual),b=wall(expected);
  assert.equal(a.length,b.length);
  a.forEach((move,i)=>{move.to.forEach((v,k)=>near(v,b[i].to[k]));near(move.volumeMm3,b[i].volumeMm3);near(move.speedMmS,b[i].speedMmS);});
  assert.equal(actual.summary.vaseWall.paths,2,'one continuous stroke per course, not cooling once per cell');
  assert.equal(actual.summary.vaseWall.motifCellsPerTurn,2);
  const between=actual.actions.slice(actual.actions.indexOf(a[0]),actual.actions.indexOf(a.at(-1))+1);
  assert.ok(between.every(v=>v.kind==='move'&&v.volumeMm3>0),'cell and course seams introduce no travel');
});

test('tilt rotates transverse depth and height before adding the regular course rise',()=>{
  const p=pattern();p.tiltDeg=-90;p.motif.points=[[0,0],[.5,.2],[1,0]];p.motif.offsetMm=[0,-2,0];
  const path=tileVaseMotif(p).paths[0];
  near(path.points[1][0],.25);near(path.points[1][1],2.05);near(path.offsetMm[1],.2);
  near(path.points[2][0],.5);near(path.points[2][1],.1);near(path.offsetMm[2],0);
  near(path.points.at(-1)[0],1);near(path.points.at(-1)[1],.2);near(path.offsetMm.at(-1),0);
});

test('single-motif cells must join, including offset; travel is not an escape from that contract',()=>{
  const machine=loadMachine();
  for(const edit of [p=>p.motif.points[0][0]=.1,p=>p.motif.points.at(-1)[0]=.9,
    p=>p.motif.points.at(-1)[1]=.01,p=>p.motif.offsetMm[2]=.1,p=>p.motif.beadHeightMm=[.1,.2,.2]]){
    const p=recipe();edit(p.skills['vase-wall'].pattern);assert.throws(()=>validatePlan(p,machine),/tiled motif must run/);
  }
  const p=recipe();p.skills['vase-wall'].pathMode='segmented';assert.throws(()=>validatePlan(p,machine),/always connects cells/);
  for(const [key,value] of [['cellsPerTurn',0],['cellsPerTurn',1.5],['courseRiseMm',0],['tiltDeg',Infinity]]){
    const p=recipe();p.skills['vase-wall'].pattern[key]=value;assert.throws(()=>validatePlan(p,machine),/Motif/);
  }
  // A dense course expands completely; there is no construction budget to exhaust.
  const huge=pattern();huge.cellsPerTurn=1000;assert.equal(tileVaseMotif(huge).paths[0].points.length,1000*(huge.motif.points.length-1)+1);
});

test('the loop preset doubles back, joins exactly and supports either side of the guide',()=>{
  for(const exterior of ['smooth','scalloped','both-scalloped']){
    const motif=loopMotif({exterior,samples:32});
    assert.ok(motif.points.some((p,i)=>i&&p[0]<motif.points[i-1][0]));
    assert.deepEqual(motif.points[0],[0,0]);assert.deepEqual(motif.points.at(-1),[1,0]);
    assert.equal(motif.offsetMm[0],motif.offsetMm.at(-1));
    near(Math.min(...motif.offsetMm),exterior==='scalloped'?0:exterior==='smooth'?-4.8:-2.4);
    near(Math.max(...motif.offsetMm),exterior==='smooth'?0:exterior==='scalloped'?4.8:2.4);
  }
});

test('compact motifs follow the actual tilted-height host and report course progress in ordinary and regional plans',async()=>{
  const machine=loadMachine(),r=await rhino(),p=recipe();p.skills['vase-wall'].pattern.tiltDeg=-10;
  const straight=wall(generatePath(p,machine,r));
  p.geometry.vertices=p.geometry.vertices.map(([x,y,z])=>[x*(1+z*.2),y,z]);
  const events=[],curved=generatePath(p,machine,r,{onProgress:v=>events.push(v)});
  assert.ok(Math.max(...wall(curved).map(a=>a.to[0]))>Math.max(...straight.map(a=>a.to[0]))+1);
  assert.deepEqual(events.filter(e=>e.stage==='Mapping vase motif courses').map(e=>[e.completed,e.total]),[[0,2],[1,2],[2,2]]);
  p.composition.regions=[{id:'wall',part:null,zStartMm:0,zEndMm:2,skills:{'vase-wall':{}},lowerSurfaceFrom:null}];
  const regional=[];generatePath(p,machine,r,{onProgress:v=>regional.push(v)});
  assert.deepEqual(regional.filter(e=>e.stage==='Mapping vase motif courses').map(e=>e.completed),[0,1,2]);
});

test('compact recipes survive normal creation and adjustment and are explained by Studio',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-cell-motif-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  await initBundle(dir,recipe());
  const saved=JSON.parse(await readFile(join(dir,'plan.json'),'utf8'));
  assert.deepEqual(saved.skills['vase-wall'].pattern,pattern(),'save one authored cell, not its expanded course');
  let state=await loadBundle(dir,{program:false});
  state=await loadBundle(dir,{program:false});
  await adjustBundle(dir,{skills:{'vase-wall':{pattern:{tiltDeg:-5,cellsPerTurn:4}}}},{expectedRevision:state.revision});
  state=await loadBundle(dir,{program:false});assert.equal(state.toolpathApproved,false);
  assert.equal(state.plan.skills['vase-wall'].pattern.cellsPerTurn,4);
  const rows=skillSettingsRows('vase-wall',state.plan.skills['vase-wall']);
  assert.ok(rows.some(([,v])=>v==='4 cells per course × 2 courses'));
  assert.ok(rows.some(([,v])=>v==='-5° about the cell advance direction'));
  const compact=structuredClone(state.plan.skills['vase-wall'].pattern);
  await adjustBundle(dir,{skills:{'vase-wall':{pattern:tileVaseMotif(compact)}}},{expectedRevision:state.revision});
  state=await loadBundle(dir,{program:false});assert.equal(state.plan.skills['vase-wall'].pattern.motif,undefined);
  await adjustBundle(dir,{skills:{'vase-wall':{pattern:compact}}},{expectedRevision:state.revision});
  state=await loadBundle(dir,{program:false});assert.deepEqual(state.plan.skills['vase-wall'].pattern,compact);
  assert.equal(state.toolpathApproved,false,'switching authoring forms leaves the host geometry unchanged without creating approval');
});

test('the compact motif uses the same checked S5, H2D and configured Dobot output',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d','dobot-mg400']){
    const machine=loadMachine(id),p=recipe(machine);if(id==='dobot-mg400')syntheticDobotSetup(p);
    validatePlan(p,machine);const path=generatePath(p,machine,r);
    const program=interpretProgram(exportProgram(path,p,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-15'}),p,machine);
    const moves=path.actions.filter(a=>a.kind==='move');assert.equal(program.moves.length,moves.length);
    moves.forEach((m,i)=>m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6)));
  }
});
