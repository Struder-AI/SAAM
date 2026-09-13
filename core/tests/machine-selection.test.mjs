import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadMachine,validateSetup} from '../machine/profile.mjs';
import {MATERIAL_IDS,applyToolSelection,hotendFor} from '../material/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {initBundle,loadBundle,approve,updatePlan,rememberSetup,generateBundle} from '../print/bundle.mjs';

const ACTOR='SYNTHETIC TEST REVIEWER — not a real approval';

test('machine profiles declare researched nozzle/core combinations',()=>{
  const h2d=loadMachine('bambu-h2d');
  for(const tool of h2d.tools)assert.deepEqual(tool.hotends.map(item=>item.nozzleMm),[.2,.4,.6,.8]);
  const s5=loadMachine('ultimaker-s5'),combinations=s5.tools[0].hotends.map(item=>`${item.core}:${item.nozzleMm}`);
  assert.deepEqual(combinations,['AA 0.25:0.25','AA 0.4:0.4','AA 0.8:0.8','BB 0.4:0.4','BB 0.8:0.8','CC 0.4:0.4','CC 0.6:0.6']);
  assert.throws(()=>hotendFor(s5,0,'AA 0.4',.6),/not supported/);
  assert.deepEqual(MATERIAL_IDS,['PLA','PETG','ABS','ASA','TPU','PA','PC','PP','PVA','BVOH','PA-CF']);
});

test('selected nozzle and material derive process defaults and validate the combination',()=>{
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  applyToolSelection(plan,machine,{tool:1,core:'Hardened steel 0.8',nozzleMm:.8,material:'PETG'});
  assert.deepEqual({tool:plan.setup.tool,nozzle:plan.setup.nozzleMm,material:plan.setup.material,layer:plan.process.layerMm,width:plan.process.lineWidthMm},
    {tool:1,nozzle:.8,material:'PETG',layer:.4,width:.8});
  validateSetup(plan,machine);
  plan.process.layerMm=.7;assert.throws(()=>validateSetup(plan,machine),/Layer height/);
  plan.process.layerMm=.4;plan.process.lineWidthMm=.5;assert.throws(()=>validateSetup(plan,machine),/Line width/);
  const s5=loadMachine('ultimaker-s5'),support=defaults(s5);
  assert.throws(()=>applyToolSelection(support,s5,{tool:0,core:'AA 0.4',nozzleMm:.4,material:'PVA'}),/not supported/);
  assert.throws(()=>applyToolSelection(support,s5,{tool:0,core:'CC 0.4',nozzleMm:.4,material:'PA-CF'}),/at least a 0.6 mm nozzle/);
});

test('setup changes invalidate plan/toolpath, persist locally, and legacy 0.4 bundles reopen',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'saam-machine-selection-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const setupFile=resolve(dir,'remembered.json'),plan=defaults();plan.geometry={shape:'box',runMm:12,widthMm:12,heightMm:2};plan.skills['draped-skin'].enabled=false;
  await initBundle(dir,plan,{setupFile});let state=await loadBundle(dir,{program:false});
  state=await approve(dir,{stage:'geometry',actor:ACTOR,revision:state.revision});state=await approve(dir,{stage:'plan',actor:ACTOR,revision:state.revision});
  await generateBundle(dir);state=await loadBundle(dir);state=await approve(dir,{stage:'toolpath',actor:ACTOR,revision:state.revision});
  const changed=structuredClone(state.plan);applyToolSelection(changed,state.machine,{tool:0,core:'AA 0.8',nozzleMm:.8,material:'PLA'});
  await updatePlan(dir,changed,state.revision);state=await loadBundle(dir,{program:false});
  assert.equal(state.geometryApproved,true);assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);assert.equal(state.review.generation,null);
  await rememberSetup(dir,{setupFile});const remembered=JSON.parse(await readFile(setupFile,'utf8'));assert.equal(remembered.setup.nozzleMm,.8);

  const legacyPlan=structuredClone(plan),legacyMachine=loadMachine('ultimaker-s5');delete legacyPlan.setup.toolSetups;delete legacyMachine.defaultSetup.toolSetups;
  for(const tool of legacyMachine.tools)delete tool.hotends;
  await writeFile(resolve(dir,'plan.json'),JSON.stringify(legacyPlan,null,2)+'\n');await writeFile(resolve(dir,'machine.json'),JSON.stringify(legacyMachine,null,2)+'\n');
  state=await loadBundle(dir,{program:false});assert.equal(state.plan.setup.nozzleMm,.4);assert.equal(state.plan.setup.toolSetups.length,2);
});
