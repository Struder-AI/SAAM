import test from 'node:test';
import assert from 'node:assert/strict';
import {flutedVase} from '../../../core/tests/fixtures/mesh-sleeve.mjs';
import {createVaseMeshReference,MESH_SLEEVE_SETTINGS} from '../scripts/reference.mjs';
import {VASE_WALL_DEFAULTS,vaseWallResult} from '../scripts/vase.mjs';
import {makeMesh} from '../../../core/geom/mesh.mjs';
import {fitMeshSleeve} from '../../../core/geom/mesh-sleeve.mjs';
import {prepareLooseSleeveOffsets} from '../../../core/geom/sleeve-frame.mjs';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loopMotif} from '../scripts/motif.mjs';
import {skillSettingsRows} from '../../../studio/settings.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';

test('mesh fidelity continuously clamps only contact faces and preserves smooth loop backs',()=>{
  const shell=flutedVase(),references=[0,.37,1].map(fidelity=>createVaseMeshReference({shell,
    settings:{...VASE_WALL_DEFAULTS,meshSleeve:{...MESH_SLEEVE_SETTINGS,fidelity}},start:.2,end:19.8,width:.4}));
  let compressed=0,unchanged=0;
  for(let i=0;i<64;i++){
    const theta=2*Math.PI*i/64;
    for(const radius of [8,11.7]){
      const p=[1+radius*Math.cos(theta),-.5+radius*Math.sin(theta),10],a=references[0].map(p),b=references[1].map(p),c=references[2].map(p);
      assert.deepEqual(a,p);
      const moved=Math.hypot(c[0]-p[0],c[1]-p[1]);
      if(radius===8)assert.ok(moved<1e-10,'inward loop back stays smooth');
      if(moved>.01)compressed++;else unchanged++;
      for(let k=0;k<3;k++)assert.ok(Math.abs(b[k]-(a[k]+.37*(c[k]-a[k])))<1e-10);
    }
  }
  assert.ok(compressed>10&&unchanged>64);
  assert.equal(references[0].report().meshSleeve.contactPreparation,null);
  assert.equal(references[2].report().meshSleeve.fidelity,1);
});

test('mesh contact limits path centers at the source, independent of bead half width',()=>{
  const shell=flutedVase({ripple:0}),references=[.4,1.2].map(width=>createVaseMeshReference({shell,
    settings:{...VASE_WALL_DEFAULTS,meshSleeve:{...MESH_SLEEVE_SETTINGS,fidelity:1}},start:.2,end:19.8,width}));
  const a=references[0].map([20,-.5,10]),b=references[1].map([20,-.5,10]);
  assert.deepEqual(a,b);assert.ok(Math.abs(a[0]-13)<MESH_SLEEVE_SETTINGS.detailToleranceMm);
  assert.equal(references[0].report().meshSleeve.contactTarget,'path-centerline');
  assert.match(references[0].report().meshSleeve.beadEnvelopeScope,/half width/);
});

test('a fitted reference uses one fixed-size loose offset chart at every authored phase',()=>{
  const machine=loadMachine(),plan=defaults(machine),input=flutedVase();
  const shell=makeMesh(input.vertices.map(([x,y,z])=>[x*2.5,y*2.5,z]),input.triangles);
  Object.assign(plan.skills['vase-wall'],{enabled:true,endTransition:'spiral',meshSleeve:{...MESH_SLEEVE_SETTINGS,fidelity:0},
    pattern:{paths:[{points:Array.from({length:33},(_,i)=>[i/32,0]),offsetMm:0,beadHeightMm:.2}],advance:[1,.2],repeats:1}});
  const result=vaseWallResult({shell,plan,machine});
  // Offset geometry retains the original spline chart. Adaptive path points
  // may increase, but every authored phase must still evaluate this same net.
  const fit=fitMeshSleeve(shell,{zMinMm:.2,zMaxMm:20,toleranceMm:.0025});
  const frame=prepareLooseSleeveOffsets({patch:fit.patch,rangeMm:fit.rangeMm}),points=result.operations[0].strokes[0].points;
  for(let i=0;i<=32;i++){
    const expected=frame.at(i/32,.2,-.2);
    assert.ok(points.some(p=>Math.hypot(...p.map((x,k)=>x-expected[k]))<1e-9));
  }
  assert.ok(points.every(p=>p[2]===.2));
  assert.equal(result.report.sectionQueries,0);
  assert.equal(result.report.meshSleeve.offsetControlCount,90);
});

test('fitted mesh motif uses normal plan, level ends, checked export and review settings',async()=>{
  const machine=loadMachine(),plan=defaults(machine),mesh=flutedVase();
  plan.geometry={shape:'mesh',vertices:mesh.vertices.map(([x,y,z])=>[x,y,z/10]),triangles:mesh.triangles,source:null};
  for(const skill of Object.values(plan.skills))skill.enabled=false;
  Object.assign(plan.skills['vase-wall'],{enabled:true,meshSleeve:{...MESH_SLEEVE_SETTINGS,fidelity:.63},
    pattern:{motif:loopMotif({widthCells:1.3,depthMm:1.2,samples:16}),cellsPerTurn:8,courseRiseMm:.2,repeats:6,tiltDeg:0}});
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino()),summary=path.summary.vaseWall;
  assert.equal(summary.meshSleeve.fidelity,.63);
  assert.equal(summary.flatStartMm,.2);assert.equal(summary.levelRimMm,2);
  assert.ok(summary.meshSleeve.compressedSamples>0);
  assert.match(JSON.stringify(skillSettingsRows('vase-wall',plan.skills['vase-wall'])),/63%.*continuous unilateral contact/);
  const program=exportProgram(path,plan,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-15'}),checked=interpretProgram(program,plan,machine);
  assert.ok(checked.moves.length>0);
  const invalid=structuredClone(plan);invalid.skills['vase-wall'].meshSleeve.fidelity=1.001;
  assert.throws(()=>validatePlan(invalid,machine),/fidelity/);
});
