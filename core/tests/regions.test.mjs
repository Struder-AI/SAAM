import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../print/plan.mjs';
import {generatePath,buildShell,translateShell} from '../print/generate.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {rhino} from '../print/geometry.mjs';
import {topAt} from '../geom/query.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {regionalStackPlan} from './fixtures/regional-stack.mjs';
import {vaseWallResult} from '../../skills/vase-wall/scripts/vase.mjs';

const region=(id,start,end,skills,lowerSurfaceFrom=null)=>({id,part:null,zStartMm:start,zEndMm:end,skills,lowerSurfaceFrom});
function smallPlan(){const p=defaults();p.geometry={shape:'box',runMm:8,widthMm:6,heightMm:2};p.process.minimumLayerSeconds=0;return p;}

test('six-stage regional stack keeps ownership, transitions and horizontal wavy-bottom fill across three machines and two native backends',async()=>{
  const r=await rhino();
  for(const id of ['ultimaker-s5','bambu-h2d','dobot-mg400'])for(const backend of ['mesh','spline']) {
    const machine=loadMachine(id),plan=regionalStackPlan(machine,backend),path=generatePath(plan,machine,r);
    const deposition=path.actions.filter(a=>a.volumeMm3>0),order=[...new Set(deposition.map(a=>a.region).filter(Boolean))];
    assert.deepEqual(order,['base','wall','cap','roof-finish','above-roof']);
    assert.ok(deposition.filter(a=>a.region==='base').every(a=>a.to[2]<=0.4+1e-8));
    assert.ok(deposition.filter(a=>a.region==='wall').every(a=>a.to[2]>=0.6-1e-8&&a.to[2]<=1.2+1e-8));
    assert.ok(deposition.filter(a=>a.region==='cap').every(a=>a.to[2]>=1.4-1e-8&&a.to[2]<=1.6+1e-8));
    assert.ok(deposition.some(a=>a.region==='roof-finish'&&a.role==='infill'));
    const firstSkin=deposition.findIndex(a=>a.phase==='draped-skin'),lastSparse=deposition.findLastIndex(a=>a.role==='infill');assert.ok(firstSkin>lastSparse);
    const upper=deposition.filter(a=>a.region==='above-roof');assert.ok(upper.some(a=>Math.abs(a.to[2]-3.2)<1e-8),'first horizontal layer intersects the wavy lower surface');
    assert.ok(upper.some(a=>a.gapMm>0&&a.gapMm<0.19),'partial thickness retained');
    const roof=translateShell(buildShell(r,plan.geometry.parts[0].geometry),plan.placement.xMm,plan.placement.yMm);
    let previous=path.initialPosition;
    for(const action of path.actions)if(action.kind==='move') {
      if(action.region==='above-roof'&&action.volumeMm3>0) {
        assert.ok(Math.abs(action.to[2]-previous[2])<1e-9,'fullfill above drape remains horizontal');
        for(const point of [previous,action.to]) {
          const roofZ=topAt(roof,point[0],point[1]).zMm;
          assert.ok(point[2]>=roofZ-0.001,'no deposition below the consumed material surface');
        }
        const length=Math.hypot(...action.to.map((v,i)=>v-previous[i]));
        assert.ok(Math.abs(action.volumeMm3-length*plan.process.lineWidthMm*action.gapMm)<1e-8);
      }
      previous=action.to;
    }
    const bytes=exportProgram(path,plan,machine,{generatorVersion:'0.1.0',buildDate:'2026-09-09'}),program=interpretProgram(bytes,plan,machine);
    const expected=path.actions.filter(a=>a.kind==='move');assert.equal(program.moves.length,expected.length);
    expected.forEach((move,i)=>{
      move.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<1.1e-5));
      assert.ok(Math.abs(move.volumeMm3-program.moves[i].volumeMm3)<=1e-4,'interpreted commanded volume preserves each variable-gap deposition move');
    });
    assert.ok(program.moves.some(m=>m.operation?.startsWith('above-roof:')));
    assert.equal(path.summary.regions.at(-1).lowerSurfaceFrom,'roof-finish');
  }
});

test('level vase ending fills exactly the remaining partial-turn material gap',async()=>{
  const plan=smallPlan();plan.skills['vase-wall'].enabled=true;plan.skills['vase-wall'].endTransition='level';plan.skills['vase-wall'].zEndMm=1.3;
  const result=vaseWallResult({shell:buildShell(await rhino(),plan.geometry),plan,machine:loadMachine()}),stroke=result.operations[0].strokes[0];
  assert.equal(result.report.levelRimMm,1.3);assert.ok(Math.abs(stroke.points.at(-1)[2]-1.3)<1e-9);
  const flat=stroke.points.filter(p=>Math.abs(p[2]-1.3)<1e-9);assert.ok(flat.length>30);
  const perimeter=2*((8-0.4)+(6-0.4)),ideal=perimeter*0.4*1.3;
  assert.ok(Math.abs(result.report.volumeMm3-ideal)<ideal*0.005,'foundation, rise and leveling fill height once');
  assert.ok(stroke.volumesMm3.at(-1)<stroke.volumesMm3.at(-20),'leveling thickness ends at zero');
});

test('a cap needs a level recipe boundary, while bridging needs no policy or support-coverage gate',async()=>{
  const r=await rhino(),machine=loadMachine(),plan=smallPlan();
  plan.composition.regions=[region('base',0,0.4,{'full-fill':{mode:'body'}}),region('wall',0.4,1.2,{'vase-wall':{endTransition:'spiral'}}),region('cap',1.2,2,{'full-fill':{mode:'body'}})];
  assert.throws(()=>generatePath(plan,machine,r),/level vase ending/);
  plan.composition.regions[1].skills['vase-wall'].endTransition='level';
  const expected=generatePath(plan,machine,r);
  assert.ok(expected.actions.some(a=>a.region==='cap'&&a.volumeMm3>0));
  for(const legacyPolicy of ['supported','bridge-experimental']) {
    plan.composition.regions[2].supportPolicy=legacyPolicy;
    assert.deepEqual(generatePath(plan,machine,r),expected,'retired policy has no effect on path or summary');
  }
  plan.composition.regions[2].zStartMm=1;assert.throws(()=>generatePath(plan,machine,r),/Overlapping material/);
  plan.composition.regions=[region('unsupported-base',0,0.4,{'planar-infill':{perimeters:0}}),region('wall',0.4,2,{'vase-wall':{endTransition:'level'}})];
  assert.ok(generatePath(plan,machine,r).actions.some(a=>a.role==='vase-wall'));
});

test('solid and sparse tops retain their coverage descriptions without bridge permission',async()=>{
  const r=await rhino(),machine=loadMachine(),plan=smallPlan();
  plan.composition.regions=[region('body',0,1,{'planar-infill':{},'full-fill':{mode:'solid-surfaces',topLayers:1,bottomLayers:1}}),region('upper',0,2,{'full-fill':{mode:'body'}},'body')];
  assert.equal(generatePath(plan,machine,r).summary.regions[0].publishedSurface,'area');
  plan.composition.regions[0].skills['full-fill'].topLayers=0;
  assert.equal(generatePath(plan,machine,r).summary.regions[0].publishedSurface,'sparse');
});

test('surface consumers cannot skip valleys, invent missing coverage or form dependency cycles',async()=>{
  const r=await rhino(),machine=loadMachine(),plan=regionalStackPlan(machine,'mesh');
  plan.composition.regions.at(-1).zStartMm=3.6;assert.throws(()=>generatePath(plan,machine,r),/skips material/);
  plan.composition.regions.at(-1).zStartMm=0;plan.geometry.parts[1].geometry.runMm=9;assert.throws(()=>generatePath(plan,machine,r),/does not cover the consumer/);
  const cycle=smallPlan();cycle.composition.regions=[region('a',0,1,{'full-fill':{}},'b'),region('b',0,2,{'full-fill':{}},'a')];
  assert.throws(()=>generatePath(cycle,machine,r),/cycle/);
  cycle.composition.regions[0].lowerSurfaceFrom='missing';assert.throws(()=>validatePlan(cycle,machine),/Unknown.*surface/);
});

test('explicit regional process overrides produce independently anchored thick courses',async()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry={shape:'box',runMm:8,widthMm:6,heightMm:3.2};plan.process.minimumLayerSeconds=0;
  plan.geometry.heightMm=3.2;plan.process.experimentalDeposition=true;plan.process.maxFlowMm3S=15;
  plan.composition.regions=[
    {...region('lower',0,1.2,{'full-fill':{}}),process:{firstLayerMm:.6,layerMm:.6,lineWidthMm:.8,firstLayerSpeedMmS:20,planarSpeedMmS:20}},
    {...region('upper',1.2,3.2,{'planar-infill':{perimeters:1,perimeterScope:'outer',density:0}}),process:{firstLayerMm:1,layerMm:1,lineWidthMm:2,firstLayerSpeedMmS:7.5,planarSpeedMmS:7.5}}
  ];
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino()),moves=path.actions.filter(a=>a.volumeMm3>0);
  assert.deepEqual([...new Set(moves.map(a=>a.to[2]))],[.6,1.2,2.2,3.2]);
  assert.deepEqual([...new Set(moves.map(a=>a.layer))],[0,1,2,3]);
  assert.ok(moves.filter(a=>a.region==='upper').some(a=>a.role==='perimeter'));
  assert.ok(moves.every(a=>a.speedMmS*a.volumeMm3/distanceFor(a,path)<=15+1e-7));
});

test('a locked prime line establishes the requested first-layer bead before every model operation',async()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.geometry={shape:'box',runMm:8,widthMm:6,heightMm:.6};plan.placement={xMm:20,yMm:20};
  plan.skills['draped-skin'].enabled=false;
  Object.assign(plan.process,{firstLayerMm:.6,layerMm:.6,lineWidthMm:2,experimentalDeposition:true,maxFlowMm3S:25,minimumLayerSeconds:0,
    primeLine:{passes:[
      {startMm:[10,20],endMm:[10,50],zMm:.6,widthMm:1,heightMm:.6,speedMmS:8},
      {startMm:[12,50],endMm:[12,20],zMm:.6,widthMm:2,heightMm:.6,speedMmS:10}
    ]}});
  const path=generatePath(plan,machine,await rhino()),deposition=path.actions.filter(a=>a.kind==='move'&&a.volumeMm3>0);
  assert.equal(deposition[0].role,'prime-line');assert.equal(deposition[0].volumeMm3,18);
  assert.equal(deposition[1].role,'prime-line');assert.equal(deposition[1].volumeMm3,36);
  assert.ok(deposition.slice(2).every(a=>a.operation!=='prime-line:0'));
  assert.equal(path.summary.primeLine.volumeMm3,54);assert.equal(path.summary.primeLine.passes,2);
});

function distanceFor(action,path){
  let from=path.initialPosition;
  for(const candidate of path.actions){if(candidate===action)return Math.hypot(...action.to.map((v,i)=>v-from[i]));if(candidate.kind==='move')from=candidate.to;}
  return Infinity;
}
