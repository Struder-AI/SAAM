import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine,checkMachinePath} from '../../../core/machine/profile.mjs';
import {generatePath,buildShell,translateShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {supportResults,assignedSupportSection} from '../scripts/supports.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';
import {exportProgram,interpretProgram} from '../../../core/export/registry.mjs';
import {syntheticDobotSetup} from '../../../core/tests/fixtures/dobot.mjs';
import {initBundle,loadBundle,generateBundle,approve,deliver,adjustBundle} from '../../../core/print/bundle.mjs';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {recipeRows,hasSkill} from '../../../studio/settings.mjs';

export function supportPlan(machine=loadMachine(),style='standard'){
  const plan=defaults(machine);plan.geometry={shape:'assembly',parts:[
    {id:'post',geometry:boxMesh(5,8,3),xMm:0,yMm:0,zMm:0},
    {id:'ledge',geometry:boxMesh(8,8,1),xMm:5,yMm:0,zMm:3}]};
  plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
  plan.skills.supports.enabled=true;
  plan.skills.supports.assignments=[{id:'ledge-support',style,reason:'Support the explicitly selected free end of the ledge.',contactZMm:3,
    footprint:style==='standard'?[[[7,1],[12,1],[12,7],[7,7]]]:[],
    treeNodes:style==='tree'?[
      {id:'root',parent:null,point:[10,4,0],radiusMm:1.2},
      {id:'fork',parent:'root',point:[10,4,1.2],radiusMm:1.1},
      {id:'tip-a',parent:'fork',point:[9,3,2.8],radiusMm:0.8},
      {id:'tip-b',parent:'fork',point:[11,5,2.8],radiusMm:0.8}]:[]}];
  return plan;
}

test('support dependency lookup chooses the final existing layer below each operation extent',()=>{
  const plan=supportPlan();
  const heights=[-0.1,0.19,0.2,0.6-5e-9,1.1,2.8,9];
  const modelResults=[{operations:heights.map((high,i)=>({id:'model:'+i,after:[],strokes:[{points:[[0,0,high-0.1],[0,0,high]]}]}))}];
  const results=supportResults({plan,shells:[],modelResults}),supports=results.flatMap(r=>r.operations);
  for(const [i,high] of heights.entries()){
    const eligible=supports.filter(op=>op.rank<=high+1e-8);
    const finalRank=eligible.reduce((rank,op)=>Math.max(rank,op.rank),-Infinity);
    assert.deepEqual(modelResults[0].operations[i].after,eligible.filter(op=>op.rank===finalRank).map(op=>op.id));
  }
});

test('no support is inferred on overhangs and enabling requires explicit assignments',async()=>{
  const plan=supportPlan();plan.skills.supports.enabled=false;plan.skills.supports.assignments=[];
  assert.ok(generatePath(plan,loadMachine(),await rhino()).actions.every(a=>a.phase!=='supports'));
  plan.skills.supports.enabled=true;assert.throws(()=>validatePlan(plan,loadMachine()),/explicitly assigned/);
  plan.skills.supports.overhangAngleDeg=45;assert.throws(()=>validatePlan(plan,loadMachine()),/Unexpected/);
});

test('conventional and tree supports use shared export-ready composition and interface gaps on S5/H2D',async()=>{
  const r=await rhino();
  for(const machineId of ['ultimaker-s5','bambu-h2d'])for(const style of ['standard','tree']){
    const machine=loadMachine(machineId),plan=supportPlan(machine,style);plan.composition.batchLayers=3;
    const path=generatePath(plan,machine,r);checkMachinePath(path,plan,machine);
    const support=path.actions.filter(a=>a.phase==='supports'&&a.volumeMm3>0);
    assert.ok(support.length>0&&support.some(a=>a.role==='support-interface'));
    assert.ok(Math.abs(Math.max(...support.map(a=>a.to[2]))-2.8)<1e-8);
    const firstLedge=path.actions.findIndex(a=>a.operation?.startsWith('ledge:')&&a.volumeMm3>0);
    assert.ok(path.actions.slice(firstLedge).every(a=>!(a.phase==='supports'&&a.volumeMm3>0)),'supports complete before ledge deposition');
    assert.ok(Math.abs(path.summary.supports[0].assignments[0].actualTopGapMm-0.2)<1e-8);
  }
});

test('tree branches split above a shared trunk; overlapping assigned footprints are deposited once',async()=>{
  const plan=supportPlan(loadMachine(),'tree'),a=plan.skills.supports.assignments[0];
  const trunk=assignedSupportSection(a,0.5,plan.skills.supports),tips=assignedSupportSection(a,2.8,plan.skills.supports);
  assert.equal(trunk.length,1);assert.equal(tips.length,2);
  const simple=supportPlan(),r=await rhino();
  const once=generatePath(simple,loadMachine(),r).actions.filter(a=>a.phase==='supports').reduce((s,a)=>s+(a.volumeMm3??0),0);
  simple.skills.supports.assignments.push({...structuredClone(simple.skills.supports.assignments[0]),id:'same-area'});
  const twice=generatePath(simple,loadMachine(),r).actions.filter(a=>a.phase==='supports').reduce((s,a)=>s+(a.volumeMm3??0),0);
  assert.ok(Math.abs(once-twice)<1e-7);
});

test('assigned geometry conflicts and malformed or floating trees fail with actionable errors',async()=>{
  const r=await rhino(),plan=supportPlan();plan.skills.supports.assignments[0].footprint=[[[0,0],[3,0],[3,3],[0,3]]];
  assert.throws(()=>generatePath(plan,loadMachine(),r),/intersects part clearance/);
  const tree=supportPlan(loadMachine(),'tree');tree.skills.supports.assignments[0].treeNodes[0].point[2]=0.1;
  assert.throws(()=>validatePlan(tree,loadMachine()),/roots must start on the bed/);
  tree.skills.supports.assignments[0].style='rimming';assert.throws(()=>validatePlan(tree,loadMachine()),/rimming skill/);
});

test('support construction uses the same geometry queries for a spline assembly',async()=>{
  const plan=supportPlan();plan.geometry.parts[0].geometry={shape:'box',runMm:5,widthMm:8,heightMm:3};
  plan.geometry.parts[1].geometry={shape:'box',runMm:8,widthMm:8,heightMm:1};
  const path=generatePath(plan,loadMachine(),await rhino());assert.ok(path.actions.some(a=>a.role==='support-interface'));
});

test('both support styles round trip all machine exports alongside region-selected infill',async()=>{
  const r=await rhino();
  for(const machineId of ['ultimaker-s5','bambu-h2d','dobot-mg400'])for(const style of ['standard','tree']){
    const machine=loadMachine(machineId),plan=supportPlan(machine,style);
    if(machineId==='dobot-mg400')syntheticDobotSetup(plan);
    plan.composition.regions=plan.geometry.parts.map(p=>({id:p.id,part:p.id,zStartMm:0,zEndMm:null,lowerSurfaceFrom:null,
      skills:{'planar-infill':{pattern:'concentric'},'full-fill':{mode:'solid-surfaces',topLayers:1,bottomLayers:1}}}));
    const path=generatePath(plan,machine,r),bytes=exportProgram(path,plan,machine,{generatorVersion:'synthetic-test',buildDate:'2026-09-10'}),program=interpretProgram(bytes,plan,machine);
    const expected=path.actions.filter(a=>a.kind==='move');assert.equal(program.moves.length,expected.length);
    expected.forEach((m,i)=>{m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6));assert.ok(Math.abs(m.volumeMm3-program.moves[i].volumeMm3)<1e-4);});
    assert.ok(program.moves.some(m=>m.phase==='supports'));
    assert.equal(hasSkill(plan,'supports'),true);
    const rows=recipeRows(plan);assert.ok(rows.some(([label,value])=>label.includes('ledge-support')&&value.includes(style)));
    assert.ok(rows.every(([,value])=>!value.includes('[object Object]')));
  }
});

test('assigned support recipe survives bundle review and exact delivery; edits invalidate the plan',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-support-synthetic-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const actor='SYNTHETIC SUPPORT TEST — not human approval';
  await initBundle(dir,supportPlan());
  await generateBundle(dir);
  let state=await loadBundle(dir);assert.ok(state.skills.includes('supports'));
  assert.ok(!(await readdir(dir)).includes('path.saampath'));
  await approve(dir,{stage:'toolpath',actor,revision:state.revision});
  state=await loadBundle(dir);assert.equal(state.toolpathApproved,true);
  const delivery=await deliver(dir);assert.deepEqual(await readFile(delivery),await readFile(join(dir,'exports/griffin-gcode/part.gcode')));
  const assignments=structuredClone(state.plan.skills.supports.assignments);assignments[0].reason='Changed chosen contact rationale';
  await adjustBundle(dir,{skills:{supports:{assignments}}});
  state=await loadBundle(dir);assert.equal(state.geometryApproved,false);assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
});
