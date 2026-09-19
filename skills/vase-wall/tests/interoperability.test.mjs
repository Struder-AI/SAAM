import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../../../core/print/plan.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {loopMotif} from '../scripts/motif.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';

const region=(id,part,start,end,skills)=>({id,part,zStartMm:start,zEndMm:end,skills,lowerSurfaceFrom:null});
const pattern=()=>({motif:loopMotif({widthCells:1.3,depthMm:1.2,samples:16}),cellsPerTurn:8,courseRiseMm:.2,repeats:2,tiltDeg:0});
const wall=path=>path.actions.filter(a=>a.role==='vase-wall');
function recipe(geometry){
  const p=defaults();p.geometry=geometry;
  for(const s of Object.values(p.skills))s.enabled=false;
  p.skills['full-fill'].enabled=true;
  Object.assign(p.skills['vase-wall'],{enabled:true,zStartMm:.4,pattern:pattern()});
  return p;
}

test('single motifs share solid-base composition on native spline and mesh components',async()=>{
  const native=await rhino(),machine=loadMachine();
  for(const geometry of [boxMesh(10,8,2),{shape:'box',runMm:10,widthMm:8,heightMm:2}]){
    const p=recipe(geometry),ordinary=generatePath(p,machine,native);
    p.composition.regions=[region('base',null,0,.4,{'full-fill':{}}),region('motifs',null,.4,2,{'vase-wall':{}})];
    const regional=generatePath(p,machine,native);
    assert.deepEqual(wall(regional).map(a=>[a.to,a.volumeMm3]),wall(ordinary).map(a=>[a.to,a.volumeMm3]));
    assert.equal(regional.summary.regions.find(r=>r.id==='motifs').publishedSurface,'rim','only the flat final motif footprint is published');
    const deposited=regional.actions.filter(a=>a.volumeMm3>0),prime=deposited.filter(a=>a.phase==='prime');
    assert.ok(prime.length>0,'machine priming remains before model deposition');
    assert.ok(prime.every(a=>a.region===undefined&&a.operation===undefined),'machine priming belongs to no model region');
    const model=deposited.filter(a=>a.phase!=='prime');
    assert.deepEqual([...new Set(model.map(a=>a.region))],['base','motifs']);
  }
});

test('a selected translated assembly component owns the motif while another component keeps its own producer',async()=>{
  const native=await rhino(),machine=loadMachine(),p=recipe(boxMesh(10,8,2));
  const expected=wall(generatePath(p,machine,native));
  p.geometry={shape:'assembly',parts:[{id:'vase',xMm:7,yMm:3,zMm:0,geometry:boxMesh(10,8,2)},
    {id:'block',xMm:24,yMm:0,zMm:0,geometry:boxMesh(3,3,.4)}]};
  p.skills['vase-wall'].part='vase';
  const actual=generatePath(p,machine,native),mapped=wall(actual);
  assert.equal(mapped.length,expected.length);
  mapped.forEach((a,i)=>a.to.forEach((v,k)=>assert.ok(Math.abs(v-expected[i].to[k]-[7,3,0][k])<1e-8)));
  assert.ok(actual.actions.some(a=>a.volumeMm3>0&&a.phase!=='prime'&&a.operation.startsWith('block:')));
  assert.ok(mapped.every(a=>a.operation.startsWith('vase:')));
});

test('level motif-to-rim handoffs compose, while explicitly spiral endings require a level boundary',async()=>{
  const p=recipe(boxMesh(10,8,2)),machine=loadMachine(),native=await rhino();
  p.composition.regions=[region('base',null,0,.4,{'full-fill':{}}),region('motifs',null,.4,1.2,{'vase-wall':{}}),region('rim',null,1.2,2,{'thick-lip':{}})];
  const path=generatePath(p,machine,native);
  assert.equal(path.summary.regions.find(r=>r.id==='motifs').publishedSurface,'rim');
  assert.ok(path.actions.some(a=>a.role==='lip-step-0'));
  p.skills['vase-wall'].endTransition='spiral';
  assert.throws(()=>generatePath(p,machine,native),/needs a level vase ending/);
});

test('a flat motif supports ordinary cap composition but never reports the hollow guide as full material coverage',async()=>{
  const p=recipe(boxMesh(10,8,2)),machine=loadMachine(),native=await rhino();
  p.composition.regions=[region('base',null,0,.4,{'full-fill':{}}),region('motifs',null,.4,1.2,{'vase-wall':{}}),region('cap',null,1.2,2,{'full-fill':{}})];
  const path=generatePath(p,machine,native);
  assert.ok(path.actions.some(a=>a.region==='cap'&&a.volumeMm3>0));
  p.composition.regions[2].lowerSurfaceFrom='motifs';
  assert.throws(()=>generatePath(p,machine,native),/does not cover the consumer|surface does not cover/);
});

test('level motif boundaries preserve checked machine moves on S5, H2D and configured Dobot',async()=>{
  const native=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d','dobot-mg400']){
    const machine=loadMachine(id),p=defaults(machine);
    const source=recipe(boxMesh(10,8,1.2));
    p.geometry=source.geometry;p.skills=source.skills;
    if(id==='dobot-mg400')syntheticDobotSetup(p);
    const path=generatePath(p,machine,native),program=interpretProgram(exportProgram(path,p,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-15'}),p,machine);
    const expected=path.actions.filter(a=>a.kind==='move');assert.equal(expected.length,program.moves.length);
    expected.forEach((a,i)=>a.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<1.1e-5)));
    assert.equal(path.summary.vaseWall.levelRimMm,1.2);
  }
});
