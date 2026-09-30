import test from 'node:test';
import assert from 'node:assert/strict';
import {h2dColourFixture} from './fixtures/bambu-h2d-colours.mjs';
import {resolveBambuJob} from '../export/bambu-job.mjs';
import {serializeBambuProject} from '../export/bambu-project.mjs';

test('H2D project fields follow job values and explicit array roles for one, two and three filaments',()=>{
  for(const count of [1,2,3]){
    const {plan,machine}=h2dColourFixture();
    plan.setup.bambu.plate='hot_plate';plan.setup.bedC=60;
    plan.setup.bambu.filaments=Array.from({length:count},(_,i)=>({id:'GFA00',colour:['#123456','#ABCDEF','#654321'][i],
      tool:i===2?0:1,source:{type:'auto'},nozzleC:i?210:225}));
    const job=resolveBambuJob(plan,machine,machine.outputs[0]),p=job.projectSettings;
    for(const [key,value]of Object.entries(job.settings)){
      if(key==='filament_map_2')assert.equal(p[key],undefined);
      else assert.deepEqual(p[key],value,`${key} must retain the canonical value`);
    }
    assert.deepEqual(p.nozzle_diameter,['0.4','0.8']);
    assert.deepEqual(p.nozzle_temperature,Array.from({length:count},(_,i)=>i?'210':'225'));
    assert.equal(p.filament_settings_id.length,count);
    assert.equal(p.filament_flush_temp.length,count);
    assert.equal(p.nozzle_volume.length,2);
    assert.equal(p.machine_max_speed_x.length,4);
    assert.equal(p.flush_volumes_matrix.length,2*count*count);
    assert.equal(p.flush_volumes_vector.length,2*count);
    assert.equal(p.enable_prime_tower,'0');
    assert.equal(p.enable_support,'0');
    for(const [key,value]of Object.entries(p).filter(([key])=>key.endsWith('_gcode')))
      assert.ok((Array.isArray(value)?value:[value]).every(v=>v===''),`${key} contains no vendor program`);
    assert.deepEqual(p.extruder_ams_count,['1#0|4#0','1#0|4#1']);
    assert.doesNotMatch(serializeBambuProject(p),/twistedbox|wedge\.stl|#00AE42|#FFFF00/);
    assert.deepEqual(JSON.parse(serializeBambuProject(p)),p);
    plan.setup.bambu.amsConnections=null;
    assert.equal(resolveBambuJob(plan,machine,machine.outputs[0]).projectSettings.extruder_ams_count,undefined,
      'unknown connectivity must not inherit a reference AMS configuration');
  }
});

test('unknown project schema fails instead of falling back to a minimal H2D record',()=>{
  const {plan,machine}=h2dColourFixture();machine.outputs[0].package.projectSchema='unknown';
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/Unknown Bambu project schema/);
  delete machine.outputs[0].package.projectSchema;
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/Unknown Bambu project schema/);
});
