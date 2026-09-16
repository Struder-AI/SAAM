import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {flutedVase} from '../../../core/tests/fixtures/mesh-sleeve.mjs';
import {MESH_SLEEVE_SETTINGS} from '../scripts/reference.mjs';
import {skillSettingsRows} from '../../../studio/settings.mjs';

test('mesh fidelity and offset tightness remain independent editable plan settings',()=>{
  const machine=loadMachine(),plan=defaults(machine),mesh=flutedVase();
  plan.geometry={shape:'mesh',vertices:mesh.vertices,triangles:mesh.triangles,source:null};
  const wall=plan.skills['vase-wall'];
  wall.meshSleeve={...MESH_SLEEVE_SETTINGS,fidelity:.37};
  for(const offsetTightness of [0,.27,1]){
    wall.meshSleeve.offsetTightness=offsetTightness;
    assert.doesNotThrow(()=>validatePlan(plan,machine));
    assert.equal(wall.meshSleeve.fidelity,.37);
    const rows=skillSettingsRows('vase-wall',wall);
    assert.ok(rows.some(([label,value])=>label.endsWith('Offset tightness')&&value.startsWith(offsetTightness*100+'%')));
  }
  delete wall.meshSleeve.offsetTightness;
  assert.doesNotThrow(()=>validatePlan(plan,machine),'older mesh recipes omit the optional setting');
  for(const invalid of [-.01,1.01,NaN,null,'0.5']){
    wall.meshSleeve.offsetTightness=invalid;
    assert.throws(()=>validatePlan(plan,machine),/offset tightness/);
  }
});
