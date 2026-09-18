import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MACHINE_IDS,loadMachine,checkMachinePath} from '../machine/profile.mjs';
import {defaults,validatePlan} from '../print/plan.mjs';
import {outputAdapter} from '../export/registry.mjs';
import {initBundle,loadBundle,adjustBundle,generateBundle,proposedPlan} from '../print/bundle.mjs';

const ids=['bambu-x1-carbon','ultimaker-2-extended','ultimaker-3'];

test('new printer profiles provide valid planar defaults and distinguish hardware/output contracts',()=>{
  for(const id of ids){
    assert.ok(MACHINE_IDS.includes(id));
    const machine=loadMachine(id),plan=defaults(machine);
    validatePlan(plan,machine);
    assert.equal(plan.setup.material,'PLA');
    assert.equal(plan.skills['draped-skin'].enabled,false);
    if(id==='bambu-x1-carbon')assert.ok(outputAdapter(plan,machine).exportAndInterpret,'X1 Carbon uses the shared Bambu adapter');
    else assert.throws(()=>outputAdapter(plan,machine),/export is not implemented/);
    const nonplanar=structuredClone(plan);nonplanar.skills['draped-skin'].enabled=true;
    assert.throws(()=>validatePlan(nonplanar,machine),/nonplanar/);
  }
  const x1=loadMachine(ids[0]),um2=loadMachine(ids[1]),um3=loadMachine(ids[2]);
  assert.deepEqual(x1.bounds.max,[256,256,256]);assert.equal(x1.filamentDiameterMm,1.75);
  assert.deepEqual(um2.bounds.max,[223,223,305]);assert.equal(um2.tools.length,1);
  assert.equal(um2.outputs[0].flavor,'UltiGCode');assert.equal(um2.outputs[0].extrusionUnits,'mm3');
  assert.equal(um3.bounds.max[2],200);assert.equal(um3.tools.length,2);
  assert.equal(um3.outputs[0].flavor,'Griffin');assert.equal(um3.filamentDiameterMm,2.85);
  const wrong=defaults(um2);wrong.setup.tool=1;assert.throws(()=>validatePlan(wrong,um2),/Selected tool/);
  const right=defaults(um3);right.setup.tool=1;validatePlan(right,um3);
  right.setup.core='BB 0.4';assert.throws(()=>validatePlan(right,um3),/Nozzle\/core/);
});

test('material changes use their own process limits instead of locking the X1 to PLA',()=>{
  const machine=loadMachine('bambu-x1-carbon');
  for(const [material,nozzleC,bedC,maxFlowMm3S] of [
    ['PETG',250,70,4],['ABS',250,95,4],['ASA',260,95,4],['PC',280,100,4],['TPU',230,40,2]
  ]){
    const plan=defaults(machine);Object.assign(plan.setup,{material,nozzleC,bedC});plan.process.maxFlowMm3S=maxFlowMm3S;
    validatePlan(plan,machine);
    plan.setup.nozzleC=215;assert.throws(()=>validatePlan(plan,machine),/Material nozzle temperature/);
  }
  for(const id of ids.slice(1)){
    const machine=loadMachine(id),plan=defaults(machine);Object.assign(plan.setup,{material:'ABS',nozzleC:250,bedC:90});
    validatePlan(plan,machine);
  }
});

test('selected-tool bounds exclude cutter and glass clip regions',()=>{
  for(const [id,inside,outside] of [
    ['bambu-x1-carbon',[100,100,20],[10,10,20]],
    ['ultimaker-2-extended',[100,100,20],[5,2,20]],
    ['ultimaker-3',[100,100,20],[220,20,20]]
  ]){
    const machine=loadMachine(id),plan=defaults(machine);
    checkMachinePath({initialPosition:inside,actions:[]},plan,machine);
    assert.throws(()=>checkMachinePath({initialPosition:outside,actions:[]},plan,machine),/tool bounds/);
    assert.throws(()=>checkMachinePath({initialPosition:inside,actions:[{kind:'move',to:outside,speedMmS:10,volumeMm3:0}]},plan,machine),/tool bounds/);
  }
});

test('profiles without an exporter persist through shared setup review and refuse output before path construction',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-printer-profiles-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const id of ids.slice(1)){
    const directory=join(root,id),setupFile=join(root,id+'-setup.json');
    await initBundle(directory,undefined,{machineId:id,setupFile});
    let state=await loadBundle(directory,{program:false});
    assert.equal(state.machine.id,id);assert.equal(state.toolpathApproved,false);
    await adjustBundle(directory,{setup:{material:'ABS',nozzleC:250,bedC:95}},{expectedRevision:state.revision,setupFile});
    state=await loadBundle(directory,{program:false});assert.equal(state.plan.setup.material,'ABS');
    assert.equal((await proposedPlan(id,{setupFile})).setup.material,'ABS');
    const progress=[];
    await assert.rejects(generateBundle(directory,{development:true,onProgress:event=>progress.push(event)}),/export is not implemented/);
    assert.ok(!progress.some(event=>event.stage==='Preparing geometry'));
    await assert.rejects(access(join(directory,'exports')),/ENOENT/);
    assert.equal((await loadBundle(directory,{program:false})).toolpathApproved,false);
  }
});
