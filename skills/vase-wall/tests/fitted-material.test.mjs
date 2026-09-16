import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../../../core/print/plan.mjs';
import {generatePath} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {flutedVase} from '../../../core/tests/fixtures/mesh-sleeve.mjs';
import {wavyCladdingPlan} from '../../../core/tests/fixtures/wavy-cladding.mjs';
import {vaseWallResult} from '../scripts/vase.mjs';
import {createVaseMeshReference,MESH_SLEEVE_SETTINGS} from '../scripts/reference.mjs';
import {strokeRegion} from '../../../core/region/stroke.mjs';
import {pointInRegion} from '../../../core/region/region2d.mjs';
import {sectionGeometry} from '../../../core/geom/query.mjs';

const config=()=>({...MESH_SLEEVE_SETTINGS,fidelity:0});
const region=(id,start,end,skills)=>({id,part:null,zStartMm:start,zEndMm:end,skills,lowerSurfaceFrom:null});
test('fitted plain wall publishes its emitted flat ring and places outside centerlines outside the fitted guide',async()=>{
  const shell=flutedVase(),machine=loadMachine(),plan=defaults(machine);
  Object.assign(plan.skills['vase-wall'],{enabled:true,zEndMm:1.2,meshSleeve:config()});
  const inside=vaseWallResult({shell,plan,machine}),boundary=inside.levelBoundary,rim=boundary.strokes[0],stroke=inside.operations[0].strokes[0];
  assert.equal(boundary.zMm,1.2);assert.ok(rim.points.every(p=>Math.abs(p[2]-1.2)<1e-10));
  assert.deepEqual(rim.points,stroke.points.slice(-rim.points.length));
  assert.deepEqual(rim.volumesMm3,stroke.volumesMm3.slice(-rim.volumesMm3.length));
  const footprint=strokeRegion([rim.points.map(p=>p.slice(0,2))],boundary.widthMm);
  assert.ok(rim.points.every(p=>pointInRegion(p,footprint)));
  const original=sectionGeometry(shell,1.2).loops[0];
  assert.ok(original.some(p=>!pointInRegion(p,footprint)),'the original fluted annulus is not a fitted material rim');
  const reference=createVaseMeshReference({shell,settings:plan.skills['vase-wall'],start:.2,end:1.2,width:.4});
  assert.ok(pointInRegion(inside.operations[0].strokes[0].points[0],reference.sectionAt(.2).loops));
  plan.skills['vase-wall'].meshSleeve.contactSide='outside';
  const outside=vaseWallResult({shell,plan,machine});
  assert.ok(!pointInRegion(outside.operations[0].strokes[0].points[0],reference.sectionAt(.2).loops));
  const maxX=result=>Math.max(...result.levelBoundary.strokes[0].points.map(p=>p[0]));
  // Loose offsets preserve the side and control structure, not an exact
  // bead-width separation; exact-distance offsets have their own metric tests.
  assert.ok(maxX(outside)>maxX(inside));
});

test('fitted plain regions retain cap composition and never publish the source mesh as a finished cladding side',async()=>{
  const native=await rhino(),shell=flutedVase(),plan=defaults(),machine=loadMachine();
  plan.geometry={shape:'mesh',vertices:shell.vertices,triangles:shell.triangles,source:null};
  plan.skills['vase-wall'].meshSleeve=config();
  plan.composition.regions=[region('wall',0,1.2,{'vase-wall':{}}),region('cap',1.2,1.6,{'full-fill':{}})];
  const path=generatePath(plan,machine,native);
  assert.equal(path.summary.regions[0].publishedSurface,'rim');
  assert.ok(path.actions.some(a=>a.region==='cap'&&a.volumeMm3>0));
  const clad=wavyCladdingPlan({heightMm:1.2,columns:16,rows:5});
  clad.skills['vase-wall'].meshSleeve=config();
  for(const regional of [false,true]){
    if(regional)clad.composition.regions=[region('wall',0,1.2,{'vase-wall':{}})];
    assert.throws(()=>generatePath(clad,loadMachine('denso-vp6242-rc8'),native),/no finished material producer/);
  }
});
