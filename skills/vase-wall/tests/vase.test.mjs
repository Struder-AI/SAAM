import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {generatePath,buildShell,translateShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {pointSegmentDistance} from '../../../core/region/region2d.mjs';
import {boxMesh,ringMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {initBundle,loadBundle,approve,generateBundle,deliver,adjustBundle,EXPORT_PATH} from '../../../core/print/bundle.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';

function vasePlan(machine=loadMachine(),geometry=boxMesh(8,6,1)) {
  const plan=defaults(machine);plan.geometry=geometry;
  plan.skills['full-fill'].enabled=false;plan.skills['draped-skin'].enabled=false;plan.skills['vase-wall'].enabled=true;
  return plan;
}
const taperedSpline={shape:'spline-shell',runMm:8,widthMm:6,cpU:4,cpV:4,longSideInsetMm:0.1,shortSideOutsetMm:0.1,heightsMm:Array.from({length:4},()=>[1,1,1,1])};
function taperedMesh() {
  const geometry=boxMesh(8,6,1);
  for(let i=4;i<8;i++){geometry.vertices[i][0]=geometry.vertices[i][0]*1.025-0.1;geometry.vertices[i][1]=geometry.vertices[i][1]*(5.8/6)+0.1;}
  return geometry;
}
function splittingMesh() {
  const vertices=[],triangles=[],index=new Map(),filled=(x,z)=>x>=0&&x<3&&z>=0&&z<2&&(z===0||x!==1);
  const quads=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  const adjacent=[[0,-1],[0,1],null,[1,0],null,[-1,0]];
  for(let x=0;x<3;x++)for(let z=0;z<2;z++)if(filled(x,z)) {
    const points=[[x,0,z],[x+1,0,z],[x+1,1,z],[x,1,z],[x,0,z+1],[x+1,0,z+1],[x+1,1,z+1],[x,1,z+1]];
    const ids=points.map(p=>{const key=p.join();if(!index.has(key)){index.set(key,vertices.length);vertices.push([p[0]*3,p[1]*6,p[2]*0.6]);}return index.get(key);});
    quads.forEach((q,i)=>{const neighbor=adjacent[i];if(neighbor&&filled(x+neighbor[0],z+neighbor[1]))return;const [a,b,c,d]=q.map(j=>ids[j]);triangles.push([a,b,c],[a,c,d]);});
  }
  return {shape:'mesh',vertices,triangles,source:null};
}

test('vase follows rising noncircular mesh and restricted spline sections on S5 and H2D',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const geometry of [taperedMesh(),taperedSpline]) {
    const machine=loadMachine(id),plan=vasePlan(machine,geometry),path=generatePath(plan,machine,r);
    const wall=path.actions.filter(a=>a.role==='vase-wall'),first=path.actions.findIndex(a=>a.role==='vase-wall'),last=path.actions.findLastIndex(a=>a.role==='vase-wall');
    assert.ok(wall.length>200);assert.ok(path.actions.slice(first,last+1).every(a=>a.kind==='move'&&a.volumeMm3>0),'one uninterrupted stroke');
    assert.equal(path.summary.vaseWall.startMm,0.2);assert.equal(wall.at(-1).to[2],1);
    assert.ok(wall.every((a,i)=>i===0||a.to[2]>=wall[i-1].to[2]));
    assert.equal(new Set(wall.map(a=>a.operation)).size,1);
    assert.ok(wall.some(a=>a.to[0]>plan.placement.xMm+7.81),'changing-Z taper follows actual boundary, beyond initial rectangle inset');
    const shell=translateShell(buildShell(r,geometry),plan.placement.xMm,plan.placement.yMm);
    let previous=path.initialPosition,volume=0;const turnTimes=new Map();
    for(const action of path.actions) {
      if(action.kind!=='move')continue;
      const length=Math.hypot(...action.to.map((v,i)=>v-previous[i]));
      if(action.role==='vase-wall') {
        const thickness=action.layer===0?plan.process.firstLayerMm:Math.min(plan.process.layerMm,(previous[2]+action.to[2])/2-path.summary.vaseWall.startMm);
        assert.ok(Math.abs(action.volumeMm3-length*plan.process.lineWidthMm*thickness)<1e-9);
        volume+=action.volumeMm3;turnTimes.set(action.layer,(turnTimes.get(action.layer)??0)+length/action.speedMmS);
        const loop=sectionGeometry(shell,action.to[2]).loops[0];
        const standoff=Math.min(...loop.map((p,i)=>pointSegmentDistance(action.to,p,loop[(i+1)%loop.length])));
        assert.ok(Math.abs(standoff-0.2)<=plan.skills['vase-wall'].toleranceMm,'actual emitted point respects section/bead width');
        const middle=action.to.map((v,i)=>(v+previous[i])/2),midLoop=sectionGeometry(shell,middle[2]).loops[0];
        const midStandoff=Math.min(...midLoop.map((p,i)=>pointSegmentDistance(middle,p,midLoop[(i+1)%midLoop.length])));
        assert.ok(Math.abs(midStandoff-0.2)<=plan.skills['vase-wall'].toleranceMm,'segment midpoint follows the actual changing-Z boundary');
      }
      previous=action.to;
    }
    assert.ok(Math.abs(volume-path.summary.vaseWall.volumeMm3)<1e-8);
    assert.ok([...turnTimes.values()].every(seconds=>seconds>=plan.process.minimumLayerSeconds-1e-6),'cooling achieved by speed without per-turn pauses');
  }
});

test('explicit full-fill base ends before the continuous wall and rejects material overlap',async()=>{
  const machine=loadMachine(),r=await rhino(),plan=vasePlan(machine,boxMesh(8,6,1.4));
  plan.skills['full-fill'].enabled=true;plan.skills['vase-wall'].zStartMm=0.6;
  const path=generatePath(plan,machine,r),deposition=path.actions.filter(a=>a.volumeMm3>0),base=deposition.filter(a=>a.role!=='vase-wall'),wall=deposition.filter(a=>a.role==='vase-wall');
  assert.ok(base.length>0);assert.ok(base.every(a=>a.to[2]<=0.6+1e-8));assert.ok(wall.every(a=>a.to[2]>=0.8-1e-8));
  const firstWall=deposition.findIndex(a=>a.role==='vase-wall');assert.ok(deposition.slice(firstWall).every(a=>a.role==='vase-wall'));
  plan.skills['vase-wall'].zStartMm=0.55;assert.throws(()=>generatePath(plan,machine,r),/layer grid/);
  plan.skills['vase-wall'].zStartMm=0;assert.throws(()=>generatePath(plan,machine,r),/positive/);
  plan.skills['full-fill'].enabled=false;plan.skills['planar-infill'].enabled=true;assert.throws(()=>generatePath(plan,machine,r),/overlap/);
  plan.skills['planar-infill'].enabled=false;plan.skills['draped-skin'].enabled=true;assert.throws(()=>generatePath(plan,machine,r),/overlap/);
});

test('vase rejects holes, islands, concavity, collapsed offsets, steep taper and exhausted sampling',async()=>{
  const machine=loadMachine(),r=await rhino();
  assert.throws(()=>generatePath(vasePlan(machine,ringMesh()),machine,r),/holes|outer section/);
  const a=boxMesh(8,6,1),b=boxMesh(8,6,1),islands={shape:'mesh',source:null,vertices:[...a.vertices,...b.vertices.map(p=>[p[0]+12,p[1],p[2]])],triangles:[...a.triangles,...b.triangles.map(t=>t.map(i=>i+8))]};
  assert.throws(()=>generatePath(vasePlan(machine,islands),machine,r),/multiple islands/);
  assert.throws(()=>generatePath(vasePlan(machine,splittingMesh()),machine,r),/multiple islands/,'one lower loop becoming two upper loops is rejected');
  const concave={shape:'vertical-spline-shell',runMm:8,widthMm:6,cpU:4,cpV:4,xBulgeMm:0,yInsetMm:0.5,heightsMm:Array.from({length:4},()=>[1,1,1,1])};
  assert.throws(()=>generatePath(vasePlan(machine,concave),machine,r),/convex/);
  assert.throws(()=>generatePath(vasePlan(machine,boxMesh(0.3,6,1)),machine,r),/outer section|collapse/);
  const steep=taperedMesh();for(let i=4;i<8;i++)steep.vertices[i][0]=4+(steep.vertices[i][0]-4)*2;
  assert.throws(()=>generatePath(vasePlan(machine,steep),machine,r),/shift too far/);
  const plan=vasePlan();plan.skills['vase-wall'].maxPoints=100;assert.throws(()=>generatePath(plan,machine,r),/budget/);
  plan.skills['vase-wall'].maxPoints=100000;plan.skills['vase-wall'].zEndMm=0.2;assert.throws(()=>generatePath(plan,machine,r),/first ring/);
  const planarOnly=structuredClone(machine);planarOnly.capabilities=['xyz-extrusion','planar'];assert.throws(()=>validatePlan(vasePlan(),planarOnly),/nonplanar/);
});

test('configured Dobot vase uses the same path and exact Lua interpreter with relay limits disclosed',async()=>{
  const machine=loadMachine('dobot-mg400'),plan=syntheticDobotSetup(vasePlan(machine,taperedMesh()));
  const path=generatePath(plan,machine,await rhino()),bytes=exportProgram(path,plan,machine,{generatorVersion:'SYNTHETIC VASE',buildDate:'2026-09-09'});
  const program=interpretProgram(bytes,plan,machine),expected=path.actions.filter(a=>a.kind==='move');
  assert.equal(program.moves.length,expected.length);
  expected.forEach((move,i)=>move.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6)));
  assert.ok(program.moves.some(m=>m.phase==='vase-wall'));assert.equal(program.summary.materialModel,'relay-estimate');
  assert.deepEqual(path.initialPosition,plan.setup.dobot.initialPositionMm);
});

test('vase native spline and mesh bundles reopen, review and deliver exact S5 bytes',async t=>{
  for(const geometry of [taperedMesh(),taperedSpline]) {
    const dir=await mkdtemp(join(tmpdir(),'saam-synthetic-vase-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
    await initBundle(dir,vasePlan(loadMachine(),geometry));
    const actor='SYNTHETIC VASE TEST — not a human approval';
    for(const stage of ['geometry','plan'])await approve(dir,{stage,actor,revision:(await loadBundle(dir)).revision});
    await generateBundle(dir);
    let state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.deepEqual(state.skills,['vase-wall']);
    await approve(dir,{stage:'toolpath',actor,revision:state.revision});
    const delivered=await deliver(dir);assert.deepEqual(await readFile(delivered),await readFile(join(dir,EXPORT_PATH)));
    state=await loadBundle(dir);assert.equal(state.toolpathApproved,true);
    await adjustBundle(dir,{skills:{'vase-wall':{zEndMm:0.8}}});
    state=await loadBundle(dir,{program:false});assert.equal(state.geometryApproved,true);assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
  }
});
