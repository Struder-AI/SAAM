import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeRows,regionRows,robotRows,hasSkill} from '../../studio/settings.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {syntheticDobotSetup} from './fixtures/dobot.mjs';
import {validateSetup,planarWallTolerance} from '../machine/rules.mjs';

test('machine wall precision is reviewable, defaults old snapshots without mutation, and preserves explicit zero',()=>{
  for(const id of ['ultimaker-s5','bambu-h2d','dobot-mg400','denso-vp6242-rc8'])assert.equal(loadMachine(id).planarWallToleranceMm,.01);
  const machine=loadMachine(),plan=defaults(machine);delete machine.planarWallToleranceMm;
  const before=structuredClone(machine);validateSetup(plan,machine);
  assert.deepEqual(machine,before);assert.equal(planarWallTolerance(machine),.01);
  assert.equal(new Map(recipeRows(plan,machine)).get('Machine · Planar wall tolerance'),'0.01 mm');
  machine.planarWallToleranceMm=0;validateSetup(plan,machine);
  assert.equal(new Map(recipeRows(plan,machine)).get('Machine · Planar wall tolerance'),'0 mm');
  for(const invalid of [null,-.01,NaN,Infinity,'0.01']){
    machine.planarWallToleranceMm=invalid;
    assert.throws(()=>validateSetup(plan,machine),/wall tolerance must be finite and nonnegative/);
  }
});

test('Studio reviews region selections and effective overrides rather than inactive global skill flags',()=>{
  const plan=defaults();
  plan.composition.regions=[
    {id:'wall',part:null,zStartMm:0,zEndMm:4,skills:{'vase-wall':{endTransition:'level'}},supportPolicy:'supported'},
    {id:'cap',part:null,zStartMm:4,zEndMm:5,skills:{'full-fill':{perimeters:3}},supportPolicy:'bridge-experimental'},
    {id:'finish',part:null,zStartMm:5,zEndMm:8,skills:{'full-fill':{}},supportPolicy:'supported',lowerSurfaceFrom:'roof'}
  ];
  assert.equal(plan.skills['vase-wall'].enabled,false);
  assert.equal(hasSkill(plan,'vase-wall'),true);
  assert.equal(hasSkill(plan,'draped-skin'),false);
  const rows=new Map(recipeRows(plan));
  assert.equal(rows.get('wall · Vase wall · Wall ending'),'Level rim');
  assert.equal(rows.get('cap · Full fill · Walls'),'3');
  assert.equal(rows.has('cap · Support'),false,'retired policy is not presented as a permission choice');
  assert.equal(rows.has('wall · Vase wall · Point budget'),false,'the retired vase point budget is not presented');
  assert.equal(rows.get('wall · Vase wall · Boundary tolerance'),'0.02 mm');
  assert.match(rows.get('finish · Bottom'),/roof/);
  assert.ok(![...rows.keys()].some(k=>k.startsWith('Draped skin')));
  assert.match(JSON.stringify(regionRows(plan)),/4–5 mm/);
});

test('Studio exposes calibrated robot motion/workspace and sparse settings, retaining zero and signed values',()=>{
  const plan=syntheticDobotSetup(defaults(loadMachine('dobot-mg400'))),rows=new Map(robotRows(plan));
  assert.equal(rows.get('Nozzle orientation'),'0° fixed');
  assert.equal(rows.get('XY calibration offset'),'-100 / -80 mm');
  assert.equal(rows.get('External starting position'),'200, 180, 20 mm in design coordinates');
  assert.equal(rows.get('Controller acceleration limit'),'1000 mm/s²');
  assert.equal(rows.get('Controller workspace minimum'),'-150, -100, 0 mm');
  plan.skills['planar-infill'].enabled=true;plan.skills['planar-infill'].fillAnglesDeg=[30,120];
  plan.composition.order=['a','b'];plan.composition.dependencies=[{before:'b',after:'c'}];
  const recipe=new Map(recipeRows(plan));
  assert.equal(recipe.get('Planar infill · Fill directions'),'30, 120°');
  assert.equal(recipe.get('Requested operation order'),'a → b');
  assert.equal(recipe.get('Additional dependencies'),'b → c');
});
