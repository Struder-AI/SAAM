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
import {offsetRegion} from '../../../core/region/offset.mjs';
import {vaseWallResult} from '../scripts/vase.mjs';

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
function twistedMesh() {
  const vertices=[],triangles=[],heights=[0,0.5,1,1.6];
  for(const z of heights)for(const [x,y] of [[-4,-3],[4,-3],[4,3],[-4,3]]) {
    const angle=z*0.02;
    vertices.push([5+x*Math.cos(angle)-y*Math.sin(angle),4+x*Math.sin(angle)+y*Math.cos(angle),z]);
  }
  for(let j=0;j<heights.length-1;j++)for(let i=0;i<4;i++) {
    const a=j*4+i,b=j*4+(i+1)%4,c=b+4,d=a+4;
    // Outward diagonal gives convex sections through each twisted band.
    triangles.push([a,b,d],[b,c,d]);
  }
  triangles.push([0,2,1],[0,3,2],[12,13,14],[12,14,15]);
  return {shape:'mesh',vertices,triangles,source:null};
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

test('expanding polygonal cup keeps continuous phase when the first seam enters later sections',async()=>{
  // Nudge Cup's 120-sided frustum. The previous nearest-point anchor flipped
  // between the two edges at its +X corner around Z=3.119693 and could not
  // converge, despite the actual surface being a straight conical wall.
  const n=120,height=17.8,vertices=[],triangles=[];
  for(const z of [0,height])for(let i=0;i<n;i++){
    const a=i*2*Math.PI/n,r=18+4*z/18;
    vertices.push([r*Math.cos(a),r*Math.sin(a),z]);
  }
  for(let i=0;i<n;i++){
    const j=(i+1)%n;triangles.push([i,j,n+j],[i,n+j,n+i]);
  }
  for(let i=1;i<n-1;i++)triangles.push([0,i+1,i],[n,n+i,n+i+1]);
  const machine=loadMachine(),geometry={shape:'mesh',vertices,triangles,source:null};
  const plan=vasePlan(machine,geometry),r=await rhino();
  plan.skills['vase-wall'].endTransition='level';
  for(const [x,y] of [[0,0],[165,120]]){
    const shell=translateShell(buildShell(r,geometry),x,y);
    const result=vaseWallResult({shell,plan,machine,zStartMm:1.2,zEndMm:4});
    const points=result.operations[0].strokes[0].points;
    assert.equal(result.report.levelRimMm,4);
    assert.equal(points.at(-1)[2],4);
    let turns=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      const angle=p=>Math.atan2(p[1]-y,p[0]-x);
      const delta=Math.atan2(Math.sin(angle(b)-angle(a)),Math.cos(angle(b)-angle(a)));
      assert.ok(delta>=-1e-6,'the spiral does not reverse around its guide');
      assert.ok(Math.hypot(...b.map((v,k)=>v-a[k]))<=plan.skills['vase-wall'].sampleStepMm+1e-9);
      assert.ok(b[2]>=a[2]);turns+=delta/(2*Math.PI);
      // Independent regular-polygon boundary at both the emitted endpoint and
      // chord midpoint: the seam fix must not move the wall off its guide.
      for(const p of [b,b.map((v,k)=>(v+a[k])/2)]){
        const radius=18+4*p[2]/18;
        const loop=Array.from({length:n},(_,j)=>[x+radius*Math.cos(j*2*Math.PI/n),y+radius*Math.sin(j*2*Math.PI/n)]);
        const gap=Math.min(...loop.map((q,j)=>pointSegmentDistance(p,q,loop[(j+1)%n])));
        assert.ok(Math.abs(gap-plan.process.lineWidthMm/2)<=plan.skills['vase-wall'].toleranceMm);
      }
    }
    assert.ok(Math.abs(turns-15)<1e-5,'foundation, thirteen rising turns and level finish remain intact');
  }
});

test('convex wall retains the near-straight corner regression across offset kernels',async()=>{
  // This rotated edge produced a microscopically concave Clip6 inset and a
  // false rejection. Clip2 need not reproduce that old rounding artifact;
  // the geometry must still generate a complete wall at the declared spacing.
  const c=Math.cos(.013),s=Math.sin(.013);
  const loop=[[0,0],[60,0],[60,40],[23,40.000001],[0,40]].map(([x,y])=>[80+x*c-y*s,50+x*s+y*c]);
  const n=loop.length,vertices=[...loop.map(p=>[...p,0]),...loop.map(p=>[...p,.6])],triangles=[];
  for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push([i,j,j+n],[i,j+n,i+n]);}
  for(let i=1;i<n-1;i++)triangles.push([0,i+1,i],[n,n+i,n+i+1]);
  const machine=loadMachine(),plan=vasePlan(machine,{shape:'mesh',vertices,triangles,source:null});
  const path=generatePath(plan,machine,await rhino());
  assert.equal(path.summary.vaseWall.offsetPrecisionMm,.00001);
  const wall=path.actions.filter(a=>a.role==='vase-wall');
  assert.ok(wall.length>100);assert.equal(wall.at(-1).to[2],.6);
  for(const action of wall) {
    const xy=action.to.map((v,k)=>v-(k===0?plan.placement.xMm:k===1?plan.placement.yMm:0));
    const standoff=Math.min(...loop.map((p,i)=>pointSegmentDistance(xy,p,loop[(i+1)%n])));
    assert.ok(Math.abs(standoff-.2)<.00003,'emitted centerline stays within the measured rounding allowance');
  }
});

test('vase follows rising noncircular mesh and restricted spline sections on S5 and H2D',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d'])for(const geometry of [taperedMesh(),taperedSpline]) {
    const machine=loadMachine(id),plan=vasePlan(machine,geometry),path=generatePath(plan,machine,r);
    const wall=path.actions.filter(a=>a.role==='vase-wall'),first=path.actions.findIndex(a=>a.role==='vase-wall'),last=path.actions.findLastIndex(a=>a.role==='vase-wall');
    assert.ok(wall.length>0);assert.ok(path.actions.slice(first,last+1).every(a=>a.kind==='move'&&a.volumeMm3>0),'one uninterrupted stroke');
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

test('twisted mesh seams preserve a continuous level-ended wall followed by a solid cap',async()=>{
  const r=await rhino();
  for(const machineId of ['ultimaker-s5','bambu-h2d']) {
    const machine=loadMachine(machineId),plan=vasePlan(machine,twistedMesh());
    plan.composition.regions=[
      {id:'wall',part:null,zStartMm:0,zEndMm:1.2,skills:{'vase-wall':{endTransition:'level'}},lowerSurfaceFrom:null},
      {id:'cap',part:null,zStartMm:1.2,zEndMm:1.6,skills:{'full-fill':{mode:'body'}},lowerSurfaceFrom:null}
    ];
    const path=generatePath(plan,machine,r),wall=path.actions.filter(a=>a.role==='vase-wall');
    assert.ok(wall.some(a=>a.to[2]<0.5)&&wall.some(a=>a.to[2]>1),'spiral crosses both internal mesh seams');
    assert.ok(Math.abs(wall.at(-1).to[2]-1.2)<1e-8);
    const lastWall=path.actions.findLastIndex(a=>a.role==='vase-wall');
    assert.ok(path.actions.slice(lastWall+1).some(a=>a.region==='cap'&&a.volumeMm3>0));
    const shell=translateShell(buildShell(r,plan.geometry),plan.placement.xMm,plan.placement.yMm);
    for(const action of wall) {
      const loop=sectionGeometry(shell,action.to[2]).loops[0];
      const gap=Math.min(...loop.map((a,i)=>pointSegmentDistance(action.to,a,loop[(i+1)%loop.length])));
      assert.ok(Math.abs(gap-plan.process.lineWidthMm/2)<=plan.skills['vase-wall'].toleranceMm);
    }
    const bytes=exportProgram(path,plan,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-09'});
    assert.equal(interpretProgram(bytes,plan,machine).moves.length,path.actions.filter(a=>a.kind==='move').length);
  }
});

test('vase rejects unsupported topology and collapsed offsets, without an overhang policy',async()=>{
  const machine=loadMachine(),r=await rhino();
  assert.ok(generatePath(vasePlan(machine,ringMesh()),machine,r).actions.some(a=>a.role==='vase-wall'),'closed sleeves can supply the outer wall');
  const a=boxMesh(8,6,1),b=boxMesh(8,6,1),islands={shape:'mesh',source:null,vertices:[...a.vertices,...b.vertices.map(p=>[p[0]+12,p[1],p[2]])],triangles:[...a.triangles,...b.triangles.map(t=>t.map(i=>i+8))]};
  assert.throws(()=>generatePath(vasePlan(machine,islands),machine,r),/multiple islands/);
  assert.throws(()=>generatePath(vasePlan(machine,splittingMesh()),machine,r),/multiple islands/,'one lower loop becoming two upper loops is rejected');
  const concave={shape:'vertical-spline-shell',runMm:8,widthMm:6,cpU:4,cpV:4,xBulgeMm:0,yInsetMm:0.5,heightsMm:Array.from({length:4},()=>[1,1,1,1])};
  assert.ok(generatePath(vasePlan(machine,concave),machine,r).actions.some(a=>a.role==='vase-wall'),'concave spline sections now produce a continuous wall');
  assert.throws(()=>generatePath(vasePlan(machine,boxMesh(0.3,6,1)),machine,r),/inward offset.*collapsed at Z.*bead width/);
  const plan=vasePlan();plan.skills['vase-wall'].zEndMm=0.2;assert.throws(()=>generatePath(plan,machine,r),/first ring/);
  const planarOnly=structuredClone(machine);planarOnly.capabilities=['xyz-extrusion','planar'];assert.throws(()=>validatePlan(vasePlan(),planarOnly),/nonplanar/);
});

test('a steep taper keeps the requested geometry and pitch without radial-overlap rejection',async()=>{
  const machine=loadMachine(),r=await rhino(),steep=taperedMesh();
  for(let i=4;i<8;i++)steep.vertices[i][0]=4+(steep.vertices[i][0]-4)*2;
  const plan=vasePlan(machine,steep),before=structuredClone(plan),path=generatePath(plan,machine,r);
  assert.deepEqual(plan,before);
  assert.equal(path.summary.vaseWall.turns,5);
  assert.equal(path.summary.vaseWall.endMm,1);
  const shell=translateShell(buildShell(r,steep),plan.placement.xMm,plan.placement.yMm);
  for(const action of path.actions.filter(a=>a.role==='vase-wall')) {
    const loop=sectionGeometry(shell,action.to[2]).loops[0];
    const gap=Math.min(...loop.map((p,i)=>pointSegmentDistance(action.to,p,loop[(i+1)%loop.length])));
    assert.ok(Math.abs(gap-plan.process.lineWidthMm/2)<=plan.skills['vase-wall'].boundaryToleranceMm);
  }
});

test('point exhaustion names usage and the setting to raise; larger budgets preserve path quality',async()=>{
  const machine=loadMachine(),r=await rhino(),plan=vasePlan();
  plan.skills['vase-wall'].maxPoints=100;
  assert.throws(()=>generatePath(plan,machine,r),/point budget exhausted.*100\/100 at Z.*skills\.vase-wall\.maxPoints from 100 to 200/);
  plan.skills['vase-wall'].maxPoints=400000;
  const first=generatePath(plan,machine,r);
  plan.skills['vase-wall'].maxPoints=800000;
  const second=generatePath(plan,machine,r);
  assert.deepEqual(first.actions,second.actions);
  assert.equal(first.summary.vaseWall.maxPoints,400000);
  assert.equal(first.summary.vaseWall.maxSectionQueries,1600000);
  plan.composition.regions=[{id:'wall',part:null,zStartMm:0,zEndMm:1,skills:{'vase-wall':{maxPoints:100}}}];
  assert.throws(()=>generatePath(plan,machine,r),/composition\.regions\[0\]\.skills\.vase-wall\.maxPoints \(region wall\)/);
  for(const value of [99,100.5,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    const invalid=vasePlan();invalid.skills['vase-wall'].maxPoints=value;
    assert.throws(()=>validatePlan(invalid,machine),/safe integer/);
  }
});

test('contour and boundary tolerances are independent, with explicit normalization of older recipes',async()=>{
  const machine=loadMachine(),plan=vasePlan();
  plan.skills['vase-wall'].toleranceMm=0.05;
  validatePlan(plan,machine);
  assert.equal(plan.skills['vase-wall'].boundaryToleranceMm,0.02);
  const r=await rhino(),coarse=generatePath(plan,machine,r);
  plan.skills['vase-wall'].toleranceMm=0.002;
  const fine=generatePath(plan,machine,r);
  assert.ok(fine.summary.vaseWall.points>coarse.summary.vaseWall.points,'contour tolerance changes subdivision work');
  assert.equal(plan.skills['vase-wall'].boundaryToleranceMm,0.02);
  plan.skills['vase-wall'].toleranceMm=0.05;
  delete plan.skills['vase-wall'].boundaryToleranceMm;
  plan.composition.regions=[{id:'wall',part:null,zStartMm:0,zEndMm:1,skills:{'vase-wall':{toleranceMm:0.03}}}];
  validatePlan(plan,machine);
  assert.equal(plan.skills['vase-wall'].boundaryToleranceMm,0.05);
  assert.equal(plan.composition.regions[0].skills['vase-wall'].boundaryToleranceMm,0.03);
  plan.skills['vase-wall'].toleranceMm=0.01;
  validatePlan(plan,machine);
  assert.equal(plan.skills['vase-wall'].boundaryToleranceMm,0.05);
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
