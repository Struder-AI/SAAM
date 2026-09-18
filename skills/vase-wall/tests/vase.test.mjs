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
import {pointSegmentDistance,loopArea,dedupe} from '../../../core/region/region2d.mjs';
import {boxMesh,ringMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {initBundle,loadBundle,approve,generateBundle,deliver,adjustBundle,EXPORT_PATH} from '../../../core/print/bundle.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {vaseWallResult} from '../scripts/vase.mjs';

function vasePlan(machine=loadMachine(),geometry=boxMesh(8,6,1)) {
  const plan=defaults(machine);plan.geometry=geometry;
  plan.skills['full-fill'].enabled=false;plan.skills['draped-skin'].enabled=false;plan.skills['vase-wall'].enabled=true;plan.skills['vase-wall'].endTransition='spiral';
  // These regressions assert the exact per-section wall (kernels, topology,
  // section-following within boundaryToleranceMm). The fitted-sleeve fast path
  // and its bounded deviation are covered separately below.
  plan.skills['vase-wall'].sleeveToleranceMm=0;
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
// A real rocket-nozzle mesh section captured at the exact height where the exact
// per-section wall failed: a healthy convex loop (~1169 mm^2, no holes, no thin
// features) whose ruled NURBS patches meet in near-collinear seam steps. Quantized
// to the offset grid, a seam rounds a hair off its edge and an inward bead-half-
// width offset amplifies that into a degenerate sliver, splitting the inset into
// two loops — a healthy section wrongly rejected as "empty, split or collapsed".
const seamPinchSection=[
  [119.503773,102.794976],[119.010867,105.272981],[118.198733,107.665449],[117.081268,109.931445],
  [115.677591,112.032196],[114.022653,113.919291],[114.01172,113.931758],[112.112157,115.59763],
  [110.011406,117.001307],[107.74541,118.118772],[105.352942,118.930906],[102.874937,119.423812],
  [100.370342,119.587971],[100.353795,119.589056],[97.832652,119.423812],[95.354647,118.930906],
  [92.977882,118.124102],[92.962179,118.118772],[90.696184,117.001307],[88.595432,115.59763],
  [86.708337,113.942692],[86.69587,113.931758],[85.029998,112.032196],[83.626321,109.931445],
  [82.508856,107.665449],[81.696723,105.272981],[81.203817,102.794976],[81.039657,100.29038],
  [81.038572,100.273833],[81.203817,97.752691],[81.696723,95.274686],[82.503526,92.89792],
  [82.508856,92.882218],[83.626321,90.616222],[85.029998,88.515471],[86.684936,86.628376],
  [86.69587,86.615909],[88.595432,84.950037],[90.696184,83.54636],[92.947307,82.436229],
  [92.962179,82.428895],[95.354647,81.616761],[97.832652,81.123855],[100.337248,80.959695],
  [100.353795,80.958611],[102.874937,81.123855],[105.352942,81.616761],[107.729708,82.423564],
  [107.74541,82.428895],[110.011406,83.54636],[112.112157,84.950037],[114.01172,86.615909],
  [115.677591,88.515471],[117.081268,90.616222],[118.191399,92.867345],[118.198733,92.882218],
  [119.010867,95.274686],[119.503773,97.752691],[119.669017,100.273833],[119.504857,102.778429],
];
// Extrude that section as a closed vertical prism (flat centroid-fan caps) so
// every wall-band section is exactly this seam-stepped loop.
function seamPinchMesh(height=8) {
  const n=seamPinchSection.length,c=[100,100];
  const vertices=[...seamPinchSection.map(p=>[...p,0]),...seamPinchSection.map(p=>[...p,height]),[...c,0],[...c,height]];
  const bottom=2*n,top=2*n+1,triangles=[];
  for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push([i,j,j+n],[i,j+n,i+n],[bottom,j,i],[top,i+n,j+n]);}
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

test('a healthy section with tessellation seam steps still offsets to one continuous wall',async()=>{
  // Regression: the exact per-section wall passed a raw mesh cut straight to the
  // inward offset, so a near-collinear patch/triangle seam — quantized to the
  // offset grid — split a degenerate sliver off the inset and a healthy section
  // was rejected as "empty, split or collapsed". The wall now removes those seams
  // before offsetting, matching what the motif path already did. The fitted-sleeve
  // fast path sidesteps this; sleeveToleranceMm=0 exercises the exact path.
  const machine=loadMachine(),r=await rhino();
  // The raw seam-stepped loop really does split under the inward bead-half-width
  // offset (width/2 = 0.2 mm), on the same grid and arc tolerance the wall uses.
  const rawInset=offsetRegion([dedupe(seamPinchSection)],-0.2,{precisionMm:0.00001,arcToleranceMm:0.005});
  assert.ok(rawInset.length>1&&rawInset.filter(loop=>loopArea(loop)>0).length===1,'the raw seam-stepped section splits a sliver off the inward offset');
  const plan=vasePlan(machine,seamPinchMesh());plan.skills['vase-wall'].zEndMm=7.5;
  const path=generatePath(plan,machine,r),wall=path.actions.filter(a=>a.role==='vase-wall');
  assert.ok(wall.length>100,'the exact wall completes over the seam-stepped section');
  assert.equal(new Set(wall.map(a=>a.operation)).size,1,'one uninterrupted stroke');
  const shell=translateShell(buildShell(r,plan.geometry),plan.placement.xMm,plan.placement.yMm);
  for(const action of wall) {
    const loop=sectionGeometry(shell,action.to[2]).loops[0];
    const gap=Math.min(...loop.map((p,i)=>pointSegmentDistance(action.to,p,loop[(i+1)%loop.length])));
    assert.ok(Math.abs(gap-plan.process.lineWidthMm/2)<=plan.skills['vase-wall'].toleranceMm,'centerline holds the bead-half-width standoff to the actual boundary');
  }
});

test('default sleeve tolerance follows a fitted NURBS sleeve, bounds deviation and falls back on thin walls',async()=>{
  const machine=loadMachine(),r=await rhino();
  // A rising noncircular mesh: the exact path rebuilds a section, offset and
  // contour at every sample; the default fitted sleeve replaces that with one
  // periodic NURBS offset evaluated per point.
  const plan=vasePlan(machine,taperedMesh());
  assert.equal(plan.skills['vase-wall'].sleeveToleranceMm,0,'helper pins exact');
  plan.skills['vase-wall'].sleeveToleranceMm=0.08;
  const path=generatePath(plan,machine,r),summary=path.summary.vaseWall;
  assert.equal(summary.sectionQueries,0,'no per-height section rebuilds on the fitted-sleeve path');
  assert.ok(summary.sleeve&&summary.sleeve.mode==='loose-offset','reports the fitted sleeve it used');
  assert.ok(summary.sleeve.achievedResidualMm<=0.08+1e-9,'achieved deviation stays within the requested tolerance');
  const wall=path.actions.filter(a=>a.role==='vase-wall');
  assert.ok(wall.length>0&&wall.at(-1).to[2]===1);
  const shell=translateShell(buildShell(r,plan.geometry),plan.placement.xMm,plan.placement.yMm);
  for(const action of wall){
    const loop=sectionGeometry(shell,action.to[2]).loops[0];
    const standoff=Math.min(...loop.map((p,i)=>pointSegmentDistance(action.to,p,loop[(i+1)%loop.length])));
    assert.ok(Math.abs(standoff-0.2)<=0.08+plan.skills['vase-wall'].boundaryToleranceMm,'centerline follows the boundary within the sleeve tolerance');
  }
  // A wall thinner than the bead still cannot be offset; the sleeve path defers
  // to the exact rejection rather than emitting a self-crossing loop.
  const thin=vasePlan(machine,boxMesh(0.3,6,1));thin.skills['vase-wall'].sleeveToleranceMm=0.08;
  assert.throws(()=>generatePath(thin,machine,r),/inward offset.*collapsed at Z.*bead width/);
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

test('a wall takes the points its geometry requires; the retired point budget is read from old recipes without effect',async()=>{
  const machine=loadMachine(),r=await rhino();
  // Well past the former 100000-point default on the exact per-section path.
  const tall=vasePlan(machine,boxMesh(8,6,90));tall.skills['vase-wall'].sampleStepMm=0.1;
  const result=vaseWallResult({shell:translateShell(buildShell(r,tall.geometry),tall.placement.xMm,tall.placement.yMm),plan:tall,machine});
  assert.ok(result.report.points>100000,`expected more than 100000 wall points, got ${result.report.points}`);
  assert.equal(result.operations[0].strokes[0].points.length,result.report.points);
  assert.equal('maxPoints' in result.report,false);
  assert.equal('maxSectionQueries' in result.report,false);
  // Older recipes and region overrides carry any budget value; it is dropped, never enforced.
  const reference=generatePath(vasePlan(),machine,r).actions;
  for(const value of [100,99,100.5,Infinity,Number.MAX_SAFE_INTEGER+1,'lots']) {
    const old=vasePlan();old.skills['vase-wall'].maxPoints=value;
    validatePlan(old,machine);
    assert.equal('maxPoints' in old.skills['vase-wall'],false);
    assert.deepEqual(generatePath(old,machine,r).actions,reference);
  }
  const regional=vasePlan();
  regional.composition.regions=[{id:'wall',part:null,zStartMm:0,zEndMm:1,skills:{'vase-wall':{maxPoints:100}}}];
  validatePlan(regional,machine);
  assert.deepEqual(regional.composition.regions[0].skills['vase-wall'],{});
  assert.ok(generatePath(regional,machine,r).actions.some(a=>a.role==='vase-wall'));
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
    await generateBundle(dir);
    let state=await loadBundle(dir);assert.equal(state.programError,undefined);assert.deepEqual(state.skills,['vase-wall']);
    await approve(dir,{actor,revision:state.revision});
    const delivered=await deliver(dir);assert.deepEqual(await readFile(delivered),await readFile(join(dir,EXPORT_PATH)));
    state=await loadBundle(dir);assert.equal(state.toolpathApproved,true);
    await adjustBundle(dir,{skills:{'vase-wall':{zEndMm:0.8}}});
    state=await loadBundle(dir,{program:false});assert.equal(state.toolpathApproved,false);
  }
});
