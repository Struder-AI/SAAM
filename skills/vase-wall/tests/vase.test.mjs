import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {generatePath,buildShell,translateShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';
import {pointSegmentDistance,loopArea,dedupe} from '../../../core/region/region2d.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {offsetRegion} from '../../../core/region/offset.mjs';
import {vaseWallResult} from '../scripts/vase.mjs';

function vasePlan(machine=loadMachine(),geometry=boxMesh(8,6,1)) {
  const plan=defaults(machine);plan.geometry=geometry;
  plan.skills['full-fill'].enabled=false;plan.skills['draped-skin'].enabled=false;plan.skills['vase-wall'].enabled=true;plan.skills['vase-wall'].endTransition='spiral';
  // These regressions assert the exact per-section wall (kernels, topology,
  // section-following within boundaryToleranceMm).
  plan.skills['vase-wall'].sleeveToleranceMm=0;
  return plan;
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
    // The level finish ends where its vanishing taper holds no writable material.
    assert.ok(turns>15-0.02&&turns<15+1e-5,'foundation, thirteen rising turns and level finish remain intact: '+turns);
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

test('a wall takes the points its geometry requires, and a retired point budget is rejected',async()=>{
  const machine=loadMachine(),r=await rhino();
  // Well past the former 100000-point default on the exact per-section path.
  const tall=vasePlan(machine,boxMesh(8,6,90));tall.skills['vase-wall'].sampleStepMm=0.1;
  const result=vaseWallResult({shell:translateShell(buildShell(r,tall.geometry),tall.placement.xMm,tall.placement.yMm),plan:tall,machine});
  assert.ok(result.report.points>100000,`expected more than 100000 wall points, got ${result.report.points}`);
  assert.equal(result.operations[0].strokes[0].points.length,result.report.points);
  assert.equal('maxPoints' in result.report,false);
  assert.equal('maxSectionQueries' in result.report,false);
  // The retired budget is no longer accepted anywhere in a recipe.
  const retired=vasePlan();retired.skills['vase-wall'].maxPoints=100;
  assert.throws(()=>validatePlan(retired,machine),/Unexpected or missing fields/);
  const regional=vasePlan();
  regional.composition.regions=[{id:'wall',part:null,zStartMm:0,zEndMm:1,lowerSurfaceFrom:null,skills:{'vase-wall':{maxPoints:100}}}];
  assert.throws(()=>validatePlan(regional,machine),/Unknown or region-owned skill override/);
});
