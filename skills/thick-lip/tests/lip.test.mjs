import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {generatePath,buildShell,translateShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {thickLipResult} from '../scripts/lip.mjs';

const region=(id,start,end,skills,lowerSurfaceFrom=null)=>({id,part:null,zStartMm:start,zEndMm:end,skills,lowerSurfaceFrom});
function smallPlan(){const p=defaults();p.geometry={shape:'box',runMm:20,widthMm:16,heightMm:4};p.process.minimumLayerSeconds=0;return p;}
function wallAndLip(steps=undefined){
  const plan=smallPlan();
  plan.composition.regions=[
    region('wall',0,1.2,{'vase-wall':{endTransition:'level'}}),
    region('lip',1.2,null,{'thick-lip':{...(steps!==undefined?{steps}:{})}})
  ];
  return plan;
}

test('each step centers its rings on the wall\'s own centerline, straddling it symmetrically',async()=>{
  const r=await rhino(),plan=smallPlan();
  const shell=translateShell(buildShell(r,plan.geometry),plan.placement.xMm,plan.placement.yMm);
  const width=plan.process.lineWidthMm;
  const result=thickLipResult({shell,plan:{...plan,skills:{...plan.skills,'thick-lip':{...plan.skills['thick-lip'],steps:[1,2,3]}}},zStartMm:1.2});
  assert.equal(result.operations.length,3);
  const halfWidthX=points=>(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])))/2;
  // For an axis-aligned box the offset of a rectangle is another rectangle
  // sharing its center, so each ring's own half-width directly reveals its
  // radial inset: baseline (n=1) sits at width/2 in from the true surface.
  const baselineHalfWidth=halfWidthX(result.operations[0].strokes[0].points);
  const [outerHalf,innerHalf]=result.operations[1].strokes.map(s=>halfWidthX(s.points)).sort((a,b)=>b-a);
  // n=2 straddles the baseline by half a spacing on each side: the outer
  // ring is one half-bead wider, the inner one half-bead narrower.
  assert.ok(Math.abs(outerHalf-(baselineHalfWidth+width/2))<1e-6);
  assert.ok(Math.abs(innerHalf-(baselineHalfWidth-width/2))<1e-6);
  const triple=result.operations[2].strokes.map(s=>halfWidthX(s.points)).sort((a,b)=>b-a);
  // n=3 straddles the same baseline by a full spacing on each side, with the
  // middle ring exactly on it - the outermost ring can land outside the true
  // modeled surface (a larger half-width than the box's own half-run), which
  // is the intended, if untested, centered-not-confined behavior.
  assert.ok(Math.abs(triple[0]-(baselineHalfWidth+width))<1e-6);
  assert.ok(Math.abs(triple[1]-baselineHalfWidth)<1e-6);
  assert.ok(Math.abs(triple[2]-(baselineHalfWidth-width))<1e-6);
});

test('a rim finish requires a level-ended vase-wall directly below it, cannot share its region, and needs its own component-level enable path',async()=>{
  const r=await rhino(),machine=loadMachine();
  const spiral=wallAndLip();spiral.composition.regions[0].skills['vase-wall'].endTransition='spiral';
  assert.throws(()=>generatePath(spiral,machine,r),/level/);

  const level=wallAndLip([2,3,2]);
  const path=generatePath(level,machine,r);
  const lipMoves=path.actions.filter(a=>a.volumeMm3>0&&a.role?.startsWith('lip-step-'));
  assert.ok(lipMoves.length>0);
  assert.ok(lipMoves.every(a=>a.to[2]>=1.2-1e-8));
  // Three ordered layers above the wall: 2, 3, then 2 perimeters again.
  const byLayer=new Map();
  for(const move of lipMoves){const z=move.to[2].toFixed(6);byLayer.set(z,(byLayer.get(z)??0)+1);}
  assert.ok([...byLayer.keys()].length>=3,'at least three distinct lip layer heights');

  const shared=wallAndLip();
  shared.composition.regions[1].skills['full-fill']={mode:'body'};
  assert.throws(()=>generatePath(shared,machine,r),/rim finish cannot also assign/);

  const orphan=smallPlan();
  orphan.composition.regions=[region('base',0,1,{'full-fill':{mode:'body'}}),region('lip',1,null,{'thick-lip':{}})];
  assert.throws(()=>generatePath(orphan,machine,r),/must sit directly above a level-ended vase-wall/);

  const nonRegional=smallPlan();nonRegional.skills['thick-lip'].enabled=true;
  assert.throws(()=>generatePath(nonRegional,machine,r),/only applies through composition.regions/);
});

test('thick-lip steps validate their bounds',async()=>{
  const machine=loadMachine(),plan=wallAndLip();
  const empty=wallAndLip();empty.composition.regions[1].skills['thick-lip']={steps:[]};
  assert.throws(()=>validatePlan(empty,machine),/Lip steps/);
  const tooMany=wallAndLip();tooMany.composition.regions[1].skills['thick-lip']={steps:Array(51).fill(1)};
  assert.throws(()=>validatePlan(tooMany,machine),/Lip steps/);
  const outOfRange=wallAndLip();outOfRange.composition.regions[1].skills['thick-lip']={steps:[0]};
  assert.throws(()=>validatePlan(outOfRange,machine),/Lip steps/);
  validatePlan(plan,machine); // default [2] is valid
  // More than about eight perimeters is only advice; a request for more prints.
  const many=wallAndLip([24]);
  validatePlan(many,machine);
  const r=await rhino();
  const lipMoves=generatePath(many,machine,r).actions.filter(a=>a.volumeMm3>0&&a.role?.startsWith('lip-step-'));
  assert.ok(lipMoves.length>0);
});
